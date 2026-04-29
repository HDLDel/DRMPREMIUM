const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');

const PORT = 3000;
const CHANNELS_DIR = path.join(__dirname, 'canais'); // Pasta onde os .m3u8 e playlists dos canais serão gerados
const VIDEO_SOURCE = path.join(__dirname, '24HORAS'); // Pasta raiz dos vídeos
const NGINX_LOG = process.platform === 'win32' ? path.join(__dirname, 'access.log') : '/var/log/nginx/iptv.log';

// No Windows, se o ffmpeg não estiver no PATH, coloque o caminho completo aqui.
// Exemplo: 'C:\\ffmpeg\\bin\\ffmpeg.exe'
const FFMPEG_PATH = 'ffmpeg'; 

const CHANNELS_DB_FILE = path.join(__dirname, 'channels.json');

// Global array to hold channel configurations
let channels = []; // { id: 1, name: 'Filmes de Acao', sourceFolder: 'Filmes_Acao', playlistFilePath: '...', status: 'offline' }
let nextChannelId = 1; // Simple ID counter

// Variáveis para cálculo de rede
let prevBytesSent = 0;
let lastNetTime = Date.now();

async function loadChannels() {
    if (fs.existsSync(CHANNELS_DB_FILE)) {
        const data = await fs.promises.readFile(CHANNELS_DB_FILE, 'utf8');
        channels = JSON.parse(data).map(c => ({
            ...c,
            inputType: c.inputType || 'concat' // Fallback para canais antigos
        }));
        if (channels.length > 0) {
            nextChannelId = Math.max(...channels.map(c => c.id)) + 1;
        }
        console.log(`Loaded ${channels.length} channels from ${CHANNELS_DB_FILE}`);
    }
}

async function saveChannels() {
    await fs.promises.writeFile(CHANNELS_DB_FILE, JSON.stringify(channels, null, 2), 'utf8');
    console.log(`Saved ${channels.length} channels to ${CHANNELS_DB_FILE}`);
}

// Helper para listar subdiretórios recursivamente para a seleção no Dashboard
async function getDirectoriesRecursive(base, root = base) {
    let results = ["."]; // Inclui a própria raiz
    async function walk(dir) {
        try {
            const list = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const dirent of list) {
                if (dirent.isDirectory()) {
                    const res = path.join(dir, dirent.name);
                    results.push(path.relative(root, res));
                    await walk(res);
                }
            }
        } catch (e) {}
    }
    if (fs.existsSync(base)) await walk(base);
    return results;
}

// Helper para buscar todos os arquivos MP4 recursivamente em uma pasta
async function getFilesRecursive(dir, extension) {
    let results = [];
    try {
        const list = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const dirent of list) {
            const res = path.join(dir, dirent.name);
            if (dirent.isDirectory()) {
                results = results.concat(await getFilesRecursive(res, extension));
            } else if (path.extname(dirent.name).toLowerCase() === extension && fs.statSync(res).size > 0) {
                // Filtra arquivos vazios (0 bytes) que causam erro de 'moov atom'
                results.push(res);
            }
        }
    } catch (e) {}
    return results;
}

// Armazena os processos FFmpeg ativos
const activeStreams = new Map();

/**
 * Helper para validar integridade do vídeo com ffprobe
 */
async function isVideoValid(filePath) {
    return new Promise((resolve) => {
        exec(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (error) => {
            resolve(!error);
        });
    });
}

/**
 * Busca estatísticas de Disco no Windows via WMIC
 */
function getDiskUsage() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') return resolve(0);
        exec('wmic logicaldisk where "DeviceID=\'C:\'" get size,freespace /format:list', (err, stdout) => {
            if (err) return resolve(0);
            const lines = stdout.split('\n');
            let free = 0, total = 0;
            lines.forEach(l => {
                if (l.startsWith('FreeSpace=')) free = parseInt(l.split('=')[1]);
                if (l.startsWith('Size=')) total = parseInt(l.split('=')[1]);
            });
            resolve(total ? Math.round(((total - free) / total) * 100) : 0);
        });
    });
}

/**
 * Busca estatísticas de Rede no Windows via Netstat
 */
function getNetworkUsage() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') return resolve(0);
        exec('netstat -e', (err, stdout) => {
            if (err) return resolve(0);
            const match = stdout.match(/Bytes\s+(\d+)\s+(\d+)/);
            if (match) {
                const sent = parseInt(match[2]);
                const now = Date.now();
                const deltaSec = (now - lastNetTime) / 1000;
                const deltaBytes = sent - prevBytesSent;
                
                prevBytesSent = sent;
                lastNetTime = now;

                // Retorna Mbps (Bytes para bits / 1024 / 1024)
                const mbps = ((deltaBytes * 8) / (1024 * 1024)) / deltaSec;
                resolve(mbps.toFixed(2));
            } else resolve(0);
        });
    });
}

/**
 * Coleta telemetria do sistema (Similar ao status.php)
 */
async function getSystemStats() {
    const load = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    // No Windows, os.loadavg() sempre retorna [0, 0, 0]. No Linux funciona normalmente.
    const cpu = process.platform === 'win32' ? 0 : Math.round((load[0] / os.cpus().length) * 100);
    const disco = await getDiskUsage();
    const rede = await getNetworkUsage();

    return {
        cpu: cpu,
        ram: Math.round(((totalMem - freeMem) / totalMem) * 100),
        disco: disco,
        rede: rede,
        uptime: Math.floor(os.uptime()),
        activeStreams: activeStreams.size // Number of currently running FFmpeg processes
    };
}

/**
 * Inicia um canal (Substitui o start.php)
 */
function startChannel(id) {
    const channel = channels.find(c => c.id === id);
    if (!channel) return { status: 'error', message: 'Canal não encontrado' };
    if (activeStreams.has(id)) return { status: 'error', message: 'Canal já rodando' };

    const playlistPath = channel.playlistFilePath; // Use the stored playlist path for the channel
    const outputDir = path.join(CHANNELS_DIR, id.toString());
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Flags de estabilidade idênticas ao sistema PHP anterior
    const args = [
        '-fflags', '+genpts',
        '-re',
        '-stream_loop', '-1'
    ];

    if (channel.inputType === 'concat') {
        args.push('-f', 'concat', '-safe', '0');
    }

    args.push('-i', playlistPath);

    args.push(
        '-avoid_negative_ts', 'make_zero',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'hls', '-hls_time', '4', '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list+omit_endlist',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        path.join(outputDir, 'index.m3u8')
    );

    const ffmpeg = spawn(FFMPEG_PATH, args);

    // Tratamento de erro para evitar que o Node.js trave (crash)
    ffmpeg.on('error', (err) => {
        console.error(`[ERRO CRÍTICO] Falha ao iniciar FFmpeg no canal ${id}:`, err.message);
        if (err.code === 'ENOENT') {
            console.error('Certifique-se de que o FFmpeg está instalado e configurado no PATH do Windows ou defina o caminho manual no server.js');
        }
        activeStreams.delete(id);
        channel.status = 'offline';
    });

    ffmpeg.stderr.on('data', (data) => {
        // Log de depuração do FFmpeg. Útil para identificar problemas de transcodificação.
        console.error(`FFmpeg [${id}] stderr: ${data.toString()}`);
    });

    ffmpeg.on('close', (code) => {
        console.log(`Canal ${id} (${channel.name}) parou com código ${code}`);
        activeStreams.delete(id);
        channel.status = 'offline'; // Update channel status
    });

    activeStreams.set(id, {
        process: ffmpeg,
        startedAt: Date.now()
    });
    channel.status = 'online'; // Update channel status

    return { status: 'success', pid: ffmpeg.pid };
}

/**
 * Servidor HTTP Simples
 */
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Roteamento de API
    if (url.pathname === '/api/status') {
        const stats = await getSystemStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(stats));
    }

    if (url.pathname === '/api/start' && req.method === 'POST') {
        let body = ''; // Removed canalNome from startChannel call
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);
            const result = startChannel(data.id); // Call startChannel with only ID
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result)); // Return result
        });
        return;
    }

    // API: Listar todos os canais
    if (url.pathname === '/api/channels') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(channels));
    }

    // API: Listar pastas e subpastas para o Select do Modal
    if (url.pathname === '/api/videosources') {
        try {
            if (!fs.existsSync(VIDEO_SOURCE)) {
                fs.mkdirSync(VIDEO_SOURCE, { recursive: true });
            }
            const folders = await getDirectoriesRecursive(VIDEO_SOURCE);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(folders));
        } catch (error) {
            console.error("Erro ao listar diretórios:", error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: "Falha ao ler pastas" }));
        }
    }

    // API: Criar canal escaneando a pasta selecionada
    if (url.pathname === '/api/createchannel' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { channelName, sourceFolderName } = JSON.parse(body);
                const scanPath = path.join(VIDEO_SOURCE, sourceFolderName);
                const hlsCheckPath = path.join(scanPath, 'index.m3u8');
                
                const id = nextChannelId++;
                const channelOutputDir = path.join(CHANNELS_DIR, id.toString());
                if (!fs.existsSync(channelOutputDir)) fs.mkdirSync(channelOutputDir, { recursive: true });

                let inputType = 'concat';
                let playlistFilePath = '';

                // Lógica Híbrida: Detecta se é um HLS pronto ou uma pasta de MP4s
                if (fs.existsSync(hlsCheckPath)) {
                    inputType = 'hls';
                    playlistFilePath = hlsCheckPath;
                } else {
                    let mp4Files = await getFilesRecursive(scanPath, '.mp4');
                    
                    // Validação de integridade para evitar o erro 'moov atom not found'
                    const validFiles = [];
                    for (const f of mp4Files) {
                        if (await isVideoValid(f)) validFiles.push(f);
                        else console.warn(`[AVISO] Pulando arquivo corrompido: ${f}`);
                    }
                    mp4Files = validFiles;

                    if (mp4Files.length === 0) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ status: 'error', message: 'Nenhum vídeo válido encontrado. Verifique se os arquivos não estão corrompidos.' }));
                    }

                    const playlistPath = path.join(channelOutputDir, 'playlist.txt');
                    // Melhora a compatibilidade com caminhos complexos e aspas simples
                    const playlistContent = mp4Files.map(f => {
                        const escaped = f.replace(/\\/g, '/').replace(/'/g, "'\\''");
                        return `file '${escaped}'`;
                    }).join('\r\n');
                    
                    await fs.promises.writeFile(playlistPath, playlistContent, 'utf8');
                    
                    inputType = 'concat';
                    playlistFilePath = playlistPath;
                }

                const newChannel = {
                    id,
                    name: channelName,
                    sourceFolder: sourceFolderName,
                    playlistFilePath,
                    inputType,
                    status: 'offline'
                };

                channels.push(newChannel);
                await saveChannels();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', channel: newChannel }));
            } catch (err) {
                console.error(err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao criar canal.' }));
            }
        });
        return;
    }

    // API: Excluir canal
    if (url.pathname === '/api/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const data = JSON.parse(body);
            const id = data.id;

            // 1. Para o processo se estiver rodando
            if (activeStreams.has(id)) {
                activeStreams.get(id).process.kill('SIGKILL');
                activeStreams.delete(id);
            }

            // 2. Remove da lista e salva banco
            channels = channels.filter(c => c.id !== id);
            await saveChannels();

            // 3. Limpa arquivos físicos
            const channelPath = path.join(CHANNELS_DIR, id.toString());
            if (fs.existsSync(channelPath)) fs.rmSync(channelPath, { recursive: true, force: true });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'deleted' }));
        });
        return;
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);
            if (activeStreams.has(data.id)) {
                activeStreams.get(data.id).process.kill('SIGKILL');
                activeStreams.delete(data.id);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'stopped' }));
        });
        return;
    }

    // Servir Arquivos Estáticos (Dashboard)
    let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Não encontrado');
        } else {
            const ext = path.extname(filePath);
            const types = { 
                '.html': 'text/html', 
                '.js': 'text/javascript', 
                '.css': 'text/css',
                '.m3u8': 'application/vnd.apple.mpegurl',
                '.ts': 'video/MP2T'
            };
            res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
            res.end(content);
        }
    });
});

/**
 * Monitor de integridade (Watchdog) - Simula o monitor_streams.php
 * Verifica a cada 15s se os arquivos HLS estão sendo atualizados
 */
setInterval(() => {
    activeStreams.forEach((info, id) => {
        const channel = channels.find(c => c.id === id);
        if (!channel || channel.status !== 'online') return;

        const m3u8Path = path.join(CHANNELS_DIR, id.toString(), 'index.m3u8');
        
        if (fs.existsSync(m3u8Path)) {
            const stats = fs.statSync(m3u8Path);
            const segundosDesdeMod = (Date.now() - stats.mtimeMs) / 1000;
            
            if (segundosDesdeMod > 25) { // Canal travado há mais de 25 segundos
                console.log(`[WATCHDOG] Canal ${id} (${channel.name}) parece travado. Reiniciando...`);
                info.process.kill('SIGKILL');
                activeStreams.delete(id);
                setTimeout(() => startChannel(id), 2000);
            }
        }
    });
}, 15000);

server.listen(PORT, () => {
    loadChannels(); // Load channels on startup
    console.log(`IPTV Pro Node rodando em http://localhost:${PORT}`);
});
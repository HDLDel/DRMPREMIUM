const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PORT = 8080;

// No Linux Ubuntu, usamos obrigatoriamente o RAM Disk (/dev/shm) para os segmentos HLS
const CHANNELS_DIR = '/dev/shm/iptv_canais';
if (!fs.existsSync(CHANNELS_DIR)) fs.mkdirSync(CHANNELS_DIR, { recursive: true });

console.log(`[SYSTEM] Armazenamento de segmentos configurado em: ${CHANNELS_DIR}`);

const VIDEO_SOURCE = path.join(__dirname, '24HORAS'); // Pasta raiz dos vídeos
const LOGS_DIR = path.join(__dirname, 'logs'); // Pasta para logs do FFmpeg

// Garante que as pastas necessárias existem
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const NGINX_LOG = '/var/log/nginx/iptv_access.log';

const FFMPEG_PATH = 'ffmpeg'; 

// Lista de Administradores com hashes seguros (bcrypt)
const ADMINS = [
    { user: '<ADMIN_EMAIL_PLACEHOLDER>', hash: '<BCRYPT_HASH_PLACEHOLDER>' }, // <REDACTED_PASSWORD>
    { user: '<ADMIN_USER_PLACEHOLDER>', hash: '<BCRYPT_HASH_PLACEHOLDER>' }  // <REDACTED_PASSWORD>
];

// Gera um ID de sessão aleatório e seguro a cada inicialização do servidor
const SESSION_ID = crypto.randomBytes(32).toString('hex');

const CHANNELS_DB_FILE = path.join(__dirname, 'channels.json');

// Global array to hold channel configurations
let channels = []; // { id: 1, name: 'Filmes de Acao', sourceFolder: 'Filmes_Acao', playlistFilePath: '...', status: 'offline' }

// Variáveis para cálculo de rede
let prevBytesSent = 0;
let lastNetTime = Date.now();

// Variáveis e funções para cálculo de CPU real (estilo htop)
function getCpuTimes() {
    const cpus = os.cpus();
    if (!cpus || cpus.length === 0) return { idle: 0, total: 0 };
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (let i = 0; i < cpus.length; i++) {
        user += cpus[i].times.user;
        nice += cpus[i].times.nice;
        sys += cpus[i].times.sys;
        idle += cpus[i].times.idle;
        irq += cpus[i].times.irq;
    }
    const total = user + nice + sys + idle + irq;
    return { idle, total };
}
let lastCpuTimes = getCpuTimes();

function getRealCpuUsage() {
    const current = getCpuTimes();
    const idleDiff = current.idle - lastCpuTimes.idle;
    const totalDiff = current.total - lastCpuTimes.total;
    
    lastCpuTimes = current;

    if (totalDiff === 0) return 0;
    const usage = 100 - Math.round((idleDiff / totalDiff) * 100);
    return Math.max(0, Math.min(100, usage));
}


function getCookies(req) {
    const list = {};
    const rc = req.headers.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURI(parts.join('='));
        });
    }
    return list;
}

async function loadChannels() {
    if (fs.existsSync(CHANNELS_DB_FILE)) {
        const data = await fs.promises.readFile(CHANNELS_DB_FILE, 'utf8');
        channels = JSON.parse(data).map(c => ({
            ...c,
            inputType: c.inputType || 'concat' // Fallback para canais antigos
        }));
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
function isVideoValid(filePath) {
    return new Promise((resolve) => {
        const ff = spawn('ffprobe', [
            '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name',
            '-of', 'default=noprint_wrappers=1:nokey=1', filePath
        ]);
        ff.on('close', (code) => {
            if (code !== 0) console.warn(`[VALIDAÇÃO] Falha ao ler metadados do vídeo: ${filePath}`);
            resolve(code === 0);
        });
    });
}

/**
 * Busca estatísticas de Disco no Windows via WMIC
 */
function getDiskUsage() {
    return new Promise((resolve) => {
        // Suporte para Linux (Ubuntu) usando o comando df
        exec("df / --output=pcent | tail -1", (err, stdout) => {
            if (err) return resolve(0);
            resolve(parseInt(stdout.replace('%', '').trim()) || 0);
        });
    });
}

/**
 * Busca estatísticas de Rede no Windows via Netstat
 */
function getNetworkUsage() {
    return new Promise((resolve) => {
        // Suporte para Linux (Ubuntu) lendo estatísticas de /proc/net/dev
        fs.readFile('/proc/net/dev', 'utf8', (err, data) => {
            if (err) return resolve(0);
            const lines = data.split('\n');
            let totalSent = 0;
            lines.forEach(line => {
                if (line.includes(':')) {
                    const parts = line.trim().split(/\s+/);
                    totalSent += parseInt(parts[9]) || 0; // Transmit bytes
                }
            });

            const now = Date.now();
            const deltaSec = (now - lastNetTime) / 1000;
            const deltaBytes = totalSent - prevBytesSent;
            prevBytesSent = totalSent;
            lastNetTime = now;
            const mbps = ((deltaBytes * 8) / (1024 * 1024)) / deltaSec;
            resolve(mbps > 0 ? mbps.toFixed(2) : "0.00");
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

    const io = Math.round((load[0] / os.cpus().length) * 100);
    const cpuReal = getRealCpuUsage();
    const disco = await getDiskUsage();
    const rede = await getNetworkUsage();
    
    return {
        cpu: cpuReal,
        io: io,
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
async function startChannel(id) {
    const channel = channels.find(c => c.id === id);
    if (!channel) return { status: 'error', message: 'Canal não encontrado' };
    if (activeStreams.has(id)) return { status: 'error', message: 'Canal já rodando' };

    const outputDir = path.join(CHANNELS_DIR, id.toString());
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Limpa arquivos antigos para o Watchdog não se confundir com timestamps do passado
    const m3u8Path = path.join(outputDir, 'index.m3u8');
    if (fs.existsSync(m3u8Path)) {
        try { fs.unlinkSync(m3u8Path); } catch(e) {}
    }

    let playlistPath = channel.playlistFilePath;

    // Se for do tipo concat, re-geramos a playlist.txt na RAM para garantir que ela existe
    if (channel.inputType === 'concat') {
        const scanPath = path.join(VIDEO_SOURCE, channel.sourceFolder);
        console.log(`[CANAL ${id}] Escaneando pasta de origem: ${scanPath}`);

        let mp4Files = await getFilesRecursive(scanPath, '.mp4');
        
        const validFiles = [];
        for (const f of mp4Files) {
            if (await isVideoValid(f)) {
                validFiles.push(f);
            } else {
                console.warn(`[CANAL ${id}] Arquivo inválido ou ilegível: ${path.basename(f)}`);
            }
        }
        mp4Files = validFiles;

        if (mp4Files.length === 0) {
            console.error(`[ERRO CANAL ${id}] Nenhum vídeo válido encontrado em ${scanPath}`);
        } else {
            console.log(`[CANAL ${id}] Playlist gerada com ${mp4Files.length} arquivos. Exemplo: ${mp4Files[0]}`);
        }

        playlistPath = path.join(outputDir, 'playlist.txt');
        const playlistContent = mp4Files.map(f => {
            // Escapa aspas simples para o formato concat do ffmpeg
            const escaped = f.replace(/'/g, "'\\''");
            return `file '${escaped}'`;
        }).join('\r\n');
        
        await fs.promises.writeFile(playlistPath, playlistContent, 'utf8');
        // Atualiza o caminho em memória para o processo atual
        channel.playlistFilePath = playlistPath;
    }

    // Correção: Garante que o playlistPath aponte para a RAM se o canal for concat
    if (channel.inputType === 'concat') {
        playlistPath = path.join(outputDir, 'playlist.txt');
    }

    // Flags de estabilidade idênticas ao sistema PHP anterior
    const args = [
        '-fflags', '+genpts+igndts+flush_packets', // Gera e limpa pacotes problemáticos
        '-err_detect', 'ignore_err',  // Ignora erros de dados para não parar o processo
        '-re',
        '-stream_loop', '-1'
    ];

    if (channel.inputType === 'concat') {
        args.push('-f', 'concat', '-safe', '0');
    }

    args.push('-i', playlistPath);

    if (channel.useTranscode) {
        // Modo Estável: Reconstrói o stream para evitar quebras em arquivos com FPS/Codecs diferentes
        args.push(
            '-fps_mode', 'cfr', // Força Constant Frame Rate para o transcode (necessário para -r 30)
            '-c:v', 'libx264', 
            '-preset', 'ultrafast', 
            '-tune', 'zerolatency', 
            '-r', '24',          // Reduz para 24fps (mais leve que 30)
            '-g', '48',          // Keyframe a cada 2 segundos (2 * 24fps)
            '-crf', '28',        // Reduz a carga de processamento de imagem
            '-threads', '1',     // Garante que o canal não consuma toda a CPU do servidor
            '-c:a', 'copy',      // Copia o áudio original (economiza processamento)
            '-sn', '-dn'         // Remove legendas e dados (economiza processamento)
        );
    } else {
        // Modo Econômico: Apenas copia os streams originais
        args.push('-fps_mode', 'passthrough'); // Mantém timestamps originais no modo copy
        args.push('-c:v', 'copy', '-c:a', 'copy');
    }

    args.push(
        '-flags', '+global_header',   // Melhora compatibilidade de troca de stream
        '-avoid_negative_ts', 'make_zero',
        '-f', 'hls', '-hls_time', '15', '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        path.join(outputDir, 'index.m3u8')
    );

    const ffmpeg = spawn(FFMPEG_PATH, args);

    // Prepara o stream de log para este canal
    const logStream = fs.createWriteStream(path.join(LOGS_DIR, `canal_${id}.log`), { flags: 'a' });
    logStream.write(`\n--- INICIANDO CANAL ${id} EM ${new Date().toLocaleString()} ---\n`);

    // Tratamento de erro para evitar que o Node.js trave (crash)
    ffmpeg.on('error', (err) => {
        const errMsg = `[ERRO CRÍTICO] Falha ao iniciar FFmpeg no canal ${id}: ${err.message}\n`;
        console.error(errMsg);
        logStream.write(errMsg);
        
        // Se houver erro ao iniciar, limpamos os dados de tempo
        const ch = channels.find(c => c.id === id);
        if (ch) {
            ch.status = 'offline';
            delete ch.startedAt;
            saveChannels();
        }
        activeStreams.delete(id);
    });

    ffmpeg.stderr.on('data', (data) => {
        logStream.write(`[FFMPEG] ${data.toString()}`);
    });

    ffmpeg.stderr.on('error', (err) => {
        logStream.write(`[SYSTEM ERROR] Falha ao ler stderr: ${err.message}\n`);
    });

    ffmpeg.on('close', (code) => {
        const closeMsg = `Canal ${id} parou com código ${code} em ${new Date().toLocaleString()}\n`;
        logStream.write(closeMsg);
        logStream.end();

        console.log(`Canal ${id} (${channel.name}) parou com código ${code}`);
        activeStreams.delete(id);
        
        // Atualiza o objeto do canal para persistência
        const ch = channels.find(c => c.id === id);
        if (ch) {
            ch.status = 'offline';
            delete ch.startedAt;
            saveChannels();
        }
    });

    // Resetamos o uptime para o momento exato do início do processo atual
    channel.startedAt = Date.now();

    activeStreams.set(id, {
        process: ffmpeg,
        startedAt: channel.startedAt
    });
    channel.status = 'online'; // Update channel status
    saveChannels();

    return { status: 'success', pid: ffmpeg.pid };
}

/**
 * Servidor HTTP Simples
 */
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // 1. Verificação de Autenticação
    const cookies = getCookies(req);
    const isAuth = cookies['session_token'] === SESSION_ID;

    // Rota pública de login
    if (url.pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const { user, pass } = JSON.parse(body);
            
            const cleanUser = user ? user.trim().toLowerCase() : '';
            console.log(`[AUTH] Tentativa de login para: ${cleanUser}`);

            const adminFound = ADMINS.find(a => a.user.toLowerCase() === cleanUser);
            
            const isPasswordValid = adminFound ? bcrypt.compareSync(pass, adminFound.hash) : false;

            if (!adminFound) console.log(`[AUTH] Falha: Usuário ${cleanUser} não encontrado.`);
            if (adminFound && !isPasswordValid) console.log(`[AUTH] Falha: Senha incorreta para ${cleanUser}.`);

            if (adminFound && isPasswordValid) {
                console.log(`[AUTH] Sucesso: Login realizado por ${cleanUser}.`);
                res.writeHead(200, { 
                    'Set-Cookie': `session_token=${SESSION_ID}; Path=/; HttpOnly`,
                    'Content-Type': 'application/json' 
                });
                res.end(JSON.stringify({ status: 'success' }));
            } else {
                res.writeHead(401);
                res.end(JSON.stringify({ status: 'error' }));
            }
        });
        return;
    }

    // Rota de Logout
    if (url.pathname === '/api/logout' && req.method === 'POST') {
        res.writeHead(200, {
            'Set-Cookie': `session_token=; Path=/; HttpOnly; Expires=${new Date(0).toUTCString()}`,
            'Content-Type': 'application/json'
        });
        return res.end(JSON.stringify({ status: 'logged_out' }));
    }

    // Rota Pública da Playlist M3U para Players de IPTV
    if (url.pathname === '/playlist.m3u') {
        const host = req.headers.host || 'localhost';
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        let m3uContent = '#EXTM3U\n';
        
        for (const channel of channels) {
            const group = channel.is18 ? 'Adultos' : 'Canais';
            m3uContent += `#EXTINF:-1 tvg-id="${channel.id}" tvg-name="${channel.name}" group-title="${group}" tvg-logo="",${channel.name}\n`;
            m3uContent += `${protocol}://${host}/canais/${channel.id}/index.m3u8\n`;
        }
        
        res.writeHead(200, {
            'Content-Type': 'application/x-mpegurl',
            'Content-Disposition': 'attachment; filename="playlist.m3u"',
            'Access-Control-Allow-Origin': '*'
        });
        return res.end(m3uContent);
    }

    // API: Alternar status +18 de um canal
    if (url.pathname === '/api/toggle18' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const data = JSON.parse(body);
            const id = Number(data.id);
            const channel = channels.find(c => c.id === id);
            if (channel) {
                channel.is18 = !channel.is18;
                await saveChannels();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', is18: channel.is18 }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ status: 'error', message: 'Canal não encontrado' }));
            }
        });
        return;
    }

    // Redireciona para login se não estiver autenticado
    if (!isAuth && url.pathname !== '/login.html' && !url.pathname.includes('.css')) {
        res.writeHead(302, { 'Location': '/login.html' });
        return res.end();
    }

    // Roteamento de API
    if (url.pathname === '/api/status') {
        const stats = await getSystemStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(stats));
    }

    // API: Buscar Logs de um canal
    if (url.pathname === '/api/logs' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        const logPath = path.join(LOGS_DIR, `canal_${id}.log`);
        
        if (fs.existsSync(logPath)) {
            // Lê apenas os últimos 5KB do log para não sobrecarregar
            const stats = fs.statSync(logPath);
            const start = Math.max(0, stats.size - 5120);
            const stream = fs.createReadStream(logPath, { start });
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return stream.pipe(res);
        }
        res.writeHead(404);
        return res.end("Log não encontrado.");
    }

    if (url.pathname === '/api/start' && req.method === 'POST') {
        let body = ''; // Removed canalNome from startChannel call
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const data = JSON.parse(body);
            const result = await startChannel(Number(data.id)); 
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result)); // Return result
        });
        return;
    }

    // API: Listar todos os canais
    if (url.pathname === '/api/channels') {
        const channelsWithUptime = channels.map(c => {
            return {
                ...c,
                uptime: (c.status === 'online' && c.startedAt) ? Math.floor((Date.now() - c.startedAt) / 1000) : 0
            };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(channelsWithUptime));
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
                const { channelName, sourceFolderName, useTranscode, is18 } = JSON.parse(body);
                const scanPath = path.join(VIDEO_SOURCE, sourceFolderName);
                const hlsCheckPath = path.join(scanPath, 'index.m3u8');
                
                // Busca o menor ID disponível (reutilizando IDs de canais excluídos)
                let id = 1;
                while (channels.some(c => c.id === id)) {
                    id++;
                }

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
                        const escaped = f.replace(/'/g, "'\\''");
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
                    status: 'offline',
                    useTranscode: !!useTranscode,
                    is18: !!is18
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
            const id = Number(data.id);

            // 1. Segurança: Não permite excluir se estiver rodando
            if (activeStreams.has(id)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'Pare o canal antes de excluí-lo.' }));
            }

            // 2. Remove da lista e salva banco
            channels = channels.filter(c => c.id !== id);
            await saveChannels();

            // 3. Limpa arquivos físicos
            const channelPath = path.join(CHANNELS_DIR, id.toString());
            const logPath = path.join(LOGS_DIR, `canal_${id}.log`);

            // Aumentamos o tempo para 1 segundo para garantir que o FFmpeg soltou os arquivos
            setTimeout(() => {
                try {
                    if (fs.existsSync(channelPath)) fs.rmSync(channelPath, { recursive: true, force: true });
                    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
                    console.log(`[LIMPEZA] Canal e logs de ${id} removidos.`);
                } catch (rmErr) {
                    console.error(`[ERRO] Falha na remoção do canal ${id}:`, rmErr);
                }
            }, 1000);

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
            const id = Number(data.id);
            
            const channel = channels.find(c => c.id === id);
            if (channel) channel.status = 'offline';

            if (activeStreams.has(id)) {
                activeStreams.get(id).process.kill('SIGKILL');
                activeStreams.delete(id);
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
            
            const headers = { 'Content-Type': types[ext] || 'text/plain' };
            // Impede que o navegador faça cache do painel (Dashboard)
            if (ext === '.js' || ext === '.css' || ext === '.html') {
                headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
            }

            res.writeHead(200, headers);
            res.end(content);
        }
    });
    } catch (err) {
        console.error("[ERRO NO SERVIDOR]", err);
        res.writeHead(500);
        res.end("Erro interno no servidor");
    }
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
            
            if (segundosDesdeMod > 120) { // Aumentado para 120s para evitar falsos positivos com segmentos de 15s
                console.log(`[WATCHDOG] Canal ${id} (${channel.name}) sem resposta há ${Math.round(segundosDesdeMod)}s. Reiniciando...`);
                
                // Registra o travamento no log antes de matar o processo
                const logPath = path.join(LOGS_DIR, `canal_${id}.log`);
                if (fs.existsSync(logPath)) {
                    fs.appendFileSync(logPath, `[WATCHDOG] ${new Date().toLocaleString()}: Canal parado por ${Math.round(segundosDesdeMod)}s. Forçando reinício.\n`);
                }

                info.process.kill('SIGKILL');
                activeStreams.delete(id);
                setTimeout(async () => await startChannel(id), 2000);
            }
        }
    });
}, 15000);

/**
 * Rotina de Limpeza de Logs (Executa a cada 48 horas)
 */
setInterval(() => {
    const agora = Date.now();
    const limite = 48 * 60 * 60 * 1000; // 48 horas em ms

    fs.readdir(LOGS_DIR, (err, files) => {
        if (err) return console.error("[LIMPEZA] Erro ao ler pasta de logs:", err);
        files.forEach(file => {
            const filePath = path.join(LOGS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && (agora - stats.mtimeMs > limite)) {
                    fs.unlink(filePath, () => console.log(`[LIMPEZA] Log antigo removido: ${file}`));
                }
            });
        });
    });
}, 48 * 60 * 60 * 1000);

server.listen(PORT, async () => {
    await loadChannels(); // Load channels on startup
    
    // Auto-start: Verifica canais que deveriam estar online e inicia o FFmpeg
    for (const channel of channels) {
        if (channel.status === 'online') {
            console.log(`[AUTO-START] Reiniciando transmissão do canal: ${channel.name}`);
            await startChannel(channel.id);
        }
    }

    console.log(`\n=== IPTV PRO DASHBOARD ===`);
    console.log(`Servidor rodando em: http://localhost:${PORT}`);
    console.log(`Diretório ativo: ${__dirname}\n`);
});
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Previne crash do Node.js em erros não tratados (JSON inválido externo, etc)
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED REJECTION]', err?.message || err);
});

const PORT = 8080;

// No Linux Ubuntu, usamos obrigatoriamente o RAM Disk (/dev/shm) para os segmentos HLS
const CHANNELS_DIR = '/dev/shm/iptv_canais';
if (!fs.existsSync(CHANNELS_DIR)) fs.mkdirSync(CHANNELS_DIR, { recursive: true });

console.log(`[SYSTEM] Armazenamento de segmentos configurado em: ${CHANNELS_DIR}`);

const VIDEO_SOURCE = path.join(__dirname, '24HORAS'); // Pasta raiz dos vídeos
const LOGS_DIR = path.join(__dirname, 'logs'); // Pasta para logs do FFmpeg

// Cache de episódios pré-baixados dos canais relay (disco, não RAM):
// sempre mantemos 2 episódios por canal (o que está transmitindo + o próximo da fila)
const CACHE_DIR = '/home/drmpremium';
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Garante que as pastas necessárias existem
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const NGINX_LOG = '/var/log/nginx/iptv_access.log';

const FFMPEG_PATH = 'ffmpeg';
const NOCACHE = '/usr/bin/nocache';
const NOCACHE_FLAG = path.join(__dirname, '.nocache');
let nocacheEnabled = fs.existsSync(NOCACHE_FLAG);
function spawnFFmpeg(args) {
    if (nocacheEnabled && fs.existsSync(NOCACHE)) {
        return spawn(NOCACHE, [FFMPEG_PATH, ...args]);
    }
    return spawn(FFMPEG_PATH, args);
}

// Detecta se a versão do FFmpeg instalada suporta -fps_mode (FFmpeg 5.1+) ou se usa -vsync (FFmpeg 4.x - Ubuntu 20.04)
let FFMPEG_FPS_FLAG = '-vsync';
try {
    const vOut = execSync(`${FFMPEG_PATH} -version 2>/dev/null`).toString();
    if (/ffmpeg version [5-9]\./i.test(vOut) || /ffmpeg version [1-9][0-9]\./i.test(vOut)) {
        FFMPEG_FPS_FLAG = '-fps_mode';
    }
} catch (e) {}

// Lista de Administradores com hashes seguros (bcrypt)
const ADMINS = [
    { user: '<ADMIN_EMAIL_PLACEHOLDER>', hash: '<BCRYPT_HASH_PLACEHOLDER>' }, // <REDACTED_PASSWORD>
    { user: '<ADMIN_USER_PLACEHOLDER>', hash: '<BCRYPT_HASH_PLACEHOLDER>' }  // <REDACTED_PASSWORD>
];

// Gera um ID de sessão aleatório e seguro a cada inicialização do servidor
const SESSION_ID = crypto.randomBytes(32).toString('hex');

// Registro de tentativas de login para segurança
const loginAttempts = [];
const MAX_LOGIN_ATTEMPTS = 500;
const BLOCKED_IPS_FILE = '/etc/nginx/blocked_ips.json';
let blockedIPs = new Set();

// Carrega IPs bloqueados do disco
function loadBlockedIPs() {
    try {
        if (fs.existsSync(BLOCKED_IPS_FILE)) {
            const data = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
            blockedIPs = new Set(data);
            console.log(`[SEGURANÇA] ${blockedIPs.size} IPs bloqueados carregados`);
        }
    } catch (e) {
        console.error('[SEGURANÇA] Erro ao carregar IPs bloqueados:', e.message);
    }
}
loadBlockedIPs();
// Gera o arquivo de configuração do nginx na inicialização
function saveBlockedIPs() {
    try {
        fs.writeFileSync(BLOCKED_IPS_FILE, JSON.stringify([...blockedIPs], null, 2));
        // Gera conf do nginx
        const valid = [...blockedIPs].filter(isValidIP);
        const conf = valid.length > 0 
            ? valid.map(ip => `deny ${ip};`).join('\n') + '\n'
            : '';
        fs.writeFileSync('/etc/nginx/blocked_ips.conf', conf);
        // Reload nginx sem derrubar conexões ativas
        execSync('nginx -s reload 2>/dev/null', { stdio: 'ignore' });
    } catch (e) {
        console.error('[SEGURANÇA] Erro ao salvar IPs bloqueados:', e.message);
    }
}

// Funções auxiliares para manipulação flexível de flags (suporta /home/drmpremium e a pasta da aplicação)
function getRelayFlagPaths(channelId) {
    return [
        path.join(__dirname, `.relay_${channelId}`),
        `/home/drmpremium/.relay_${channelId}`
    ];
}

function hasRelayFlag(channelId) {
    return getRelayFlagPaths(channelId).some(p => fs.existsSync(p));
}

function setRelayFlag(channelId) {
    for (const p of getRelayFlagPaths(channelId)) {
        try {
            const dir = path.dirname(p);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(p, '');
        } catch (e) {}
    }
}

function removeRelayFlag(channelId) {
    for (const p of getRelayFlagPaths(channelId)) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) {}
    }
}

function getVodFlagPaths(channelId) {
    return [
        path.join(__dirname, `.vod_${channelId}`),
        `/home/drmpremium/.vod_${channelId}`
    ];
}

function hasVodFlag(channelId) {
    return getVodFlagPaths(channelId).some(p => fs.existsSync(p));
}

function setVodFlag(channelId) {
    for (const p of getVodFlagPaths(channelId)) {
        try {
            const dir = path.dirname(p);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(p, '');
        } catch (e) {}
    }
}

function removeVodFlag(channelId) {
    for (const p of getVodFlagPaths(channelId)) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) {}
    }
}

function recordLoginAttempt(ip, user, success, userAgent) {
    loginAttempts.unshift({
        ip,
        user: user || '(vazio)',
        success,
        userAgent: (userAgent || '').substring(0, 80),
        timestamp: new Date().toISOString()
    });
    if (loginAttempts.length > MAX_LOGIN_ATTEMPTS) loginAttempts.pop();
}

// Monitor de acessos via nginx access log
const NGINX_ACCESS_LOG = '/var/log/nginx/iptv_access.log';
let nginxAccessData = new Map();
let nginxLogOffset = 0;

function parseNginxAccessLog() {
    try {
        if (!fs.existsSync(NGINX_ACCESS_LOG)) return;
        const stats = fs.statSync(NGINX_ACCESS_LOG);
        if (stats.size < nginxLogOffset) nginxLogOffset = 0;
        if (stats.size === nginxLogOffset) return;
        // Na primeira execução, pula todo o histórico existente (comportamento tail -f)
        if (nginxLogOffset === 0) {
            nginxLogOffset = stats.size;
            return;
        }
        const fd = fs.openSync(NGINX_ACCESS_LOG, 'r');
        const buffer = Buffer.alloc(stats.size - nginxLogOffset);
        fs.readSync(fd, buffer, 0, buffer.length, nginxLogOffset);
        fs.closeSync(fd);
        nginxLogOffset = stats.size;
        const lines = buffer.toString('utf8').split('\n');
        const now = Date.now();
        const MAX_AGE = 60 * 60 * 1000;
        for (const line of lines) {
            if (!line.trim()) continue;
            const match = line.match(/^(\S+).*"GET \/canais\/(\d+)\/[^"]*"\s+(\d+)/);
            if (!match) continue;
            const ip = match[1];
            const channelId = match[2];
            const status = match[3];
            if (status !== '200') continue;
            if (!nginxAccessData.has(ip)) {
                nginxAccessData.set(ip, { channels: {}, totalHits: 0, firstSeen: now, lastSeen: now });
            }
            const entry = nginxAccessData.get(ip);
            if (!entry.channels[channelId]) {
                entry.channels[channelId] = { hits: 0, lastAccess: now };
            }
            entry.channels[channelId].hits++;
            entry.channels[channelId].lastAccess = now;
            entry.totalHits++;
            entry.lastSeen = now;
        }
        for (const [ip, data] of nginxAccessData) {
            if (now - data.lastSeen > MAX_AGE) nginxAccessData.delete(ip);
        }
    } catch (e) {
        console.error('[NGINX LOG] Erro ao ler access log:', e.message);
    }
}

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
            const key = parts.shift().trim();
            let value;
            try {
                value = decodeURI(parts.join('='));
            } catch (e) {
                value = parts.join('=');
            }
            list[key] = value;
        });
    }
    return list;
}

// Valida se o valor parece um IP (IPv4 ou IPv6) para evitar injeção de comando
function isValidIP(ip) {
    if (typeof ip !== 'string' || !ip || ip.length > 45) return false;
    const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (ipv4.test(ip)) return true;
    // IPv6 básico (inclui formas compactas, sem zona/scope)
    if (!ip.includes(':')) return false;
    if (!/^[0-9a-fA-F:]+$/.test(ip)) return false;
    const parts = ip.split(':');
    if (parts.length < 3 || parts.length > 8) return false;
    if (parts.some(p => p.length > 4)) return false;
    return true;
}

async function loadChannels() {
    if (fs.existsSync(CHANNELS_DB_FILE)) {
        const data = await fs.promises.readFile(CHANNELS_DB_FILE, 'utf8');
        channels = data.trim() ? JSON.parse(data).map(c => ({
            ...c,
            inputType: c.inputType || 'concat' // Fallback para canais antigos
        })) : [];
        console.log(`Loaded ${channels.length} channels from ${CHANNELS_DB_FILE}`);
    }
}

// Fila de gravação para evitar last-writer-wins em writes concorrentes
let saveChannelsQueue = Promise.resolve();
function saveChannels() {
    const snapshot = JSON.stringify(channels, null, 2);
    const count = channels.length;
    saveChannelsQueue = saveChannelsQueue
        .then(() => fs.promises.writeFile(CHANNELS_DB_FILE, snapshot, 'utf8'))
        .then(() => console.log(`Saved ${count} channels to ${CHANNELS_DB_FILE}`))
        .catch(e => console.error('[ERRO] Falha ao salvar channels.json:', e.message));
    return saveChannelsQueue;
}

// Helper para listar subdiretórios recursivamente para a seleção no Dashboard
// Helper para listar subdiretórios recursivamente para a seleção no Dashboard
async function getDirectoriesRecursive(base, root = base) {
    let results = ["."]; // Inclui a própria raiz
    const visited = new Set();
    try {
        visited.add(fs.realpathSync(base));
    } catch (e) {}

    async function walk(dir) {
        try {
            const list = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const dirent of list) {
                const res = path.join(dir, dirent.name);
                let isDir = false;
                let canonical = "";
                try {
                    const stat = fs.statSync(res);
                    isDir = stat.isDirectory();
                    if (isDir) {
                        canonical = fs.realpathSync(res);
                    }
                } catch (e) {}

                if (isDir && canonical && !visited.has(canonical)) {
                    visited.add(canonical);
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
    const visited = new Set();
    try {
        visited.add(fs.realpathSync(dir));
    } catch (e) {}

    async function walk(currentDir) {
        try {
            const list = await fs.promises.readdir(currentDir, { withFileTypes: true });
            for (const dirent of list) {
                const res = path.join(currentDir, dirent.name);
                let isDir = false;
                let canonical = "";
                let size = 0;
                try {
                    const stat = fs.statSync(res);
                    isDir = stat.isDirectory();
                    size = stat.size;
                    if (isDir) {
                        canonical = fs.realpathSync(res);
                    }
                } catch (e) {}

                if (isDir) {
                    if (canonical && !visited.has(canonical)) {
                        visited.add(canonical);
                        await walk(res);
                    }
                } else if (path.extname(dirent.name).toLowerCase() === extension && size > 0) {
                    // Filtra arquivos vazios (0 bytes) que causam erro de 'moov atom'
                    results.push(res);
                }
            }
        } catch (e) {}
    }
    if (fs.existsSync(dir)) await walk(dir);
    return results;
}

// Armazena os processos FFmpeg ativos
const activeStreams = new Map();

// Timers de avanço automático para relay-loop
const relayLoopTimers = new Map();

// Guardian: máximo de falhas consecutivas antes da pausa e tempo de pausa
const RELAY_GUARDIAN_MAX_FAILS = 5;
const RELAY_GUARDIAN_RETRY_MS = 10 * 60 * 1000;
const relayGuardianPausedAt = new Map(); // channelId -> timestamp da pausa

// Transmux on-the-fly do relay loop (1 ffmpeg leve por pessoa assistindo):
// controlados para nunca vazar processos quando o cliente desconecta.
const relayTransmuxProcs = new Map(); // channelId -> Set<proc> (procs de transmux ativos)
const RELAY_TRANSMUX_MAX_PER_CHANNEL = 20; // trava de segurança por canal
const RELAY_TRANSMUX_SWEEP_MS = 5 * 60 * 1000; // varredura periódica de limpeza

function trackRelayTransmux(channelId, proc) {
    if (!relayTransmuxProcs.has(channelId)) relayTransmuxProcs.set(channelId, new Set());
    relayTransmuxProcs.get(channelId).add(proc);
    proc.on('exit', () => {
        const procs = relayTransmuxProcs.get(channelId);
        if (!procs) return;
        procs.delete(proc);
        if (procs.size === 0) relayTransmuxProcs.delete(channelId);
    });
}

function killRelayTransmuxProcs(channelId) {
    const procs = relayTransmuxProcs.get(channelId);
    if (!procs) return;
    for (const proc of procs) {
        try { proc.kill('SIGKILL'); } catch (e) {}
    }
    relayTransmuxProcs.delete(channelId);
}

function killRelayTransmuxProc(proc) {
    try { proc.kill('SIGKILL'); } catch (e) {}
}

// Varredura periódica: derruba transmux órfãos (cliente foi embora mas o processo
// de alguma forma sobreviveu) e aplica a trava por canal quando há excesso.
setInterval(() => {
    for (const [channelId, procs] of relayTransmuxProcs) {
        const procsArr = Array.from(procs);
        let killed = 0;
        // Trava: se passar do limite, derruba os mais antigos até caber
        while (procsArr.length > RELAY_TRANSMUX_MAX_PER_CHANNEL) {
            const oldest = procsArr.shift();
            try { oldest.kill('SIGKILL'); } catch (e) {}
            killed++;
        }
        // Órfãos: processo marcado como desconectado e que ainda está vivo
        for (const proc of procsArr) {
            if (proc.__relayClientGone && proc.exitCode === null) {
                try { proc.kill('SIGKILL'); } catch (e) {}
                killed++;
            }
        }
        if (killed > 0) console.warn(`[RELAY LOOP] Varredura de transmux: canal ${channelId} teve ${killed} processos encerrados (cliente desconectado/excesso).`);
    }
}, RELAY_TRANSMUX_SWEEP_MS);

// Contador de falhas por URL no relay loop (chave por URL, pois índices mudam após remoção)
const relayLoopFailures = new Map(); // channelId -> Map<url, count>
// URLs removidas da rotação e o momento (para re-teste de recuperação)
const relayLoopDeadUrls = new Map(); // channelId -> Map<url, removedAt>

// Estado de cache de episódios por canal relay:
// channelId -> { list, startIdx, playingPos, queuedPos, durations, downloadInflight, lastOutUs, ffmpegPid }
const relayCacheState = new Map();
// Cada execução do FFmpeg usa uma geração própria e imutável do cache.
const relayCacheGenerations = new Map();
// Processos de preparação (probe/download) não ficam em activeStreams porque
// ainda não existe HLS. Eles também precisam ser canceláveis no stop.
const relayPreparationProcesses = new Map();
const relayPreparationRuns = new Map();

function trackRelayPreparationProcess(channelId, proc) {
    if (!relayPreparationProcesses.has(channelId)) relayPreparationProcesses.set(channelId, new Set());
    relayPreparationProcesses.get(channelId).add(proc);
}

function untrackRelayPreparationProcess(channelId, proc) {
    const processes = relayPreparationProcesses.get(channelId);
    if (!processes) return;
    processes.delete(proc);
    if (processes.size === 0) relayPreparationProcesses.delete(channelId);
}

function cancelRelayPreparation(channelId) {
    const run = relayPreparationRuns.get(channelId);
    if (run) run.cancelled = true;
    relayPreparationRuns.delete(channelId);
    const processes = relayPreparationProcesses.get(channelId);
    if (processes) {
        for (const proc of processes) {
            try { proc.kill('SIGKILL'); } catch (e) {}
        }
        relayPreparationProcesses.delete(channelId);
    }
}

function isRelayLoopSubtype(subtype) {
    return subtype === 'loop' || subtype === 'loop-cache';
}

function isRelaySyncSubtype(subtype) {
    return subtype === 'sync' || subtype === 'sync-cache';
}

function isRelayCacheSubtype(subtype) {
    return subtype === 'loop-cache' || subtype === 'sync-cache';
}

function isRelayDirectSubtype(subtype) {
    return subtype === 'sync' || subtype === 'loop';
}

// Caminho do arquivo de episódio em cache (usado pelo concat local e pelo downloader)
function relayCachePath(channelId, idx) {
    return path.join(relayCacheDir(channelId), `ep_${idx}.ts`);
}

function relayCacheDir(channelId) {
    const root = path.join(CACHE_DIR, channelId.toString());
    const dir = relayCacheGenerations.get(channelId) || root;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function createRelayCacheGeneration(channelId) {
    const root = path.join(CACHE_DIR, channelId.toString());
    const dir = path.join(root, `gen-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dir, { recursive: true });
    relayCacheGenerations.set(channelId, dir);
    return dir;
}

// Só remove gerações antigas quando não há FFmpeg ativo para o canal.
function cleanupOldRelayCacheGenerations(channelId, keepDir) {
    const root = path.join(CACHE_DIR, channelId.toString());
    if (hasActiveStream(channelId)) return;
    try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            const fullPath = path.join(root, entry.name);
            if (entry.isDirectory() && fullPath !== keepDir && entry.name.startsWith('gen-')) {
                fs.rmSync(fullPath, { recursive: true, force: true });
            }
        }
    } catch (e) {}
}

// Stop manual/delete: invalida a geração para novas operações, mas não remove
// arquivos enquanto o processo antigo ainda pode estar encerrando.
function clearRelayCache(channelId) {
    cancelRelayPreparation(channelId);
    relayCacheState.delete(channelId);
    relayCacheGenerations.delete(channelId);
    setTimeout(() => {
        if (hasActiveStream(channelId) || relayCacheGenerations.has(channelId)) return;
        const root = path.join(CACHE_DIR, channelId.toString());
        try { if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
    }, 1500);
}

function clearRelayStartupState(channel) {
    if (channel) delete channel.relayStartup;
}

// Lista de rotação na ordem que o concat vai tocar: [startIdx, startIdx+1, ..., N-1, 0, ..., startIdx-1]
function buildRelayRotationList(channel, startIdx) {
    const n = (channel.relayUrlProbed || channel.relayUrls || []).length;
    if (n === 0) return [];
    const list = [];
    for (let i = 0; i < n; i++) list.push((startIdx + i) % n);
    return list;
}

// Escreve o concat.txt do canal com TODOS os episódios na ordem da rotação.
// O demuxer concat é lazy (só abre o arquivo quando alcança), então episódios ainda
// não baixados podem ficar listados sem derrubar o ffmpeg.
function writeRelayConcat(channel, list) {
    const lines = ['ffconcat version 1.0'];
    for (const idx of list) {
        const p = relayCachePath(channel.id, idx);
        lines.push(`file '${p.replace(/'/g, "'\\''")}'`);
    }
    const p = path.join(relayCacheDir(channel.id), 'concat.txt');
    fs.writeFileSync(p, lines.join('\r\n'));
    return p;
}

// Lista ordenada dos índices de episódios já disponíveis em disco (completo e >= 1MB)
function getRelayCachedEpisodes(channel) {
    const dir = relayCacheDir(channel.id);
    const idxs = [];
    try {
        for (const f of fs.readdirSync(dir)) {
            const m = f.match(/^ep_(\d+)\.ts$/);
            if (m && fs.statSync(path.join(dir, f)).size > 1024 * 1024) idxs.push(parseInt(m[1]));
        }
    } catch (e) {}
    return idxs.sort((a, b) => a - b);
}

// Baixa um episódio completo para o cache (mpegts, -c copy, sem -re → ~575x real-time).
// Retorna a duração local ou null em caso de falha.
function downloadRelayEpisode(channel, idx) {
    const urls = channel.relayUrlProbed || channel.relayUrls || [];
    const url = urls[idx];
    if (!url) return Promise.resolve(null);
    relayCacheDir(channel.id);
    const target = relayCachePath(channel.id, idx);
    const tmp = target + '.tmp';
    return new Promise((resolve) => {
        let done = false;
        let timer = null;
        const finish = () => {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
            resolve(null);
        };
        const proc = spawnFFmpeg([
            '-fflags', '+genpts+igndts+flush_packets',
            '-err_detect', 'ignore_err',
            // Reconexão por erro de rede/5xx, mas SEM -reconnect_at_eof: o download
            // precisa terminar no EOF real do episódio (senão re-baixa o arquivo em loop).
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_on_network_error', '1',
            '-reconnect_on_http_error', '5xx',
            '-reconnect_delay_max', '5',
            '-timeout', '60000000',
            '-i', url,
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-sn', '-dn',
            '-avoid_negative_ts', 'make_zero',
            '-f', 'mpegts',
            tmp
        ]);
        trackRelayPreparationProcess(channel.id, proc);
        timer = setTimeout(() => {
            console.warn(`[RELAY CACHE] Canal ${channel.id}: download do episódio ${idx} excedeu 10min. Abortando.`);
            try { proc.kill('SIGKILL'); } catch (e) {}
        }, 10 * 60 * 1000);
        proc.stderr.on('data', () => {});
        proc.on('error', finish);
        proc.on('close', (code) => {
            untrackRelayPreparationProcess(channel.id, proc);
            if (done) return;
            if (code !== 0) return finish();
            try {
                const size = fs.statSync(tmp).size;
                if (size < 1024 * 1024) return finish();
                fs.renameSync(tmp, target);
            } catch (e) {
                return finish();
            }
            probeLocalDuration(target).then((dur) => {
                if (dur) { resolve(dur); done = true; if (timer) clearTimeout(timer); }
                else finish();
            });
        });
    });
}

// ffprobe local rápido (arquivo já em disco)
function probeLocalDuration(file) {
    return new Promise((resolve) => {
        const proc = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', file]);
        let stdout = '';
        proc.stdout.on('data', d => stdout += d);
        proc.on('error', () => resolve(null));
        proc.on('close', (code) => {
            if (code !== 0) return resolve(null);
            try {
                const d = parseFloat(JSON.parse(stdout).format?.duration);
                resolve(d > 0 ? d : null);
            } catch (e) { resolve(null); }
        });
    });
}

// Duração estimada de um episódio (local baixado > probe > padrão 3600s)
function relayEpisodeDuration(channel, state, idx) {
    if (state.durations && state.durations[idx]) return state.durations[idx];
    const probed = channel.relayUrlDurations;
    if (probed && probed[idx] > 0) return probed[idx];
    return 3600;
}

// Garante que os 2 primeiros episódios da rotação estão em disco (janela inicial de cache)
async function ensureRelayWindow(channel, state) {
    const need = [];
    const limit = Math.min(2, state.list.length);
    for (let p = 0; p < limit; p++) {
        const idx = state.list[p];
        const pth = relayCachePath(channel.id, idx);
        if (!fs.existsSync(pth) || fs.statSync(pth).size <= 1024 * 1024) need.push(idx);
    }
    for (const idx of need) {
        console.log(`[RELAY CACHE] Canal ${channel.id}: baixando episódio ${idx}...`);
        const dur = await downloadRelayEpisode(channel, idx);
        if (!dur) {
            console.error(`[RELAY CACHE] Canal ${channel.id}: falha ao baixar episódio ${idx}.`);
            return false;
        }
        state.durations[idx] = dur;
        console.log(`[RELAY CACHE] Canal ${channel.id}: episódio ${idx} pronto (${Math.round(dur)}s).`);
    }
    return true;
}

// Mapeia posição acumulada (out_time, em segundos) para o índice local da rotação
function relayPositionToIndex(channel, state, posSec) {
    if (!state.list.length) return 0;
    let total = 0;
    for (const idx of state.list) total += relayEpisodeDuration(channel, state, idx);
    if (total <= 0) total = state.list.length * 3600;
    const rot = posSec % total;
    let cum = 0;
    for (let i = 0; i < state.list.length; i++) {
        const d = relayEpisodeDuration(channel, state, state.list[i]);
        if (rot < cum + d) return i;
        cum += d;
    }
    return state.list.length - 1;
}

// Consome o stdout do ffmpeg (-progress pipe:1) e detecta a posição de reprodução
function handleRelayProgress(channel, chunk) {
    const state = relayCacheState.get(channel.id);
    if (!state) return;
    state.progressBuf = (state.progressBuf || '') + chunk.toString();
    const lines = state.progressBuf.split('\n');
    state.progressBuf = lines.pop() || '';
    let outUs = null;
    for (const line of lines) {
        if (line.indexOf('out_time_us=') === 0) outUs = parseInt(line.slice(12));
    }
    if (outUs === null || isNaN(outUs)) return;
    state.lastOutUs = outUs;
    const playingPos = relayPositionToIndex(channel, state, outUs / 1e6);
    advanceRelayWindow(channel, state, playingPos);
}

// Avança a janela de cache conforme o episódio que está sendo transmitido:
// quando o próximo (da fila) começa, baixa o seguinte imediatamente.
function advanceRelayWindow(channel, state, playingPos) {
    if (state.list.length < 2) return;
    if (playingPos === state.playingPos) return;
    // Só aceita avanço de exatamente um passo (ou o wrap N-1→0). Saltos estranhos são ignorados.
    const expected = (state.playingPos + 1) % state.list.length;
    if (playingPos !== expected) return;
    // Não remover o episódio anterior: -stream_loop pode reabrir qualquer
    // item da lista após o wrap, e o concat do FFmpeg é lazy.
    state.playingPos = expected;
    state.queuedPos = (expected + 1) % state.list.length;
    const queuedIdx = state.list[state.queuedPos];
    const qFile = relayCachePath(channel.id, queuedIdx);
    try {
        if (fs.existsSync(qFile) && fs.statSync(qFile).size > 1024 * 1024) return;
    } catch (e) {}
    if (state.downloadInflight[queuedIdx]) return;
    console.log(`[RELAY CACHE] Canal ${channel.id}: episódio ${queuedIdx} começou a transmitir; baixando o próximo (${queuedIdx}).`);
    state.downloadInflight[queuedIdx] = true;
    downloadRelayEpisode(channel, queuedIdx).then((dur) => {
        delete state.downloadInflight[queuedIdx];
        if (dur) {
            state.durations[queuedIdx] = dur;
            console.log(`[RELAY CACHE] Canal ${channel.id}: próximo episódio ${queuedIdx} pronto (${Math.round(dur)}s).`);
        } else {
            console.error(`[RELAY CACHE] Canal ${channel.id}: falha ao baixar próximo episódio ${queuedIdx}. Re-tentando em 30s.`);
            setTimeout(() => {
                const st = relayCacheState.get(channel.id);
                if (st && !st.downloadInflight[queuedIdx]) {
                    st.downloadInflight[queuedIdx] = true;
                    downloadRelayEpisode(channel, queuedIdx).then((d2) => {
                        delete st.downloadInflight[queuedIdx];
                        if (d2) st.durations[queuedIdx] = d2;
                    });
                }
            }, 30000);
        }
    });
}

// Inicia (ou reinicia) o ffmpeg compartilhado de um canal relay a partir do cache local.
// Vale para loop e sync: 1 ffmpeg por canal, HLS 15s no tmpfs, servido pelo nginx.
async function startRelayCached(channel) {
    const id = channel.id;
    const run = { cancelled: false };
    relayPreparationRuns.set(id, run);
    const isCancelled = () => run.cancelled || channel.userStopped || relayPreparationRuns.get(id) !== run;

    // Placeholder state antes do probe (bloqueia guardian durante probe/download)
    if (!relayCacheState.has(id)) {
        relayCacheState.set(id, {
            id, list: [], startIdx: 0, ffmpegPid: null,
            durations: {}, downloadInflight: {}, lastOutUs: 0, progressBuf: '',
            probing: true
        });
    }

    // Probe (re)validado das URLs, se ainda não houver
    if (!channel.relayUrlProbed || channel.relayUrlProbed.length === 0) {
        console.log(`[RELAY CACHE] Canal ${id}: probando ${channel.relayUrls.length} URLs...`);
        const results = await Promise.all(channel.relayUrls.map(u => probeUrlDuration(u, id)));
        const probed = [];
        const durations = [];
        for (let i = 0; i < results.length; i++) {
            if (results[i] !== null) {
                probed.push(channel.relayUrls[i]);
                durations.push(results[i]);
            } else {
                console.warn(`[RELAY CACHE] URL ${i} inválida/off, pulando: ${channel.relayUrls[i]}`);
            }
        }
        if (isCancelled()) {
            relayPreparationRuns.delete(id);
            relayCacheState.delete(id);
            return { status: 'error', message: 'Canal parado durante a preparação.' };
        }
        if (probed.length === 0) {
            relayPreparationRuns.delete(id);
            relayCacheState.delete(id);
            return { status: 'error', message: 'Nenhuma URL válida encontrada. Todas falharam no ffprobe.' };
        }
        channel.relayUrlProbed = probed;
        channel.relayUrlDurations = durations;
    }

    const n = channel.relayUrlProbed.length;
    let startIdx = channel.currentUrlIndex || 0;
    if (startIdx >= n) startIdx = 0;

    if (channel.userStopped) {
        relayCacheState.delete(id);
        console.log("[RELAY CACHE] Canal " + id + " parado pelo usuário durante o start. Abortando.");
        channel.status = 'offline';
        saveChannels();
        return { status: 'error', message: 'Canal parado durante o start' };
    }

    const list = buildRelayRotationList(channel, startIdx);
    const state = {
        id,
        list,
        startIdx,
        playingPos: 0,
        queuedPos: list.length > 1 ? 1 : 0,
        durations: {},
        downloadInflight: {},
        lastOutUs: 0,
        progressBuf: '',
        ffmpegPid: null
    };
    const generationDir = createRelayCacheGeneration(id);
    cleanupOldRelayCacheGenerations(id, generationDir);
    relayCacheState.set(id, state);

    const ok = await ensureRelayWindow(channel, state);
    if (!ok || isCancelled()) {
        relayPreparationRuns.delete(id);
        relayCacheState.delete(id);
        return { status: 'error', message: isCancelled() ? 'Canal parado durante a preparação.' : 'Falha ao baixar episódios iniciais.' };
    }

    // Re-checa após o download da janela: um stop manual durante o start deve vencer.
    if (channel.userStopped) {
        console.log(`[RELAY CACHE] Canal ${id} parado durante o download da janela. Abortando.`);
        relayCacheState.delete(id);
        channel.status = 'offline';
        return { status: 'error', message: 'Canal parado durante o start' };
    }

    // Limpa segmentos HLS antigos do tmpfs antes de iniciar
    const outputDir = path.join(CHANNELS_DIR, id.toString());
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    let cleaned = 0;
    try {
        const files = fs.readdirSync(outputDir);
        for (const f of files) {
            if (f.endsWith('.ts') || f.endsWith('.m3u8') || f.endsWith('.tmp')) {
                fs.unlinkSync(path.join(outputDir, f));
                cleaned++;
            }
        }
    } catch (e) {}
    if (cleaned > 0) console.log(`[CANAL ${id}] ${cleaned} arquivos antigos limpos do tmpfs`);

    const concatPath = writeRelayConcat(channel, list);

    const args = [
        '-fflags', '+genpts+igndts+flush_packets',
        '-err_detect', 'ignore_err',
        '-re',
        '-stream_loop', '-1',
        '-f', 'concat', '-safe', '0',
        '-protocol_whitelist', 'file,http,https,tcp,tls',
        '-i', concatPath
    ];
    if (channel.useTranscode) {
        args.push(FFMPEG_FPS_FLAG, 'cfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-r', '24', '-g', '48', '-crf', '28', '-threads', '1', '-c:a', 'copy', '-sn', '-dn');
    } else {
        args.push(FFMPEG_FPS_FLAG, 'passthrough', '-c:v', 'copy', '-c:a', 'copy');
    }
    args.push(
        '-flags', '+global_header',
        '-avoid_negative_ts', 'make_zero',
        '-loglevel', 'error',
        '-progress', 'pipe:1',
        '-f', 'hls', '-hls_time', '15', '-hls_list_size', '10',
        '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        path.join(outputDir, 'index.m3u8')
    );

    const ffmpeg = spawnFFmpeg(args);
    relayPreparationRuns.delete(id);
    state.ffmpegPid = ffmpeg.pid;
    ffmpeg.stdout.on('data', (d) => handleRelayProgress(channel, d));

    const logStream = fs.createWriteStream(path.join(LOGS_DIR, `canal_${id}.log`), { flags: 'a' });
    logStream.write(`\n--- INICIANDO CANAL RELAY CACHE ${id} EM ${new Date().toLocaleString()} ---\n`);

    ffmpeg.on('error', (err) => {
        const msg = `[ERRO CRÍTICO] Falha ao iniciar FFmpeg no canal ${id}: ${err.message}\n`;
        console.error(msg);
        logStream.write(msg);
        const ch = channels.find(c => c.id === id);
        if (ch) { ch.status = 'offline'; delete ch.startedAt; removeRelayFlag(id); saveChannels(); }
        activeStreams.delete(id);
        relayCacheState.delete(id);
    });

    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (/error|Error|Warning|warning|fail|Fail|Invalid|invalid/i.test(msg)) logStream.write(`[FFMPEG] ${msg}`);
    });
    ffmpeg.stderr.on('error', (err) => logStream.write(`[SYSTEM ERROR] Falha ao ler stderr: ${err.message}\n`));

    ffmpeg.on('close', (code) => {
        const closeMsg = `Canal ${id} parou com código ${code} em ${new Date().toLocaleString()}\n`;
        logStream.write(closeMsg);
        logStream.end();
        console.log(`Canal ${id} (${channel.name}) parou com código ${code}`);
        const current = activeStreams.get(id);
        if (current && current.process === ffmpeg) activeStreams.delete(id);
        const st = relayCacheState.get(id);
        if (st && st.ffmpegPid === ffmpeg.pid) relayCacheState.delete(id);
        const ch = channels.find(c => c.id === id);
        if (ch && (ch.status === 'online' || ch.status === 'relay')) {
            ch.status = 'offline';
            delete ch.startedAt;
            removeRelayFlag(id);
            saveChannels();
        }
    });

    channel.startedAt = Date.now();
    activeStreams.set(id, { process: ffmpeg, startedAt: channel.startedAt });
    channel.status = 'relay';
    channel.userStopped = false;
    if (channel.restartFails) channel.restartFails = 0;
    setRelayFlag(id);
    await saveChannels();
    console.log(`[RELAY CACHE] Canal ${id} ativado com rotação de ${list.length} episódios.`);
    return { status: 'success', pid: ffmpeg.pid, rotation: list.length };
}

// Limpa o estado de falhas/removidas de um canal relay loop (novo start re-probeia tudo)
function clearRelayLoopState(id) {
    relayLoopFailures.delete(id);
    relayLoopDeadUrls.delete(id);
    killRelayTransmuxProcs(id);
}

// Timers de reinício automático após falha/watchdog.
// Precisam ser canceláveis para que um stop manual vença um restart já agendado.
const relayRestartTimers = new Map();

function clearRelayLoopTimer(id) {
    if (relayLoopTimers.has(id)) {
        clearTimeout(relayLoopTimers.get(id));
        relayLoopTimers.delete(id);
    }
}

function clearRelayRestartTimer(id) {
    const timer = relayRestartTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        relayRestartTimers.delete(id);
    }
}

function hasActiveStream(id) {
    const info = activeStreams.get(id);
    if (!info) return false;

    const process = info.process;
    if (!process || process.exitCode !== null || process.killed) {
        activeStreams.delete(id);
        return false;
    }
    return true;
}

    function isChannelRuntimeActive(channel) {
    if (!channel) return false;
    if (channel.status === 'vod') return hasVodFlag(channel.id);
    if (channel.mode === 'relay') {
        const cacheState = relayCacheState.get(channel.id);
        if (cacheState && !cacheState.ffmpegPid) return true;
        return hasActiveStream(channel.id) || (channel.status === 'relay' && hasRelayFlag(channel.id));
    }
    return hasActiveStream(channel.id);
}

function scheduleRelayRestart(id, reason) {
    clearRelayRestartTimer(id);

    const timer = setTimeout(async () => {
        relayRestartTimers.delete(id);
        const channel = channels.find(c => c.id === id);

        // Falha automática pode reiniciar; stop manual ou mudança de estado não.
        if (!channel || channel.userStopped || channel.status !== 'offline') return;

        console.log(`[RESTART] Canal ${id} reiniciando após ${reason}.`);
        const result = await startChannel(id);
        if (result && result.status === 'success') channel.restartFails = 0;
    }, 2000);

    relayRestartTimers.set(id, timer);
}

// Grava evento de log para o canal (funciona em Relay Loop, VOD e Live)
function logChannelEvent(channelId, message) {
    try {
        if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
        const logPath = path.join(LOGS_DIR, `canal_${channelId}.log`);
        const time = new Date().toLocaleString();
        fs.appendFileSync(logPath, `[${time}] ${message}\n`);
    } catch (e) {}
}

// Avança o índice atual do relay loop para o próximo episódio válido e reagenda o timer.
// Retorna false se não há episódios suficientes para avançar.
function advanceRelayLoop(channel) {
    const urls = channel.relayUrlProbed || channel.relayUrls;
    if (!urls || urls.length < 2) {
        console.warn(`[RELAY LOOP] Canal ${channel.id} sem episódios suficientes para avançar.`);
        return false;
    }
    const nextIdx = ((channel.currentUrlIndex || 0) + 1) % urls.length;
    channel.currentUrlIndex = nextIdx;
    scheduleRelayLoop(channel);
    return true;
}

function scheduleRelayLoop(channel) {
    clearRelayLoopTimer(channel.id);
    const urls = channel.relayUrlProbed || channel.relayUrls;
    const durations = channel.relayUrlDurations || [];
    if (!urls || urls.length < 2) {
        console.warn("[RELAY LOOP] Canal " + channel.id + " sem episódios suficientes para agendar avanço.");
        return;
    }
    const idx = channel.currentUrlIndex || 0;
    const dur = durations[idx];
    if (!dur || dur <= 0) return;
    console.log("[RELAY LOOP] Canal " + channel.id + " agendado: avança da posição " + idx + " em " + Math.round(dur) + "s");
    const timer = setTimeout(() => {
        const ch = channels.find(c => c.id === channel.id && c.status === 'relay');
        if (!ch || ch.relaySubtype !== 'loop') return;
        if (!advanceRelayLoop(ch)) return;
        saveChannels().catch(e => console.error('[RELAY LOOP] Erro ao salvar channels no avanço automático:', e));
        console.log("[RELAY LOOP] Canal " + ch.id + " avançou automático para posição " + ch.currentUrlIndex);
    }, dur * 1000);
    relayLoopTimers.set(channel.id, timer);
}

async function startRelayLoop(channel) {
    clearRelayLoopState(channel.id);
    console.log("[RELAY LOOP] Probing " + channel.relayUrls.length + " URLs para canal " + channel.id + "...");
    const results = await Promise.all(channel.relayUrls.map(u => probeUrlDuration(u, channel.id)));
    const probed = [];
    const durations = [];
    for (let i = 0; i < results.length; i++) {
        if (results[i] !== null) {
            probed.push(channel.relayUrls[i]);
            durations.push(results[i]);
        } else {
            console.warn("[RELAY LOOP] URL " + i + " inválida/off, pulando: " + channel.relayUrls[i]);
        }
    }
    if (probed.length === 0) {
        channel.relayUrlProbed = undefined;
        channel.relayUrlDurations = undefined;
        return { status: 'error', message: 'Nenhuma URL válida encontrada. Todas falharam no ffprobe.' };
    }
    channel.relayUrlProbed = probed;
    channel.relayUrlDurations = durations;
    if (channel.currentUrlIndex === undefined || channel.currentUrlIndex >= probed.length) channel.currentUrlIndex = 0;
    if (channel.userStopped) {
        channel.status = 'offline';
        await saveChannels();
        return { status: 'error', message: 'Canal parado durante o start' };
    }
    setRelayFlag(channel.id);
    channel.status = 'relay';
    channel.userStopped = false;
    channel.startedAt = Date.now();
    await saveChannels();
    scheduleRelayLoop(channel);
    console.log("[RELAY LOOP] Canal " + channel.id + " ativado com " + probed.length + "/" + channel.relayUrls.length + " URLs válidas");
    return { status: 'success', mode: 'relay-loop', validUrls: probed.length, totalUrls: channel.relayUrls.length };
}

// Remove uma URL da rotação após falhas repetidas, ajustando o índice atual
function removeRelayLoopUrl(channel, url) {
    const probed = channel.relayUrlProbed || [];
    const durations = channel.relayUrlDurations || [];
    const pos = probed.indexOf(url);
    if (pos === -1) return;
    const wasCurrent = (channel.currentUrlIndex || 0) === pos;
    probed.splice(pos, 1);
    if (durations.length) durations.splice(pos, 1);
    if (wasCurrent) {
        // Índice agora aponta para o próximo episódio da lista (que virou o "atual")
        channel.currentUrlIndex = pos;
    } else if ((channel.currentUrlIndex || 0) > pos) {
        channel.currentUrlIndex -= 1;
    }
    const dead = relayLoopDeadUrls.get(channel.id) || new Map();
    dead.set(url, Date.now());
    relayLoopDeadUrls.set(channel.id, dead);
}

// Trata falha de transmux de uma URL do relay loop: conta, remove após 4 falhas e
// avança imediatamente se for o episódio atual (sem esperar o timer)
function handleRelayLoopFailure(channel, idx) {
    const urls = channel.relayUrlProbed || channel.relayUrls;
    if (!urls || !urls[idx]) return;
    const url = urls[idx];
    const fails = relayLoopFailures.get(channel.id) || new Map();
    const count = (fails.get(url) || 0) + 1;
    fails.set(url, count);
    relayLoopFailures.set(channel.id, fails);
    const isCurrent = (channel.currentUrlIndex || 0) === idx;
    console.warn(`[RELAY LOOP] Canal ${channel.id} falha ${count}/4 na URL ${idx}: ${url}`);

    if (count >= 4) {
        removeRelayLoopUrl(channel, url);
        console.warn(`[RELAY LOOP] Canal ${channel.id}: URL removida da rotação por ${count} falhas: ${url}`);
        saveChannels().catch(e => console.error('[RELAY LOOP] Erro ao salvar channels ao remover URL:', e));
    }

    if (isCurrent) {
        if (count < 4) {
            if (advanceRelayLoop(channel)) {
                saveChannels().catch(e => console.error('[RELAY LOOP] Erro ao salvar channels ao avançar por falha:', e));
                console.log("[RELAY LOOP] Canal " + channel.id + " avançou por falha para posição " + channel.currentUrlIndex);
            }
        } else {
            // URL atual removida: re-sincroniza o timer com o novo episódio atual
            scheduleRelayLoop(channel);
        }
    }
}

// Reintroduz uma URL que voltou a funcionar, na posição original da lista canônica
function reintroduceRelayLoopUrl(channel, url, duration) {
    const probeUrls = channel.relayUrlProbed || [];
    if (probeUrls.includes(url)) {
        const dead = relayLoopDeadUrls.get(channel.id);
        if (dead) dead.delete(url);
        return;
    }
    const durations = channel.relayUrlDurations || [];
    const canonical = channel.relayUrls || [];
    const origPos = canonical.indexOf(url);
    let insertPos = probeUrls.length;
    for (let i = 0; i < probeUrls.length; i++) {
        const pos = canonical.indexOf(probeUrls[i]);
        if (pos > origPos) { insertPos = i; break; }
    }
    probeUrls.splice(insertPos, 0, url);
    durations.splice(insertPos, 0, duration);
    if ((channel.currentUrlIndex || 0) >= insertPos) channel.currentUrlIndex += 1;
    const dead = relayLoopDeadUrls.get(channel.id);
    if (dead) dead.delete(url);
    saveChannels().catch(e => console.error('[RELAY LOOP] Erro ao salvar channels na reintrodução:', e));
    console.log(`[RELAY LOOP] Canal ${channel.id}: URL reincorporada na posição ${insertPos}: ${url}`);
}

// Re-teste periódico (1x por hora) das URLs removidas: se voltaram a funcionar, reintroduz
setInterval(() => {
    if (relayLoopDeadUrls.size === 0) return;
    for (const [channelId, deadMap] of relayLoopDeadUrls) {
        const channel = channels.find(c => c.id === channelId && c.mode === 'relay' && c.relaySubtype === 'loop');
        if (!channel) continue;
        const entries = [...deadMap.entries()];
        for (const [url, removedAt] of entries) {
            // Evita re-teste imediato pós-remoção (só testa após 5 min fora)
            if (Date.now() - removedAt < 5 * 60 * 1000) continue;
            probeUrlDuration(url, channelId).then(duration => {
                if (duration && duration > 0) {
                    reintroduceRelayLoopUrl(channel, url, duration);
                } else {
                    console.log(`[RELAY LOOP] Canal ${channelId}: URL continua fora (re-teste falhou): ${url}`);
                }
            });
        }
    }
}, 60 * 60 * 1000);

function probeUrlDuration(url, channelId = null) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            if (channelId !== null) untrackRelayPreparationProcess(channelId, proc);
            resolve(value);
        };
        const proc = spawn('ffprobe', [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-show_format',
            url
        ]);
        if (channelId !== null) trackRelayPreparationProcess(channelId, proc);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', (code) => {
            if (code !== 0) {
                finish(null);
                return;
            }
            try {
                const data = JSON.parse(stdout);
                const duration = parseFloat(data.format?.duration);
                if (duration && duration > 0) {
                    finish(duration);
                } else {
                    finish(null);
                }
            } catch (e) {
                finish(null);
            }
        });
        proc.on('error', () => finish(null));
        // Timeout de 15s por URL
        setTimeout(() => {
            try { proc.kill(); } catch (e) {}
            finish(null);
        }, 15000);
    });
}

// Flags HTTP de resiliência: reconecta em quedas de rede e em respostas 5xx (503 etc.)
// do servidor de origem (evita "Stream ends prematurely" e "HTTP error 503" derrubarem o canal)
const HTTP_RECONNECT_FLAGS = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_on_http_error', '5xx',
    '-reconnect_delay_max', '5',
    '-timeout', '60000000'
];

// Diretivas por arquivo no playlist concat (precisam de -safe 0, já usado)
const CONCAT_HTTP_OPTION_LINES = [
    'option reconnect 1',
    'option reconnect_streamed 1',
    'option reconnect_at_eof 1',
    'option reconnect_on_network_error 1',
    'option reconnect_on_http_error 5xx',
    'option reconnect_delay_max 5',
    'option timeout 60000000'
];

// Gera o conteúdo do playlist concat de URLs remotas com opções de reconexão HTTP por arquivo.
// Sem isso, um 503/truncamento transitório numa única URL derruba o canal inteiro.
function buildRelayPlaylist(urls) {
    const lines = ['ffconcat version 1.0'];
    for (const u of urls) {
        lines.push(`file '${u.replace(/'/g, "'\\''")}'`);
        lines.push(...CONCAT_HTTP_OPTION_LINES);
    }
    return lines.join('\r\n');
}

// Aguarda o processo terminar com timeout e tratamento de erro
function waitForProcessClose(proc, timeoutMs = 120000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (code) => { if (!done) { done = true; resolve(code); } };
        proc.on('close', finish);
        proc.on('error', () => finish(null));
        setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (e) {}
            finish(null);
        }, timeoutMs);
    });
}


// Armazena a posição estimada no playlist para restart não voltar ao início
const channelPlaylistState = new Map();

// Arquivo temporário + rename para escrita atômica
async function writeFileAtomic(filePath, content) {
    const tmp = filePath + '.tmp';
    await fs.promises.writeFile(tmp, content, 'utf8');
    await fs.promises.rename(tmp, filePath);
}

/**
 * Estima qual índice do playlist está rodando baseado nos segments gerados
 */
function estimateFileIndex(channelId, totalFiles) {
    if (!totalFiles) return 0;
    const dir = path.join(CHANNELS_DIR, channelId.toString());
    let maxSeq = 0;
    try {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            for (const f of files) {
                const m = f.match(/segment_(\d+)\.ts$/);
                if (m) maxSeq = Math.max(maxSeq, parseInt(m[1]));
            }
        }
    } catch (e) {}
    // ~88 segments de 15s por arquivo de 22min
    const AVG_SEGMENTS_PER_FILE = 88;
    const estimatedIndex = Math.floor(maxSeq / AVG_SEGMENTS_PER_FILE);
    return estimatedIndex % totalFiles;
}

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
 * Busca informações detalhadas de todos os SSDs/Discos físicos do sistema
 */
function getDiskSpaceDetails() {
    return new Promise((resolve) => {
        if (os.platform() === 'win32') {
            exec("wmic logicaldisk get deviceid, size, freespace", (err, stdout) => {
                if (err) return resolve([{ filesystem: 'C:', size: '100G', used: '40G', avail: '60G', usePercent: '40%', mounted: 'C:' }]);
                const lines = stdout.split('\n');
                const disks = [];
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const parts = line.split(/\s+/);
                    if (parts.length >= 3) {
                        // wmic logic: deviceid (parts[0]), freespace (parts[1]), size (parts[2])
                        const free = parseInt(parts[1]) || 0;
                        const total = parseInt(parts[2]) || 0;
                        if (total > 0) {
                            const freeGB = Math.round(free / 1024 / 1024 / 1024) + 'G';
                            const totalGB = Math.round(total / 1024 / 1024 / 1024) + 'G';
                            const usedGB = Math.round((total - free) / 1024 / 1024 / 1024) + 'G';
                            const pct = Math.round(((total - free) / total) * 100) + '%';
                            disks.push({
                                filesystem: parts[0],
                                size: totalGB,
                                used: usedGB,
                                avail: freeGB,
                                usePercent: pct,
                                mounted: parts[0]
                            });
                        }
                    }
                }
                resolve(disks.length > 0 ? disks : [{ filesystem: 'C:', size: '100G', used: '40G', avail: '60G', usePercent: '40%', mounted: 'C:' }]);
            });
            return;
        }

        // Linux (Ubuntu) - df -Ph garante uma linha por montagem
        exec("df -Ph -x tmpfs -x devtmpfs -x run -x udev -x loop -x overlay", (err, stdout) => {
            if (err) return resolve([]);
            const lines = stdout.split('\n');
            const disks = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const parts = line.split(/\s+/);
                if (parts.length >= 6) {
                    const filesystem = parts[0];
                    const size = parts[1];
                    const used = parts[2];
                    const avail = parts[3];
                    const usePercent = parts[4];
                    const mounted = parts[5];
                    
                    // Filtrar apenas montagens de partições físicas reais ou mapeadas
                    const isPhysical = filesystem.startsWith('/dev/') || mounted.startsWith('/mnt') || mounted.startsWith('/home') || mounted.startsWith('/media') || mounted === '/';
                    const isVirtual = filesystem.includes('tmpfs') || filesystem.includes('loop') || filesystem.includes('udev');
                    const isBoot = mounted.startsWith('/boot');
                    
                    if (isPhysical && !isVirtual && !isBoot) {
                        disks.push({
                            filesystem,
                            size,
                            used,
                            avail,
                            usePercent,
                            mounted
                        });
                    }
                }
            }
            resolve(disks);
        });
    });
}

let cachedDisks = [];
let lastDiskCheck = 0;

async function getDiskSpaceDetailsCached() {
    const now = Date.now();
    if (now - lastDiskCheck > 60000 || cachedDisks.length === 0) {
        cachedDisks = await getDiskSpaceDetails();
        lastDiskCheck = now;
    }
    return cachedDisks;
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
    const disksInfo = await getDiskSpaceDetailsCached();
    
    return {
        cpu: cpuReal,
        io: io,
        ram: Math.round(((totalMem - freeMem) / totalMem) * 100),
        disco: disco,
        rede: rede,
        uptime: Math.floor(os.uptime()),
        activeStreams: channels.filter(c => c.status === 'online' || c.status === 'relay').length,
        disks: disksInfo,
        nocache: nocacheEnabled
    };
}

/**
 * Inicia um canal (Substitui o start.php)
 */
async function startChannel(id) {
    const channel = channels.find(c => c.id === id);
    if (!channel) return { status: 'error', message: 'Canal não encontrado' };

    // Loop puro (sem cache): repasse direto do link ao cliente (playlist virtual +
    // transmux on-the-fly por requisição). Não usa ffmpeg persistente nem activeStreams.
    if (channel.mode === 'relay' && channel.relaySubtype === 'loop') {
        if (channel.status === 'relay' && hasRelayFlag(channel.id)) return { status: 'error', message: 'Canal já rodando' };
        return startRelayLoop(channel);
    }

    if (activeStreams.has(id)) return { status: 'error', message: 'Canal já rodando' };

    // Reserva o slot imediatamente para evitar que duas chamadas concorrentes iniciem o mesmo canal
    activeStreams.set(id, { process: null, startedAt: null });

    try {
    // Relay (loop e sync) usa o pipeline de cache: 1 ffmpeg compartilhado por canal.
    if (channel.mode === 'relay' && isRelayCacheSubtype(channel.relaySubtype)) {
        const result = await startRelayCached(channel);
        if (result && result.status !== 'success') activeStreams.delete(id);
        return result;
    }
    if (channel.mode === 'relay') {
        setRelayFlag(id);
        console.log("[RELAY FLAG] Flag criada para canal " + id + " (relay)");
    }

    const outputDir = path.join(CHANNELS_DIR, id.toString());
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Limpa todo estado anterior: segments órfãos, m3u8 e .tmp
    let cleaned = 0;
    try {
        const files = fs.readdirSync(outputDir);
        for (const f of files) {
            if (f.endsWith('.ts') || f.endsWith('.m3u8') || f.endsWith('.tmp')) {
                fs.unlinkSync(path.join(outputDir, f));
                cleaned++;
            }
        }
    } catch (e) {}
    if (cleaned > 0) console.log(`[CANAL ${id}] ${cleaned} arquivos antigos limpos do tmpfs`);

    let playlistPath = channel.playlistFilePath;

    // Se for do tipo concat e não for relay, re-geramos a playlist.txt na RAM para garantir que ela existe
    if (channel.inputType === 'concat' && channel.mode !== 'relay') {
        const scanPath = path.isAbsolute(channel.sourceFolder)
            ? channel.sourceFolder
            : path.join(VIDEO_SOURCE, channel.sourceFolder);
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

        // Rotaciona o playlist para começar do episódio estimado
        const savedState = channelPlaylistState.get(id);
        const startIndex = savedState ? Math.min(savedState.fileIndex, mp4Files.length - 1) : 0;
        if (startIndex > 0) {
            mp4Files = [...mp4Files.slice(startIndex), ...mp4Files.slice(0, startIndex)];
            console.log(`[CANAL ${id}] Playlist rotacionado: iniciando do arquivo ${startIndex + 1}/${mp4Files.length}`);
        }

        const playlistContent = mp4Files.map(f => {
            // Escapa aspas simples para o formato concat do ffmpeg
            const escaped = f.replace(/'/g, "'\\''");
            return `file '${escaped}'`;
        }).join('\r\n');

        await writeFileAtomic(playlistPath, playlistContent);
        // Atualiza o caminho em memória para o processo atual
        channel.playlistFilePath = playlistPath;
    }

    // Correção: Garante que o playlistPath aponte para a RAM se o canal for concat e não for relay
    if (channel.inputType === 'concat' && channel.mode !== 'relay') {
        playlistPath = path.join(outputDir, 'playlist.txt');
    }

    // Relay-sync/loop (sem cache): probeia URLs, filtra válidas, gera playlist (evita URL morta travar o FFmpeg)
    if (channel.mode === 'relay' && isRelayDirectSubtype(channel.relaySubtype)) {
        const urls = channel.relayUrls || [];
        if (urls.length > 0) {
            console.log(`[RELAY SYNC ${id}] Probeando ${urls.length} URLs...`);
            const results = await Promise.all(urls.map(u => probeUrlDuration(u, id)));
            const validUrls = urls.filter((_, i) => results[i] !== null);
            if (validUrls.length === 0) {
                const errMsg = `[ERRO RELAY SYNC ${id}] Nenhuma URL válida encontrada`;
                console.error(errMsg);
                return { status: 'error', message: errMsg };
            }
            console.log(`[RELAY SYNC ${id}] ${validUrls.length}/${urls.length} URLs válidas`);
            const plContent = buildRelayPlaylist(validUrls);
            const plPath = path.join(outputDir, 'playlist_urls.txt');
            fs.writeFileSync(plPath, plContent);
            playlistPath = plPath;
        } else {
            playlistPath = path.join(outputDir, 'playlist_urls.txt');
        }
    }

    // Flags de estabilidade idênticas ao sistema PHP anterior
    const args = [
        '-fflags', '+genpts+igndts+flush_packets', // Gera e limpa pacotes problemáticos
        '-err_detect', 'ignore_err',  // Ignora erros de dados para não parar o processo
        '-re',
        '-stream_loop', '-1'
    ];

    if (channel.inputType === 'concat' || (channel.mode === 'relay' && isRelayDirectSubtype(channel.relaySubtype))) {
        args.push('-f', 'concat', '-safe', '0');
    }

    if (channel.mode === 'relay') {
        args.push('-protocol_whitelist', 'file,http,https,tcp,tls');
    }

    args.push('-i', playlistPath);

    if (channel.useTranscode) {
        // Modo Estável: Reconstrói o stream para evitar quebras em arquivos com FPS/Codecs diferentes
        args.push(
            FFMPEG_FPS_FLAG, 'cfr', // Força Constant Frame Rate para o transcode (necessário para -r 30)
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
        args.push(FFMPEG_FPS_FLAG, 'passthrough'); // Mantém timestamps originais no modo copy
        args.push('-c:v', 'copy', '-c:a', 'copy');
    }

    args.push(
        '-flags', '+global_header',   // Melhora compatibilidade de troca de stream
        '-avoid_negative_ts', 'make_zero',
        '-f', 'hls', '-hls_time', '15', '-hls_list_size', '10',
        '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        path.join(outputDir, 'index.m3u8')
    );

    // Se o usuário parou o canal durante o probe, aborta o início (evita revival não solicitado)
    if (channel.userStopped) {
        console.log("[START ABORTADO] Canal " + id + " parado pelo usuário durante o start. Abortando.");
        activeStreams.delete(id);
        channel.status = 'offline';
        delete channel.startedAt;
        saveChannels();
        return { status: 'error', message: 'Canal parado durante o start' };
    }

    const ffmpeg = spawnFFmpeg(args);

    // Prepara o stream de log para este canal
    const logStream = fs.createWriteStream(path.join(LOGS_DIR, `canal_${id}.log`), { flags: 'a' });
    logStream.write(`\n--- INICIANDO CANAL ${id} EM ${new Date().toLocaleString()} ---\n`);

    // Tratamento de erro para evitar que o Node.js trave (crash)
    ffmpeg.on('error', (err) => {
        const errMsg = `[ERRO CRÍTICO] Falha ao iniciar FFmpeg no canal ${id}: ${err.message}\n`;
        console.error(errMsg);
        logStream.write(errMsg);
        
        // Se houver erro ao iniciar, limpamos os dados de tempo e a flag
        const ch = channels.find(c => c.id === id);
        if (ch) {
            ch.status = 'offline';
            delete ch.startedAt;
            removeRelayFlag(id);
            saveChannels();
        }
        activeStreams.delete(id);
    });

    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (/error|Error|Warning|warning|fail|Fail|Invalid|invalid/i.test(msg)) {
            logStream.write(`[FFMPEG] ${msg}`);
        }
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
        if (ch && (ch.status === 'online' || ch.status === 'relay')) {
            ch.status = 'offline';
            delete ch.startedAt;
            removeRelayFlag(id);
            saveChannels();
        }
    });

    // Resetamos o uptime para o momento exato do início do processo atual
    channel.startedAt = Date.now();

    activeStreams.set(id, {
        process: ffmpeg,
        startedAt: channel.startedAt
    });    channel.status = channel.mode === 'relay' ? 'relay' : 'online';
    channel.userStopped = false;
    if (channel.restartFails) channel.restartFails = 0;
    saveChannels();

    return { status: 'success', pid: ffmpeg.pid };
    } catch (err) {
        console.error(`[ERRO startChannel ${id}]`, err.message);
        activeStreams.delete(id);
        if (channel) {
            channel.status = 'offline';
            delete channel.startedAt;
        }
        return { status: 'error', message: err.message };
    }
}

/**
 * Servidor HTTP Simples
 */
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Helper para obter IP real do cliente (trata proxy reverso)
    function getClientIP(req) {
        const remote = (req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
        // Só confia em headers de proxy quando o request vem de um proxy local (nginx)
        const fromLoopback = remote === '127.0.0.1' || remote === '::1' || remote === 'unknown';
        if (fromLoopback) {
            const fwd = req.headers['x-forwarded-for'];
            if (fwd) return fwd.split(',')[0].trim().replace(/^::ffff:/, '');
            const real = req.headers['x-real-ip'];
            if (real) return real.trim().replace(/^::ffff:/, '');
        }
        return remote;
    }

    // Autenticação Estrita via Cookie de Sessão (Zero Bypass de IP)
    const cookies = getCookies(req);
    const isAuth = cookies['session_token'] === SESSION_ID;

    // Rota pública de login
    if (url.pathname === '/api/login' && req.method === 'POST') {
        const clientIP = getClientIP(req);
        if (blockedIPs.has(clientIP)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'error', message: 'IP bloqueado' }));
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let user, pass;
            try {
                const parsed = JSON.parse(body);
                user = parsed.user;
                pass = parsed.pass;
            } catch (e) {
                console.error(`[ERRO JSON] Login com JSON inválido: ${e.message}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            
            const cleanUser = (typeof user === 'string') ? user.trim().toLowerCase() : '';
            const adminFound = ADMINS.find(a => a.user.toLowerCase() === cleanUser);
            let isPasswordValid = false;
            if (adminFound && typeof pass === 'string' && pass.length > 0) {
                try {
                    isPasswordValid = bcrypt.compareSync(pass, adminFound.hash);
                } catch (e) {
                    isPasswordValid = false;
                }
            }
            const success = !!(adminFound && isPasswordValid);
            
            recordLoginAttempt(clientIP, cleanUser, success, req.headers['user-agent']);

            if (success) {
                console.log(`[AUTH] Sucesso: Login realizado por ${cleanUser} (${clientIP})`);
                res.writeHead(200, { 
                    'Set-Cookie': `session_token=${SESSION_ID}; Path=/; HttpOnly; SameSite=Lax`,
                    'Content-Type': 'application/json' 
                });
                res.end(JSON.stringify({ status: 'success' }));
            } else {
                console.log(`[AUTH] Falha: ${cleanUser || 'IP '+clientIP}`);
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Usuário ou senha inválidos' }));
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
            const cleanName = channel.name.trim();
            m3uContent += `#EXTINF:-1 tvg-name="${cleanName}" tvg-logo="" group-title="",${cleanName}\n`;
            m3uContent += `${protocol}://${host}/canais/${channel.id}/index.m3u8\n`;
        }
        
        res.writeHead(200, {
            'Content-Type': 'application/x-mpegurl',
            'Content-Disposition': 'attachment; filename="playlist.m3u"',
            'Access-Control-Allow-Origin': '*'
        });
        return res.end(m3uContent);
    }

// Bloqueio Global: Se não autenticado por Cookie de Sessão permitido: arquivos estáticos principais, fontes em `/fonts/*.ttf`
if (!isAuth && !(url.pathname === '/login.html' || url.pathname === '/login.js' || url.pathname === '/favicon.png' || url.pathname.endsWith('.css') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/canais/'))) {
        if (url.pathname.startsWith('/api/')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'error', message: 'Sessão inválida ou expirada. Faça login novamente.' }));
        }
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
        const id = Number(url.searchParams.get('id'));
        const logPath = path.join(LOGS_DIR, `canal_${id}.log`);
        
        // Se o arquivo de log não existir ou estiver vazio (0 bytes), cria registro inicial
        let stats = null;
        try { if (fs.existsSync(logPath)) stats = fs.statSync(logPath); } catch (e) {}
        
        if (!stats || stats.size === 0) {
            const channel = channels.find(c => c.id === id);
            const channelName = channel ? channel.name : `Canal ${id}`;
            const channelMode = channel ? (channel.status || 'offline') : 'desconhecido';
            const initialMessage = `[${new Date().toLocaleString()}] [SISTEMA] Log inicializado para ${channelName} (Status: ${channelMode}). Aguardando eventos...\n`;
            try {
                if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
                fs.writeFileSync(logPath, initialMessage);
                stats = fs.statSync(logPath);
            } catch (e) {}
        }

        if (fs.existsSync(logPath)) {
            const start = Math.max(0, (stats ? stats.size : 0) - 5120);
            const stream = fs.createReadStream(logPath, { start });
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            return stream.pipe(res);
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`[${new Date().toLocaleString()}] [SISTEMA] Log aguardando eventos.`);
    }

    // API: Limpar todos os logs de todos os canais
    if (url.pathname === '/api/clear-logs' && req.method === 'POST') {
        try {
            if (fs.existsSync(LOGS_DIR)) {
                const files = fs.readdirSync(LOGS_DIR);
                let count = 0;
                for (const f of files) {
                    if (f.endsWith('.log')) {
                        try {
                            fs.writeFileSync(path.join(LOGS_DIR, f), '');
                            count++;
                        } catch (e) {}
                    }
                }
                console.log(`[LIMPEZA] Logs de ${count} canais limpos com sucesso.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'success', count }));
            }
        } catch (err) {
            console.error('[ERRO] Falha ao limpar logs:', err.message);
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: 'Falha ao limpar logs.' }));
    }

    if (url.pathname === '/api/start' && req.method === 'POST') {
        let body = ''; // Removed canalNome from startChannel call
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                console.error(`[ERRO JSON] start com JSON inválido: ${e.message}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const id = Number(data.id);
            clearRelayRestartTimer(id);
            const channel = channels.find(c => c.id === id);
            if (channel) channel.userStopped = false;
            if (channel && channel.mode === 'relay') {
                if (!channel.relayUrls || channel.relayUrls.length === 0) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 'error', message: 'Nenhuma URL configurada.' }));
                }
                const result = await startChannel(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }
            const result = await startChannel(id); 
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result)); // Return result
            } catch (err) {
                console.error(`[ERRO start ${id}]`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao iniciar canal' }));
            }
        });
        return;
    }

    function getChannelType(channel) {
        if (String(channel.status || '').toLowerCase() === 'vod') return 'vod';
        if (String(channel.mode || '').toLowerCase() === 'relay') {
            if (channel.relaySubtype === 'loop-cache') return 'relay-loop-cache';
            if (channel.relaySubtype === 'sync-cache') return 'relay-sync-cache';
            return channel.relaySubtype === 'loop' ? 'relay-loop' : 'relay-sync';
        }
        return 'live';
    }

    function getChannelDisplayStatus(channel) {
        // Preparação/download não é ONLINE: o canal só fica online quando o
        // FFmpeg já está ativo e o HLS começou a ser produzido.
        if (!channel) return 'offline';
        if (channel.status === 'vod') return hasVodFlag(channel.id) ? 'online' : 'offline';
        if (hasActiveStream(channel.id)) return 'online';
        if (channel.mode === 'relay' && channel.status === 'relay' && hasRelayFlag(channel.id)) return 'online';
        return 'offline';
    }

    // API: Listar todos os canais (com filtro, ordenação e paginação opcionais)
    if (url.pathname === '/api/channels') {
        let list = channels.map(c => {
            const cacheState = relayCacheState.get(c.id);
            return {
                ...c,
                channelType: getChannelType(c),
                runtimeActive: isChannelRuntimeActive(c),
                displayStatus: getChannelDisplayStatus(c),
                preparation: c.relayStartup || (cacheState && !cacheState.ffmpegPid ? {
                    phase: cacheState.phase || 'preparing',
                    message: cacheState.currentDownload !== null && cacheState.currentDownload !== undefined
                        ? `Baixando episódio ${cacheState.currentDownload}...`
                        : 'Preparando canal...'
                } : null),
                uptime: (getChannelDisplayStatus(c) === 'online' && c.startedAt) ? Math.floor((Date.now() - c.startedAt) / 1000) : 0
            };
        });

        const q = url.searchParams;

        // Filtro por busca (nome ou ID)
        const searchTerm = String(q.get('search') || '').trim().toLowerCase();
        if (searchTerm) {
            list = list.filter(ch =>
                String(ch.name || '').toLowerCase().includes(searchTerm) ||
                String(ch.id ?? '').includes(searchTerm)
            );
        }

        // Filtro por conteúdo (+18 / livre)
        const filterType = q.get('contentType') || q.get('type') || 'all';
        const isAdult = ch => ch.is18 === true || ch.is18 === 1 || ch.is18 === '1' || String(ch.is18 || '').toLowerCase() === 'true';
        if (filterType === '18') {
            list = list.filter(isAdult);
        } else if (filterType === 'family') {
            list = list.filter(ch => !isAdult(ch));
        }

        // Filtro por status: somente online/offline
        const statusFilter = q.get('status') || 'all';
        if (statusFilter === 'online') {
            list = list.filter(ch => ch.displayStatus === 'online');
        } else if (statusFilter === 'offline') {
            list = list.filter(ch => ch.displayStatus === 'offline');
        }

        // Filtro por tipo de canal
        const channelTypeFilter = q.get('channelType') || 'all';
        if (channelTypeFilter !== 'all') {
            list = list.filter(ch => ch.channelType === channelTypeFilter);
        }

        // Ordenação (espelha a ordenação do painel)
        const sortCol = q.get('sort') || 'id';
        const sortDir = q.get('dir') === 'desc' ? -1 : 1;
        const validSortCols = ['id', 'name', 'status', 'type', 'uptime'];
        const col = validSortCols.includes(sortCol) ? sortCol : 'id';
        list.sort((a, b) => {
            let valA = col === 'status' ? a.displayStatus : col === 'type' ? a.channelType : a[col];
            let valB = col === 'status' ? b.displayStatus : col === 'type' ? b.channelType : b[col];
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';
            if (valA < valB) return -1 * sortDir;
            if (valA > valB) return 1 * sortDir;
            return 0;
        });

        const total = list.length;

        // Paginação opcional: se pageSize estiver presente, retorna {total, items} da página
        const pageSizeRaw = parseInt(q.get('pageSize'), 10);
        if (!isNaN(pageSizeRaw) && pageSizeRaw > 0) {
            const pageSize = pageSizeRaw;
            const page = (isNaN(parseInt(q.get('page'), 10)) || parseInt(q.get('page'), 10) < 1) ? 1 : parseInt(q.get('page'), 10);
            const start = (page - 1) * pageSize;
            const items = list.slice(start, start + pageSize);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ total, page, pageSize, items }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(list));
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

    // API: Listar arquivos .m3u disponíveis no servidor
    if (url.pathname === '/api/relay-m3u-files' && req.method === 'GET') {
        try {
            const m3uDir = '/home/drmpremium';
            let files = [];
            if (fs.existsSync(m3uDir)) {
                files = fs.readdirSync(m3uDir).filter(f => f.endsWith('.m3u') || f.endsWith('.m3u8'));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(files));
        } catch (e) {
            res.writeHead(500);
            return res.end(JSON.stringify([]));
        }
    }

    // API: Ler arquivo .m3u e extrair URLs
    if (url.pathname === '/api/read-m3u' && req.method === 'GET') {
        const filename = url.searchParams.get('file');
        if (!filename) {
            res.writeHead(400);
            return res.end(JSON.stringify({ status: 'error', message: 'Parâmetro file obrigatório' }));
        }
        const filePath = path.join('/home/drmpremium', path.basename(filename));
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const urls = [];
            const lines = content.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
                    urls.push(trimmed);
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ urls }));
        } catch (e) {
            res.writeHead(404);
            return res.end(JSON.stringify({ status: 'error', message: 'Arquivo não encontrado' }));
        }
    }

    // API: Alternar status +18 de um canal
    if (url.pathname === '/api/toggle18' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
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

    // API: Criar canal escaneando a pasta selecionada
    if (url.pathname === '/api/createchannel' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { channelName, sourceFolderName, useTranscode, is18, mode, sourceUrl, relaySubtype, relayUrls } = JSON.parse(body);
                const channelMode = mode === 'relay' ? 'relay' : 'live';
                const relayST = ['loop', 'sync', 'loop-cache', 'sync-cache'].includes(relaySubtype) ? relaySubtype : null;

                // Busca o menor ID disponível (reutilizando IDs de canais excluídos)
                let id = 1;
                while (channels.some(c => c.id === id)) {
                    id++;
                }

                const channelOutputDir = path.join(CHANNELS_DIR, id.toString());
                if (!fs.existsSync(channelOutputDir)) fs.mkdirSync(channelOutputDir, { recursive: true });

                let inputType = 'concat';
                let playlistFilePath = '';
                let relayUrlList = [];

                if (channelMode === 'relay') {
                    if (relayUrls && Array.isArray(relayUrls) && relayUrls.length > 0) {
                        relayUrlList = relayUrls;
                    } else if (sourceUrl) {
                        relayUrlList = [sourceUrl];
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ status: 'error', message: 'Forneça ao menos uma URL de origem para Relay.' }));
                    }
                    if (relayST === 'sync') {
                        const plContent = buildRelayPlaylist(relayUrlList);
                        const plPath = path.join(channelOutputDir, 'playlist_urls.txt');
                        fs.writeFileSync(plPath, plContent);
                        playlistFilePath = plPath;
                        inputType = 'concat';
                    } else {
                        inputType = 'relay';
                    }
                } else {
                    const scanPath = path.isAbsolute(sourceFolderName)
                        ? sourceFolderName
                        : path.join(VIDEO_SOURCE, sourceFolderName);

                    if (!fs.existsSync(scanPath)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ status: 'error', message: 'O caminho especificado não existe ou está inacessível: ' + scanPath }));
                    }

                    const hlsCheckPath = path.join(scanPath, 'index.m3u8');
                    if (fs.existsSync(hlsCheckPath)) {
                        inputType = 'hls';
                        playlistFilePath = hlsCheckPath;
                    } else {
                        let mp4Files = await getFilesRecursive(scanPath, '.mp4');
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
                        const playlistContent = mp4Files.map(f => {
                            const escaped = f.replace(/'/g, "'\\''");
                            return `file '${escaped}'`;
                        }).join('\r\n');
                        await writeFileAtomic(playlistPath, playlistContent);
                        inputType = 'concat';
                        playlistFilePath = playlistPath;
                    }
                }

                const newChannel = {
                    id,
                    name: channelName,
                    sourceFolder: sourceFolderName || '',
                    sourceUrl: channelMode === 'relay' ? (sourceUrl || '') : '',
                    relayUrls: relayUrlList,
                    mode: channelMode,
                    relaySubtype: relayST,
                    currentUrlIndex: 0,
                    playlistFilePath,
                    inputType: channelMode === 'relay' ? 'relay' : inputType,
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

    // API: Editar/Atualizar canal existente (Mantém o ID original intacto)
    if (url.pathname === '/api/updatechannel' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { id, channelName, sourceFolderName, useTranscode, is18, mode, sourceUrl, relaySubtype, relayUrls } = JSON.parse(body);
                const channelId = Number(id);
                const channel = channels.find(c => c.id === channelId);
                
                if (!channel) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 'error', message: 'Canal não encontrado.' }));
                }

                // Segurança: Não permite editar canal ativo
                if (isChannelRuntimeActive(channel)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 'error', message: 'Pare o canal antes de editá-lo.' }));
                }

                const channelMode = mode === 'relay' ? 'relay' : 'live';
                const relayST = ['loop', 'sync', 'loop-cache', 'sync-cache'].includes(relaySubtype) ? relaySubtype : null;
                let inputType = 'concat';
                let playlistFilePath = '';
                let relayUrlList = [];

                if (channelMode === 'relay') {
                    if (relayUrls && Array.isArray(relayUrls) && relayUrls.length > 0) {
                        relayUrlList = relayUrls;
                    } else if (sourceUrl) {
                        relayUrlList = [sourceUrl];
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ status: 'error', message: 'Forneça ao menos uma URL de origem para Relay.' }));
                    }
                    const chOutDir = path.join(CHANNELS_DIR, channelId.toString());
                    if (!fs.existsSync(chOutDir)) fs.mkdirSync(chOutDir, { recursive: true });
                    if (relayST === 'sync') {
                        const plContent = buildRelayPlaylist(relayUrlList);
                        const plPath = path.join(chOutDir, 'playlist_urls.txt');
                        fs.writeFileSync(plPath, plContent);
                        playlistFilePath = plPath;
                        inputType = 'concat';
                    } else {
                        inputType = 'relay';
                    }
                } else {
                    const scanPath = path.isAbsolute(sourceFolderName)
                        ? sourceFolderName
                        : path.join(VIDEO_SOURCE, sourceFolderName);

                    if (!fs.existsSync(scanPath)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ status: 'error', message: 'O caminho especificado não existe ou está inacessível: ' + scanPath }));
                    }

                    const hlsCheckPath = path.join(scanPath, 'index.m3u8');
                    const channelOutputDir = path.join(CHANNELS_DIR, channelId.toString());
                    if (!fs.existsSync(channelOutputDir)) fs.mkdirSync(channelOutputDir, { recursive: true });

                    if (fs.existsSync(hlsCheckPath)) {
                        inputType = 'hls';
                        playlistFilePath = hlsCheckPath;
                    } else {
                        let mp4Files = await getFilesRecursive(scanPath, '.mp4');
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
                        const playlistContent = mp4Files.map(f => {
                            const escaped = f.replace(/'/g, "'\\''");
                            return `file '${escaped}'`;
                        }).join('\r\n');
                        await writeFileAtomic(playlistPath, playlistContent);
                        inputType = 'concat';
                        playlistFilePath = playlistPath;
                    }
                }

                // Atualiza os dados do canal sem alterar o ID original
                channel.name = channelName;
                channel.sourceFolder = sourceFolderName || '';
                channel.sourceUrl = channelMode === 'relay' ? (sourceUrl || '') : '';
                channel.relayUrls = relayUrlList;
                channel.mode = channelMode;
                channel.relaySubtype = relayST;
                channel.playlistFilePath = playlistFilePath;
                channel.inputType = channelMode === 'relay' ? 'relay' : inputType;
                channel.useTranscode = !!useTranscode;
                channel.is18 = !!is18;

                await saveChannels();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', channel }));
            } catch (err) {
                console.error(err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao atualizar canal.' }));
            }
        });
        return;
    }

    // API: Excluir canal
    if (url.pathname === '/api/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                console.error(`[ERRO JSON] delete com JSON inválido: ${e.message}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const id = Number(data.id);

            // 1. Segurança: Não permite excluir se estiver rodando
            if (isChannelRuntimeActive(channels.find(c => c.id === id))) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'Pare o canal antes de excluí-lo.' }));
            }

            clearRelayLoopTimer(id);
            clearRelayRestartTimer(id);
            clearRelayCache(id);

            // 2. Remove da lista e salva banco
            channels = channels.filter(c => c.id !== id);
            await saveChannels();

            // 3. Limpa arquivos físicos
            const channelPath = path.join(CHANNELS_DIR, id.toString());
            const logPath = path.join(LOGS_DIR, `canal_${id}.log`);

            // Limpa flags VOD e Relay
            removeVodFlag(id);
            removeRelayFlag(id);

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
            } catch (err) {
                console.error(`[ERRO delete ${id}]`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao excluir canal' }));
            }
        });
        return;
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                console.error(`[ERRO JSON] stop com JSON inválido: ${e.message}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const id = Number(data.id);
            clearRelayRestartTimer(id);
            clearRelayCache(id);
            
            const channel = channels.find(c => c.id === id);
            if (channel) {
                clearRelayStartupState(channel);
                channel.status = 'offline';
                delete channel.startedAt;
                channel.userStopped = true;
                if (channel.restartFails) channel.restartFails = 0;
            }

            clearRelayLoopTimer(id);
            clearRelayLoopState(id);

            // Relay: remove flag
            removeRelayFlag(id);
            console.log("[RELAY] Canal " + id + " desativado via stop");

            if (activeStreams.has(id)) {
                try { const proc = activeStreams.get(id).process; if (proc) proc.kill('SIGKILL'); } catch (e) {}
                activeStreams.delete(id);
            }
            saveChannels().catch(e => console.error('[ERRO] Falha ao salvar channels no stop:', e));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'stopped' }));
        });
        return;
    }

    if (url.pathname === '/api/startall' && req.method === 'POST') {
        console.log(`[STARTALL] Requisição recebida: ${channels.length} canais serão avaliados.`);
        const started = [];
        const resultsByChannel = [];
        // Não confiar no status persistido: ele pode estar divergente do processo,
        // flag ou modo real do canal. Todos os canais serão avaliados.
        const channelsToStart = [...channels];
        const BATCH_SIZE = 5;
        for (let i = 0; i < channelsToStart.length; i += BATCH_SIZE) {
            const batch = channelsToStart.slice(i, i + BATCH_SIZE);
            console.log(`[STARTALL] Lote ${Math.floor(i/BATCH_SIZE) + 1}: ${batch.length} canais...`);
            const results = batch.map(ch => {
                clearRelayRestartTimer(ch.id);
                ch.userStopped = false;
                if (ch.status === 'vod' && hasVodFlag(ch.id)) {
                    return { id: ch.id, name: ch.name, mode: 'vod', status: 'already-running', message: 'VOD já está ativo.' };
                }
                if (activeStreams.has(ch.id)) {
                    return { id: ch.id, name: ch.name, mode: ch.relaySubtype || ch.mode, status: 'already-running', message: 'Canal já possui processo ativo.' };
                }
                if (ch.mode === 'relay' && ch.relaySubtype === 'loop' && ch.status === 'relay' && hasRelayFlag(ch.id)) {
                    return { id: ch.id, name: ch.name, mode: ch.relaySubtype, status: 'already-running', message: 'RELAY LOOP já está ativo.' };
                }

                const launch = startChannel(ch.id);
                launch.then(result => {
                    console.log(`[STARTALL] Canal ${ch.id} (${ch.name}) finalizou: ${result?.status || 'desconhecido'}${result?.message ? ` - ${result.message}` : ''}`);
                }).catch(error => {
                    console.error(`[STARTALL] Canal ${ch.id} (${ch.name}) falhou:`, error.message);
                });
                return { id: ch.id, name: ch.name, mode: ch.relaySubtype || ch.mode, status: 'starting', message: 'Inicialização solicitada. Acompanhe o status do canal.' };
            });
            for (const result of results) {
                resultsByChannel.push(result);
                if (result.status === 'success') {
                    started.push(result.name);
                }
            }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'success', started, results: resultsByChannel, asynchronous: true }));
    }

    if (url.pathname === '/api/nocache-status') {
        return res.end(JSON.stringify({ nocache: nocacheEnabled }));
    }

    // API: Alternar modo do canal (Live, VOD, Relay Sync, Relay Loop, Offline)
    if (url.pathname === '/api/switch-mode' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                res.writeHead(400);
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const { id, newMode } = data;
            const channel = channels.find(c => c.id === id);
            if (!channel) {
                res.writeHead(404);
                return res.end(JSON.stringify({ status: 'error', message: 'Canal não encontrado' }));
            }

            // Para o stream ativo se houver
            clearRelayRestartTimer(id);
            if (activeStreams.has(id)) {
                try { activeStreams.get(id).process.kill('SIGKILL'); } catch (e) {}
                activeStreams.delete(id);
            }
            clearRelayLoopTimer(id);

            // Remove flags antigas
            removeVodFlag(id);
            removeRelayFlag(id);

            if (newMode === 'offline') {
                channel.status = 'offline';
                channel.userStopped = true;
                clearRelayStartupState(channel);
                if (channel.restartFails) channel.restartFails = 0;
                await saveChannels();
                res.writeHead(200);
                return res.end(JSON.stringify({ status: 'success', mode: 'offline' }));
            }

            if (newMode === 'vod') {
                const vodDir = "/home/drmpremium/hls_pronto/" + id;
                if (!fs.existsSync(vodDir) || !fs.existsSync(vodDir + "/index.m3u8")) {
                    const playlistPath = channel.playlistFilePath;
                    if (!fs.existsSync(playlistPath)) {
                        res.writeHead(400);
                        return res.end(JSON.stringify({ status: 'error', message: 'Playlist não encontrada para converter para VOD.' }));
                    }
                    if (!fs.existsSync(vodDir)) fs.mkdirSync(vodDir, { recursive: true });
                    console.log("[SWITCH] Convertendo canal " + id + " para VOD...\n");
                    const proc = spawnFFmpeg([
                        '-fflags', '+genpts+igndts+flush_packets',
                        '-err_detect', 'ignore_err',
                        '-f', 'concat', '-safe', '0',
                        '-i', playlistPath,
                        '-c:v', 'copy',
                        '-c:a', 'copy',
                        '-f', 'hls',
                        '-hls_time', '15',
                        '-hls_playlist_type', 'vod',
                        '-hls_list_size', '0',
                        '-hls_segment_filename', vodDir + "/segment_%03d.ts",
                        vodDir + "/index.m3u8"
                    ]);
                    await waitForProcessClose(proc);
                }
                setVodFlag(id);
                channel.status = 'vod';
                channel.userStopped = false;
                channel.startedAt = undefined;
                await saveChannels();
                console.log("[SWITCH] Canal " + id + " → VOD");
                res.writeHead(200);
                return res.end(JSON.stringify({ status: 'success', mode: 'vod' }));
            }

            if (newMode === 'relay-loop' || newMode === 'relay-loop-cache') {
                if (!channel.relayUrls || channel.relayUrls.length === 0) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ status: 'error', message: 'Canal sem URLs configuradas.' }));
                }
                clearRelayLoopTimer(id);
                clearRelayRestartTimer(id);
                channel.mode = 'relay';
                channel.relaySubtype = newMode === 'relay-loop-cache' ? 'loop-cache' : 'loop';
                channel.currentUrlIndex = 0;
                channel.status = 'offline';
                channel.userStopped = false;
                channel.startedAt = undefined;
                await saveChannels();
                const result = await startChannel(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(result));
            }

            if (newMode === 'relay-sync' || newMode === 'relay-sync-cache' || newMode === 'live') {
                if (newMode === 'relay-sync' || newMode === 'relay-sync-cache') {
                    channel.mode = 'relay';
                    channel.relaySubtype = newMode === 'relay-sync-cache' ? 'sync-cache' : 'sync';
                    if (channel.relayUrls && channel.relayUrls.length > 0) {
                        const outDir = path.join(CHANNELS_DIR, id.toString());
                        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                        const plContent = buildRelayPlaylist(channel.relayUrls);
                        const plPath = path.join(outDir, 'playlist_urls.txt');
                        fs.writeFileSync(plPath, plContent);
                        channel.playlistFilePath = plPath;
                        channel.inputType = channel.relaySubtype === 'sync' ? 'concat' : 'relay';
                    }
                } else {
                    channel.mode = 'live';
                    channel.relaySubtype = null;
                    // Reseta inputType para o modo live regenerar a playlist a partir da pasta de origem
                    if (channel.inputType === 'relay') {
                        channel.inputType = 'concat';
                        channel.playlistFilePath = null;
                        channel.currentUrlIndex = 0;
                    }
                }
                channel.userStopped = false;
                await saveChannels();
                const result = await startChannel(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: result.status, mode: newMode }));
            }

            res.writeHead(400);
            res.end(JSON.stringify({ status: 'error', message: 'Modo inválido: ' + newMode }));
            } catch (err) {
                console.error(`[ERRO switch-mode ${id}]`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao alternar modo' }));
            }
        });
        return;
    }

    // API: Avançar manualmente a URL do relay-loop
    if (url.pathname === '/api/relay-advance' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                res.writeHead(400);
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const { id } = data;
            const channel = channels.find(c => c.id === id);
            if (!channel || channel.status !== 'relay' || channel.relaySubtype !== 'loop') {
                res.writeHead(400);
                return res.end(JSON.stringify({ status: 'error', message: 'Canal não está em modo relay-loop ativo.' }));
            }
            const urls = channel.relayUrlProbed || channel.relayUrls;
            if (!urls || urls.length < 2) {
                res.writeHead(400);
                return res.end(JSON.stringify({ status: 'error', message: 'Canal não possui múltiplas URLs.' }));
            }
            const nextIdx = ((channel.currentUrlIndex || 0) + 1) % urls.length;
            channel.currentUrlIndex = nextIdx;
            await saveChannels();
            // Reinicia o ffmpeg compartilhado a partir do próximo episódio (janela de cache preserva o arquivo)
            channel.status = 'offline';
            relayCacheState.delete(id);
            if (activeStreams.has(id)) {
                try { activeStreams.get(id).process.kill('SIGKILL'); } catch (e) {}
                activeStreams.delete(id);
            }
            scheduleRelayRestart(id, 'relay-advance');
            console.log("[RELAY LOOP] Canal " + channel.id + " avançado manualmente para posição " + channel.currentUrlIndex);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', currentIndex: channel.currentUrlIndex }));
            } catch (err) {
                console.error(`[ERRO relay-advance ${id}]`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao avançar relay' }));
            }
        });
        return;
    }

    if (url.pathname === '/api/toggle-nocache' && req.method === 'POST') {
        nocacheEnabled = !nocacheEnabled;
        if (nocacheEnabled) {
            fs.writeFileSync(NOCACHE_FLAG, '');
            console.log('[NOCACHE] Cache de disco DESLIGADO (nocache ativado)');
        } else {
            try { fs.unlinkSync(NOCACHE_FLAG); } catch (e) {}
            console.log('[NOCACHE] Cache de disco LIGADO (nocache desativado)');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ nocache: nocacheEnabled }));
    }

    if (url.pathname === '/api/stopall' && req.method === 'POST') {
        console.log(`[STOPALL] Requisição recebida: normalizando ${channels.length} canais.`);
        const stopped = [];
        const results = [];
        for (const channel of channels) {
            // Parada idempotente: sempre normaliza todos os canais, mesmo offline.
            channel.status = 'offline';
            channel.userStopped = true;
            delete channel.startedAt;
            if (channel.restartFails) channel.restartFails = 0;
            clearRelayStartupState(channel);
            clearRelayLoopTimer(channel.id);
            clearRelayRestartTimer(channel.id);
            clearRelayCache(channel.id);
            removeVodFlag(channel.id);
            const relayFlag = "/home/drmpremium/.relay_" + channel.id;
            try { if (fs.existsSync(relayFlag)) fs.unlinkSync(relayFlag); } catch (e) {}
            if (activeStreams.has(channel.id)) {
                try {
                    const process = activeStreams.get(channel.id).process;
                    if (process) process.kill('SIGKILL');
                } catch (e) {
                    console.error("[Erro ao parar canal " + channel.id + "]:", e);
                }
                activeStreams.delete(channel.id);
            }
            stopped.push(channel.name);
            results.push({ id: channel.id, name: channel.name, status: 'stopped' });
        }
        await saveChannels();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'success', stopped, results }));
    }

    // API: Converter canal para VOD estático (concat HLS 15s segments)
    if (url.pathname === '/api/convert' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                console.error(`[ERRO JSON] convert com JSON inválido: ${e.message}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const { id } = data;
            const channel = channels.find(c => c.id === id);
            if (!channel) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'Canal não encontrado' }));
            }

            const outputDir = `/home/drmpremium/hls_pronto/${id}`;
            const flagPath = `/home/drmpremium/.vod_${id}`;
            const vodIndex = `${outputDir}/index.m3u8`;

            // Se VOD já existir, só ativa o modo (flag) sem reconverter
            if (fs.existsSync(vodIndex)) {
                console.log(`[CONVERT] VOD já existe para canal ${id}, ativando modo VOD...`);
            } else {
                const playlistPath = path.join(CHANNELS_DIR, id.toString(), 'playlist.txt');
                if (!fs.existsSync(playlistPath)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 'error', message: 'Playlist não encontrada' }));
                }

                if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

                console.log(`[CONVERT] Convertendo canal ${id} (${channel.name}) para VOD...`);
                const proc = spawnFFmpeg([
                    '-fflags', '+genpts+igndts+flush_packets',
                    '-err_detect', 'ignore_err',
                    '-f', 'concat', '-safe', '0',
                    '-i', playlistPath,
                    '-c:v', 'copy',
                    '-c:a', 'copy',
                    '-f', 'hls',
                    '-hls_time', '15',
                    '-hls_playlist_type', 'vod',
                    '-hls_list_size', '0',
                    '-hls_segment_filename', `${outputDir}/segment_%03d.ts`,
                    `${outputDir}/index.m3u8`
                ]);
                proc.stderr.on('data', () => {});
                await waitForProcessClose(proc);
                console.log(`[CONVERT] Conversão concluída para canal ${id}`);
            }

            // Cria flag file (nginx check)
            fs.writeFileSync(flagPath, '');

            channel.status = 'vod';
            channel.startedAt = undefined;
            await saveChannels();

            if (activeStreams.has(id)) {
                try { activeStreams.get(id).process.kill('SIGKILL'); } catch (e) {}
                activeStreams.delete(id);
            }
            const liveDir = path.join(CHANNELS_DIR, id.toString());
            try {
                if (fs.existsSync(liveDir)) {
                    fs.readdirSync(liveDir).forEach(f => {
                        if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
                            fs.unlinkSync(path.join(liveDir, f));
                        }
                    });
                }
            } catch (e) {}

            await saveChannels();

            console.log(`[CONVERT] Canal ${id} convertido para VOD`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success' }));
        });
        return;
    }

    // API: Toggle VOD mode para um canal
    if (url.pathname === '/api/toggle-vod' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                console.error(`[ERRO JSON] toggle-vod com JSON inválido: ${e.message}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const { id } = data;
            const channel = channels.find(c => c.id === id);
            if (!channel) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'Canal não encontrado' }));
            }

            const flagPath = `/home/drmpremium/.vod_${id}`;
            const vodDir = `/home/drmpremium/hls_pronto/${id}`;
            const isVod = fs.existsSync(flagPath);

            if (isVod) {
                // VOD → LIVE: remove flag, inicia ffmpeg
                try { fs.unlinkSync(flagPath); } catch (e) {}
                channel.status = 'online';
                channel.startedAt = undefined;
                await saveChannels();

                const result = await startChannel(id);
                console.log(`[TOGGLE] Canal ${id} alternado para LIVE`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'success', mode: 'live' }));
            } else {
                // LIVE → VOD: cria flag, se VOD não existir converte
                if (!fs.existsSync(vodDir) || !fs.existsSync(`${vodDir}/index.m3u8`)) {
                    // Converte primeiro
                    const playlistPath = channel.playlistFilePath;
                    if (!fs.existsSync(playlistPath)) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ status: 'error', message: 'Playlist não encontrada' }));
                    }
                    if (!fs.existsSync(vodDir)) fs.mkdirSync(vodDir, { recursive: true });
                    fs.readdirSync(vodDir).forEach(f => {
                        if (f.endsWith('.ts') || f === 'index.m3u8') {
                            try { fs.unlinkSync(path.join(vodDir, f)); } catch (e) {}
                        }
                    });
                    console.log(`[TOGGLE] Convertendo canal ${id} para VOD...`);
                    const proc = spawnFFmpeg([
                        '-fflags', '+genpts+igndts+flush_packets',
                        '-err_detect', 'ignore_err',
                        '-f', 'concat', '-safe', '0',
                        '-i', playlistPath,
                        '-c:v', 'copy',
                        '-c:a', 'copy',
                        '-f', 'hls',
                        '-hls_time', '15',
                        '-hls_playlist_type', 'vod',
                        '-hls_list_size', '0',
                        '-hls_segment_filename', `${vodDir}/segment_%03d.ts`,
                        `${vodDir}/index.m3u8`
                    ]);
                    proc.stderr.on('data', () => {});
                    await waitForProcessClose(proc);
                    console.log(`[TOGGLE] Conversão concluída para canal ${id}`);
                }

                // Cria flag e para o live
                fs.writeFileSync(flagPath, '');
                channel.status = 'vod';
                channel.startedAt = undefined;
                await saveChannels();

                if (activeStreams.has(id)) {
                    try { activeStreams.get(id).process.kill('SIGKILL'); } catch (e) {}
                    activeStreams.delete(id);
                }

                // Limpa live HLS
                const liveDir = path.join(CHANNELS_DIR, id.toString());
                try {
                    if (fs.existsSync(liveDir)) {
                        fs.readdirSync(liveDir).forEach(f => {
                            if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
                                fs.unlinkSync(path.join(liveDir, f));
                            }
                        });
                    }
                } catch (e) {}

                await saveChannels();
                console.log(`[TOGGLE] Canal ${id} alternado para VOD`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'success', mode: 'vod' }));
            }
            } catch (err) {
                console.error(`[ERRO toggle-vod ${id}]`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao alternar VOD' }));
            }
        });
        return;
    }

    // API: Listar tentativas de login
    if (url.pathname === '/api/login-attempts' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(loginAttempts.slice(0, 200)));
    }

    // API: Top IPs com mais tentativas (para detectar ataques)
    if (url.pathname === '/api/top-attackers' && req.method === 'GET') {
        const countMap = {};
        loginAttempts.forEach(a => {
            if (!countMap[a.ip]) countMap[a.ip] = { ip: a.ip, total: 0, fails: 0, successes: 0, lastAttempt: a.timestamp };
            countMap[a.ip].total++;
            if (a.success) countMap[a.ip].successes++;
            else countMap[a.ip].fails++;
            if (a.timestamp > countMap[a.ip].lastAttempt) countMap[a.ip].lastAttempt = a.timestamp;
        });
        const sorted = Object.values(countMap).sort((a, b) => b.total - a.total);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(sorted));
    }

    // API: Listar IPs bloqueados
    if (url.pathname === '/api/blocked-ips' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([...blockedIPs]));
    }

    // API: Bloquear IP
    if (url.pathname === '/api/block-ip' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const ip = data.ip;
            if (!ip) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'IP não informado' }));
            }
            if (!isValidIP(ip)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'IP inválido' }));
            }
            blockedIPs.add(ip);
            saveBlockedIPs();
            // Tenta bloquear via UFW também
            try { execSync(`ufw deny from ${ip} 2>/dev/null`, { stdio: 'ignore' }); } catch (e) {}
            console.log(`[SEGURANÇA] IP ${ip} bloqueado`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', ip }));
            } catch (err) {
                console.error(`[ERRO block-ip ${ip}]`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao bloquear IP' }));
            }
        });
        return;
    }

    // API: Desbloquear IP
    if (url.pathname === '/api/unblock-ip' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            let data;
            try { data = JSON.parse(body); } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'JSON inválido' }));
            }
            const ip = data.ip;
            if (!ip) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'IP não informado' }));
            }
            if (!isValidIP(ip)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'error', message: 'IP inválido' }));
            }
            blockedIPs.delete(ip);
            saveBlockedIPs();
            // Remove do UFW também
            try { execSync(`ufw delete deny from ${ip} 2>/dev/null`, { stdio: 'ignore' }); } catch (e) {}
            console.log(`[SEGURANÇA] IP ${ip} desbloqueado`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', ip }));
            } catch (err) {
                console.error(`[ERRO unblock-ip ${ip}]`, err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Erro interno ao desbloquear IP' }));
            }
        });
        return;
    }

    // API: Acessos aos canais via nginx log
    if (url.pathname === '/api/nginx-access' && req.method === 'GET') {
        const data = [];
        for (const [ip, entry] of nginxAccessData) {
            const channels = Object.entries(entry.channels).map(([id, info]) => ({
                id: parseInt(id),
                hits: info.hits,
                lastAccess: info.lastAccess
            }));
            channels.sort((a, b) => b.hits - a.hits);
            data.push({ ip, channels, totalHits: entry.totalHits, firstSeen: entry.firstSeen, lastSeen: entry.lastSeen });
        }
        data.sort((a, b) => b.totalHits - a.totalHits);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(data));
    }

    // API: Stats resumidos de acesso
    if (url.pathname === '/api/nginx-access/stats' && req.method === 'GET') {
        let totalIPs = 0, totalRequests = 0;
        const channelStats = {};
        for (const [ip, entry] of nginxAccessData) {
            totalIPs++;
            totalRequests += entry.totalHits;
            for (const [id, info] of Object.entries(entry.channels)) {
                if (!channelStats[id]) channelStats[id] = 0;
                channelStats[id] += info.hits;
            }
        }
        const topChannels = Object.entries(channelStats)
            .map(([id, hits]) => ({ id: parseInt(id), hits }))
            .sort((a, b) => b.hits - a.hits)
            .slice(0, 5);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ totalIPs, totalRequests, topChannels }));
    }

    // Handler de /canais/: relay, live ou VOD
    const relayMatch = url.pathname.match(/^\/canais\/(\d+)\/(.+)$/);
    if (relayMatch) {
        const channelId = parseInt(relayMatch[1]);
        const requestedFile = relayMatch[2];
        // Bloqueia arquivos internos que expõem caminhos absolutos/URLs de origem
        if (requestedFile === 'playlist.txt' || requestedFile === 'playlist_urls.txt' || requestedFile === 'playlist.json') {
            res.writeHead(403);
            return res.end('Acesso negado');
        }
        if (hasRelayFlag(channelId)) {
            const channel = channels.find(c => c.id === channelId && c.mode === 'relay');
            if (!channel) {
                res.writeHead(404);
                return res.end('Canal relay não configurado');
            }

            if (channel.relaySubtype === 'loop') {
                // LOOP PURO: repasse direto do link ao cliente.
                // Playlist virtual + transmux on-the-fly por requisição (sem re-encode).
                const urls = channel.relayUrlProbed || channel.relayUrls || [channel.sourceUrl];
                const urlsLen = urls.length;

                if (requestedFile === 'index.m3u8') {
                    // Gera playlist HLS Virtual de alta compatibilidade com #EXT-X-DISCONTINUITY
                    const startIdx = channel.currentUrlIndex || 0;
                    const durations = channel.relayUrlDurations || [];

                    // Calcula o target duration (maior duração entre os vídeos, ou padrão 7200)
                    let maxDur = 7200;
                    if (durations.length > 0) {
                        maxDur = Math.ceil(Math.max(...durations.filter(d => d > 0)));
                    }

                    let lines = '#EXTM3U\n';
                    lines += '#EXT-X-VERSION:3\n';
                    lines += '#EXT-X-PLAYLIST-TYPE:VOD\n';
                    lines += `#EXT-X-TARGETDURATION:${maxDur}\n`;
                    lines += `#EXT-X-MEDIA-SEQUENCE:0\n`;

                    const host = req.headers.host || 'localhost';
                    const protocol = req.socket.encrypted ? 'https' : 'http';

                    for (let i = 0; i < urlsLen * 100; i++) {
                        const idx = (startIdx + i) % urlsLen;
                        const dur = durations[idx] ? durations[idx].toFixed(6) : '3600.000000';

                        lines += '#EXT-X-DISCONTINUITY\n';
                        lines += `#EXTINF:${dur},\n`;
                        lines += `${protocol}://${host}/canais/${channelId}/${idx}.ts\n`;
                    }

                    res.writeHead(200, {
                        'Content-Type': 'application/vnd.apple.mpegurl',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    return res.end(lines);
                }

                // requestedFile é o índice (ex: /canais/5/0 → proxy urls[0])
                const idx = parseInt(requestedFile);
                if (isNaN(idx) || idx < 0 || idx >= urlsLen) {
                    res.writeHead(404);
                    return res.end('Índice inválido');
                }
                const targetUrl = urls[idx];
                if (!targetUrl) {
                    res.writeHead(404);
                    return res.end('URL de destino vazia');
                }

                // Transmux MP4 → MPEG-TS on-the-fly (sem re-encode, só muda o container).
                // 1 ffmpeg leve por requisição. Sempre morto quando o cliente desconecta:
                // res/req 'close' + varredura periódica + trava por canal.
                const ffmpeg = spawn(FFMPEG_PATH, [
                    '-i', targetUrl,
                    '-c', 'copy',
                    '-f', 'mpegts',
                    '-'
                ]);
                trackRelayTransmux(channelId, ffmpeg);

                let stderrLog = '';
                ffmpeg.stderr.on('data', d => { if (stderrLog.length < 2000) stderrLog += d; });
                ffmpeg.on('error', (e) => {
                    console.error("[RELAY LOOP] Erro FFmpeg URL " + idx + ": " + e.message);
                    if (!res.headersSent) { res.writeHead(502); res.end('Transmux error'); }
                });
                ffmpeg.on('close', (code) => {
                    if (ffmpeg.__relayClientGone) return;
                    if (code !== 0) {
                        handleRelayLoopFailure(channel, idx);
                        if (!res.headersSent) {
                            console.error("[RELAY LOOP] FFmpeg exit " + code + " URL " + idx + ": " + stderrLog.slice(-300));
                            res.writeHead(502);
                            res.end('Transmux failed');
                        }
                    }
                });

                const killOnDisconnect = () => {
                    ffmpeg.__relayClientGone = true;
                    killRelayTransmuxProc(ffmpeg);
                };
                res.on('close', killOnDisconnect);
                req.on('close', killOnDisconnect);

                res.writeHead(200, {
                    'Content-Type': 'video/MP2T',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                });
                ffmpeg.stdout.pipe(res);
                return;
            }

            if (isRelaySyncSubtype(channel.relaySubtype) || isRelayCacheSubtype(channel.relaySubtype)) {
                const filePath = path.join(CHANNELS_DIR, channelId.toString(), requestedFile);
                if (requestedFile === 'index.m3u8' && !fs.existsSync(filePath)) {
                    // Espera até 12 segundos (60 * 200ms) para o FFmpeg criar o arquivo inicial
                    let retries = 60;
                    while (retries > 0 && !fs.existsSync(filePath)) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                        retries--;
                    }
                }
                if (fs.existsSync(filePath)) {
                    const ext = path.extname(filePath);
                    const types = { '.ts': 'video/MP2T', '.m3u8': 'application/vnd.apple.mpegurl' };
                    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
                    return fs.createReadStream(filePath).pipe(res);
                } else {
                    res.writeHead(404);
                    return res.end('Arquivo HLS não encontrado');
                }
            }
        }

        // Não é relay → tenta servir do filesystem (live / VOD)
        const vodFlag = "/home/drmpremium/.vod_" + channelId;
        const hlsBase = fs.existsSync(vodFlag)
            ? "/home/drmpremium/hls_pronto"
            : "/dev/shm/iptv_canais";
        const filePath = path.join(hlsBase, channelId.toString(), requestedFile);
        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath);
            const types = { '.ts': 'video/MP2T', '.m3u8': 'application/vnd.apple.mpegurl' };
            res.writeHead(200, {
                'Content-Type': types[ext] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            });
            return fs.createReadStream(filePath).pipe(res);
        }
        res.writeHead(404);
        return res.end('Arquivo não encontrado');
    }

    // Servir Arquivos Estáticos (Dashboard)
    const staticRoot = path.resolve(__dirname);
    // Remove leading slash so path.resolve doesn't treat it as absolute (which would ignore staticRoot)
    const relPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    let filePath = path.resolve(staticRoot, relPath);
    
    // Bloqueia acesso a arquivos sensíveis e garante que o path permanece dentro do diretório do painel
    const blockedExt = ['.env', '.log', '.json', '.md'];
    const blockedFiles = ['server.js', 'package.json', 'package-lock.json', 'channels.json', 'build-obfuscated.py', 'nginx_iptv.conf', '.env.example'];
    const baseName = path.basename(filePath);
    const isBlockedFile = blockedFiles.includes(baseName) || (blockedExt.includes(path.extname(filePath).toLowerCase()) && !url.pathname.startsWith('/canais/'));
    if (!filePath.startsWith(staticRoot + path.sep) && filePath !== staticRoot) {
        res.writeHead(403);
        return res.end('Acesso negado');
    }
    if (isBlockedFile) {
        res.writeHead(403);
        return res.end('Acesso negado');
    }
    
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
                '.ttf': 'font/ttf',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.m3u8': 'application/vnd.apple.mpegurl',
                '.ts': 'video/MP2T',
                '.mp4': 'video/mp4',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.webp': 'image/webp',
                '.ico': 'image/x-icon',
                '.json': 'application/json',
                '.txt': 'text/plain'
            };
            
            const headers = { 'Content-Type': types[ext] || 'text/plain' };
            // Painel (Dashboard): revalidação com ETag (304) em vez de no-store
            if (ext === '.js' || ext === '.css' || ext === '.html') {
                const etag = '"' + crypto.createHash('md5').update(content).digest('hex') + '"';
                headers['ETag'] = etag;
                headers['Cache-Control'] = 'no-cache, must-revalidate';
                if (req.headers['if-none-match'] === etag) {
                    res.writeHead(304, headers);
                    return res.end();
                }
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
    activeStreams.forEach(async (info, id) => {
        const channel = channels.find(c => c.id === id);
        if (!channel || (channel.status !== 'online' && channel.status !== 'relay')) return;

        const m3u8Path = path.join(CHANNELS_DIR, id.toString(), 'index.m3u8');
        
        if (fs.existsSync(m3u8Path)) {
            const stats = fs.statSync(m3u8Path);
            const segundosDesdeMod = (Date.now() - stats.mtimeMs) / 1000;
            
            if (segundosDesdeMod > 60) { // 60s = 4 segmentos perdidos
                console.log(`[WATCHDOG] Canal ${id} (${channel.name}) sem resposta há ${Math.round(segundosDesdeMod)}s. Reiniciando...`);
                
                // Registra o travamento no log antes de matar o processo
                const logPath = path.join(LOGS_DIR, `canal_${id}.log`);
                if (fs.existsSync(logPath)) {
                    fs.appendFileSync(logPath, `[WATCHDOG] ${new Date().toLocaleString()}: Canal parado por ${Math.round(segundosDesdeMod)}s. Forçando reinício.\n`);
                }

                // Salva posição estimada lendo o playlist existente (leve, sem rescan)
                let totalFiles = 1;
                try {
                    const plContent = fs.readFileSync(path.join(CHANNELS_DIR, id.toString(), 'playlist.txt'), 'utf8');
                    totalFiles = plContent.split('\n').filter(l => l.startsWith("file '")).length;
                } catch (e) {}
                const fileIndex = estimateFileIndex(id, totalFiles);
                channelPlaylistState.set(id, { fileIndex, updatedAt: Date.now() });

                if (info.process) { try { info.process.kill('SIGKILL'); } catch (e) {} }
                activeStreams.delete(id);
                channel.status = 'offline';
                scheduleRelayRestart(id, 'watchdog');
            }
        }
    });

    // Relay Guardian: revive relay (sync e loop) offline ou sem processo ativo
    // Limite de tentativas consecutivas: após 5 falhas, pausa por um tempo e
    // depois tenta de novo (não desiste para sempre).
    for (const channel of channels) {
        if (channel.mode === 'relay' && (isRelaySyncSubtype(channel.relaySubtype) || isRelayLoopSubtype(channel.relaySubtype))) {
            // Canal parado manualmente pelo usuário não pode ser revivido
            if (channel.userStopped) continue;
            // Start em andamento (janela de cache baixando, ainda sem FFmpeg): não reviver
            const st = relayCacheState.get(channel.id);
            if (st && !st.ffmpegPid) continue;

            let isAlive;
            if (channel.relaySubtype === 'loop') {
                // Loop puro não tem processo persistente: está vivo se tem a flag e status relay
                isAlive = channel.status === 'relay' && hasRelayFlag(channel.id);
            } else {
                isAlive = activeStreams.has(channel.id);
            }
            if (!isAlive && channel.status !== 'offline') {
                console.log(`[RELAY GUARDIAN] Canal ${channel.id} (${channel.name}) sem FFmpeg ativo (status=${channel.status}). Corrigindo...`);
                channel.status = 'offline';
            }
            if (channel.status === 'offline') {
                const pausedAt = relayGuardianPausedAt.get(channel.id);
                if ((channel.restartFails || 0) > RELAY_GUARDIAN_MAX_FAILS) {
                    if (!pausedAt) {
                        relayGuardianPausedAt.set(channel.id, Date.now());
                        console.warn(`[RELAY GUARDIAN] Canal ${channel.id} (${channel.name}) falhou ${channel.restartFails} vezes. Pausando auto-restart por ${Math.round(RELAY_GUARDIAN_RETRY_MS / 60000)}min.`);
                        continue;
                    }
                    if (Date.now() - pausedAt < RELAY_GUARDIAN_RETRY_MS) continue;
                    console.log(`[RELAY GUARDIAN] Canal ${channel.id} (${channel.name}) parado há ${Math.round((Date.now() - pausedAt) / 60000)}min. Retomando auto-restart.`);
                    channel.restartFails = 0;
                    relayGuardianPausedAt.delete(channel.id);
                } else {
                    relayGuardianPausedAt.delete(channel.id);
                }
                channel.restartFails = (channel.restartFails || 0) + 1;
                console.log(`[RELAY GUARDIAN] Canal ${channel.id} (${channel.name}) offline. Reiniciando relay...`);
                scheduleRelayRestart(channel.id, 'guardian');
            } else {
                relayGuardianPausedAt.delete(channel.id);
            }
        }
    }
}, 15000);

/**
 * Rotina de Limpeza de Logs (Executa a cada 12 horas)
 */
setInterval(() => {
    const agora = Date.now();
    const limite = 12 * 60 * 60 * 1000; // 12 horas em ms

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
}, 12 * 60 * 60 * 1000);

/**
 * Rotina de Limpeza do tmpfs (a cada 30 min) - remove segmentos órfãos
 */
setInterval(() => {
    const channelsDir = path.join(CHANNELS_DIR);
    if (!fs.existsSync(channelsDir)) return;
    const dirs = fs.readdirSync(channelsDir);
    let removed = 0;
    for (const d of dirs) {
        const dirPath = path.join(channelsDir, d);
        try {
            const files = fs.readdirSync(dirPath);
            // Só limpa se houver mais que 15 segments (hls_list_size=10 + margem)
            const tsFiles = files.filter(f => f.endsWith('.ts'));
            if (tsFiles.length > 15) {
                // Ordena por nome (segmento mais antigo = menor número)
                const sorted = tsFiles.sort();
                const toDelete = sorted.slice(0, sorted.length - 10);
                for (const f of toDelete) {
                    fs.unlinkSync(path.join(dirPath, f));
                    removed++;
                }
            }
        } catch (e) {}
    }
    if (removed > 0) console.log(`[LIMPEZA tmpfs] ${removed} segmentos órfãos removidos`);
}, 30 * 60 * 1000);

// Parse do nginx access log a cada 30s para monitor de acessos
setInterval(parseNginxAccessLog, 30000);
setTimeout(parseNginxAccessLog, 5000);

 // Limpa segmentos HLS antigos no tmpfs para evitar acúmulo entre restart
 function cleanTmpfsSegments() {
     const channelsDir = path.join(CHANNELS_DIR);
     if (!fs.existsSync(channelsDir)) return;
     const dirs = fs.readdirSync(channelsDir);
     let removed = 0;
     for (const d of dirs) {
         const dirPath = path.join(channelsDir, d);
         try {
             const files = fs.readdirSync(dirPath);
             for (const f of files) {
                 if (f.endsWith('.ts') || f === 'index.m3u8') {
                     fs.unlinkSync(path.join(dirPath, f));
                     removed++;
                 }
             }
         } catch (e) {}
     }
     console.log(`[LIMPEZA] ${removed} segmentos HLS antigos removidos do tmpfs`);
 }

 // Mata ffmpeg órfãos de execuções anteriores
 function killOrphanFFmpeg() {
     try {
         const result = execSync('pkill -x ffmpeg 2>/dev/null; echo done').toString();
         console.log('[STARTUP] ffmpeg órfãos finalizados');
     } catch (e) {}
 }

 server.listen(PORT, async () => {
     await loadChannels(); // Load channels on startup
     killOrphanFFmpeg();
     cleanTmpfsSegments();
     
     // Reseta status de canais em lotes e inicia de forma correta baseada no seu modo original
     // Canais parados manualmente (userStopped) permanecem parados após o restart
     let resetCount = 0;
     let resetRelayCount = 0;
     for (const ch of channels) {
         if (ch.status !== 'vod' && !ch.userStopped) {
             if (ch.mode === 'relay') {
                 ch.status = 'relay';
                 resetRelayCount++;
             } else {
                 ch.status = 'online';
                 resetCount++;
             }
         }
     }
     console.log(`[STARTUP] ${resetCount} canais resetados para online, ${resetRelayCount} canais resetados para relay`);
     
     // Auto-start de canais Live e Relay Sync (ignora canais parados manualmente)
     const channelsToStart = channels.filter(c => !c.userStopped && (c.status === 'online' || (c.status === 'relay' && isRelaySyncSubtype(c.relaySubtype))));
     const BATCH_SIZE = 5;
     for (let i = 0; i < channelsToStart.length; i += BATCH_SIZE) {
         const batch = channelsToStart.slice(i, i + BATCH_SIZE);
         console.log(`[AUTO-START] Lote ${Math.floor(i/BATCH_SIZE) + 1}: ${batch.length} canais...`);
         await Promise.all(batch.map(ch => {
             console.log(`[AUTO-START] Reiniciando transmissão do canal: ${ch.name}`);
             return startChannel(ch.id);
         }));
     }

    // Auto-start de canais Relay Loop (ignora canais parados manualmente)
    // Loop puro: repasse direto — startRelayLoop faz o probe e cria a flag.
    for (const channel of channels) {
        if (channel.mode === 'relay' && channel.relaySubtype === 'loop' && !channel.userStopped) {
            console.log("[AUTO-START] Iniciando Relay Loop para canal " + channel.id + " (" + channel.name + ")");
            startRelayLoop(channel).catch(e => console.error("[AUTO-START] Erro no Relay Loop do canal " + channel.id + ":", e));
        }
    }

    // Auto-start de canais Relay Loop-Cache (baixa episódios e serve via ffmpeg persistente)
    for (const channel of channels) {
        if (channel.mode === 'relay' && channel.relaySubtype === 'loop-cache' && !channel.userStopped) {
            console.log("[AUTO-START] Iniciando Relay Loop-Cache para canal " + channel.id + " (" + channel.name + ")");
            startChannel(channel.id).catch(e => console.error("[AUTO-START] Erro no Relay Loop-Cache do canal " + channel.id + ":", e));
        }
    }
    // Cria flag para relay-sync que ainda nao tem flag (ignora canais parados manualmente)
    for (const channel of channels) {
        if (channel.mode === 'relay' && isRelaySyncSubtype(channel.relaySubtype) && !channel.userStopped && !hasRelayFlag(channel.id)) {
            setRelayFlag(channel.id);
            console.log("[AUTO-START] Flag Relay criada para canal " + channel.id + " (" + channel.name + ") (sync)");
        }
    }

    // Cria flag files para canais em modo VOD (nginx check)
    for (const channel of channels) {
        if (channel.status === 'vod') {
            if (!hasVodFlag(channel.id)) {
                setVodFlag(channel.id);
                console.log(`[AUTO-START] Flag VOD criada para canal ${channel.id} (${channel.name})`);
            }
        }
    }

    console.log(`\n=== IPTV PRO DASHBOARD ===`);
    console.log(`Servidor rodando em: http://localhost:${PORT}`);
    console.log(`Diretório ativo: ${__dirname}\n`);
});

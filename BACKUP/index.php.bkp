<?php
include 'config.php';
proteger();

$base_dir = "/home/drmpremium";
$canais = [];

function formatarUptime($segundos) {
    $segundos = max(0, (int)$segundos);

    $horas = floor($segundos / 3600);
    $minutos = floor(($segundos % 3600) / 60);
    $segundosRestantes = $segundos % 60;

    if ($horas > 0) {
        return sprintf("%02d:%02d:%02d", $horas, $minutos, $segundosRestantes);
    }

    return sprintf("%02d:%02d", $minutos, $segundosRestantes);
}

function medirRede() {
    $interface = "enp0s31f6";
    $rxMbps = 0;
    $txMbps = 0;

    $rxFile = "/sys/class/net/$interface/statistics/rx_bytes";
    $txFile = "/sys/class/net/$interface/statistics/tx_bytes";

    if (is_readable($rxFile) && is_readable($txFile)) {
        $rx1 = intval(trim(file_get_contents($rxFile)));
        $tx1 = intval(trim(file_get_contents($txFile)));

        usleep(1000000);

        $rx2 = intval(trim(file_get_contents($rxFile)));
        $tx2 = intval(trim(file_get_contents($txFile)));

        $rxBytes = max(0, $rx2 - $rx1);
        $txBytes = max(0, $tx2 - $tx1);

        $rxMbps = round(($rxBytes * 8) / 1024 / 1024, 2);
        $txMbps = round(($txBytes * 8) / 1024 / 1024, 2);
    }

    return [
        'rxMbps' => $rxMbps,
        'txMbps' => $txMbps,
        'interface' => $interface
    ];
}

if (isset($_GET['ajax']) && $_GET['ajax'] === 'rede') {
    header('Content-Type: application/json');
    echo json_encode(medirRede());
    exit;
}

/* =========================
   START / STOP / DELETE
========================= */

if (isset($_GET['start'])) {
    $canal = basename($_GET['start']);
    $dir = "$base_dir/Tokusatsu/$canal";

    if (file_exists("$dir/playlist.txt")) {
        shell_exec("pkill -f " . escapeshellarg("$dir/playlist.m3u8"));

        shell_exec("find " . escapeshellarg($dir) . " -maxdepth 1 -name 'playlist*.ts' -delete");
        shell_exec("rm -f " . escapeshellarg("$dir/playlist.m3u8"));

        $script = "while true; do " .
            "ffmpeg -hide_banner -loglevel warning " .
            "-re -stream_loop -1 " .
            "-f concat -safe 0 " .
            "-i " . escapeshellarg("$dir/playlist.txt") . " " .
            "-fflags +genpts " .
            "-avoid_negative_ts make_zero " .
            "-c copy " .
            "-f hls " .
            "-hls_time 10 " .
            "-hls_list_size 6 " .
            "-hls_flags delete_segments+omit_endlist+independent_segments " .
            "-hls_segment_filename " . escapeshellarg("$dir/playlist%d.ts") . " " .
            escapeshellarg("$dir/playlist.m3u8") . " " .
            ">> " . escapeshellarg("$dir/ffmpeg.log") . " 2>&1; " .
            "sleep 3; " .
            "done";

        file_put_contents("$dir/started_at.txt", time());

        $cmd = "nohup bash -c " . escapeshellarg($script) . " > /dev/null 2>&1 &";
        shell_exec($cmd);
    }

    header("Location: index.php");
    exit;
}

if (isset($_GET['stop'])) {
    $canal = basename($_GET['stop']);
    $dir = "$base_dir/Tokusatsu/$canal";

    shell_exec("pkill -f " . escapeshellarg("$dir/playlist.m3u8"));
    @unlink("$dir/started_at.txt");

    header("Location: index.php");
    exit;
}

if (isset($_GET['delete'])) {
    $canal = basename($_GET['delete']);
    $dir = "$base_dir/Tokusatsu/$canal";

    shell_exec("pkill -f " . escapeshellarg("$dir/playlist.m3u8"));
    @unlink("$dir/started_at.txt");

    header("Location: index.php");
    exit;
}

/* =========================
   INFORMAÇÕES DO SISTEMA
========================= */

$cpuLoad = sys_getloadavg();
$nproc = intval(shell_exec("nproc"));
$cpuPercent = round($cpuLoad[0] * 100 / max(1, $nproc));

$meminfo = file_get_contents("/proc/meminfo");
preg_match('/MemTotal:\s+(\d+)/', $meminfo, $totalMem);
preg_match('/MemAvailable:\s+(\d+)/', $meminfo, $availMem);

$totalRam = isset($totalMem[1]) ? round($totalMem[1] / 1024 / 1024, 2) : 0;
$usedRam = isset($totalMem[1], $availMem[1]) ? round(($totalMem[1] - $availMem[1]) / 1024 / 1024, 2) : 0;
$ramPercent = $totalRam > 0 ? round(($usedRam / $totalRam) * 100) : 0;

$diskTotal = disk_total_space("/");
$diskFree = disk_free_space("/");
$diskUsed = $diskTotal - $diskFree;
$diskPercent = $diskTotal > 0 ? round(($diskUsed / $diskTotal) * 100) : 0;

$rede = medirRede();
$rxMbps = $rede['rxMbps'];
$txMbps = $rede['txMbps'];

/* =========================
   CANAIS
========================= */

if (is_dir($base_dir)) {
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($base_dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $file) {
        if (!$file->isDir()) {
            continue;
        }

        $canal_path = $file->getPathname();

        if (preg_match('#/(cache|logs|playlists|videos)$#', $canal_path)) {
            continue;
        }

        $playlist_file = "$canal_path/playlist.m3u8";
        $playlist_txt = "$canal_path/playlist.txt";

        if (!file_exists($playlist_file) && !file_exists($playlist_txt)) {
            continue;
        }

        $canal = basename($canal_path);
        $categoria = basename(dirname($canal_path));

        $dominio = $_SERVER['HTTP_HOST'];
        $playlist_web = "http://$dominio/live/" . str_replace('/home/drmpremium/', '', $canal_path) . "/playlist.m3u8";

        $processo = shell_exec("pgrep -af ffmpeg | grep " . escapeshellarg($playlist_file) . " | grep -v grep");
        $playlistAtualizada = file_exists($playlist_file) && (time() - filemtime($playlist_file) <= 60);

        $status = (!empty($processo) || $playlistAtualizada) ? "Online" : "Offline";
        $uptime = "Offline";
        $startedAt = 0;

        if ($status === "Online") {
            $startedFile = "$canal_path/started_at.txt";

            if (file_exists($startedFile)) {
                $startedAt = intval(file_get_contents($startedFile));
            } elseif (file_exists($playlist_file)) {
                $startedAt = filemtime($playlist_file);
            }

            $uptime = $startedAt > 0 ? formatarUptime(time() - $startedAt) : "Online";
        }

        $conexoes = intval(shell_exec("lsof -i :80 | grep playlist.m3u8 | grep " . escapeshellarg($canal) . " | wc -l"));

        $canais[] = [
            'nome' => $canal,
            'categoria' => $categoria,
            'playlist' => $playlist_web,
            'status' => $status,
            'uptime' => $uptime,
            'started_at' => $startedAt,
            'conexoes' => $conexoes
        ];
    }
}
?>
<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="30">
<title>DRM Premium Dashboard</title>

<style>
body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: #0a0f1c;
    color: white;
}

.sidebar {
    width: 250px;
    height: 100vh;
    background: #111827;
    position: fixed;
    left: 0;
    top: 0;
    padding-top: 20px;
    border-right: 1px solid rgba(255,255,255,0.08);
}

.sidebar h2 {
    text-align: center;
    color: #5b7cff;
    margin-bottom: 30px;
}

.sidebar a {
    display: block;
    color: white;
    padding: 15px 25px;
    text-decoration: none;
    transition: 0.3s;
}

.sidebar a:hover {
    background: #5b7cff;
}

.main {
    margin-left: 250px;
    padding: 30px;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #111827;
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 25px;
}

.btn-refresh,
.baixar-global {
    color: white;
    padding: 12px 20px;
    text-decoration: none;
    border-radius: 8px;
    font-weight: bold;
}

.btn-refresh {
    background: #10b981;
}

.baixar-global {
    background: #00c853;
}

.cards {
    display: grid;
    grid-template-columns: repeat(auto-fit,minmax(250px,1fr));
    gap: 20px;
    margin-bottom: 30px;
}

.card,
.canal {
    background: #111827;
    padding: 25px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.05);
}

.card h3 {
    margin-top: 0;
    color: #5b7cff;
}

.card .value {
    font-size: 30px;
    font-weight: bold;
    margin: 15px 0;
}

.grid-canais {
    display: grid;
    grid-template-columns: repeat(auto-fit,minmax(320px,1fr));
    gap: 20px;
}

.canal h2 {
    color: #00ff99;
}

.online {
    color: lime;
    font-weight: bold;
}

.offline {
    color: red;
    font-weight: bold;
}

.acoes {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 15px;
}

.linha-acoes {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}

.btn {
    padding: 10px 16px;
    border-radius: 8px;
    text-decoration: none;
    color: white;
    font-weight: bold;
    font-size: 14px;
    transition: 0.3s;
    display: inline-block;
}

.btn:hover {
    opacity: 0.85;
}

.assistir {
    background: #2563eb;
}

.baixar {
    background: #00c853;
}

.excluir {
    background: #dc2626;
}

.iniciar {
    background: #16a34a;
}

.parar {
    background: #f59e0b;
}
</style>
</head>
<body>

<div class="sidebar">
    <h2>DRM PREMIUM</h2>
    <a href="index.php">Dashboard</a>
    <a href="canais.php">Criar Canal</a>
    <a href="conexoes.php">Conexões Ativas</a>
    <a href="perfil.php">Perfil</a>
    <a href="logout.php">Sair</a>
</div>

<div class="main">

    <div class="header">
        <div>
            <h1>Dashboard</h1>
            <p>Visão geral do sistema em tempo real</p>
        </div>

        <div style="display:flex; gap:10px;">
            <a href="gerar_m3u.php" class="btn baixar-global">⬇ Baixar M3U</a>
            <a href="index.php" class="btn-refresh">Atualizar</a>
        </div>
    </div>

    <div class="cards">
        <div class="card">
            <h3>CPU</h3>
            <div class="value"><?= $cpuPercent ?>%</div>
            <p>Uso atual do processador</p>
        </div>

        <div class="card">
            <h3>RAM</h3>
            <div class="value"><?= $ramPercent ?>%</div>
            <p><?= $usedRam ?> GB / <?= $totalRam ?> GB</p>
        </div>

        <div class="card">
            <h3>Disco</h3>
            <div class="value"><?= $diskPercent ?>%</div>
            <p><?= round($diskUsed / 1024 / 1024 / 1024) ?> GB usados</p>
        </div>

        <div class="card">
            <h3>Rede</h3>
            <div class="value">
                <span id="rxMbps"><?= $rxMbps ?></span> Mbps ↓ /
                <span id="txMbps"><?= $txMbps ?></span> Mbps ↑
            </div>
            <p>Uso atual de banda</p>
        </div>
    </div>

    <h2>Meus Canais</h2>

    <div class="grid-canais">
        <?php foreach ($canais as $canal): ?>
            <div class="canal">
                <h2><?= htmlspecialchars($canal['nome']) ?></h2>

                <p>Status:
                    <span class="<?= $canal['status'] === 'Online' ? 'online' : 'offline' ?>">
                        <?= $canal['status'] ?>
                    </span>
                </p>

                <p>
                    Uptime:
                    <strong class="uptime"
                            data-started="<?= intval($canal['started_at']) ?>"
                            data-status="<?= htmlspecialchars($canal['status']) ?>">
                        <?= htmlspecialchars($canal['uptime']) ?>
                    </strong>
                </p>

                <p>Conexões Ativas: <strong><?= intval($canal['conexoes']) ?></strong></p>

                <div class="acoes">
                    <div class="linha-acoes">
                        <a class="btn iniciar" href="?start=<?= urlencode($canal['nome']) ?>">▶ Iniciar</a>
                        <a class="btn parar" href="?stop=<?= urlencode($canal['nome']) ?>">⏹ Parar</a>
                    </div>

                    <div class="linha-acoes">
                        <a class="btn assistir" href="<?= htmlspecialchars($canal['playlist']) ?>" target="_blank">▶ Assistir</a>

                        <a class="btn excluir"
                           href="?delete=<?= urlencode($canal['nome']) ?>"
                           onclick="return confirm('Deseja remover/parar este canal da lista ativa?')">
                            ✖ Excluir
                        </a>
                    </div>
                </div>
            </div>
        <?php endforeach; ?>
    </div>

</div>

<script>
function formatarUptime(segundos) {
    segundos = Math.max(0, parseInt(segundos, 10) || 0);

    const horas = Math.floor(segundos / 3600);
    const minutos = Math.floor((segundos % 3600) / 60);
    const segundosRestantes = segundos % 60;
    const dois = valor => String(valor).padStart(2, '0');

    if (horas > 0) {
        return `${dois(horas)}:${dois(minutos)}:${dois(segundosRestantes)}`;
    }

    return `${dois(minutos)}:${dois(segundosRestantes)}`;
}

function atualizarUptimes() {
    const agora = Math.floor(Date.now() / 1000);

    document.querySelectorAll('.uptime').forEach(el => {
        const status = el.dataset.status;
        const started = parseInt(el.dataset.started, 10) || 0;

        if (status !== 'Online' || started <= 0) {
            el.textContent = 'Offline';
            return;
        }

        el.textContent = formatarUptime(agora - started);
    });
}

async function atualizarRede() {
    try {
        const resp = await fetch('index.php?ajax=rede&_=' + Date.now(), {
            cache: 'no-store'
        });

        const data = await resp.json();

        document.getElementById('rxMbps').textContent = data.rxMbps;
        document.getElementById('txMbps').textContent = data.txMbps;
    } catch (e) {}
}

atualizarUptimes();
atualizarRede();

setInterval(atualizarUptimes, 1000);
setInterval(atualizarRede, 1000);
</script>

</body>
</html>

<?php
include 'config.php';
proteger();

$base_dir = "/home/drmpremium";
$msg = "";

function buscarVideos($dir) {
    $videos = [];
    $extensoes = ['mp4', 'mkv', 'avi', 'mov', 'm4v'];

    if (!is_dir($dir)) return $videos;

    foreach (glob($dir . '/*') as $file) {
        if (is_file($file)) {
            $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            if (in_array($ext, $extensoes)) {
                $videos[] = $file;
            }
        }
    }

    sort($videos);
    return $videos;
}

$pasta_atual = $_GET['pasta'] ?? $base_dir;
$real_base = realpath($base_dir);
$real_pasta = realpath($pasta_atual);

if (!$real_pasta || !str_starts_with($real_pasta, $real_base)) {
    $pasta_atual = $base_dir;
    $real_pasta = $real_base;
}

$subpastas = array_filter(glob($real_pasta . '/*'), 'is_dir');
$videos_disponiveis = buscarVideos($real_pasta);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $nome = trim($_POST['nome'] ?? '');
    $selecionados = $_POST['videos'] ?? [];

    if (!$nome || empty($selecionados)) {
        $msg = "Informe o nome do canal e selecione ao menos um vídeo.";
    } else {
        $canal_dir = $real_pasta;
        $playlist_txt = $canal_dir . '/playlist.txt';

        // Mata processo antigo desta pasta
        shell_exec("pkill -f " . escapeshellarg($playlist_txt));

        // Remove streams antigos
        foreach (glob($canal_dir . '/playlist*.ts') as $arquivo) {
            @unlink($arquivo);
        }
        @unlink($canal_dir . '/playlist.m3u8');
        @unlink($canal_dir . '/playlist.txt');
        @unlink($canal_dir . '/ffmpeg.log');

        // Cria playlist.txt corretamente
        $fp = fopen($playlist_txt, 'w') or die("Erro ao criar playlist em $playlist_txt");

        foreach ($selecionados as $video) {
            if (file_exists($video)) {
                fwrite($fp, "file '" . str_replace("'", "'\\''", $video) . "'\n");
            }
        }

        fclose($fp);
        chmod($playlist_txt, 0777);

        // Comando FFmpeg leve
        $cmd = "nohup ffmpeg -re -stream_loop -1 -f concat -safe 0 -i "
            . escapeshellarg($playlist_txt)
            . " -fflags +genpts "
            . " -avoid_negative_ts make_zero "
            . " -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p "
            . "-c:a aac -b:a 128k "
            . "-bsf:v h264_mp4toannexb "
            . "-f hls "
            . "-hls_time 6 "
            . "-hls_list_size 15 "
            . "-hls_flags delete_segments+append_list+independent_segments "
            . "-hls_segment_type mpegts "
            . "-hls_segment_filename "
            . escapeshellarg($canal_dir . '/playlist%d.ts')
            . " "
            . escapeshellarg($canal_dir . '/playlist.m3u8')
            . " > "
            . escapeshellarg($canal_dir . '/ffmpeg.log')
            . " 2>&1 &";

        shell_exec($cmd);
        sleep(5);

        if (file_exists($canal_dir . '/playlist.m3u8')) {
            $msg = "Canal criado com sucesso.";
        } else {
            $msg = "Canal criado, stream inicializando. Verifique ffmpeg.log se necessário.";
        }
    }
}
?>
<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Criar Canal Premium</title>
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
}
.sidebar a:hover {
    background: #5b7cff;
}
.main {
    margin-left: 250px;
    padding: 40px;
}
.card {
    background: #111827;
    padding: 30px;
    border-radius: 14px;
    max-width: 1100px;
}
input[type=text] {
    width: 100%;
    padding: 14px;
    margin-top: 8px;
    margin-bottom: 20px;
    border-radius: 8px;
    border: none;
    background: #1f2937;
    color: white;
}
button {
    background: #10b981;
    color: white;
    padding: 14px 25px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    margin-top: 15px;
}
button:hover { opacity: 0.9; }
.video-list {
    max-height: 500px;
    overflow-y: auto;
    background: #0f172a;
    padding: 20px;
    border-radius: 10px;
}
.video-item { margin-bottom: 8px; }
.msg {
    margin-bottom: 20px;
    padding: 15px;
    border-radius: 8px;
    background: #1f2937;
}
.select-all {
    margin-bottom: 20px;
    display: inline-block;
    background: #2563eb;
    padding: 10px 15px;
    border-radius: 8px;
    cursor: pointer;
}
.btn-nav {
    display: inline-block;
    padding: 10px 15px;
    background: #2563eb;
    color: white;
    text-decoration: none;
    border-radius: 8px;
    margin-bottom: 15px;
}
.folder-link {
    color: #00ff99;
    text-decoration: none;
}
</style>
<script>
function toggleSelectAll(source) {
    let checkboxes = document.querySelectorAll('.video-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
}
</script>
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
    <div class="card">
        <h1>Criar Novo Canal</h1>
        <p>Navegue pelas pastas dentro de <b>/home/drmpremium</b> para selecionar os vídeos do acervo.</p>

        <?php if ($msg): ?>
            <div class="msg"><?= htmlspecialchars($msg) ?></div>
        <?php endif; ?>

        <div style="margin-bottom:20px;">
            <strong>Pasta atual:</strong> <?= htmlspecialchars(str_replace($real_base, '/home/drmpremium', $real_pasta)) ?>
        </div>

        <?php if ($real_pasta !== $real_base): ?>
            <a href="?pasta=<?= urlencode(dirname($real_pasta)) ?>" class="btn-nav">⬅ Voltar</a>
        <?php endif; ?>

        <div class="video-list" style="margin-bottom:20px;">
            <h3>Subpastas</h3>
            <?php foreach ($subpastas as $subpasta): ?>
                <div class="video-item">
                    <a class="folder-link" href="?pasta=<?= urlencode($subpasta) ?>">
                        📁 <?= htmlspecialchars(basename($subpasta)) ?>
                    </a>
                </div>
            <?php endforeach; ?>
        </div>

        <form method="POST">
            <label>Nome do Canal</label>
            <input type="text" name="nome" placeholder="Ex: Tokusatsu" required>

            <label class="select-all">
                <input type="checkbox" onclick="toggleSelectAll(this)"> Selecionar Todos
            </label>

            <div class="video-list">
                <?php foreach ($videos_disponiveis as $video): ?>
                    <div class="video-item">
                        <label>
                            <input class="video-checkbox" type="checkbox" name="videos[]" value="<?= htmlspecialchars($video) ?>">
                            <?= htmlspecialchars(str_replace($real_base . '/', '', $video)) ?>
                        </label>
                    </div>
                <?php endforeach; ?>
            </div>

            <button type="submit">+ Criar Canal</button>
        </form>
    </div>
</div>
</body>
</html>

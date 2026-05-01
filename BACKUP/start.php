<?php
include 'config.php';
proteger();

$canal_raw = $_GET['c'] ?? '';
$pasta_raw = $_GET['pasta'] ?? '';

// nome seguro (hash)
$canal = md5($canal_raw);

// valida pasta
$pasta = realpath($pasta_raw);
$base = "/home/drmpremium";

if (!$pasta || strpos($pasta, $base) !== 0) {
    die("Pasta inválida");
}

// caminhos
$cache = "/home/drmpremium/cache/$canal.mp4";
$saida_dir = "/var/www/stream/$canal";
$saida = "$saida_dir/index.m3u8";

// verifica mp4
if (!file_exists($cache)) {
    die("MP4 não encontrado. Gere o cache primeiro.");
}

// cria pasta stream
if (!is_dir($saida_dir)) {
    mkdir($saida_dir, 0777, true);
}

// mata processo antigo
shell_exec("pkill -f '$cache'");

// comando final (IMPORTANTE)
$cmd = "nohup /usr/bin/ffmpeg -re -stream_loop -1 -i '$cache' -c copy -f hls -hls_time 6 -hls_list_size 10 -hls_flags delete_segments '$saida' > /home/drmpremium/logs/$canal.log 2>&1 &";

shell_exec($cmd);

// redireciona
header("Location: canais.php");
exit;

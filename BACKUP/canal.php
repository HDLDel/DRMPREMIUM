<?php

error_reporting(E_ALL);
ini_set('display_errors', 1);

// ========================
// CONFIG
// ========================
$base = "/home/drmpremium";
$acao = $_GET['acao'] ?? '';
$canal = preg_replace('/[^a-zA-Z0-9]/', '', $_GET['canal'] ?? '');
$pasta_raw = $_GET['pasta'] ?? '';
$pasta = urldecode($pasta_raw);

$playlist = "$base/playlists/$canal.txt";
$cache = "$base/cache/$canal.mp4";
$stream_dir = "/var/www/stream/$canal";

// ========================
// VALIDAR CANAL
// ========================
if (!$canal) {
    die("Canal inválido");
}

// ========================
// VALIDAR PASTA
// ========================
if ($pasta) {
    $real = realpath($pasta);

    if (!$real || strpos($real, $base) !== 0) {
        die("Pasta inválida");
    }

    $pasta = $real;
}

// ========================
// PLAYLIST
// ========================
if ($acao == "playlist") {

    if (!$pasta) {
        die("Pasta não informada");
    }

    if (!is_dir($pasta)) {
        die("Pasta não existe");
    }

    $files = glob($pasta . "/*.mp4");

    if (!$files) {
        die("Nenhum MP4 encontrado");
    }

    file_put_contents($playlist, "");

    foreach ($files as $f) {
        file_put_contents($playlist, "file '$f'\n", FILE_APPEND);
    }

    echo "Playlist OK";
    exit;
}

// ========================
// GERAR MP4
// ========================
if ($acao == "cache") {

    if (!file_exists($playlist)) {
        die("Crie a playlist primeiro");
    }

    shell_exec("ffmpeg -y -f concat -safe 0 -i '$playlist' -c copy '$cache' > /dev/null 2>&1 &");

    echo "Gerando MP4 em background";
    exit;
}

// ========================
// INICIAR STREAM
// ========================
if ($acao == "start") {

    if (!file_exists($cache)) {
        die("MP4 não encontrado");
    }

    // cria pasta stream
    if (!is_dir($stream_dir)) {
        mkdir($stream_dir, 0777, true);
    }

    // mata processo antigo
    shell_exec("pkill -f '$cache'");

    // inicia stream
    shell_exec("nohup ffmpeg -re -stream_loop -1 -i '$cache' -c copy -f hls -hls_time 6 -hls_list_size 10 -hls_flags delete_segments '$stream_dir/index.m3u8' > /dev/null 2>&1 &");

    echo "Canal iniciado";
    exit;
}

// ========================
// PARAR STREAM
// ========================
if ($acao == "stop") {

    shell_exec("pkill -f '$canal'");

    echo "Canal parado";
    exit;
}

// ========================
// PROGRESSO (simples)
// ========================
if ($acao == "progress") {

    if (!file_exists($cache)) {
        echo 0;
        exit;
    }

    $size = filesize($cache);

    if ($size > 0) {
        echo 100;
    } else {
        echo 0;
    }

    exit;
}

// ========================
// DEFAULT
// ========================
echo "API OK";

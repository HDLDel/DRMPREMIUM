<?php
include 'config.php';
proteger();

header('Content-Type: audio/x-mpegurl');
header('Content-Disposition: attachment; filename="canais.m3u"');

$base_dir = "/home/drmpremium";
$dominio = $_SERVER['HTTP_HOST'];

echo "#EXTM3U\n";

foreach (scandir($base_dir) as $canal) {
    if ($canal === '.' || $canal === '..') continue;

    $canal_path = "$base_dir/$canal";

    if (!is_dir($canal_path)) continue;
    if (in_array($canal, ['cache', 'logs', 'playlists', 'videos'])) continue;

    if (file_exists("$canal_path/playlist.m3u8")) {
        $url = "http://$dominio/live/$canal/playlist.m3u8";

        echo "#EXTINF:-1,$canal\n";
        echo "$url\n";
    }
}
?>

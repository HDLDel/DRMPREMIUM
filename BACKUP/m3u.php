<?php
session_start();
if(!isset($_SESSION['logado'])) exit;

require "config.php";

header('Content-Type: audio/x-mpegurl');
header('Content-Disposition: attachment; filename="canais.m3u"');

echo "#EXTM3U\n";

$canais = $conn->query("SELECT * FROM canais");

while($c = $canais->fetch_assoc()){
    $url = "http://".$_SERVER['HTTP_HOST']."/canais/".$c['id']."/index.m3u8";
    echo "#EXTINF:-1,".$c['nome']."\n";
    echo $url."\n";
}

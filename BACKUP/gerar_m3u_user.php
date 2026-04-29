<?php
require "config.php";

$user = $_GET['user'] ?? '';
$pass = $_GET['pass'] ?? '';

if(!$user || !$pass){
    die("Erro");
}

$host = $_SERVER['HTTP_HOST'];

$res = $conn->query("SELECT * FROM canais WHERE status='on'");

// 🔥 força download
header('Content-Type: application/octet-stream');
header("Content-Disposition: attachment; filename=\"{$user}.m3u\"");
header('Pragma: no-cache');
header('Expires: 0');

echo "#EXTM3U\n";

while($c = $res->fetch_assoc()){

    echo "#EXTINF:-1,".$c['nome']."\n";
    echo "http://$host/play.php?user=$user&pass=$pass&canal=".$c['id']."\n";
}

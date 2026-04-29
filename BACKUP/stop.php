<?php
require "config.php";

$id = intval($_GET['id']);
$dir = "/home/drmpremium/canais/$id";

$c = $conn->query("SELECT * FROM canais WHERE id=$id")->fetch_assoc();

if($c){

    // 🔥 1. tenta matar pelo PID (mais preciso)
    $pid_file = "$dir/pid";

    if(file_exists($pid_file)){
        $pid = trim(file_get_contents($pid_file));

        if($pid){
            exec("kill -9 $pid");
        }

        unlink($pid_file);
    }

    // 🔥 2. fallback (caso PID não funcione)
    exec("pkill -9 -f 'canais/$id/index.m3u8'");

    // 🧹 limpa HLS
    exec("find " . escapeshellarg($dir) . " -type f -name '*.ts' -delete");
    exec("find " . escapeshellarg($dir) . " -type f -name '*.m3u8' -delete");

    // banco
    $conn->query("UPDATE canais SET status='off' WHERE id=$id");
}

header("Location: index.php");
exit;

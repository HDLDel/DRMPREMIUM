<?php
session_start();
require "config.php";

if(!isset($_SESSION['logado'])){
    exit;
}

$id = intval($_GET['id']);

$c = $conn->query("SELECT * FROM canais WHERE id=$id")->fetch_assoc();

if(!$c){
    die("Canal não encontrado");
}

$dir = "/home/drmpremium/canais/$id";
$playlist = "$dir/lista.txt";

if(!file_exists($playlist)){
    die("Playlist não encontrada");
}

if(!is_dir($dir)){
    mkdir($dir, 0777, true);
}

//////////////////////////////////////////////
// 🔴 PARA PROCESSO ANTIGO
//////////////////////////////////////////////
if(!empty($c['pid'])){
    exec("kill -9 ".$c['pid']);
}

//////////////////////////////////////////////
// 🔥 LIMPA HLS ANTIGO
//////////////////////////////////////////////
exec("rm -f $dir/*.ts");
exec("rm -f $dir/*.m3u8");

//////////////////////////////////////////////
// 🚀 COMANDO SIMPLES E 100% FUNCIONAL
//////////////////////////////////////////////

$cmd = "ffmpeg -re -stream_loop -1 -f concat -safe 0 -i \"$playlist\" "
     . "-fflags +genpts -avoid_negative_ts make_zero "
     . "-c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p "
     . "-c:a aac -b:a 128k -ar 44100 "
     . "-map 0:v:0 -map 0:a:0? " 
     . "-f hls -hls_time 6 -hls_list_size 6 "
     . "-hls_flags delete_segments+append_list+omit_endlist "
     . "-hls_segment_filename \"$dir/segment_%d.ts\" "
     . "\"$dir/index.m3u8\" > /dev/null 2>&1 &";

// 🔥 EXECUÇÃO CORRETA EM BACKGROUND
$pid = shell_exec("nohup $cmd > /dev/null 2>&1 & echo $!");

//////////////////////////////////////////////
// 🧠 DEBUG (SE FALHAR, SALVA LOG)
//////////////////////////////////////////////
file_put_contents("$dir/debug.txt", "CMD:\n$cmd\nPID:$pid\n");

//////////////////////////////////////////////
// 💾 SALVA PID
//////////////////////////////////////////////
$conn->query("UPDATE canais SET status='on', pid='".trim($pid)."' WHERE id=$id");

header("Location: index.php");
exit;
?>

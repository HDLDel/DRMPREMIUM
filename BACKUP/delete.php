<?php
require "config.php";

$id = intval($_GET['id']);

// buscar canal
$c = $conn->query("SELECT * FROM canais WHERE id=$id")->fetch_assoc();

if($c){

    // 🔴 PARAR PROCESSO (se estiver rodando)
    if(!empty($c['pid'])){
        exec("pkill -P ".$c['pid']);
        exec("kill -9 ".$c['pid']);
    }

    // 🗂️ APAGAR PASTA DO CANAL
    $dir = "/home/drmpremium/canais/$id";

    if(is_dir($dir)){
        exec("rm -rf " . escapeshellarg($dir));
    }

    // 🧠 REMOVER DO BANCO
    $conn->query("DELETE FROM canais WHERE id=$id");
}

// 🔄 voltar pro painel
header("Location: index.php");
exit;

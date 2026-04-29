<?php
$ip = $_SERVER['REMOTE_ADDR'];
$canal = intval($_GET['id'] ?? 0);

if(!$canal) exit;

$arquivo = "/tmp/conexoes.json";
$data = [];

if(file_exists($arquivo)){
    $data = json_decode(file_get_contents($arquivo), true);
}

// registra
$data[$ip] = [
    "canal"=>$canal,
    "tempo"=>time()
];

// limpa antigos
foreach($data as $k => $v){
    if(time() - $v['tempo'] > 15){
        unset($data[$k]);
    }
}

file_put_contents($arquivo, json_encode($data));

// 🔥 REDIRECIONA PRO STREAM REAL
$host = $_SERVER['HTTP_HOST'];
header("Location: http://$host/canais/$canal/index.m3u8");
exit;

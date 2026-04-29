<?php
require "config.php";

$user = $_GET['user'] ?? '';
$pass = $_GET['pass'] ?? '';
$canal = intval($_GET['canal'] ?? 0);

if(!$user || !$pass || !$canal){
    die("Erro");
}

// valida login
$q = $conn->query("SELECT * FROM iptv_users
WHERE usuario='$user' AND senha='".md5($pass)."'");

if($q->num_rows == 0){
    die("Login inválido");
}

$u = $q->fetch_assoc();

// controle conexões
$arquivo_user = "/tmp/con_".$user.".json";
$data = [];

if(file_exists($arquivo_user)){
    $data = json_decode(file_get_contents($arquivo_user), true);
}

foreach($data as $ip => $t){
    if(time() - $t > 15){
        unset($data[$ip]);
    }
}

if(count($data) >= $u['max_con']){
    die("Limite atingido");
}

$data[$_SERVER['REMOTE_ADDR']] = time();
file_put_contents($arquivo_user, json_encode($data));

// 🔥 STREAM DIRETO (SEM REDIRECT)
$arquivo = "/home/drmpremium/canais/$canal/index.m3u8";

if(!file_exists($arquivo)){
    die("Stream offline");
}

header("Content-Type: application/vnd.apple.mpegurl");
header("Cache-Control: no-cache");

$conteudo = file_get_contents($arquivo);

// Como o Nginx bloqueia a pasta /canais/ diretamente, usamos a rota /live/ que é o alias
$base = "http://".$_SERVER['HTTP_HOST']."/live/canais/$canal/";

// corrige caminhos
$conteudo = preg_replace('/(segment_\d+\.ts)/', $base.'$1', $conteudo);

echo $conteudo;
exit;

<?php
session_start();
require "config.php";

if(!isset($_SESSION['logado'])){
    header("Location: login.php");
    exit;
}

$log = "/var/log/nginx/iptv.log";
$usuarios = [];

if(file_exists($log)){
    $linhas = array_slice(file($log), -3000);

    foreach($linhas as $l){

        $p = explode("|", $l);
        if(count($p) < 2) continue;

        $ip = trim($p[0]);
        $url = trim($p[1]);

        if(strpos($url, "/canais/") !== false){

            preg_match('/canais\/(\d+)/', $url, $m);
            if(!isset($m[1])) continue;

            $canal_id = $m[1];

            // salva último acesso
            $usuarios[$ip] = [
                "canal"=>$canal_id,
                "tempo"=>time()
            ];
        }
    }
}

// mantém últimos 15s
$ativos = [];

foreach($usuarios as $ip => $u){
    if(time() - $u['tempo'] <= 15){
        $ativos[$ip] = $u;
    }
}
?>

<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Usuários Online</title>

<style>
body{
    background:#0f1115;
    color:#fff;
    font-family:Arial;
    margin:0;
    padding:20px;
}

h2{
    margin-bottom:20px;
}

.grid{
    display:flex;
    flex-wrap:wrap;
    gap:15px;
}

.card{
    background:#1a1d23;
    padding:15px;
    border-radius:10px;
    width:250px;
    box-shadow:0 0 10px rgba(0,0,0,0.5);
}

.card b{
    color:#00c896;
}

small{
    color:#aaa;
}
a{
    color:#00c896;
    text-decoration:none;
}
</style>

</head>
<body>

<h2>👥 Usuários Online</h2>

<div class="grid">

<?php foreach($ativos as $ip => $u): ?>

<div class="card">
    <b>IP:</b> <?= $ip ?><br><br>

    <b>Canal:</b> <?= $u['canal'] ?><br><br>

    <b>Tempo:</b> Online agora
</div>

<?php endforeach; ?>

</div>

<br><br>
<a href="index.php">← Voltar</a>

</body>
</html>

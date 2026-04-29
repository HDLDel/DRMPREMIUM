<?php
session_start();

if(!isset($_SESSION['logado'])){
    exit;
}

$arquivo = "Backup_".date("d_m_Y").".tar.gz";
$path = "/tmp/".$arquivo;

// comando correto (SEM QUEBRAR)
$cmd = "nohup nice -n 19 tar --exclude='canais/*' -czf $path /home/drmpremium > /dev/null 2>&1 &";

// executa
exec($cmd);

// retorna JSON correto
echo json_encode([
    "status" => "ok",
    "msg" => "Backup iniciado com sucesso!",
    "file" => $arquivo
]);

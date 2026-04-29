<?php
session_start();
if(!isset($_SESSION['logado'])) exit;

$file = basename($_GET['file']);
$path = "/tmp/".$file;

if(!file_exists($path)){
    die("Arquivo não encontrado");
}

header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="'.$file.'"');
readfile($path);

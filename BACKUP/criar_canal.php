<?php
session_start();
require "config.php";

if(!isset($_SESSION['logado'])){
    header("Location: login.php");
    exit;
}

// valida nome
if(!isset($_POST['nome']) || empty($_POST['nome'])){
    die("Informe o nome do canal");
}

// valida vídeos
if(!isset($_POST['videos']) || empty($_POST['videos'])){
    die("Nenhum arquivo selecionado");
}

$nome = $conn->real_escape_string($_POST['nome']);
$videos = $_POST['videos'];

// cria no banco
$conn->query("INSERT INTO canais (nome, status) VALUES ('$nome','off')");
$id = $conn->insert_id;

// cria pasta do canal
$dir = "/home/drmpremium/canais/$id";
if(!is_dir($dir)){
    mkdir($dir, 0777, true);
}

// cria lista.txt
$lista = "";

foreach($videos as $v){
    $v = str_replace("'", "\\'", $v);
    $lista .= "file '$v'\n";
}

file_put_contents("$dir/lista.txt", $lista);

// volta pro painel
header("Location: index.php");
exit;

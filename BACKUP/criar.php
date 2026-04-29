<?php
require "config.php";

$nome = $_POST['nome'];
$videos = $_POST['videos'];

$conn->query("INSERT INTO canais (nome,status) VALUES ('$nome','off')");
$id = $conn->insert_id;

$dir = "/home/drmpremium/canais/$id";
mkdir($dir,0777,true);

$playlist = "$dir/lista.txt";
$f = fopen($playlist,"w");

foreach($videos as $v){
    fwrite($f, "file '$v'\n");
}

fclose($f);

header("Location: index.php");

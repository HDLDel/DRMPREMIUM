<?php
session_start();
if(!isset($_SESSION['logado'])) exit;

$file = basename($_GET['file']);
$path = "/tmp/".$file;

if(file_exists($path)){
    unlink($path);
    echo "ok";
} else {
    echo "erro";
}

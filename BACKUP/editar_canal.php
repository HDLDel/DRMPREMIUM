<?php
session_start();
require "config.php";

if(!isset($_SESSION['logado'])){
    exit;
}

$id = intval($_POST['id']);
$nome = $conn->real_escape_string($_POST['nome']);

$conn->query("UPDATE canais SET nome='$nome' WHERE id=$id");

echo "ok";

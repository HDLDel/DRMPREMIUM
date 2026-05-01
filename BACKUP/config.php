<?php
session_start();

$USER = "admin";
$PASS = "123456";

function logado() {
    return isset($_SESSION['logado']);
}

function proteger() {
    if (!logado()) {
        header("Location: login.php");
        exit;
    }
}

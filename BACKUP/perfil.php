<?php
session_start();
require "config.php";

if(!isset($_SESSION['logado'])){
    header("Location: login.php");
    exit;
}

$msg = "";

// trocar senha
if(isset($_POST['trocar'])){
    <REDACTED_PASSWORD> = md5($_POST['nova']);

    if(<REDACTED_PASSWORD>){
        $conn->query("UPDATE admin SET senha='<REDACTED_PASSWORD>' WHERE id=1");
        $msg = "Senha alterada com sucesso!";
    }
}
?>

<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Perfil</title>

<style>
body{
    background:#0f1115;
    color:#fff;
    font-family:Arial;
    padding:20px;
}

input{
    padding:10px;
    margin:5px;
    border:none;
    border-radius:5px;
}

button{
    padding:10px;
    background:#00c896;
    border:none;
    color:#fff;
    border-radius:5px;
    cursor:pointer;
}

.card{
    background:#1a1d23;
    padding:20px;
    border-radius:10px;
    width:300px;
}
</style>

</head>
<body>

<h2>👤 Perfil</h2>

<div class="card">

<form method="POST">
    <input type="password" name="nova" placeholder="Nova senha" required>
    <button name="trocar">Alterar senha</button>
</form>

<br>
<?= $msg ?>

</div>

<br>
<a href="index.php">← Voltar</a>

</body>
</html>

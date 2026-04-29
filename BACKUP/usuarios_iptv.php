<?php
session_start();
require "config.php";

if(!isset($_SESSION['logado'])){
    header("Location: login.php");
    exit;
}

// criar usuário
if(isset($_POST['criar'])){
    $user = $conn->real_escape_string($_POST['usuario']);
    $pass_txt = $_POST['senha'];
    $pass = md5($pass_txt);
    $max  = intval($_POST['max_con']);

    if($user && $pass_txt){
        $conn->query("INSERT INTO iptv_users (usuario, senha, senha_txt, max_con)
        VALUES ('$user','$pass','$pass_txt',$max)");
    }
}

// deletar usuário
if(isset($_GET['del'])){
    $id = intval($_GET['del']);
    $conn->query("DELETE FROM iptv_users WHERE id=$id");
}

// listar usuários
$res = $conn->query("SELECT * FROM iptv_users");
?>

<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Usuários IPTV</title>

<style>
body{
    background:#0f1115;
    color:#fff;
    font-family:Arial;
    padding:20px;
}

input{
    padding:8px;
    margin:5px;
    border:none;
    border-radius:5px;
}

button{
    padding:8px;
    background:#00c896;
    border:none;
    color:#fff;
    border-radius:5px;
    cursor:pointer;
}

.card{
    background:#1a1d23;
    padding:15px;
    margin-top:10px;
    border-radius:8px;
}
a{
    color:#00c896;
    text-decoration:none;
}
</style>

</head>
<body>

<h2>👤 Usuários IPTV</h2>

<form method="POST">
    <input name="usuario" placeholder="Usuário" required>
    <input name="senha" placeholder="Senha" required>
    <input name="max_con" type="number" value="1" min="1">
    <button name="criar">Criar</button>
</form>

<hr>

<?php while($u = $res->fetch_assoc()): ?>

<div class="card">
    <b><?= $u['usuario'] ?></b><br>
    Conexões: <?= $u['max_con'] ?><br><br>

    <a href="gerar_m3u_user.php?user=<?= $u['usuario'] ?>&pass=<?= $u['senha_txt'] ?>">
        📺 Gerar M3U
    </a><br><br>

    <a href="?del=<?= $u['id'] ?>" style="color:red;">Excluir</a>
</div>

<?php endwhile; ?>

<br>
<a href="index.php">← Voltar</a>

</body>
</html>

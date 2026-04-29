<?php
session_start();
require "config.php";

$erro = "";

if(isset($_POST['usuario'])){

    $usuario = $conn->real_escape_string($_POST['usuario']);
    $senha_input = $_POST['senha'];

    $sql = $conn->query("SELECT * FROM admin WHERE usuario='$usuario' LIMIT 1");

    if($sql->num_rows > 0){

        $user = $sql->fetch_assoc();

        // aceita senha normal OU md5
        if($user['senha'] === $senha_input || $user['senha'] === md5($senha_input)){
            $_SESSION['logado'] = true;
            header("Location: index.php");
            exit;
        } else {
            $erro = "Login inválido";
        }

    } else {
        $erro = "Login inválido";
    }
}
?>

<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Sistema Canais 24h</title>

<style>
body{
    margin:0;
    background:#000;
    font-family:Arial;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
    color:#fff;
}

.box{
    background:#111;
    padding:30px;
    border-radius:10px;
    width:300px;
    text-align:center;
}

input{
    width:100%;
    padding:10px;
    margin:10px 0;
    border:none;
    border-radius:5px;
}

button{
    width:100%;
    padding:10px;
    background:#ff2a2a;
    border:none;
    color:#fff;
    font-weight:bold;
    border-radius:5px;
    cursor:pointer;
}

button:hover{
    background:#cc0000;
}

.erro{
    color:red;
    margin-top:10px;
}
.footer{
    position:fixed;
    bottom:10px;
    font-size:12px;
    color:#aaa;
}
</style>

</head>
<body>

<div class="box">
    <h2>🔐 Sistema Canais 24h</h2>

    <form method="POST">
        <input type="text" name="usuario" placeholder="Usuário" required>
        <input type="password" name="senha" placeholder="Senha" required>
        <button type="submit">Entrar</button>
    </form>

    <?php if($erro): ?>
        <div class="erro"><?php echo $erro; ?></div>
    <?php endif; ?>
</div>

<div class="footer">
    Sistema exclusivo Cyber desde 2022
</div>

</body>
</html>

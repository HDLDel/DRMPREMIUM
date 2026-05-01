<?php
include 'config.php';

if ($_POST) {
    if ($_POST['user'] == $USER && $_POST['pass'] == $PASS) {
        $_SESSION['logado'] = true;
        header("Location: index.php");
        exit;
    } else {
        $erro = "Usuário ou senha inválidos";
    }
}
?>

<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Login - Painel IPTV</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<style>
body {
    margin:0;
    font-family:Arial;
    background: linear-gradient(135deg,#0b0f1a,#0f172a);
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:center;
    height:100vh;
}

/* CONTAINER */
.container {
    width:100%;
    max-width:1100px;
    display:flex;
    justify-content:space-between;
    align-items:center;
}

/* ESQUERDA */
.left {
    width:50%;
}

.logo {
    font-size:20px;
    margin-bottom:20px;
    color:#8b5cf6;
}

.titulo {
    font-size:40px;
    font-weight:bold;
    margin-bottom:15px;
}

.desc {
    color:#9ca3af;
    margin-bottom:30px;
    line-height:1.5;
}

.item {
    margin-bottom:15px;
    color:#d1d5db;
}

/* LOGIN BOX */
.box {
    width:350px;
    background:#111827;
    padding:30px;
    border-radius:12px;
    box-shadow:0 0 30px rgba(0,0,0,0.5);
}

.box h2 {
    margin-bottom:20px;
}

input {
    width:100%;
    padding:12px;
    margin:8px 0;
    border:none;
    border-radius:8px;
    background:#1f2937;
    color:#fff;
}

button {
    width:100%;
    padding:12px;
    background:#6366f1;
    border:none;
    border-radius:8px;
    color:#fff;
    font-weight:bold;
    margin-top:10px;
    cursor:pointer;
}

button:hover {
    background:#4f46e5;
}

.erro {
    color:red;
    margin-top:10px;
}

/* RODAPÉ */
.footer {
    position:absolute;
    bottom:10px;
    width:100%;
    text-align:center;
    font-size:12px;
    color:#6b7280;
}
</style>

</head>

<body>

<div class="container">

    <!-- LADO ESQUERDO -->
    <div class="left">
        <div class="logo">⚡ Cyber Streaming</div>

        <div class="titulo">Bem-vindo de volta</div>

        <div class="desc">
            Gerencie seus canais 24H de forma simples e profissional.
            Crie streams contínuos, monitore conexões e mantenha seu sistema sempre online.
        </div>

        <div class="item">📺 Criação de canais 24H automática</div>
        <div class="item">⚡ Sistema leve e otimizado (baixo CPU)</div>
        <div class="item">📊 Monitoramento em tempo real</div>
        <div class="item">🔐 Controle total do streaming</div>
    </div>

    <!-- LOGIN -->
    <div class="box">
        <h2>Fazer login</h2>

        <form method="POST">
            <input name="user" placeholder="Usuário">
            <input name="pass" type="password" placeholder="Senha">
            <button>Entrar</button>
        </form>

        <div class="erro"><?php echo $erro ?? ""; ?></div>
    </div>

</div>

<div class="footer">
    Sistema exclusivo Cyber © <?php echo date("Y"); ?>
</div>

</body>
</html>

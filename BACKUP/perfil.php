<?php
include 'config.php';
proteger();

$msg = "";

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $novo_usuario = trim($_POST['usuario'] ?? '');
    admin_senha = trim($_POST['senha'] ?? '');

    if ($novo_usuario && admin_senha) {
        $config_file = __DIR__ . '/config.php';
        $config_content = file_get_contents($config_file);

        $config_content = preg_replace(
            "/\\$usuario_admin\\s*=\\s*'.*?';/",
            "\$usuario_admin = '" . addslashes($novo_usuario) . "';",
            $config_content
        );

        $config_content = preg_replace(
            "/\\$senha_admin\\s*=\\s*'.*?';/",
            "\$senha_admin = '" . addslashes(password_hash(admin_senha, PASSWORD_DEFAULT)) . "';",
            $config_content
        );

        file_put_contents($config_file, $config_content);

        $msg = "Perfil atualizado com sucesso.";
    } else {
        $msg = "Preencha usuário e senha.";
    }
}
?>
<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Perfil</title>
<style>
body {
    margin:0;
    font-family:Arial;
    background:#0a0f1c;
    color:white;
}
.sidebar {
    width:250px;
    height:100vh;
    background:#111827;
    position:fixed;
    padding-top:20px;
}
.sidebar h2 {
    text-align:center;
    color:#5b7cff;
}
.sidebar a {
    display:block;
    color:white;
    padding:15px 25px;
    text-decoration:none;
}
.sidebar a:hover {
    background:#5b7cff;
}
.main {
    margin-left:250px;
    padding:40px;
}
.card {
    background:#111827;
    padding:30px;
    border-radius:14px;
    max-width:700px;
}
input {
    width:100%;
    padding:14px;
    margin:10px 0 20px;
    border:none;
    border-radius:8px;
    background:#1f2937;
    color:white;
}
button {
    background:#10b981;
    color:white;
    padding:14px 25px;
    border:none;
    border-radius:8px;
    cursor:pointer;
    font-weight:bold;
}
.msg {
    margin-bottom:20px;
    padding:15px;
    background:#1f2937;
    border-radius:8px;
}
</style>
</head>
<body>

<div class="sidebar">
    <h2>DRM PREMIUM</h2>
    <a href="index.php">Dashboard</a>
    <a href="canais.php">Criar Canal</a>
    <a href="conexoes.php">Conexões Ativas</a>
    <a href="perfil.php">Perfil</a>
    <a href="logout.php">Sair</a>
</div>

<div class="main">
    <div class="card">
        <h1>Perfil do Usuário</h1>

        <?php if ($msg): ?>
            <div class="msg"><?= htmlspecialchars($msg) ?></div>
        <?php endif; ?>

        <form method="POST">
            <label>Novo Usuário</label>
            <input type="text" name="usuario" required>

            <label>Nova Senha</label>
            <input type="password" name="senha" required>

            <button type="submit">Salvar Alterações</button>
        </form>
    </div>
</div>

</body>
</html>

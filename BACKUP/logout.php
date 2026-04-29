<?php
session_start();

// limpa todas as variáveis de sessão
$_SESSION = [];

// destrói a sessão
session_destroy();

// opcional: remove cookie de sessão (mais seguro)
if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(
        session_name(),
        '',
        time() - 42000,
        $params["path"],
        $params["domain"],
        $params["secure"],
        $params["httponly"]
    );
}

// redireciona pro login
header("Location: login.php");
exit;

<?php
include 'config.php';
proteger();

$canal = $_GET['canal'] ?? '';
if (!$canal) {
    die("Canal não informado.");
}

$base_dir = "/home/drmpremium/canais";
$stream_base = "/live";

$stream = null;

// Busca o stream ativo na pasta de canais do sistema
$id_canal = intval($_GET['id'] ?? 0);
$pasta_canal = $base_dir . "/" . $id_canal;

if (is_dir($pasta_canal)) {
    $arquivos = glob($pasta_canal . "/*.m3u8");
    if (!empty($arquivos)) {
        $stream = "/live/canais/$id_canal/index.m3u8";
    }
}

if (!$stream) {
    die("Stream não encontrado.");
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($canal) ?></title>
    <style>
        body {
            margin: 0;
            background: #000814;
            color: white;
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }

        h1 {
            margin-bottom: 20px;
            color: #00ff99;
        }

        video {
            width: 90%;
            max-width: 1500px;
            border-radius: 16px;
            box-shadow: 0 0 25px rgba(0,255,153,0.5);
            background: black;
        }

        .voltar {
            margin-top: 20px;
            padding: 12px 24px;
            background: #2563eb;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
        }

        .voltar:hover {
            background: #1d4ed8;
        }
    </style>
</head>
<body>

    <h1><?= htmlspecialchars($canal) ?></h1>

    <video controls autoplay>
        <source src="<?= htmlspecialchars($stream) ?>" type="application/x-mpegURL">
        Seu navegador não suporta vídeo.
    </video>

    <a class="voltar" href="index.php">← Voltar</a>

</body>
</html>

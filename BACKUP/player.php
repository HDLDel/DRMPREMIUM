<?php
include 'config.php';
proteger();

$canal = $_GET['canal'] ?? '';
if (!$canal) {
    die("Canal não informado.");
}

$base_dir = "/home/drmpremium";
$stream_base = "/canais";

$stream = null;

/*
 Procura o canal em qualquer categoria dentro de /home/drmpremium
 Ex:
 /home/drmpremium/Tokusatsu/Bicrossers (1985)
 /home/drmpremium/Filmes/Canal X
*/
$pastas = glob($base_dir . "/*/" . $canal);

if (!$pastas) {
    die("Canal não encontrado.");
}

foreach ($pastas as $pasta_canal) {
    $arquivos = glob($pasta_canal . "/playlist*.ts");

    if (!empty($arquivos)) {
        rsort($arquivos); // último segmento disponível
        $arquivo = $arquivos[0];

        $relative = str_replace($base_dir, $stream_base, $arquivo);
        $stream = implode('/', array_map('rawurlencode', explode('/', $relative)));

        break;
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
        <source src="<?= htmlspecialchars($stream) ?>" type="video/mp2t">
        Seu navegador não suporta vídeo.
    </video>

    <a class="voltar" href="index.php">← Voltar</a>

</body>
</html>

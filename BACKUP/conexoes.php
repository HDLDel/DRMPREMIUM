<?php
include 'config.php';
proteger();

$logFile = '/var/log/nginx/iptv.log';
$linhasParaLer = 5000;
$linhasRecentesAtivas = 300;
$conexoes = [];
$agora = time();

function tempoHumano($segundos) {
    $segundos = max(0, (int)$segundos);

    $h = floor($segundos / 3600);
    $m = floor(($segundos % 3600) / 60);
    $s = $segundos % 60;

    if ($h > 0) {
        return "{$h}h {$m}m {$s}s";
    }

    if ($m > 0) {
        return "{$m}m {$s}s";
    }

    return "{$s}s";
}

function extrairCanal($url) {
    $path = parse_url($url, PHP_URL_PATH);

    if (!$path) {
        return null;
    }

    $path = urldecode($path);
    $partes = array_values(array_filter(explode('/', $path)));

    foreach ($partes as $i => $parte) {
        if (preg_match('/^playlist.*\.ts$/i', $parte)) {
            return $i >= 1 ? $partes[$i - 1] : null;
        }
    }

    return null;
}

$linhasLog = is_readable($logFile)
    ? shell_exec('tail -n ' . intval($linhasParaLer) . ' ' . escapeshellarg($logFile))
    : '';

$linhas = array_values(array_filter(explode("\n", trim($linhasLog))));
$linhas = array_slice($linhas, -$linhasRecentesAtivas);
$totalLinhas = count($linhas);

foreach ($linhas as $i => $linha) {
    if (strpos($linha, '|') === false) {
        continue;
    }

    [$ip, $url] = array_pad(explode('|', $linha, 2), 2, '');

    $ip = trim($ip);
    $url = trim($url);

    if (
        $ip === '' ||
        $url === '' ||
        stripos($url, '/live/') === false ||
        stripos($url, '.ts') === false
    ) {
        continue;
    }

    $canal = extrairCanal($url);

    if (!$canal) {
        continue;
    }

    $linhasAteFinal = max(0, $totalLinhas - $i - 1);
    $timestampEstimado = $agora - min(300, $linhasAteFinal);

    $chave = $ip . '|' . $canal;

    if (!isset($conexoes[$chave])) {
        $conexoes[$chave] = [
            'ip' => $ip,
            'canal' => $canal,
            'inicio' => $timestampEstimado,
            'ultimo' => $timestampEstimado,
            'requests' => 1,
            'ultima_url' => $url
        ];
    } else {
        $conexoes[$chave]['inicio'] = min($conexoes[$chave]['inicio'], $timestampEstimado);
        $conexoes[$chave]['ultimo'] = max($conexoes[$chave]['ultimo'], $timestampEstimado);
        $conexoes[$chave]['requests']++;
        $conexoes[$chave]['ultima_url'] = $url;
    }
}

usort($conexoes, function ($a, $b) {
    return $b['ultimo'] <=> $a['ultimo'];
});
?>
<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Conexões Ativas</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="10">

<style>
body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: #070b16;
    color: white;
}

.sidebar {
    width: 238px;
    height: 100vh;
    background: #111827;
    position: fixed;
    left: 0;
    top: 0;
    padding-top: 36px;
    border-right: 1px solid rgba(255,255,255,0.08);
}

.sidebar h2 {
    color: #5b7cff;
    margin: 0 0 32px 26px;
    font-size: 24px;
    font-weight: bold;
}

.sidebar a {
    display: block;
    color: white;
    padding: 15px 26px;
    text-decoration: none;
    font-size: 16px;
    transition: 0.25s;
}

.sidebar a:hover,
.sidebar a.active {
    background: #5b7cff;
    color: white;
}

.main {
    margin-left: 238px;
    padding: 28px 30px;
}

h1 {
    margin-top: 0;
    margin-bottom: 25px;
}

.card {
    background: #111827;
    border-radius: 10px;
    padding: 18px;
    margin-bottom: 14px;
    border: 1px solid rgba(255,255,255,0.06);
}

.grid {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr;
    gap: 12px;
    align-items: center;
}

.label {
    color: #9ca3af;
    font-size: 13px;
    margin-bottom: 4px;
}

.valor {
    font-size: 16px;
    font-weight: bold;
}

.online {
    color: #22c55e;
}

.empty {
    color: #9ca3af;
    background: #111827;
    padding: 20px;
    border-radius: 10px;
}

.debug {
    margin-top: 15px;
    color: #9ca3af;
    font-size: 13px;
}

@media (max-width: 900px) {
    .sidebar {
        position: relative;
        width: 100%;
        height: auto;
        padding: 20px 0;
    }

    .main {
        margin-left: 0;
        padding: 20px;
    }

    .grid {
        grid-template-columns: 1fr;
    }
}
</style>
</head>
<body>

<div class="sidebar">
    <h2>DRM PREMIUM</h2>

    <a href="index.php">Dashboard</a>
    <a href="canais.php">Criar Canal</a>
    <a href="conexoes.php" class="active">Conexões Ativas</a>
    <a href="perfil.php">Perfil</a>
    <a href="logout.php">Sair</a>
</div>

<div class="main">
    <h1>Conexões Ativas</h1>

    <?php if (empty($conexoes)): ?>
        <div class="empty">
            Nenhuma conexão ativa no momento.
            <div class="debug">
                Log usado: <?= htmlspecialchars($logFile) ?> |
                Últimas linhas analisadas: <?= intval($totalLinhas) ?>
            </div>
        </div>
    <?php else: ?>
        <?php foreach ($conexoes as $c): ?>
            <div class="card">
                <div class="grid">
                    <div>
                        <div class="label">Canal</div>
                        <div class="valor"><?= htmlspecialchars($c['canal']) ?></div>
                    </div>

                    <div>
                        <div class="label">IP</div>
                        <div class="valor"><?= htmlspecialchars($c['ip']) ?></div>
                    </div>

                    <div>
                        <div class="label">Ativo há</div>
                        <div class="valor"><?= tempoHumano(time() - $c['inicio']) ?></div>
                    </div>

                    <div>
                        <div class="label">Última atividade</div>
                        <div class="valor online"><?= tempoHumano(time() - $c['ultimo']) ?> atrás</div>
                    </div>

                    <div>
                        <div class="label">Segmentos</div>
                        <div class="valor"><?= intval($c['requests']) ?></div>
                    </div>
                </div>
            </div>
        <?php endforeach; ?>

        <div class="debug">
            Log usado: <?= htmlspecialchars($logFile) ?> |
            Últimas linhas analisadas: <?= intval($totalLinhas) ?>
        </div>
    <?php endif; ?>
</div>

</body>
</html>

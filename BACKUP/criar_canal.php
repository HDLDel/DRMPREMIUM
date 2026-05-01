<?php
include 'config.php';
proteger();

$base_dir = "/home/drmpremium";
$dir = $_POST['dir'] ?? $_GET['dir'] ?? $base_dir;

$msg = "";

// segurança (não sair da pasta base)
if (strpos(realpath($dir), $base_dir) !== 0) {
    $dir = $base_dir;
}

// CRIAR CANAL
if ($_POST) {

    $nome = preg_replace('/[^a-zA-Z0-9]/', '', $_POST['nome']);
    $arquivos = $_POST['arquivos'] ?? [];

    if (!$nome || empty($arquivos)) {
        $msg = "Selecione pelo menos um arquivo!";
    } else {

        $pasta = "/var/www/stream/$nome";

        if (!is_dir($pasta)) {
            mkdir($pasta, 0777, true);
        }

        // cria playlist
        $playlist = "/tmp/playlist_$nome.txt";
        $conteudo = "";

        foreach ($arquivos as $a) {
            $conteudo .= "file '$a'\n";
        }

        file_put_contents($playlist, $conteudo);

        // comando ffmpeg 24h
        $cmd = "ffmpeg -re -stream_loop -1 -f concat -safe 0 -i $playlist -c copy -f hls -hls_time 6 -hls_list_size 10 -hls_flags delete_segments $pasta/index.m3u8 > /dev/null 2>&1 &";

        shell_exec($cmd);

        $msg = "Canal criado com sucesso!";
    }
}

// listar arquivos
$files = scandir($dir);
?>

<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Criar Canal</title>

<style>
body {
    background:#0b0f1a;
    color:#fff;
    font-family:Arial;
}

/* CONTAINER */
.container {
    max-width:800px;
    margin:30px auto;
    background:#111827;
    padding:20px;
    border-radius:10px;
}

/* TOPO */
.topbar {
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:15px;
}

.voltar {
    background:#1f2937;
    padding:8px 12px;
    border-radius:6px;
    text-decoration:none;
    color:#9ca3af;
}

.voltar:hover {
    background:#374151;
    color:#fff;
}

/* INPUT */
input, button {
    width:100%;
    padding:10px;
    margin:10px 0;
    background:#1f2937;
    border:none;
    color:#fff;
    border-radius:6px;
}

button {
    background:#6366f1;
    cursor:pointer;
}

button:hover {
    background:#4f46e5;
}

/* LISTA */
.file {
    padding:8px;
    border-bottom:1px solid #1f2937;
    display:flex;
    align-items:center;
}

.file input {
    width:auto;
    margin-right:10px;
}

/* BOTÕES */
.topbtn {
    background:#374151;
    padding:8px;
    margin-bottom:10px;
    cursor:pointer;
    text-align:center;
    border-radius:6px;
}

.topbtn:hover {
    background:#4b5563;
}

.msg {
    color:#22c55e;
    margin-top:10px;
}
</style>

<script>
function selecionarTodos() {
    document.querySelectorAll('.chk').forEach(c => c.checked = true);
}

function desmarcarTodos() {
    document.querySelectorAll('.chk').forEach(c => c.checked = false);
}
</script>

</head>

<body>

<div class="container">

<!-- TOPO -->
<div class="topbar">

<?php
if ($dir != $base_dir) {
    $parent = dirname($dir);
    echo "<a class='voltar' href='?dir=$parent'>⬅ Voltar</a>";
} else {
    echo "<div></div>";
}
?>

<div style="color:#6b7280; font-size:12px;">
<?php echo $dir; ?>
</div>

</div>

<h2>➕ Criar Canal 24H</h2>

<form method="POST" action="">
<input type="hidden" name="dir" value="<?php echo $dir; ?>">

Nome do canal:
<input name="nome" placeholder="ex: filmes">

<button>Criar Canal</button>

<div class="msg"><?php echo $msg; ?></div>

<hr>

<div class="topbtn" onclick="selecionarTodos()">✔ Selecionar TODOS</div>
<div class="topbtn" onclick="desmarcarTodos()">❌ Desmarcar TODOS</div>

<?php

foreach ($files as $file) {

    if ($file == "." || $file == "..") continue;

    $path = $dir . "/" . $file;

    if (is_dir($path)) {
        echo "<div class='file'>📁 <a href='?dir=$path' style='color:#9ca3af;text-decoration:none;'>$file</a></div>";
    } else {
        echo "<div class='file'>
            <input type='checkbox' class='chk' name='arquivos[]' value='$path'>
            🎬 $file
        </div>";
    }
}
?>

</form>

</div>

</body>
</html>

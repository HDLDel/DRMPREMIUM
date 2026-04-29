<?php
session_start();
if(!isset($_SESSION['logado'])){
    header("Location: login.php");
    exit;
}

$base = "/home/drmpremium";

// pasta atual
$dir = isset($_GET['dir']) ? $_GET['dir'] : $base;

// segurança
$dir = realpath($dir);
if(!$dir || strpos($dir, realpath($base)) !== 0){
    $dir = $base;
}

$files = scandir($dir);
?>

<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Selecionar Arquivos</title>

<style>
body{
    background:#000;
    color:#fff;
    font-family:Arial;
    padding:20px;
}

.container{
    max-width:900px;
    margin:auto;
}

h2{
    margin-bottom:15px;
}

.item{
    padding:8px;
    border-bottom:1px solid #222;
}

.folder{
    color:#00aaff;
}

.file{
    color:#ccc;
}

input[type=text]{
    width:100%;
    padding:10px;
    margin-bottom:10px;
    border:none;
    border-radius:5px;
}

button{
    padding:10px;
    background:#ff2a2a;
    color:#fff;
    border:none;
    border-radius:5px;
    cursor:pointer;
    margin-right:5px;
}

button:hover{
    background:#cc0000;
}

.top{
    margin-bottom:10px;
}

a{
    color:#aaa;
    text-decoration:none;
}

a:hover{
    color:#fff;
}
</style>

<script>
function selecionarTudo(){
    document.querySelectorAll("input[name='videos[]']").forEach(e=>e.checked=true);
}

function desmarcarTudo(){
    document.querySelectorAll("input[name='videos[]']").forEach(e=>e.checked=false);
}
</script>

</head>
<body>

<div class="container">

<h2>📁 Acervo: <?= str_replace($base, '', $dir) ?: '/' ?></h2>

<?php if($dir != $base): ?>
    <a href="?dir=<?= urlencode(dirname($dir)) ?>">⬅ Voltar</a><br><br>
<?php endif; ?>

<form method="POST" action="criar_canal.php">

<!-- 🔥 NOME DO CANAL -->
<input type="text" name="nome" placeholder="Nome do Canal" required>

<div class="top">
    <button type="button" onclick="selecionarTudo()">Selecionar tudo</button>
    <button type="button" onclick="desmarcarTudo()">Desmarcar</button>
</div>

<?php foreach($files as $f): 
    if($f == "." || $f == "..") continue;

    $path = $dir . "/" . $f;

    if(is_dir($path)): ?>
        <div class="item folder">
            📁 <a href="?dir=<?= urlencode($path) ?>"><?= $f ?></a>
        </div>

    <?php else:
        if(strtolower(pathinfo($f, PATHINFO_EXTENSION)) == "mp4"): ?>
            <div class="item file">
                <input type="checkbox" name="videos[]" value="<?= $path ?>">
                🎬 <?= $f ?>
            </div>
        <?php endif;
    endif;
endforeach; ?>

<br>
<button type="submit">🚀 Criar Canal 24H</button>

</form>

<br>
<a href="index.php">⬅ Voltar ao painel</a>

</div>

</body>
</html>

<?php
$base = "/home/drmpremium";
$pastas = array_filter(glob($base."/*"), 'is_dir');
?>

<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Pastas 24H</title>

<style>
body {
    background:#0b0b0b;
    color:#fff;
    font-family:Arial;
    margin:0;
}

.topbar {
    background:#111;
    padding:15px;
    font-size:22px;
    color:#ff2c2c;
    display:flex;
    justify-content:space-between;
    align-items:center;
}

.container {
    padding:20px;
}

/* LINK DO CARD */
.card-link {
    text-decoration:none;
    color:#fff;
    display:block;
}

/* CARD */
.card {
    background:#1a1a1a;
    padding:15px;
    border-radius:10px;
    margin:10px 0;
    border-left:4px solid #ff2c2c;
    transition:0.2s;
    cursor:pointer;
}

.card:hover {
    background:#2a2a2a;
    transform:scale(1.01);
}

/* BOTÃO */
button {
    background:#ff2c2c;
    border:none;
    padding:8px 12px;
    color:#fff;
    border-radius:5px;
    cursor:pointer;
}
</style>

</head>

<body>

<div class="topbar">
    📁 Pastas 24H
    <a href="index.php">
        <button>⬅ Voltar</button>
    </a>
</div>

<div class="container">

<?php if(empty($pastas)): ?>
    <p>Nenhuma pasta encontrada em /home/drmpremium</p>
<?php endif; ?>

<?php foreach($pastas as $p): 
$nome = basename($p);
?>

<a href="arquivos.php?pasta=<?= urlencode($nome) ?>" class="card-link">
    <div class="card">
        📂 <?= htmlspecialchars($nome) ?>
    </div>
</a>

<?php endforeach; ?>

</div>

</body>
</html>

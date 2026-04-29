<?php
$pasta = $_GET['pasta'];
$dir = "/home/drmpremium/$pasta/";

$videos = glob($dir . "*.mp4");
?>

<h2>🎬 <?= htmlspecialchars($pasta) ?></h2>

<form method="POST" action="criar_canal_24h.php">

<input type="hidden" name="nome" value="<?= htmlspecialchars($pasta) ?>">

<?php foreach($videos as $v): ?>
    <input type="checkbox" name="videos[]" value="<?= $v ?>">
    <?= basename($v) ?><br>
<?php endforeach; ?>

<br>
<button>Criar Canal 24H</button>
</form>

<br>
<a href="pastas.php">Voltar</a>

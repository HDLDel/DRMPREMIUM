<?php
include 'config.php';
proteger();

if (!isset($_GET['canal']) || empty($_GET['canal'])) {
    header("Location: index.php");
    exit;
}

$canal = $_GET['canal'];
$base_dir = "/home/drmpremium";

$canal_path = null;

/* Buscar canal recursivamente */
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($base_dir, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::SELF_FIRST
);

foreach ($iterator as $file) {
    if ($file->isDir() && basename($file->getPathname()) === $canal) {
        if (file_exists($file->getPathname() . '/playlist.m3u8')) {
            $canal_path = $file->getPathname();
            break;
        }
    }
}

if (!$canal_path) {
    header("Location: index.php");
    exit;
}

/* Mata ffmpeg */
shell_exec("pkill -f " . escapeshellarg($canal_path));

/* Remove apenas arquivos do canal */
$arquivos = glob($canal_path . "/playlist*");
foreach ($arquivos as $arquivo) {
    @unlink($arquivo);
}

/* Remove playlists auxiliares */
@unlink($canal_path . "/playlist.txt");

/* NÃO remove vídeos MP4 */
/* NÃO remove pasta da série */

header("Location: index.php");
exit;
?>

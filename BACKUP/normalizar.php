<?php
require "config.php";
if(session_status() === PHP_SESSION_NONE) session_start();

set_time_limit(0); // Impede que o script pare em vídeos longos
ob_implicit_flush(true); // Envia o texto para o navegador em tempo real

/**
 * FERRAMENTA DE INTEGRIDADE IPTV PRO
 * Finalidade: Analisar os arquivos MP4 e corrigir timestamps (DTS/PTS) 
 * para permitir o uso de '-c copy' sem travamentos.
 */

$canal_nome = $_GET['canal'] ?? '';
if (!$canal_nome) die("Informe o nome do canal.");

/**
 * Caminho da mídia: 
 * Os vídeos originais residem em /home/drmpremium/
 */
$base_dir = "/home/drmpremium/" . $canal_nome;

$playlist_txt = "$base_dir/playlist.txt";

if (!file_exists($playlist_txt)) die("Playlist.txt não encontrada.");

$arquivos = file($playlist_txt);
echo "<html><body style='background:#000; color:#0f0; font-family:monospace; padding:20px;'>";
echo "<h2>--- Iniciando Verificação de Integridade: $canal_nome ---</h2>";
echo "<pre>";

foreach ($arquivos as $linha) {
    if (strpos($linha, "file '") === 0) {
        $path = trim(str_replace(["file '", "'"], "", $linha));
        $full_path = (realpath($path)) ? $path : $base_dir . "/" . $path;

        echo "Analisando: " . basename($full_path) . "... ";

        // Tenta ler o arquivo rapidamente para achar erros de stream
        $cmd_check = "ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 " . escapeshellarg($full_path) . " 2>&1";
        $erro = shell_exec($cmd_check);

        flush();

        if (strpos($erro, "Non-monotonic DTS") !== false || empty(trim($erro))) {
            echo "⚠️ [TIMESTAMP QUEBRADO] Corrigindo...\n";
            flush();

            $tmp_file = $full_path . ".fixed.mp4";
            // Transcodifica apenas este arquivo problemático para normalizar os tempos
            $cmd_fix = "ffmpeg -i " . escapeshellarg($full_path) . " -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -y " . escapeshellarg($tmp_file);
            shell_exec($cmd_fix);

            if (file_exists($tmp_file)) {
                rename($tmp_file, $full_path);
                echo "✅ Arquivo Normalizado com Sucesso.\n";
            }
        } else {
            echo "✔ OK (Pronto para -c copy)\n";
        }
    }
}

echo "\n--- Verificação Concluída. Canal seguro para transmissão ---\n</pre></body></html>";
?>
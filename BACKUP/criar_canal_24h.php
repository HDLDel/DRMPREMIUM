<?php
require "config.php";

$nome = $_POST['nome'];
$videos = $_POST['videos'];

$conn->query("INSERT INTO canais (nome,status) VALUES ('$nome','off')");
$id = $conn->insert_id;

$dir = "/home/drmpremium/canais/$id";
mkdir($dir,0777,true);

$playlist = "$dir/lista.txt";
$f = fopen($playlist,"w");

foreach($videos as $v){
    fwrite($f, "file '$v'\n");
}

fclose($f);

// inicia automaticamente
$cmd = "nohup ffmpeg -re -stream_loop -1 -f concat -safe 0 -i $playlist \
-c copy \
-f hls -hls_time 6 -hls_list_size 10 \
$dir/index.m3u8 > /dev/null 2>&1 & echo $!";

$pid = shell_exec($cmd);

$conn->query("UPDATE canais SET status='on', pid='".trim($pid)."' WHERE id=$id");

echo "✅ Canal criado!<br>";
echo "<a href='index.php'>Voltar</a>";

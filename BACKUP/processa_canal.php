<?php
require "config.php";

$nome = $_POST['nome'];

$conn->query("INSERT INTO canais (nome,status) VALUES ('$nome','off')");
$id = $conn->insert_id;

$dirVideos = "/home/drmpremium/"; // Onde os vídeos são armazenados
$dirCanal = "/home/drmpremium/canais/$id";

mkdir($dirVideos,0777,true);
mkdir($dirCanal,0777,true);

$playlist = "$dirCanal/lista.txt";
$f = fopen($playlist,"w");

foreach($_FILES['videos']['tmp_name'] as $key => $tmp){

    $nomeArq = time()."_".$_FILES['videos']['name'][$key];
    $destino = $dirVideos.$nomeArq;

    if(move_uploaded_file($tmp,$destino)){
        fwrite($f,"file '$destino'\n");
    }
}

fclose($f);

// inicia automaticamente
$cmd = "nohup ffmpeg -re -stream_loop -1 -f concat -safe 0 -i $playlist \
-c copy \
-f hls -hls_time 6 -hls_list_size 10 \
$dirCanal/index.m3u8 > /dev/null 2>&1 & echo $!";

$pid = shell_exec($cmd);

$conn->query("UPDATE canais SET status='on', pid='".trim($pid)."' WHERE id=$id");

echo "✅ Canal criado!<br>";
echo "📡 URL: http://".$_SERVER['HTTP_HOST']."/live/canais/$id/index.m3u8";

<?php
require "config.php";

$base = "/home/drmpremium/canais/";

$res = $conn->query("SELECT * FROM canais WHERE status='on'");

while($c = $res->fetch_assoc()){

    $id = $c['id'];
    $dir = $base.$id;
    $m3u8 = $dir."/index.m3u8";

    echo "Verificando canal $id...\n";

    // 🔍 1. verifica se ffmpeg está rodando
    $process = shell_exec("ps aux | grep 'canais/$id/index.m3u8' | grep -v grep");

    if(empty($process)){
        echo "⚠️ Canal $id sem processo FFmpeg\n";
        restart($id, $dir);
        continue;
    }

    // 🔍 2. verifica se arquivo existe
    if(!file_exists($m3u8)){
        echo "⚠️ Canal $id sem index.m3u8\n";
        restart($id, $dir);
        continue;
    }

    // 🔍 3. verifica se travou (não atualiza)
    $ultima = filemtime($m3u8);

    if(time() - $ultima > 15){
        echo "⚠️ Canal $id travado\n";
        restart($id, $dir);
        continue;
    }

    echo "✔ Canal $id OK\n\n";
}

function restart($id, $dir){

    echo "🔄 Reiniciando canal $id...\n";

    // 🔥 mata processo antigo
    exec("pkill -9 -f canais/$id");

    // 🧹 limpa arquivos
    exec("rm -f $dir/*.ts");
    exec("rm -f $dir/*.m3u8");

    $playlist = $dir."/lista.txt";

    if(!file_exists($playlist)){
        echo "❌ Playlist não encontrada para canal $id\n\n";
        return;
    }

    // 🚀 comando ffmpeg estável
    $cmd = "ffmpeg -re -stream_loop -1 -f concat -safe 0 -i \"$playlist\" "
         . "-fflags +genpts -avoid_negative_ts make_zero "
         . "-c:v libx264 -preset ultrafast -tune zerolatency "
         . "-c:a aac -b:a 128k "
         . "-f hls -hls_time 4 -hls_list_size 6 "
         . "-hls_flags delete_segments+append_list+omit_endlist "
         . "-hls_segment_filename \"$dir/segment_%03d.ts\" "
         . "\"$dir/index.m3u8\" > /dev/null 2>&1 &";

    exec($cmd);

    echo "✅ Canal $id reiniciado\n\n";
}

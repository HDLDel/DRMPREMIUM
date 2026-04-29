<?php
header('Content-Type: application/json');

// ================= CPU =================
$load = sys_getloadavg();
$cpu = round($load[0] * 100 / max(1, (int)shell_exec("nproc")));

// ================= RAM =================
$free = shell_exec("free -m");
$lines = explode("\n", trim($free));
$mem = preg_split('/\s+/', $lines[1]);
$ram = round(($mem[2] / $mem[1]) * 100);

// ================= DISCO =================
$total = disk_total_space("/");
$free = disk_free_space("/");
$disk = round((($total - $free) / $total) * 100);

// ================= REDE =================
$iface = "enp0s31f6";

$stat_file = "/tmp/net_stats.json";

$rx = @file_get_contents("/sys/class/net/$iface/statistics/rx_bytes");
$tx = @file_get_contents("/sys/class/net/$iface/statistics/tx_bytes");

$time = time();

$down = 0;
$up = 0;

if(file_exists($stat_file)){
    $old = json_decode(file_get_contents($stat_file), true);

    if($old){
        $time_diff = max(1, $time - $old['time']);

        $down = (($rx - $old['rx']) / $time_diff) * 8 / 1024 / 1024;
        $up   = (($tx - $old['tx']) / $time_diff) * 8 / 1024 / 1024;
    }
}

file_put_contents($stat_file, json_encode([
    "rx"=>$rx,
    "tx"=>$tx,
    "time"=>$time
]));

$down = round($down, 2);
$up = round($up, 2);

// ================= CONEXÕES IGUAL AO INDEX =================
$total_conexoes = 0;
$log = "/var/log/nginx/iptv.log";

if(file_exists($log)){

    $linhas = array_slice(file($log), -3000);

    // pega todos canais
    require "config.php";
    $res = $conn->query("SELECT id FROM canais");

    while($c = $res->fetch_assoc()){

        $ips = [];

        foreach($linhas as $l){

            $p = explode("|", $l);
            if(count($p) < 2) continue;

            $ip = trim($p[0]);
            $url = trim($p[1]);

            // 🔥 EXATAMENTE IGUAL AO INDEX
            if(strpos($url, "/live/canais/".$c['id']."/") !== false){
                $ips[$ip] = true;
            }
        }

        $total_conexoes += count($ips);
    }
}

$users = $total_conexoes;
// ================= OUTPUT =================
echo json_encode([
    "cpu"=>$cpu,
    "ram"=>$ram,
    "disk"=>$disk,
    "up"=>$up,
    "down"=>$down,
    "users"=>$users
]);

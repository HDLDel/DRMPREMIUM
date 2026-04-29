<?php

// ================= CPU =================
$load = sys_getloadavg();
$cores = intval(shell_exec("nproc")) ?: 1;
$cpu = round(($load[0] / $cores) * 100, 1);

// ================= RAM =================
$mem = file_get_contents("/proc/meminfo");
preg_match('/MemTotal:\s+(\d+)/', $mem, $total);
preg_match('/MemAvailable:\s+(\d+)/', $mem, $free);

$total = $total[1];
$free  = $free[1];
$ram = round((($total - $free) / $total) * 100);

// ================= DISK =================
$disk_total = disk_total_space("/");
$disk_free  = disk_free_space("/");
$disk = round((($disk_total - $disk_free) / $disk_total) * 100);

// ================= UPTIME =================
$uptime_raw = file_get_contents("/proc/uptime");
$seconds = intval(explode(" ", $uptime_raw)[0]);

$hours = floor($seconds / 3600);
$minutes = floor(($seconds % 3600) / 60);
$secs = $seconds % 60;

$uptime = sprintf("%02dh %02dm %02ds", $hours, $minutes, $secs);

// ================= NETWORK =================
$iface = "eth0"; // ajuste se necessário

$net = file_get_contents("/proc/net/dev");
preg_match("/$iface:\s+(\d+).*?(\d+)/", $net, $match);

$rx = $match[1] ?? 0;
$tx = $match[2] ?? 0;

// ================= STREAMS =================
$streams = intval(shell_exec("ps aux | grep ffmpeg | grep -v grep | wc -l"));

// ================= IPTV LOG =================
$logfile = "/var/log/nginx/iptv.log";

$ips = [];
$channels = [];
$totalConns = 0;

// 🔥 janela de sessão (segundos)
$window = 15;
$now = time();

if(file_exists($logfile)){

    $log = file($logfile);
    $last = array_slice($log, -1000);

    foreach($last as $l){

        if(strpos($l, ".ts") !== false){

            $parts = explode("|", $l);

            $ip = $parts[0] ?? "unknown";
            $timeStr = $parts[1] ?? "";

            // converter tempo do log
            $time = strtotime($timeStr);

            if(!$time || ($now - $time) > $window){
                continue;
            }

            if(preg_match('/canais\/(\d+)/', $l, $m)){
                $canal = $m[1];

                $key = $ip . "_" . $canal;

                // USERS GLOBAL
                $ips[$ip] = true;

                // evitar duplicação dentro da janela
                if(isset($channels[$canal]["seen"][$key])){
                    continue;
                }

                $channels[$canal]["seen"][$key] = true;

                // CONNECTIONS
                $totalConns++;

                // POR CANAL
                if(!isset($channels[$canal])){
                    $channels[$canal] = [
                        "views" => 0,
                        "ips" => [],
                        "seen" => []
                    ];
                }

                $channels[$canal]["views"]++;
                $channels[$canal]["ips"][$ip] = true;
            }
        }
    }
}

// FINALIZAR DADOS
foreach($channels as $id => $c){
    $channels[$id]["users"] = count($c["ips"]);
    unset($channels[$id]["ips"]);
    unset($channels[$id]["seen"]);
}

// ================= OUTPUT =================
echo json_encode([
    "cpu" => $cpu,
    "ram" => $ram,
    "disk" => $disk,
    "uptime" => $uptime,
    "rx" => $rx,
    "tx" => $tx,
    "streams" => $streams,
    "users" => count($ips),
    "connections" => $totalConns,
    "channels" => $channels
]);

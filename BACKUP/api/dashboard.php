<?php
header('Content-Type: application/json');

$stream_base = "/var/www/stream";
$host = $_SERVER['HTTP_HOST'];

$canais = [];
$total_conexoes = 0;

if (is_dir($stream_base)) {
    foreach (scandir($stream_base) as $canal) {
        if ($canal == '.' || $canal == '..') continue;

        $path = "$stream_base/$canal";
        if (!is_dir($path)) continue;

        if (file_exists("$path/index.m3u8")) {

            // Conta conexões pelo access log nginx
            $conexoes = 0;
            $log = "/var/log/nginx/access.log";

            if (file_exists($log)) {
                $linhas = shell_exec("grep '/live/$canal/' $log | tail -100");
                if ($linhas) {
                    $ips = [];
                    foreach (explode("\n", trim($linhas)) as $linha) {
                        if (preg_match('/^([0-9\.]+)/', $linha, $m)) {
                            $ips[$m[1]] = true;
                        }
                    }
                    $conexoes = count($ips);
                }
            }

            $total_conexoes += $conexoes;

            $canais[] = [
                "nome" => $canal,
                "link" => "http://$host:8080/live/$canal/index.m3u8",
                "conexoes" => $conexoes
            ];
        }
    }
}

// CPU
$cpu = trim(shell_exec("top -bn1 | grep 'Cpu(s)' | awk '{print 100 - $8}' | cut -d. -f1"));
if ($cpu == '') $cpu = 0;

// RAM
$ram = trim(shell_exec("free | grep Mem | awk '{printf(\"%.0f\", $3/$2 * 100.0)}'"));
if ($ram == '') $ram = 0;

echo json_encode([
    "conexoes" => $total_conexoes,
    "canais" => count($canais),
    "cpu" => $cpu,
    "ram" => $ram,
    "status" => count($canais) > 0 ? "Online" : "Offline",
    "lista" => $canais
]);

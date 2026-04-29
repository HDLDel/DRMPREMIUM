<?php
include 'config.php';
proteger();

header('Content-Type: application/json');

$interface = "enp0s31f6";

function lerBytes($interface, $tipo) {
    $file = "/sys/class/net/$interface/statistics/{$tipo}_bytes";

    if (!is_readable($file)) {
        return null;
    }

    return intval(trim(file_get_contents($file)));
}

$rx1 = lerBytes($interface, 'rx');
$tx1 = lerBytes($interface, 'tx');

usleep(1000000);

$rx2 = lerBytes($interface, 'rx');
$tx2 = lerBytes($interface, 'tx');

$rxMbps = 0;
$txMbps = 0;

if ($rx1 !== null && $tx1 !== null && $rx2 !== null && $tx2 !== null) {
    $rxBytes = max(0, $rx2 - $rx1);
    $txBytes = max(0, $tx2 - $tx1);

    $rxMbps = round(($rxBytes * 8) / 1024 / 1024, 2);
    $txMbps = round(($txBytes * 8) / 1024 / 1024, 2);
}

echo json_encode([
    'rxMbps' => $rxMbps,
    'txMbps' => $txMbps,
    'interface' => $interface
]);

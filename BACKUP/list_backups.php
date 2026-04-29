<?php
session_start();
if(!isset($_SESSION['logado'])) exit;

$files = glob("/tmp/Backup_*.tar.gz");

$list = [];

foreach($files as $f){
    $list[] = basename($f);
}

echo json_encode($list);

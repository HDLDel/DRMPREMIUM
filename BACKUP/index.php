<?php
session_start();
require "config.php";

if(!isset($_SESSION['logado'])){
    header("Location: login.php");
    exit;
}

$canais = $conn->query("SELECT * FROM canais ORDER BY id DESC");
$host = $_SERVER['HTTP_HOST'];

// leitura do log nginx (últimas linhas)
$log_file = "/var/log/nginx/iptv.log";
$log_linhas = [];

if(file_exists($log_file)){
    $log_linhas = @array_slice(file($log_file), -300);
}
?>

<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Painel IPTV</title>

<style>
body{margin:0;background:#0f1115;color:#fff;font-family:Arial;}

.topo{
    background:#111;
    padding:15px;
    display:flex;
    justify-content:space-between;
}

.logo{color:#ff2a2a;font-weight:bold;}

.btn{
    background:#ff2a2a;
    padding:8px 12px;
    border-radius:5px;
    color:#fff;
    text-decoration:none;
    margin-left:5px;
}

.container{display:flex;padding:20px;}

.canais{
    flex:1;
    display:flex;
    flex-wrap:wrap;
    gap:15px;
}

.card{
    background:#1a1d23;
    padding:15px;
    border-radius:10px;
    width:260px;
}

button{
    margin-top:5px;
    padding:6px;
    background:#ff2a2a;
    border:none;
    color:#fff;
    border-radius:5px;
    cursor:pointer;
}

input{
    width:100%;
    padding:5px;
    border-radius:5px;
    border:none;
    margin-top:5px;
}

/* MONITOR */
.monitor{
    width:300px;
    background:#2c323a;
    padding:20px;
    border-radius:10px;
    margin-left:20px;
}

.line{margin-bottom:15px;}
.line span{font-size:12px;color:#ccc;}

.bar{
    width:100%;
    height:10px;
    background:#444;
    border-radius:5px;
    margin-top:5px;
}

.bar div{
    height:100%;
    width:0%;
    background:#00c896;
    border-radius:5px;
}

small{word-break:break-all;}
</style>

<script>
function acao(url){
    fetch(url).then(()=>location.reload());
}

function editarNome(id){
    document.getElementById("view"+id).style.display="none";
    document.getElementById("edit"+id).style.display="block";
}

function salvarNome(id){
    let nome = document.getElementById("nome"+id).value;

    fetch("editar_canal.php", {
        method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:"id="+id+"&nome="+encodeURIComponent(nome)
    }).then(()=>location.reload());
}

// MONITOR
function atualizarMonitor(){
    fetch("monitor.php")
    .then(r=>r.json())
    .then(d=>{

        document.getElementById("cpu_txt").innerText = d.cpu+"%";
        document.getElementById("ram_txt").innerText = d.ram+"%";
        document.getElementById("disk_txt").innerText = d.disk+"%";
        document.getElementById("up_txt").innerText = d.up+" Mbps";
        document.getElementById("down_txt").innerText = d.down+" Mbps";
        document.getElementById("users_txt").innerText = d.users;

        document.getElementById("cpu_bar").style.width = d.cpu+"%";
        document.getElementById("ram_bar").style.width = d.ram+"%";
        document.getElementById("disk_bar").style.width = d.disk+"%";

        document.getElementById("up_bar").style.width = Math.min(d.up,100)+"%";
        document.getElementById("down_bar").style.width = Math.min(d.down,100)+"%";

        let maxUsers = 1000;

        let percent = (d.users / maxUsers) * 100;
        percent = Math.min(percent, 100);

       document.getElementById("users_bar").style.width = percent + "%";
       });
}

setInterval(atualizarMonitor,2000);
window.onload = atualizarMonitor;
</script>

</head>
<body>

<div class="topo">
    <div class="logo">🔥 PAINEL IPTV PRO</div>
    <div>
        <a class="btn" href="arquivos.php">Criar Canal</a>
        <a class="btn" href="usuarios.php">Usuários</a> 
        <a class="btn" href="usuarios_iptv.php">IPTV Usuários</a>
        <a class="btn" href="perfil.php">Perfil</a>
        <a class="btn" href="logout.php">Sair</a>
    </div>
</div>

<div class="container">

<div class="canais">

<?php while($c = $canais->fetch_assoc()): ?>

<?php
$ips = [];
if (!empty($log_linhas)) {
    foreach($log_linhas as $l){
        $p = explode("|", $l);
        if(count($p) < 2) continue;

        $ip = trim($p[0]);
        $url = trim($p[1]);

        // Verifica conexões para este canal específico
        if(strpos($url, "/live/canais/".$c['id']."/") !== false){
            $ips[$ip] = true;
        }
    }
}
$conexoes = count($ips);
?>

<div class="card">

<div id="view<?= $c['id'] ?>">
    <b><?= htmlspecialchars($c['nome']) ?></b><br>
    <button onclick="editarNome(<?= $c['id'] ?>)">Editar Nome</button>
</div>

<div id="edit<?= $c['id'] ?>" style="display:none;">
    <input type="text" id="nome<?= $c['id'] ?>" value="<?= htmlspecialchars($c['nome']) ?>">
    <button onclick="salvarNome(<?= $c['id'] ?>)">Salvar</button>
</div>

<br>

<?php if($c['status'] == 'on'): ?>
    Status: <span style="color:#00ff88;font-size:18px;">●</span> <b>ONLINE</b><br>
<?php else: ?>
    Status: <span style="color:#ff3b3b;font-size:18px;">●</span> <b>OFFLINE</b><br>
<?php endif; ?>
👥 Conexões: <?= $conexoes ?><br><br>

<button onclick="acao('start.php?id=<?= $c['id'] ?>')">▶ Start</button>
<button onclick="acao('stop.php?id=<?= $c['id'] ?>')">⏹ Stop</button>
<button onclick="acao('delete.php?id=<?= $c['id'] ?>')">Excluir</button>

<a class="btn" 
   href="/normalizar.php?canal=<?= urlencode($c['nome']) ?>" 
   target="_blank" 
   style="background:#8b5cf6; display:block; text-align:center; margin-top:5px; font-size:12px;">
   🛠 Normalizar
</a>

<br><br>

<small>http://<?= $host ?>/live/canais/<?= $c['id'] ?>/index.m3u8</small>

</div>

<?php endwhile; ?>

</div>

<!-- MONITOR -->
<div class="monitor">

<div class="line">
<span>CPU <b id="cpu_txt">0%</b></span>
<div class="bar"><div id="cpu_bar"></div></div>
</div>

<div class="line">
<span>RAM <b id="ram_txt">0%</b></span>
<div class="bar"><div id="ram_bar"></div></div>
</div>

<div class="line">
<span>DISK <b id="disk_txt">0%</b></span>
<div class="bar"><div id="disk_bar"></div></div>
</div>

<div class="line">
<span>UPLOAD <b id="up_txt">0 Mbps</b></span>
<div class="bar"><div id="up_bar"></div></div>
</div>

<div class="line">
<span>DOWNLOAD <b id="down_txt">0 Mbps</b></span>
<div class="bar"><div id="down_bar"></div></div>
</div>

<div class="line">
<span>CONEXÕES <b id="users_txt">0</b></span>
<div class="bar"><div id="users_bar"></div></div>
</div>

</div>

</div>

</body>
</html>

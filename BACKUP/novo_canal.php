<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Criar Canal 24H</title>

<style>
body { background:#0b0b0b; color:#fff; font-family:Arial; }
.box { padding:20px; }

.progress {
    width:100%;
    background:#222;
    border-radius:5px;
    overflow:hidden;
    margin-top:10px;
}

.progress-bar {
    height:20px;
    background:#ff2c2c;
    width:0%;
}
</style>
</head>

<body>

<div class="box">

<h2>🎬 Criar Canal 24H</h2>

<input type="text" id="nome" placeholder="Nome do canal"><br><br>

<input type="file" id="videos" multiple><br><br>

<button onclick="upload()">🚀 Criar Canal</button>

<div class="progress">
    <div class="progress-bar" id="bar"></div>
</div>

<div id="status"></div>

</div>

<script>
function upload(){

    let files = document.getElementById("videos").files;
    let nome = document.getElementById("nome").value;

    let formData = new FormData();

    for(let i=0;i<files.length;i++){
        formData.append("videos[]", files[i]);
    }

    formData.append("nome", nome);

    let xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", function(e){
        let percent = (e.loaded / e.total) * 100;
        document.getElementById("bar").style.width = percent + "%";
    });

    xhr.onload = function(){
        document.getElementById("status").innerHTML = xhr.responseText;
    };

    xhr.open("POST", "processa_canal.php", true);
    xhr.send(formData);
}
</script>

</body>
</html>

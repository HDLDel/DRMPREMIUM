<?php
require "config.php";

$dir = "videos/";

if(!is_dir($dir)){
    mkdir($dir,0777,true);
}

if(isset($_FILES['videos'])){

    $total = count($_FILES['videos']['name']);

    for($i=0; $i < $total; $i++){

        $nome = basename($_FILES['videos']['name'][$i]);
        $tmp  = $_FILES['videos']['tmp_name'][$i];

        if($tmp){

            $destino = $dir . time() . "_" . $nome;

            if(move_uploaded_file($tmp, $destino)){

                $stmt = $conn->prepare("INSERT INTO videos (nome,caminho) VALUES (?,?)");
                $stmt->bind_param("ss", $nome, $destino);
                $stmt->execute();

                echo "✅ $nome enviado<br>";
            }
        }
    }
}
?>

<h2>Upload Profissional</h2>

<form method="POST" enctype="multipart/form-data">
<input type="file" name="videos[]" multiple required>
<br><br>
<button>Enviar</button>
</form>

<br><br>
<a href="index.php">Voltar</a>

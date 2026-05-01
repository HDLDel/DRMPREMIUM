#!/bin/bash

# 1. Atualizar repositórios
sudo apt update && sudo apt upgrade -y

# 2. Instalar dependências básicas e FFmpeg
sudo apt install -y curl ffmpeg nginx git

# 3. Instalar Node.js 20 (LTS) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. Instalar dependências do projeto e PM2
npm install
sudo npm install -g pm2

# 5. Criar pastas necessárias com permissões corretas
mkdir -p canais 24HORAS
sudo chown -R $USER:$USER .

# 6. Configurar Nginx
ALERTA EM CAIXA ALTA: ESTE COMANDO COPIARÁ O ARQUIVO DE CONFIGURAÇÃO DO NGINX.
sudo cp nginx_iptv.conf /etc/nginx/sites-available/

ALERTA EM CAIXA ALTA: ESTE COMANDO CRIARÁ UM LINK SIMBÓLICO PARA HABILITAR A CONFIGURAÇÃO DO NGINX.
sudo ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/

ALERTA EM CAIXA ALTA: ESTE COMANDO REMOVERÁ A CONFIGURAÇÃO PADRÃO DO NGINX.
sudo rm -f /etc/nginx/sites-enabled/default

ALERTA EM CAIXA ALTA: ESTE COMANDO TESTARÁ A SINTAXE DA CONFIGURAÇÃO DO NGINX.
sudo nginx -t

ALERTA EM CAIXA ALTA: ESTE COMANDO REINICIARÁ O SERVIÇO NGINX PARA APLICAR AS NOVAS CONFIGURAÇÕES.
sudo systemctl restart nginx

# 7. Mensagem final
echo "-------------------------------------------------------"
echo "Instalação concluída!"
echo "O Nginx foi configurado e reiniciado."
echo "Para iniciar o servidor Node.js: pm2 start server.js --name iptv-pro"
echo "Para salvar a configuração do PM2 para iniciar automaticamente: pm2 save"
echo "-------------------------------------------------------"
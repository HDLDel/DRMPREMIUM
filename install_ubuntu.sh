#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "Este script precisa ser executado como root. Reexecutando com sudo..."
  exec sudo bash "$0" "$@"
fi

set -e

# 1. Atualizar repositórios
apt update && apt upgrade -y

# 2. Instalar dependências básicas e FFmpeg
apt install -y curl ffmpeg nginx git

# 3. Instalar Node.js 20 (LTS) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 4. Instalar dependências do projeto e PM2
npm install
npm install -g pm2

# 5. Criar pastas necessárias com permissões corretas
mkdir -p canais 24HORAS
chown -R $SUDO_USER:$SUDO_USER .

# 6. Configurar Nginx
cp nginx_iptv.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Criar arquivo de bloqueio de IPs se não existir
if [ ! -f /etc/nginx/blocked_ips.conf ]; then
  touch /etc/nginx/blocked_ips.conf
  echo "Arquivo /etc/nginx/blocked_ips.conf criado."
fi

nginx -t
systemctl restart nginx

# 7. Aplicar ajustes de desempenho do sistema
echo "Aplicando ajustes de desempenho..."
bash ajuste.sh

# 8. Iniciar aplicação com PM2
pm2 start server.js --name iptv-pro
pm2 save
pm2 startup

# 9. Mensagem final
echo "-------------------------------------------------------"
echo "Instalação concluída!"
echo "O sistema já está online."
echo "-------------------------------------------------------"

#!/bin/bash

# Este script atualiza a configuração do Nginx e reinicia o serviço.

# Verifica se o script está sendo executado como root
if [ "$EUID" -ne 0 ]; then
  echo "Por favor, execute este script com sudo."
  exit 1
fi

PROJDIR="$(cd "$(dirname "$0")/.." && pwd)"

# Copia o arquivo de configuração do Nginx para o diretório de sites-available
echo "Copiando nginx_iptv.conf para /etc/nginx/sites-available/"
cp "$PROJDIR/nginx_iptv.conf" /etc/nginx/sites-available/

# Cria um link simbólico para habilitar a configuração
echo "Habilitando a configuração do nginx_iptv.conf"
ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/

# Remove a configuração padrão do Nginx para evitar conflitos
echo "Removendo a configuração padrão do Nginx (se existir)"
rm -f /etc/nginx/sites-enabled/default

# Testa a sintaxe da configuração do Nginx e reinicia o serviço
echo "Testando a configuração do Nginx e reiniciando o serviço..."
nginx -t && systemctl restart nginx

echo "Nginx atualizado e reiniciado com sucesso!"
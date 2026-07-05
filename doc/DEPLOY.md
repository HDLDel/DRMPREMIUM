# Guia de Deploy

## Requisitos de Sistema

| Componente | Versao Minima | Recomendado |
|------------|--------------|-------------|
| Ubuntu | 20.04 | 22.04 / 24.04 |
| Node.js | 18.x | 20.x LTS |
| FFmpeg | 4.x | 6.x |
| Nginx | 1.18 | 1.24+ |
| RAM | 2GB | 4GB+ |
| Disco | 10GB livres | SSD |

## Instalacao Rapida (Ubuntu)

```bash
# Clone o repositorio
git clone <URL> /opt/drmpremium
cd /opt/drmpremium

# Torne o script executavel e execute
chmod +x install_ubuntu.sh
sudo ./install_ubuntu.sh

# Inicie o servidor
pm2 start server.js --name iptv-pro
pm2 save
```

O script instala: Node.js 20, FFmpeg, Nginx, bcryptjs, PM2.

## Instalacao Manual Passo a Passo

### 1. Dependencias do Sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ffmpeg nginx git
```

### 2. Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Projeto

```bash
git clone <URL> /opt/drmpremium
cd /opt/drmpremium
npm install
mkdir -p logs 24HORAS
sudo chown -R $USER:$USER .
```

### 4. Nginx

```bash
sudo cp nginx_iptv.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

### 5. PM2 (Producao)

```bash
sudo npm install -g pm2
pm2 start server.js --name iptv-pro
pm2 save
pm2 startup

# Visualizar logs
pm2 logs iptv-pro

# Monitorar
pm2 monit
```

## RAM Disk

O sistema usa `/dev/shm/iptv_canais` automaticamente. Verifique o espaco:

```bash
df -h /dev/shm
```

Se precisar aumentar o tamanho do RAM disk:

```bash
# Edite /etc/fstab
sudo mount -o remount,size=4G /dev/shm
```

## Variaveis de Ambiente

Nao ha variaveis obrigatorias, mas voce pode sobrescrever credenciais:

```bash
# Exemplo de variaveis para override futuro (ainda nao implementado)
ADMIN_USER=admin ADMIN_PASS=senha pm2 restart iptv-pro
```

## Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 8080/tcp   # Opcional (acesso direto ao Node)
sudo ufw enable
```

## SSL (HTTPS)

Recomendado usar Certbot + Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com
```

## Manutencao

### Verificar canais rodando

```bash
# Listar processos FFmpeg
ps aux | grep ffmpeg

# Verificar segmentos HLS
ls -lh /dev/shm/iptv_canais/
ls -lh /dev/shm/iptv_canais/1/

# Logs de acesso Nginx
tail -f /var/log/nginx/iptv_access.log

# Logs de erro Nginx
tail -f /var/log/nginx/iptv_error.log
```

### Backup

```bash
cp channels.json channels.json.bak
```

### Atualizar config Nginx

```bash
sudo ./update_nginx.sh
```

### Limpeza manual de logs

```bash
# Logs antigos sao removidos automaticamente a cada 48h,
# mas pode forçar:
rm -f logs/*.log
```

## Troubleshooting de Producao

### OOM Killer matou o FFmpeg

```bash
dmesg | tail -n 50 | grep -i oom
```
Se frequente, reduza `threads` no transcode ou aumente RAM.

### Nginx retornando 502

Node.js pode estar fora do ar:
```bash
pm2 status
pm2 logs iptv-pro --lines 20
```

### Disco cheio

Segmentos HLS ficam em RAM, mas logs podem crescer:
```bash
du -sh logs/
```

### Canal nao reinicia sozinho

Watchdog checa a cada 15s, tolerancia de 120s. Verifique o log:
```bash
cat logs/canal_5.log | tail -20
```

## Rolling Back

```bash
# Parar servidor
pm2 stop iptv-pro

# Restaurar channels.json
cp channels.json.bak channels.json

# Reiniciar
pm2 start iptv-pro
```

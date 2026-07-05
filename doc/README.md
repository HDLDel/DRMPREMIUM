# DRMPREMIUM — Documentacao do Sistema

**Servidor de canais IPTV 24 horas.** Converte pastas de videos MP4 em streams HLS ao vivo usando FFmpeg, servidos via Nginx com RAM disk. Painel web para gerenciar canais, monitorar CPU/RAM/disco/rede e exportar playlist M3U.

## Para quem e cada documento

| Documento | Publico | Conteudo |
|-----------|---------|----------|
| `ARCHITECTURE.md` | Devs senior | Decisoes tecnicas, fluxo de dados, diagrama |
| `API.md` | Devs integradores | Todos os endpoints REST com exemplos |
| `DEVELOPER.md` | Devs mantenedores | Documentacao de funcoes, classes, variaveis |
| `USER_GUIDE.md` | Usuarios finais | Manual do dashboard passo a passo |
| `DEPLOY.md` | DevOps/Sysadmins | Instalacao, configuracao, producao |

## Stack

- **Backend:** Node.js puro (http module)
- **Autenticacao:** bcrypt + cookie session (crypto.randomBytes)
- **Video:** FFmpeg (HLS, concat, transcode libx264)
- **Servidor web:** Nginx (proxy reverso + HLS segment serving)
- **Armazenamento:** RAM disk `/dev/shm` (segmentos), JSON (config)
- **Frontend:** HTML/CSS/JS vanilla, dark theme
- **Producao:** PM2 + systemd

## Estrutura de diretorios

```
DRMPREMIUM/
  server.js           → Servidor HTTP + API + FFmpeg + Watchdog
  index.html          → Dashboard admin
  login.html          → Tela de login
  script.js           → Frontend JS
  style.css           → Tema dark
  channels.json       → Banco de canais (JSON)
  playlist.txt        → Playlist concat de exemplo
  package.json        → Dependencia: bcryptjs
  nginx_iptv.conf     → Config Nginx
  install_ubuntu.sh   → Instalador Ubuntu
  update_nginx.sh     → Atualizar config Nginx
  logs/               → Logs FFmpeg por canal
  24HORAS/            → Pasta raiz de videos fonte
  doc/                → Esta documentacao
```

## Comandos rapidos

```bash
# Desenvolvimento
node server.js

# Producao com PM2
pm2 start server.js --name iptv-pro
pm2 save
pm2 startup

# Nginx
sudo cp nginx_iptv.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# Acesso
http://localhost:8080          — Dashboard
http://localhost:80            — Via Nginx (HLS + proxy)
http://localhost:80/playlist.m3u  — Playlist IPTV
```

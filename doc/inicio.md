# DRMPREMIUM — IPTV Pro / DRM PREMIUM 24 HORAS

## O Que e

Servidor de canais IPTV 24 horas. Converte pastas de videos MP4 em streams HLS ao vivo usando FFmpeg, servidos via Nginx com RAM disk. Painel web para gerenciar canais, monitorar CPU/RAM/disco/rede e exportar playlist M3U.

## Arquitetura

```
Nginx (porta 80)
  ├── /canais/{id}/index.m3u8  → Servido direto do RAM disk (/dev/shm/iptv_canais)
  └── /*                         → Proxy reverso para Node.js (porta 8080)

Node.js (server.js, porta 8080)
  ├── Autenticacao (cookie session + bcrypt)
  ├── API REST (canais, status, logs, M3U)
  ├── Gerenciamento FFmpeg (start/stop/restart)
  ├── Watchdog (a cada 15s, reinicia canais travados)
  └── Frontend SPA (HTML/CSS/JS)

FFmpeg (por canal)
  ├── Input: concat de MP4s ou HLS existente
  ├── Output: HLS segments (.ts) + playlist (.m3u8) em /dev/shm/iptv_canais/{id}/
  ├── Modos: transcode (libx264) ou copy (stream copy)
  └── Auto-restart: watchdog reinicia se sem update por 120s
```

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js puro (http module) |
| Auth | bcrypt + cookie session (crypto.randomBytes) |
| Video | FFmpeg (HLS, concat, transcode libx264) |
| Servidor web | Nginx (proxy reverso + HLS) |
| Armazenamento | RAM disk `/dev/shm` (segmentos), JSON (config) |
| Frontend | HTML/CSS/JS vanilla, dark theme |
| Producao | PM2 + systemd |

## Estrutura

```
DRMPREMIUM/
  ├── server.js              → Servidor HTTP + API + FFmpeg + Watchdog (tudo)
  ├── index.html             → Dashboard admin (stats, canais, acoes)
  ├── login.html             → Tela de login
  ├── script.js              → Frontend JS (polling, modais, M3U)
  ├── style.css              → Tema dark premium
  ├── channels.json          → Banco de canais (config em JSON)
  ├── playlist.txt           → Playlist concat de exemplo
  ├── package.json           → Dependencia: bcryptjs
  │
  ├── nginx_iptv.conf        → Config Nginx (proxy + HLS)
  ├── install_ubuntu.sh      → Instalador Ubuntu (Node, FFmpeg, Nginx, PM2)
  ├── update_nginx.sh        → Atualizar config Nginx
  │
  ├── logs/                  → Logs FFmpeg por canal (canal_{id}.log)
  ├── 24HORAS/               → Pasta raiz de videos fonte
  │
  ├── readme.md              → Notas e comandos diversos
  ├── TODO.md                → Analise e melhorias
  └── GEMINI.md              → Contexto para IAs
```

## Funcionalidades Principais

- **Canais 24/7** — cada canal = uma pasta de MP4s rodando em loop infinito via FFmpeg
- **Dashboard metrics** — CPU real, RAM, disco, rede, IO, streams ativos em tempo real
- **Discos SSD** — exibe uso de cada particao com barra de progresso
- **CRUD canais** — criar, editar, excluir canal com selecao de pasta fonte
- **Iniciar/Parar** — controle individual ou em massa (startAll/stopAll)
- **Modos de saida** — transcode (libx264, crf 28, 24fps) ou stream copy
- **Classificacao +18** — toggle por canal, filtro no dashboard
- **Exportar M3U** — playlist para players IPTV (download ou link)
- **Watchdog** — monitora atualizacao HLS a cada 15s, reinicia canal se parado >120s
- **Auto-start** — canais online sao reiniciados automaticamente ao subir o servidor
- **Limpeza de logs** — remove logs antigos (>48h) automaticamente
- **Segmentos em RAM** — HLS em `/dev/shm` (zero escrita em disco)
- **Validacao de video** — ffprobe checa integridade antes de incluir na playlist

## API Endpoints

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/login` | POST | Autenticacao (bcrypt) |
| `/api/logout` | POST | Logout |
| `/api/status` | GET | Metricas do sistema (CPU, RAM, disco, rede, etc) |
| `/api/channels` | GET | Lista canais com uptime |
| `/api/start` | POST | Iniciar canal (body: `{id}`) |
| `/api/stop` | POST | Parar canal (body: `{id}`) |
| `/api/startall` | POST | Iniciar todos offline |
| `/api/stopall` | POST | Parar todos ativos |
| `/api/createchannel` | POST | Criar canal |
| `/api/updatechannel` | POST | Editar canal |
| `/api/delete` | POST | Excluir canal |
| `/api/toggle18` | POST | Alternar marcacao +18 |
| `/api/logs` | GET | Log FFmpeg do canal (`?id=`) |
| `/api/videosources` | GET | Pastas de video disponiveis |
| `/playlist.m3u` | GET | Playlist M3U para IPTV |

## Autenticacao

Admins hardcoded em `server.js` (bcrypt):

| Usuario | Senha (hash) |
|---------|-------------|
| <ADMIN_EMAIL_PLACEHOLDER> | <REDACTED_PASSWORD> |
| <ADMIN_USER_PLACEHOLDER> | <REDACTED_PASSWORD> |

## Comandos Uteis

```bash
# Rodar
node server.js

# Producao PM2
pm2 start server.js --name iptv-pro
pm2 save
pm2 startup

# Nginx
sudo cp nginx_iptv.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# Acesso
http://localhost:8080          — Dashboard (redireciona para login)
http://localhost:80            — Via Nginx (HLS + proxy)
http://localhost:80/playlist.m3u  — Playlist IPTV
```

## Convencoes

- Backend: Node.js puro (sem frameworks), CommonJS (`require`)
- Frontend: HTML/CSS/JS vanilla, polling a cada 5s (stats) e 10s (canais)
- Canais: persistidos em `channels.json`, IDs reutilizaveis apos exclusao
- HLS: segmentos de 15s, lista de 6 segmentos, em RAM disk
- Watchdog: tolerancia de 120s sem atualizacao antes de reiniciar
- Logs: rotacao automatica a cada 48h

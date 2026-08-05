# DRMPREMIUM — Painel 24 Horas (IPTV)

Servidor de canais IPTV 24 horas. Converte pastas de vídeos MP4 em streams
HLS ao vivo usando FFmpeg, retransmite URLs externas (relay) e serve VOD
estático — tudo via Nginx com RAM disk. Painel web para gerenciar canais,
monitorar CPU/RAM/disco/rede, acompanhar segurança e exportar playlist M3U.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js puro (`http` module), CommonJS |
| Auth | bcrypt + cookie session (`crypto.randomBytes`) |
| Vídeo | FFmpeg (HLS, concat, transcode libx264, relay, VOD) |
| Servidor web | Nginx (proxy reverso + serve de HLS), porta 8081 |
| Armazenamento | RAM disk `/dev/shm/iptv_canais` (segmentos), JSON (config) |
| Frontend | HTML/CSS/JS vanilla, tema dark/light com toggle |
| Produção | PM2 (serviço `24horas`) |

## Documentação

| Documento | Público | Conteúdo |
|-----------|---------|----------|
| `doc/README.md` | Todos | Visão geral, instalação, deploy e operação |
| `doc/DEVELOPER.md` | Devs | Arquitetura, API completa e referência do código |
| `doc/USER_GUIDE.md` | Usuários finais | Manual do dashboard passo a passo |

## Estrutura do projeto

```
DRMPREMIUM/
  ├── server.js             → Servidor HTTP + API + FFmpeg + Watchdog
  ├── index.html            → Dashboard admin (abas P1 Canais / P2 Segurança)
  ├── login.html            → Tela de login
  ├── login.js              → Tema + submit do login
  ├── script.js             → Frontend JS (polling, modais, M3U, segurança)
  ├── style.css             → Tema dark/light (tokens Blue-600)
  ├── channels.json         → Banco de canais (config em JSON)
  ├── package.json          → Dependência: bcryptjs
  ├── nginx_iptv.conf       → Config Nginx (proxy + HLS)
  ├── install_ubuntu.sh     → Instalador Ubuntu
  ├── update_nginx.sh       → Reaplicar config Nginx
  ├── build-obfuscated.py   → Build ofuscado em DRMPREMIUM/
  ├── fonts/                → Fontes auto-hospedadas (VT323)
  ├── logs/                 → Logs FFmpeg por canal (canal_{id}.log)
  ├── 24HORAS/              → Pasta raiz de vídeos fonte
  ├── canais/               → Segmentos HLS
  ├── diagramas/            → Diagramas HTML de arquitetura/fluxo
  └── doc/                  → Documentação
```

## Funcionalidades

- **Canais 24/7** — cada canal roda em loop infinito via FFmpeg.
- **Modos de transmissão** (via modal "Alterar Modo" por canal):
  - `live` — pasta local de MP4s (concat) ou HLS pronto.
  - `vod` — VOD estático: converte a pasta para HLS de duração total.
  - `relay-loop` — fila de URLs externas sondadas via FFprobe; **zero CPU / zero disk**.
  - `relay-sync` — retransmissão sincronizada via FFmpeg (concat de URLs).
  - `offline` — canal desativado.
- **Dashboard metrics** — CPU real (diferencial), IO, RAM, disco, rede, streams ativos, com badges de tendência (▲/▼/~).
- **Cache Disco (nocache)** — card clicável que liga/desliga o `nocache` do ffmpeg.
- **CRUD de canais** — criar, editar, excluir, importar playlist M3U, copiar link M3U por canal.
- **Controle em massa** — iniciar/parar todos, limpar logs.
- **Classificação +18** — toggle por canal, filtro no dashboard.
- **Exportar M3U** — playlist para players IPTV (download ou link).
- **Watchdog** — monitora atualização HLS a cada 15s e reinicia canal parado (>60s).
- **Relay Guardian** — revive relay-sync offline a cada 15s.
- **Segurança** (aba P2) — tentativas de login, top IPs suspeitos, bloquear/desbloquear IP (Nginx deny + UFW), acessos aos canais via log do Nginx.
- **Auto-start** — canais online/relay são reiniciados ao subir o servidor.
- **Limpeza automática** — logs antigos (>12h), segmentos órfãos do tmpfs (30min).

## Comandos rápidos

```bash
# Desenvolvimento
node server.js

# Produção com PM2
pm2 start server.js --name 24horas
pm2 save
pm2 startup systemd -u root --hp /root

# Build de distribuição (ofusca server.js/script.js, minifica HTML/CSS)
python3 build-obfuscated.py   # → gera a pasta DRMPREMIUM/

# Nginx
sudo cp nginx_iptv.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# Acesso
http://localhost:8080            — Dashboard (redireciona para /login.html)
http://<IP>:8081                 — Via Nginx (proxy + HLS)
http://<IP>:8081/playlist.m3u    — Playlist IPTV
```

## Credenciais de acesso

Admins definidos em `server.js` (`ADMINS`, hashes bcrypt) e também
documentados aqui para operação:

| Usuário | Senha |
|---------|-------|
| `<ADMIN_EMAIL_PLACEHOLDER>` | `<REDACTED_PASSWORD>` |
| `<ADMIN_USER_PLACEHOLDER>` | `<REDACTED_PASSWORD>` |

A sessão é um único cookie `session_token` (regenerado a cada boot). Todos
os usuários compartilham a mesma sessão. Rotas públicas: `/login.html`,
`/playlist.m3u`, estáticos `.css`/`.js`, `/fonts/` e `/canais/`.

---

# Instalação (Ubuntu)

## Requisitos de sistema

| Componente | Versão mínima | Recomendado |
|------------|--------------|-------------|
| Ubuntu | 20.04 | 22.04 / 24.04 |
| Node.js | 18.x | 20.x LTS |
| FFmpeg | 4.x | 6.x |
| Nginx | 1.18 | 1.24+ |
| RAM | 2GB | 4GB+ |
| Disco | 10GB livres | SSD |

## Instalação rápida

```bash
git clone <URL> /opt/drmpremium
cd /opt/drmpremium
chmod +x install_ubuntu.sh
sudo ./install_ubuntu.sh
pm2 start server.js --name 24horas
pm2 save
```

O script instala: Node.js 20, FFmpeg, Nginx, bcryptjs, PM2; cria `logs/` e
`24HORAS/`; copia a config do Nginx; cria `/etc/nginx/blocked_ips.conf` e
`blocked_ips.json` vazios.

## Instalação manual

```bash
# 1. Dependências do sistema
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ffmpeg nginx git

# 2. Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Projeto
git clone <URL> /opt/drmpremium
cd /opt/drmpremium
npm install
mkdir -p logs 24HORAS canais
sudo chown -R $USER:$USER .

# 4. Nginx (escuta na porta 8081)
sudo cp nginx_iptv.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# 5. PM2
sudo npm install -g pm2
pm2 start server.js --name 24horas
pm2 save
pm2 startup systemd -u root --hp /root
```

## RAM disk

O sistema usa `/dev/shm/iptv_canais` automaticamente:

```bash
df -h /dev/shm
sudo mount -o remount,size=4G /dev/shm   # aumentar tamanho
```

---

# Deploy

## Deploy em TESTES (1.0.0.1)

O deploy de testes é feito pela skill `deploy-teste`:

```bash
# 1. Gerar o build (ofuscado/minificado) na pasta DRMPREMIUM/
python3 build-obfuscated.py

# 2. Executar o deploy (SSH/SFTP para 1.0.0.1)
python3 .agents/skills/deploy-teste/scripts/deploy.py
```

O script do deploy:
- Conecta via SSH em `1.0.0.1` como `root`.
- Envia o conteúdo de `DRMPREMIUM/` para `/root/24HORAS`.
- **Não substitui** `channels.json`, `node_modules/`, `24HORAS/`,
  `canais/` e `logs/` (preservam o estado do servidor).
- Instala dependências de produção e reinicia o PM2 `24horas`.

Servidor de testes: **http://1.0.0.1:8081** (Nginx, proxy para o
Node na porta 8080). Verificação após deploy:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://1.0.0.1:8081/login.html
curl -s http://1.0.0.1:8081/style.css | rg -o "#2563EB|#0D111D" | sort -u
ssh root@1.0.0.1 "pm2 status"
```

> **Regra:** nunca execute o deploy sem confirmação explícita do usuário
> (a skill `deploy-teste` também exige isso).

## Deploy em PRODUÇÃO

Processo equivalente ao de testes, apontando para o servidor de produção
e atualizando o serviço PM2 `24horas` na VPS alvo. O build ofuscado
(`DRMPREMIUM/`) é a fonte de upload — nunca enviar o repositório bruto.

Arquivos do build que **não devem ser substituídos** no destino:
`channels.json` (estado dos canais), `node_modules/`, `24HORAS/` (vídeos),
`canais/` (segmentos), `logs/`.

## Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 8081/tcp      # Nginx
sudo ufw allow 8080/tcp      # Opcional: acesso direto ao Node
sudo ufw allow 22/tcp        # SSH
sudo ufw enable
```

## SSL (HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com
```

---

# Operação e manutenção

```bash
# Listar processos FFmpeg
ps aux | grep ffmpeg

# Verificar segmentos HLS
ls -lh /dev/shm/iptv_canais/
ls -lh /dev/shm/iptv_canais/1/

# Logs do serviço
pm2 logs 24horas

# Backup do estado de canais
cp channels.json channels.json.bak

# Reaplicar config Nginx
sudo ./update_nginx.sh
```

## Troubleshooting

| Problema | Causa provável | Solução |
|----------|---------------|---------|
| Nginx 502 | Node fora do ar | `pm2 status && pm2 logs 24horas --lines 20` |
| OOM matou FFmpeg | Falta de RAM | `dmesg | grep -i oom`; reduza `threads` ou aumente RAM |
| Canal não reinicia | Video corrompido / falta CPU | Watchdog reinicia em ~1min; veja `logs/canal_5.log` |
| "moov atom not found" | MP4 corrompido | Remova ou reconverta o arquivo |
| Disco cheio | Logs podem crescer | `du -sh logs/`; limpe via dashboard ("Limpar Logs") |
| Playlist não atualiza | Nginx proxy errado | Confira `nginx_iptv.conf` (listen 8081, `/canais/` para Node) |

## Rolling back

```bash
pm2 stop 24horas
cp channels.json.bak channels.json
pm2 start 24horas
```

## Convenções

- Backend: Node.js puro (sem frameworks), CommonJS (`require`).
- Frontend: HTML/CSS/JS vanilla, polling 5s (stats) e 10s (canais).
- Canais: persistidos em `channels.json`, IDs reutilizáveis após exclusão.
- HLS: segmentos de 15s, `hls_list_size` 10, em RAM disk.
- Watchdog: checagem a cada 15s, tolerância de 60s sem update.
- Limpeza de logs: 12h; limpeza de tmpfs: 30min.

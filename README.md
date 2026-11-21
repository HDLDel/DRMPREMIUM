# DRMPREMIUM — Painel 24 Horas (IPTV)

Servidor de canais IPTV 24 horas. Converte pastas de vídeos MP4 em streams HLS
ao vivo com FFmpeg, retransmite URLs externas (relay) e serve VOD estático —
tudo via Nginx com RAM disk. O painel web permite gerenciar canais, monitorar
CPU/RAM/disco/rede, acompanhar a segurança e exportar playlist M3U.

## Visão geral

- **Canais 24/7** em loop infinito via FFmpeg.
- **6 modos de transmissão** para diferentes cenários (pasta local, VOD,
  retransmissão e variações com cache).
- **Dashboard em tempo real** com métricas de CPU, RAM, disco, I/O, rede e
  streams ativos.
- **Playlist M3U** pronta para VLC, TiviMate, IPTV Smarters, Kodi etc.
- **Watchdog e auto-start** — canais reiniciam sozinhos após falha ou reboot.
- **Painel de segurança** com registro de login e bloqueio de IPs suspeitos.

## Stack

| Camada | Tecnologia |
| ------ | ---------- |
| Backend | Node.js puro (`http` module), CommonJS |
| Auth | bcrypt + cookie de sessão (`crypto.randomBytes`) |
| Vídeo | FFmpeg (HLS, concat, transcode libx264, transmux) |
| Servidor web | Nginx (proxy reverso + HLS), porta 8081 |
| Armazenamento | RAM disk `/dev/shm/iptv_canais` (segmentos) + JSON |
| Frontend | HTML/CSS/JS vanilla, tema dark/light |
| Produção | PM2 (serviço `24horas`) |

## Modos de transmissão

| Modo | CPU por canal | RAM por canal | Disco | Fonte |
| ---- | ------------- | ------------- | ----- | ----- |
| **Ao Vivo** (`live`) | 1–2% | ~80 MB | Temporário (RAM disk) | Pasta local MP4 |
| **VOD** (`vod`) | ~0% (após conversão) | ~0% | Fixo (RAM disk) | Pasta local MP4 |
| **Relay Sync** (`relay-sync`) | 1–2% | ~80 MB | Temporário | URLs externas |
| **Relay Loop** (`relay-loop`) | ~0% + 1%/viewer | ~20 MB/viewer | Nenhum | URLs externas |
| **Loop-Cache** (`relay-loop-cache`) | 1–2% | ~80 MB | Vídeos no servidor | URLs externas (download) |
| **Sync-Cache** (`relay-sync-cache`) | 1–2% | ~80 MB | Vídeos no servidor | URLs externas (download) |

> **Exemplo:** 10 canais ao vivo ≈ 10–20% de CPU e 800 MB de RAM.
> 10 canais relay-loop com 5 viewers cada ≈ 50% de CPU e 1 GB de RAM.

- **Ao Vivo** — concatena os MP4 da pasta em loop e gera segmentos HLS a cada
  15s. Custo fixo por canal, não por viewer.
- **VOD** — converte a pasta em um único vídeo longo, assistível do início ao
  fim, sem loop. Consome quase zero CPU depois de pronto.
- **Relay Sync** — retransmite links externos com um FFmpeg compartilhado; todos
  os viewers veem o mesmo fluxo.
- **Relay Loop** — um FFmpeg leve por viewer, criado sob demanda. Custo zero em
  repouso; ideal para poucos espectadores simultâneos.
- **Loop-Cache / Sync-Cache** — baixam os vídeos para o servidor e os transmitem
  em loop; o Sync-Cache mantém a posição original da transmissão.

## Funcionalidades

- CRUD de canais: criar, editar, excluir, importar playlist M3U e copiar link
  M3U por canal.
- Controle em massa: iniciar/parar todos e limpar logs.
- Classificação +18 por canal, com filtro no dashboard.
- Cache Disco: card clicável que liga/desliga o `nocache` do FFmpeg.
- Badges de tendência (▲/▼/~) nas métricas.
- Relay Guardian: monitora canais relay offline e tenta reiniciá-los.
- Limpeza automática de logs antigos (>12h) e segmentos órfãos do tmpfs (30min).
- Tema claro/escuro com preferência salva no navegador.

## Requisitos

| Componente | Mínimo | Recomendado |
| ---------- | ------ | ----------- |
| Ubuntu | 20.04 | 22.04 / 24.04 |
| Node.js | 18.x | 20.x LTS |
| FFmpeg | 4.x | 6.x |
| Nginx | 1.18 | 1.24+ |
| RAM | 2 GB | 4 GB+ |
| Disco | 10 GB livres | SSD |

## Instalação rápida (Ubuntu)

```bash
git clone <URL_DO_REPOSITORIO> /opt/drmpremium
cd /opt/drmpremium
chmod +x scripts/install_ubuntu.sh
sudo ./scripts/install_ubuntu.sh

# Ajuste de rede anti-travamento (troque pela sua interface: ip link)
sudo ./scripts/server-tuning/install.sh --interface <INTERFACE_REDE>
sudo reboot
```

O script de instalação instala Node.js 20, FFmpeg, Nginx, PM2 e dependências;
cria as pastas `logs/` e `24HORAS/`; copia a config do Nginx e prepara os
arquivos de bloqueio de IP.

Para rodar em desenvolvimento:

```bash
npm install
npm start          # node server.js → http://localhost:8080
```

## Acesso

Após a instalação, abra `http://<IP_DO_SERVIDOR>:8081` e entre com as
credenciais definidas pelo administrador.

> As contas de administrador são configuradas no deploy como hashes bcrypt em
> `server.js`. Nenhuma credencial padrão é versionada neste repositório.

- Dashboard: `http://<IP_DO_SERVIDOR>:8081`
- Playlist IPTV: `http://<IP_DO_SERVIDOR>:8081/playlist.m3u`

No primeiro acesso: coloque os vídeos em `24HORAS/`, configure os canais e use
**Iniciar Todos** no dashboard.

### Comandos rápidos

```bash
# Produção
pm2 start server.js --name 24horas
pm2 save

# Build de distribuição (ofusca/minifica em DRMPREMIUM/)
npm run obfuscate

# Nginx
sudo cp nginx_iptv.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# Operação
pm2 logs 24horas
df -h /dev/shm
```

## Estrutura

```
DRMPREMIUM/
  ├── server.js             → HTTP + API + FFmpeg + Watchdog
  ├── index.html            → Dashboard (P1 Canais / P2 Segurança)
  ├── login.html / login.js → Tela de login e tema
  ├── script.js / style.css → Frontend e tema dark/light
  ├── channels.json         → Estado dos canais
  ├── nginx_iptv.conf       → Proxy reverso + HLS
  ├── scripts/              → Instalação, nginx, crons e build
  ├── scripts/server-tuning/→ Tuning de rede
  ├── 24HORAS/              → Vídeos fonte
  ├── canais/               → Segmentos HLS
  └── doc/                  → Documentação
```

## Documentação

| Documento | Conteúdo |
| --------- | -------- |
| [doc/README.md](doc/README.md) | Visão geral, instalação, deploy e operação |
| [doc/DEPLOY.md](doc/DEPLOY.md) | Sequência de instalação em máquina nova e scripts |
| [doc/USER_GUIDE.md](doc/USER_GUIDE.md) | Manual do dashboard para usuários finais |
| [doc/DEVELOPER.md](doc/DEVELOPER.md) | Arquitetura, API completa e referência |
| [doc/SERVER_TUNING.md](doc/SERVER_TUNING.md) | Tuning de rede anti-travamento |
| [doc/architecture.html](doc/architecture.html) | Diagrama visual de arquitetura |

# DESENVOLVIMENTO — DRMPREMIUM

Arquitetura, API e referência do código do Painel 24 Horas.

Tamanhos atuais: `server.js` ~3580 linhas, `script.js` ~1852 linhas,
`login.js` 73 linhas, `index.html` 465 linhas, `style.css` ~1839 linhas.

---

# 1. Arquitetura

## Visão geral

```
Internet
  │
  ▼
Nginx (porta 8081)
  ├── /canais/{id}/... → Node.js (decide: relay dinâmico, live/VOD do filesystem/RAM)
  └── /*               → Proxy reverso para Node.js (porta 8080)
                            │
                            ▼
                    Node.js (server.js)
                      ├── Auth (bcrypt + cookie session)
                      ├── API REST (30 rotas)
                      ├── Gerenciamento FFmpeg (live/relay/vod)
                      ├── Watchdog (15s) + Relay Guardian
                      ├── Segurança (login-attempts, blocked IPs, nginx-access)
                      └── Serve estático (index.html, login.html, etc.)
                            │
                            ▼
                    FFmpeg (por canal)
                      ├── Input: concat de MP4s, HLS pronto, URLs externas (relay)
                      └── Output: HLS em /dev/shm/iptv_canais/{id}/
```

## Fluxo de dados

### Criação de canal (live)

1. Usuário preenche modal (modo PASTA LOCAL ou RELAY).
2. `script.js` → `POST /api/createchannel` → `server.js`.
3. Modo `live`: escaneia a pasta fonte; se houver `index.m3u8` usa HLS
   pronto (`inputType: 'hls'`); senão lista MP4s recursivamente, valida
   com `ffprobe`, gera `playlist.txt`.
4. Modo `relay`: salva `relayUrls`; para `relay-sync` gera
   `playlist_urls.txt` (concat de URLs); para `relay-loop` usa
   `inputType: 'relay'`.
5. Salva em `channels.json` e retorna o canal.

### Início de transmissão (`startChannel`)

1. Cria/limpa `outputDir` no RAM disk (remove `.ts`, `.m3u8`, `.tmp`).
2. Se concat (não-relay): re-gera `playlist.txt` na RAM a partir da pasta.
3. Sonda URLs via FFprobe para relay-loop (`relayUrlProbed`/`relayUrlDurations`).
4. Monta args do FFmpeg (transcode vs copy vs relay).
5. `spawn(ffmpeg, args)`; stderr → `logs/canal_{id}.log`.
6. Registra em `activeStreams` (Map), marca canal `online`/`relay`.

### Watchdog (a cada 15s)

- Para cada stream ativo: se `index.m3u8` sem atualização há **>60s**,
  registra no log, salva posição estimada do playlist, `SIGKILL`,
  remove de `activeStreams` e reinicia após 2s.
- **Relay Guardian**: relay-sync sem FFmpeg ativo e não offline é marcado
  offline; offline é reiniciado após 2s.

### Limpeza (intervalos)

- Logs antigos: a cada 12h remove `logs/*.log` com mtime > 12h.
- tmpfs: a cada 30min remove segmentos órfãos.

---

## Decisões técnicas

### RAM disk para segmentos HLS

- Path: `/dev/shm/iptv_canais/`. Evita desgaste do SSD com escritas
  constantes de segmentos `.ts`. Tradeoff: limitado à RAM disponível.

### Modos de saída: Transcode vs Copy

| Modo | Flag | Uso CPU | Estabilidade | Uso recomendado |
| ---- | ---- | ------- | ------------ | --------------- |
| Copy | `useTranscode=false` | Baixo | Média | Vídeos com codecs homogêneos |
| Transcode | `useTranscode=true` | Alto | Alta | Vídeos com codecs/FPS variados |

Transcode usa libx264, 24fps, CRF 28, 1 thread, `ultrafast` — prioriza
estabilidade sobre qualidade.

### Por que Node.js puro (sem frameworks)

Zero dependências além do `bcryptjs`; ideal para recursos limitados;
arquivo único facilita deploy e debug.

### Autenticação via sessão estática

- `SESSION_ID` gerado no startup via `crypto.randomBytes(32)`.
- Cookie `session_token` (HttpOnly, SameSite=Lax) válido até reiniciar.
- Todos os usuários compartilham a mesma sessão.
- Admins hardcoded com hashes bcrypt em `ADMINS`.

### nocache

- Binário `/usr/bin/nocache` (se presente) prefixa o FFmpeg para evitar
  cache de disco. Estado persistido no flag `.nocache` (na pasta do app).

---

## Convenções de código

| Aspecto | Convenção |
| ------- | --------- |
| Backend | Node.js puro, CommonJS (`require`) |
| Frontend | HTML/CSS/JS vanilla |
| Polling | Stats 5s, canais 10s |
| Canais | Persistidos em `channels.json`, IDs reutilizáveis |
| HLS | Segmentos de 15s, `hls_list_size` 10 |
| Watchdog | Tolerância de 60s sem update |
| Logs | Rotação a cada 12h |
| Ícones | SVG inline (`.svgIcon`/`ICON_PATHS`), nunca emoji |

---

# 2. API Reference

Base URL: `http://<host>:8080` (Node direto) ou `http://<host>:8081`
(via Nginx). Rotas públicas (sem cookie): `/api/login`, `/api/logout`,
`/playlist.m3u`, `/login.html`, estáticos `.css`/`.js`, `/fonts/`,
`/canais/`. Todas as demais `/api/*` retornam **401** sem
`session_token`.

## Autenticação

### POST /api/login

```json
{"user": "<ADMIN_USER_PLACEHOLDER>", "pass": "<REDACTED_PASSWORD>"}
```

**200:** `{"status":"success"}` — define cookie `session_token`.
**401:** `{"status":"error"}`. Cada tentativa é registrada em
`loginAttempts` (ip, user, success, userAgent, timestamp; máx. 500).

### POST /api/logout

**200:** `{"status":"logged_out"}` — remove a sessão.

---

## Sistema / Status

### GET /api/status

```json
{
  "cpu": 45, "io": 12, "ram": 67, "disco": 34, "rede": "2.45",
  "uptime": 3600,
  "activeStreams": 3,
  "nocache": true,
  "disks": [{"filesystem": "/dev/sda1", "size": "100G", "used": "40G", "avail": "60G", "usePercent": "40%", "mounted": "/"}]
}
```

| Campo | Descrição |
| ----- | --------- |
| cpu | % CPU real (diferencial, estilo htop) |
| io | Load avg escalado pelo nº de cores |
| ram | % RAM em uso |
| disco | % do disco raiz usado |
| rede | Taxa de envio em Mbps (média desde última leitura) |
| uptime | Segundos desde boot do servidor |
| activeStreams | Canais `online` + `relay` |
| nocache | Estado do cache de disco |
| disks | Partições físicas com uso detalhado |

---

## Canais

### GET /api/channels

Lista canais com uptime calculado:

```json
[{"id": 1, "name": "teste", "status": "relay", "mode": "relay",
  "relaySubtype": "sync", "is18": false, "useTranscode": false,
  "uptime": 5400, "currentUrlIndex": 0, "relayUrls": ["http://..."],
  "sourceFolder": "", "playlistFilePath": "/dev/shm/iptv_canais/1/playlist_urls.txt"}]
```

### POST /api/createchannel

```json
{"channelName": "Meu Canal", "sourceFolderName": "Filmes_Acao",
 "useTranscode": false, "is18": false, "mode": "live",
 "sourceUrl": "", "relaySubtype": null, "relayUrls": []}
```

- `mode: "live"` → usa `sourceFolderName` (subpasta de `24HORAS/`, caminho
  absoluto, ou `"."` para a raiz). Detecta HLS pronto (`index.m3u8`) ou gera
  playlist de MP4s.
- `mode: "relay"` → exige `relayUrls` (array) ou `sourceUrl` (string);
  `relaySubtype` `"sync"` (concat de URLs) ou `"loop"` (inputType `relay`).
- Usa o menor ID inteiro disponível (reutiliza IDs excluídos).
- **400:** caminho não existe; nenhum vídeo válido; sem URLs de relay.

### POST /api/updatechannel

Edita canal (deve estar parado):

```json
{"id": 5, "channelName": "Novo Nome", "sourceFolderName": "OutraPasta",
 "useTranscode": true, "is18": true}
```

**400** se o canal estiver rodando: `"Pare o canal antes de editá-lo."`

### POST /api/delete

```json
{"id": 5}
```

**200:** `{"status":"deleted"}`. Remove registro, RAM disk e log do canal
(após delay). Exige canal parado.

### POST /api/toggle18

```json
{"id": 1}
```

**200:** `{"status":"success","is18":true}`

---

## Controle de transmissão

### POST /api/start

```json
{"id": 1}
```

**200:** `{"status":"success","pid":12345}` · **400:** "Canal já rodando"

### POST /api/stop

```json
{"id": 1}
```

**200:** `{"status":"stopped"}` (SIGKILL)

### POST /api/startall / /api/stopall

**200:** `{"status":"success","started":["..."]}` /
`{"status":"success","stopped":["..."]}`

### POST /api/switch-mode

Troca o modo sem recriar o canal:

```json
{"id": 1, "newMode": "offline" | "live" | "vod" | "relay-loop" | "relay-sync"}
```

- `offline`: para e marca offline.
- `vod`: converte pasta para HLS VOD em `/home/drmpremium/hls_pronto/{id}/`
  (reconverte se não existir) e marca `status: 'vod'`.
- `relay-loop`: exige `relayUrls`; marca `mode:relay, relaySubtype:loop`.
- `relay-sync`/`live`: inicia; para relay-sync escreve `playlist_urls.txt`.
- **400:** playlist não encontrada para VOD; canal sem URLs; modo inválido.

### POST /api/toggle-vod

Alterna VOD ↔ live sem reconverter (usa flag `.vod_{id}`):

```json
{"id": 1}
```

**200:** `{"status":"success","mode":"vod"|"live", ...}`

### POST /api/convert

Converte canal para VOD estático em `/home/drmpremium/hls_pronto/{id}/`
(se já existir `index.m3u8`, só ativa o modo).

### POST /api/relay-advance

Avança manualmente o índice de um relay-loop:

```json
{"id": 1}
```

**200:** `{"status":"success","currentIndex":2}`

---

## Logs e utilitários

### GET /api/videosources

Lista pastas de vídeo disponíveis dentro de `24HORAS/`:

```json
[".", "Filmes_Acao", "Series", "Filmes_Acao/Subpasta"]
```

### GET /api/logs?id={id}

Últimos 5KB do log FFmpeg do canal. **200** `text/plain`.

### POST /api/clear-logs

Esvazia todos os `logs/*.log`. **200:** `{"status":"success","count":N}`

### GET /api/relay-m3u-files

Lista arquivos `.m3u`/`.m3u8` em `/home/drmpremium/`:

```json
["canais.m3u", "lista.m3u8"]
```

### GET /api/read-m3u?file={nome}

Extrai URLs http/https de um `.m3u` (usa `path.basename` — sem path
traversal). **200:** `{"urls":["http://..."]}` · **404:** arquivo não existe.

### GET /api/nocache-status

**200:** `{"nocache": true|false}`

### POST /api/toggle-nocache

Inverte o flag `.nocache` (cria/remove). **200:** `{"nocache":true}`

---

## Segurança (aba P2)

### GET /api/login-attempts

Últimas 200 tentativas:

```json
[{"ip": "1.0.0.1", "user": "admin", "success": false,
  "userAgent": "curl/8.0", "timestamp": "2026-01-01T00:00:00.000Z"}]
```

### GET /api/top-attackers

IPs agregados por total de tentativas (ordem decrescente):

```json
[{"ip": "1.0.0.1", "total": 50, "fails": 48, "successes": 2, "lastAttempt": "..."}]
```

### GET /api/blocked-ips

```json
["1.0.0.1", "1.0.0.1"]
```

### POST /api/block-ip / /api/unblock-ip

```json
{"ip": "1.0.0.1"}
```

Persiste em `/etc/nginx/blocked_ips.json`, gera `/etc/nginx/blocked_ips.conf`
(`deny <ip>;`), reload do Nginx e aplica `ufw deny from <ip>`.
**200:** `{"status":"success","ip":"1.0.0.1"}`

### GET /api/nginx-access

Agregados do `/var/log/nginx/iptv_access.log`:

```json
[{"ip": "1.0.0.1", "totalHits": 100, "firstSeen": "...", "lastSeen": "...",
  "channels": [{"id": 1, "hits": 90, "lastAccess": "..."}]}]
```

### GET /api/nginx-access/stats

Resumo: `{"totalIPs": 10, "totalRequests": 500, "topChannels": [{"id":1,"hits":300}]}`

---

## Público

### GET /playlist.m3u

Gera playlist M3U com todos os canais (`http://host/canais/{id}/index.m3u8`),
`Content-Disposition: attachment`.

### GET /canais/{id}/{arquivo}

Handler de relay/live/VOD: relay-loop serve playlist dinâmica de URLs;
live/VOD servem do filesystem/RAM disk.

---

# 3. Referência do código

## server.js (Node, ~3580 linhas)

### Constantes globais

| Constante | Valor | Descrição |
| --------- | ----- | --------- |
| `PORT` | 8080 | Porta do servidor HTTP |
| `CHANNELS_DIR` | `/dev/shm/iptv_canais` | RAM disk para HLS |
| `VIDEO_SOURCE` | `path.join(__dirname, '24HORAS')` | Pasta raiz de vídeos |
| `LOGS_DIR` | `path.join(__dirname, 'logs')` | Logs FFmpeg por canal |
| `NGINX_LOG` | `/var/log/nginx/iptv_access.log` | Log de acesso Nginx |
| `FFMPEG_PATH` | `ffmpeg` | Binário do FFmpeg |
| `NOCACHE` | `/usr/bin/nocache` | Wrapper anti-cache (opcional) |
| `NOCACHE_FLAG` | `path.join(__dirname, '.nocache')` | Flag do nocache |
| `SESSION_ID` | `crypto.randomBytes(32)` | Token de sessão (regenerado no boot) |
| `ADMINS` | `[{user, hash}]` | Credenciais bcrypt hardcoded |
| `BLOCKED_IPS_FILE` | `/etc/nginx/blocked_ips.json` | IPs bloqueados |
| `START_BATCH_SIZE` | 10 | Canais por lote no start em massa |
| `START_BATCH_DELAY_MS` | 500 | Pausa entre lotes (ms) |

### Variáveis globais

| Variável | Tipo | Descrição |
| -------- | ---- | --------- |
| `channels` | `Array<Channel>` | Configurações dos canais (JSON) |
| `activeStreams` | `Map<number,{process,startedAt}>` | FFmpeg ativos |
| `relayTransmuxProcs` | `Map<number,ChildProcess[]>` | FFmpeg transmux on-the-fly por canal |
| `relayCacheState` | `Map<number,{active:boolean,errors:number}>` | Estado do cache de relay |
| `relayCacheProcs` | `Map<number,ChildProcess>` | FFmpeg de relay-cache por canal |
| `loginAttempts` | `Array` | Registro de tentativas (máx. 500) |
| `blockedIPs` | `Set<string>` | IPs bloqueados |
| `nginxAccessData` | `Map<ip,{channels,totalHits,...}>` | Acessos via log Nginx |
| `relayLoopTimers` | `Map<number,Timeout>` | Timers de avanço do relay-loop |
| `channelPlaylistState` | `Map` | Posição estimada do playlist |

### Funções principais

| Função | Descrição |
| ------ | --------- |
| `getCpuTimes()` / `getRealCpuUsage()` | CPU diferencial estilo htop |
| `getCookies(req)` | Parse do header Cookie |
| `loadChannels()` / `saveChannels()` | I/O do `channels.json` |
| `getDirectoriesRecursive(base, root)` | Lista subpastas (usa realpath) |
| `getFilesRecursive(dir, extension)` | Lista arquivos, filtra 0 bytes |
| `isVideoValid(filePath)` | `ffprobe -v error ...`; true se exit 0 |
| `getDiskUsage()` | `df / --output=pcent` |
| `getNetworkUsage()` | `/proc/net/dev`, diferencial em Mbps |
| `getDiskSpaceDetails()` / `getDiskSpaceDetailsCached()` | Cache 60s |
| `getSystemStats()` | Agrega tudo para `/api/status` (inclui `nocache`, `ffmpegCount`) |
| `countFfmpegProcesses()` | Conta processos FFmpeg ativos no sistema |
| `startChannel(id)` | Fluxo completo de início |
| `delay(ms)` | Pausa entre lotes no start em massa (throttle de rede) |
| `startRelayLoop(channel)` | Relay loop puro: playlist virtual + transmux on-the-fly |
| `startRelayCached(channel)` | Relay cache: download + transmissão compartilhada |
| `handleRelayLoopFailure(channelId, req, res, startTime, err)` | Resposta 502 graceful |
| `recordLoginAttempt(ip, user, success, userAgent)` | Segurança |
| `loadBlockedIPs()` / `saveBlockedIPs()` | IPs + geração do `blocked_ips.conf` |
| `parseNginxAccessLog()` | Lê o access log do Nginx em streaming |
| `probeUrlDuration(url)` | FFprobe de URL externa para relay-loop |
| `scheduleRelayLoop(channel)` / `advanceRelayLoop(...)` | Fila do relay |
| `getRelayFlagPaths` / `hasRelayFlag` / `setRelayFlag` | Flags `.relay_{id}` |
| `getVodFlagPaths` / flags `.vod_{id}` | Flags VOD |
| `estimateFileIndex(id, totalFiles)` | Posição aproximada no playlist |
| `trackRelayTransmux(id, proc)` / `killRelayTransmuxProcs(id)` | Gerencia transmux on-the-fly |
| `sweepDeadRelayTransmuxProcs()` | Limpeza periódica de processos mortos |
| `clearRelayLoopState(id)` | Mata transmux + limpa state do relay-loop |

### Roteamento (30 rotas + estático)

Lista completa na seção API acima. Todas as APIs protegidas por cookie;
estáticos servidos de `__dirname` com whitelist `/fonts/` e `/canais/`.
Páginas não autenticadas recebem 302 → `/login.html`.

### Watchdog e limpezas

- `setInterval(15000)`: watchdog de `index.m3u8` (60s de tolerância) +
  Relay Guardian para relay-sync (com pausa após 5 falhas consecutivas).
- `setInterval(5min)`: sweep de processos transmux mortos (`sweepDeadRelayTransmuxProcs`).
- `setInterval(12h)`: remove logs com mtime > 12h.
- `setInterval(30min)`: limpa segmentos órfãos do tmpfs.

### Start em massa (throttle de rede)

Quando todos os canais sobem juntos (reboot ou "Iniciar Tudo"), os FFmpeg
disparam a mesma rajada de rede ao mesmo tempo — isso esgota os buffers do
10Gbps e causa retransmissões em massa (os "pequenos travamentos" na
assinatura `TcpRetransSegs` em milhões).

Para suavizar, o start em massa opera em **lotes com espera**:

- `START_BATCH_SIZE = 10` canais por lote.
- O lote **termina por completo** antes do próximo começar.
- Entre lotes há `START_BATCH_DELAY_MS = 500ms` de pausa.

Resultado: 590 canais sobem em ~59 lotes, com a rede consumida de forma
gradual em vez de tudo de uma vez. Isso vale para os 3 pontos de entrada:

1. `/api/startall` — usa `await Promise.all` por lote + `delay()` entre lotes.
2. Auto-start do boot (Live/RelaySync) — idem.
3. Auto-start do boot (Relay Loop e Loop-Cache) — antes era disparo
   sequencial sem espera; agora usa o mesmo esquema de lotes com espera.

**Nota**: o start de um canal isolado (botão individual, reinício do
Watchdog/Guardian via `scheduleRelayRestart`) **não passa** por essa fila e
continua imediato — canal que cai sozinho volta normalmente.

### Tuning de rede do servidor (O.S.)

O throttle do código (seção acima) reduz a rajada, mas o sistema operacional
também precisa de ajustes para não descartar pacotes quando o pico chega:
**RPS nas filas de RX (rede espalhada por todos os cores)**, filas do kernel
maiores (`somaxconn`, `netdev_max_backlog`) e nginx com `backlog=4096` +
`worker_connections`/`multi_accept`.

Detalhes, valores e o instalador idempotente (`scripts/server-tuning/install.sh`) em
→ **[`doc/SERVER_TUNING.md`](./SERVER_TUNING.md)**.

### `-rw_timeout` no FFmpeg relay

Canais relay leem URL(s) externa(s). Se a fonte travar sem entregar dados:

- antes: o FFmpeg podia ficar preso para sempre (consumindo recursos e
  mantendo retransmissões longas);
- agora: `-rw_timeout 30000000` (30s) encerra o processo sozinho, em conjunto
  com o `-reconnect` que já existia. Aplicado no canal comum (`startChannel`)
  e no transcoder do relay-cache.

---

## Tipos de Canal — Visão técnica

### Modos de transmissão

| Modo | `mode` | `relaySubtype` | FFmpeg por canal | CPU por canal | RAM por canal |
| ---- | ------ | -------------- | ---------------- | ------------- | ------------- |
| Ao Vivo | `live` | — | 1 (compartilhado) | 1-2% (copy) / 30-40% (transcode) | ~80 MB |
| VOD | `vod` | — | 1 (compartilhado) | 30-40% (conversão), depois ~0% | ~80 MB |
| Relay Sync | `relay` | `sync` | 1 (compartilhado) | 1-2% | ~80 MB |
| Relay Loop | `relay` | `loop` | 1 por viewer (transmux) | ~0% repouso, ~1%/viewer | ~20 MB/viewer |
| Relay Loop-Cache | `relay` | `loop-cache` | 1 (compartilhado) | 1-2% | ~80 MB |
| Relay Sync-Cache | `relay` | `sync-cache` | 1 (compartilhado) | 1-2% | ~80 MB |
| Offline | `offline` | — | 0 | 0% | 0 MB |

### Fluxo de dados por modo

**Ao Vivo (`live`):**
`24HORAS/{pasta}/*.mp4` → playlist concat → FFmpeg concat demuxer → segmentos HLS → `/dev/shm/iptv_canais/{id}/`

**VOD (`vod`):**
`24HORAS/{pasta}/*.mp4` → playlist concat → FFmpeg concat demuxer → segmentos HLS fixos → `/dev/shm/iptv_canais/{id}/`

**Relay Sync (`relay` + `sync`):**
`relayUrls[]` → FFmpeg compartilhado → playlist concatenada → segmentos HLS → `/dev/shm/iptv_canais/{id}/`

**Relay Loop (`relay` + `loop`):**
`relayUrls[]` → playlist virtual `#EXT-X-DISCONTINUITY` → 1 transmux FFmpeg por viewer (`ffmpeg -i url -c copy -f mpegts pipe:1`) → stream direto ao viewer

**Relay Loop-Cache (`relay` + `loop-cache`):**
`relayUrls[]` → download `yt-dlp` → `24HORAS/{pasta}/` → FFmpeg compartilhado → segmentos HLS → `/dev/shm/iptv_canais/{id}/`

**Relay Sync-Cache (`relay` + `sync-cache`):**
Igual ao Loop-Cache, mas sincroniza com a posição original da transmissão.

### especoficidades por modo

**Ao Vivo (Pasta Local)** — O sistema pega uma pasta de vídeos MP4 e
transmite em loop infinito. É como colocar uma playlist no YouTube que
repete para sempre. Cada canal gasta ~1-2% de CPU e ~80 MB de RAM.

**VOD (Estático)** — O sistema converte uma pasta inteira em um vídeo único
muito longo. É como um filme que você assiste do começo ao fim, sem repetir.
Depois de pronto, gasta quase zero CPU.

**Relay Sync** — O sistema retransmite links externos usando um FFmpeg
compartilhado. Todos que assistem veem o mesmo fluxo. Cada canal gasta
~1-2% de CPU e ~80 MB de RAM.

**Relay Loop** — O sistema retransmite links externos, mas cada pessoa que
assiste ganha seu próprio FFmpeg leve. É mais econômico quando poucas pessoas
assistem ao mesmo tempo. Em repouso gasta ~0% de CPU; cada viewer ativo
gasta ~1% de CPU e ~20 MB de RAM.

**Relay Loop-Cache** — O sistema baixa os vídeos automaticamente para o
servidor e transmite em loop. É mais estável que o Loop puro, mas gasta
disco para salvar os vídeos. Cada canal gasta ~1-2% de CPU e ~80 MB de RAM.

**Relay Sync-Cache** — Igual ao Loop-Cache, mas sincroniza com a posição
original da transmissão. Se o canal original está no minuto 30, o seu
canal também começa no minuto 30.

### Armazenamento por modo

| Modo | Segmentos HLS | Vídeos fonte | Logs |
| ---- | ------------- | ------------ | ---- |
| Ao Vivo | RAM disk (temporário, 15s) | `24HORAS/{pasta}/` | `logs/canal_{id}.log` |
| VOD | RAM disk (fixos, duração total) | `24HORAS/{pasta}/` | `logs/canal_{id}.log` |
| Relay Sync | RAM disk (temporário) | Nenhum | `logs/canal_{id}.log` |
| Relay Loop | Nenhum | Nenhum | `logs/relay_{id}.log` |
| Relay Loop-Cache | RAM disk (temporário) | `24HORAS/{pasta}/` (downloads) | `logs/canal_{id}.log` |
| Relay Sync-Cache | RAM disk (temporário) | `24HORAS/{pasta}/` (downloads) | `logs/canal_{id}.log` |

---

## script.js (frontend, ~1852 linhas)

### Variáveis globais

`allChannels`, `currentSortColumn`/`currentSortDirection`,
`editingChannelId`, `isManualSource`, `trendHistory`.

### Funções

| Função | Descrição |
| ------ | --------- |
| `svgIcon(name, size)` | Ícones SVG (ICON_PATHS) |
| `updateStats()` | `/api/status` a cada 5s + `updateTrends()` |
| `updateTrends(metrics)` | Badges ▲/▼/~ com histórico em `trendHistory` |
| `toggleNocache()` | `/api/toggle-nocache` |
| `logout()` / `toggleTheme()` | Sair / trocar tema (localStorage `drm-theme`) |
| `start(id)` / `stop(id)` | Iniciar/parar canal |
| `formatUptime(seconds)` | `HH:MM:SS` |
| `sortTable(column)` / `updateSortIcons()` | Ordenação da tabela |
| `loadAndRenderChannels(filter)` | `/api/channels` + busca/filtro/render |
| `viewLogs(id, name)` / `hideLogsModal()` | Modal de logs |
| `deleteChannel(id, status)` | Confirma + exclui (bloqueia online) |
| `showCreateChannelModal()` / `showEditChannelModal(id)` | Modais |
| `toggleSourceInput(event)` | Select ↔ caminho absoluto manual |
| `loadVideoSourceOptions(selected)` | `/api/videosources` |
| `createOrEditChannel()` | POST create/update |
| `handleSearch()` / `scrollToTop()` / `switchTab(tab)` | UX |
| `loadLoginAttempts()` / `loadBlockedIPs()` / `loadTopAttackers()` / `loadNginxAccess()` | Aba Segurança |
| `blockIP(ip)` / `unblockIP(ip)` | Bloquear/desbloquear IP |
| `updateHeaderClock()` | Relógio do masthead |
| `toggle18(id)` | Alterna +18 |
| `downloadM3U()` / `copyM3ULink()` / `copyChannelM3U(channelId)` | M3U |
| `startAll()` / `stopAll()` | Ações em massa |
| `toggleVod(id)` | `/api/toggle-vod` |
| `onChannelModeChange()` / `loadRelayM3UFiles()` / `onM3UFileSelect()` | Modal relay |
| `advanceRelay(id)` | `/api/relay-advance` |
| `openSwitchModeModal(id)` / `submitSwitchMode()` | Troca de modo |
| `openPlayerModal(id, name)` / `closePlayerModal()` / `copyCurrentPlayerUrl()` | Player HLS (hls.js) |

### Intervalos

- `5000ms` → `updateStats()`
- `10000ms` → `loadAndRenderChannels()`

---

## login.js (73 linhas)

- IIFE aplica tema antes do render (sem FOUC): `localStorage['drm-theme']`
  → fallback `prefers-color-scheme`.
- `toggleTheme()` — inverte tema e persiste.
- `doLogin()` — POST `/api/login`; erro mostra `#error-msg.visible`.
- Enter no campo de senha dispara login.

## index.html (465 linhas)

- Masthead: título + relógio + `.btn-theme` + `Sair`.
- 7 cards KPI: IO, CPU, RAM, Disco, Rede, Streams (+ `#cache-card`
  clicável) — cada um com `.trend`/`#trend-*`.
- Abas: P1 **Canais** (armazenamento + canais), P2 **Segurança**
  (tentativas de login, top IPs, IPs bloqueados, acessos aos canais).
- Modais: criar/editar canal (modo live/relay + M3U import), alterar modo,
  logs, player HLS.

## style.css (~1839 linhas)

- Dois temas via `:root` (dark) e `:root[data-theme="light"]`.
- Tokens dark: `--bg #0B0F19`, `--surface #131927`, `--surface-2 #161F30`,
  `--border #1E293B`, `--text #F8FAFC`, `--muted #94A3B8`,
  `--accent #2563EB` (Blue-600), `--green #10B981`, `--red #EF4444`,
  `--yellow #F59E0B`, `--purple #8B5CF6`, `--pink #EC4899`.
- Light: `--bg #F3F5F8`, surfaces `#FFFFFF`, bordas `#E2E8F0`,
  texto `#0F172A`/`#64748B`/`#94A3B8`.
- Classes chave: `.btn-theme`/`.icon-sun`/`.icon-moon`, `.trend/.up/.down`,
  `.card-trend`, `.tick-*`, `.section-bar`, `.tab-btn/.page-no`,
  `.status-badge/.status-*`, `.modal-card`, `.login-card`, `.stat-num`,
  `.action-bar`, `.disk-bar/.fill-*`, `.log-content`, `#scroll-to-top`.
- Alinhamento numérico: `td:has(> .stat-num)`, `td:has(.action-bar)`,
  `td:has(> .btn-small)`, `td.stat-num` → `text-align: right`.

---

# 4. channels.json

```json
{
  "id": 1,
  "name": "teste",
  "sourceFolder": "",
  "sourceUrl": "",
  "relayUrls": ["http://...", "http://..."],
  "mode": "relay",
  "relaySubtype": "sync",
  "currentUrlIndex": 0,
  "playlistFilePath": "/dev/shm/iptv_canais/1/playlist_urls.txt",
  "inputType": "concat",
  "status": "relay",
  "useTranscode": false,
  "is18": false,
  "relayUrlProbed": ["http://..."],
  "relayUrlDurations": [2536.8, 2538.9],
  "startedAt": 1785948057232
}
```

| Campo | Tipo | Descrição |
| ----- | ---- | --------- |
| `id` | number | Único; reutiliza IDs de canais excluídos |
| `name` | string | Nome exibido no dashboard e M3U |
| `sourceFolder` | string | Relativo a `24HORAS/` ou caminho absoluto (live) |
| `sourceUrl` | string | URL única de origem (relay single) |
| `relayUrls` | string[] | Lista de URLs de retransmissão |
| `mode` | string | `live` \| `relay` \| `vod` \| `offline` |
| `relaySubtype` | string? | `sync` \| `loop` \| `loop-cache` \| `sync-cache` (apenas relay) |
| `currentUrlIndex` | number | Posição atual no relay-loop |
| `playlistFilePath` | string | Playlist gerada (concat) ou HLS pronto |
| `inputType` | string | `concat` \| `hls` \| `relay` |
| `status` | string | `online` \| `offline` \| `relay` \| `vod` |
| `useTranscode` | boolean | `true` = libx264, `false` = stream copy |
| `is18` | boolean | Conteúdo adulto |
| `relayUrlProbed` | string[] | URLs validadas via FFprobe (loop) |
| `relayUrlDurations` | number[] | Durações das URLs sondadas |
| `startedAt` | number | Timestamp de início |

---

# 5. Nginx (nginx_iptv.conf)

```nginx
server {
    listen 8081;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8080;   # Tudo vai para Node.js
    }

    location /canais/ {
        proxy_pass http://127.0.0.1:8080;   # Node decide: relay/live/VOD
    }

    # (bloqueios deny de blocked_ips.conf são incluídos)
}
```

Histórico: em versões antigas o Nginx servia `/canais/` direto do RAM disk
via `alias`; hoje **tudo** passa pelo Node.js, que decide entre relay
dinâmico, live e VOD.

---

## Arquivos de apoio

- `scripts/install_ubuntu.sh` — instalação automatizada (Node 20, FFmpeg, Nginx,
  PM2, pastas, config Nginx, blocked_ips vazios).
- `scripts/update_nginx.sh` — reaplica a config do Nginx.
- `scripts/build-obfuscated.py` — gera `DRMPREMIUM/` com `server.js`/`script.js`
  ofuscados e HTML/CSS minificados; copia `fonts/`; mantém `channels.json`
  preservado no destino durante o deploy.

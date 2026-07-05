# API Reference

Base URL: `http://<host>:8080` (ou `http://<host>` via Nginx)

## Autenticacao

Todas as rotas (exceto `/api/login`, `/api/logout`, `/playlist.m3u`, `/login.html`) requerem cookie `session_token`.

### POST /api/login

Autentica usuario administrador.

**Request:**
```json
{"user": "admin@email.com", "pass": "<REDACTED_PASSWORD>"}
```

**Response (200):**
```json
{"status": "success"}
```
Define cookie `session_token`.

**Response (401):**
```json
{"status": "error"}
```

### POST /api/logout

Remove cookie de sessao.

**Response (200):**
```json
{"status": "logged_out"}
```

---

## Sistema / Status

### GET /api/status

Metricas do servidor em tempo real.

**Response (200):**
```json
{
  "cpu": 45,
  "io": 12,
  "ram": 67,
  "disco": 34,
  "rede": "2.45",
  "uptime": 3600,
  "activeStreams": 3,
  "disks": [
    {
      "filesystem": "/dev/sda1",
      "size": "100G",
      "used": "40G",
      "avail": "60G",
      "usePercent": "40%",
      "mounted": "/"
    }
  ]
}
```

| Campo | Descricao |
|-------|-----------|
| cpu | % CPU real (diferencial, estilo htop) |
| io | Load avg escalado pelo numero de cores |
| ram | % RAM em uso |
| disco | % do disco raiz usado |
| rede | Taxa de envio em Mbps (media desde ultima leitura) |
| uptime | Segundos desde boot do servidor |
| activeStreams | Numero de processos FFmpeg ativos |
| disks | Lista de particoes fisicas com uso detalhado |

---

## Gerenciamento de Canais

### GET /api/channels

Lista todos os canais com uptime.

**Response (200):**
```json
[
  {
    "id": 1,
    "name": "Filmes Acao",
    "sourceFolder": "Filmes_Acao",
    "playlistFilePath": "/dev/shm/iptv_canais/1/playlist.txt",
    "inputType": "concat",
    "status": "online",
    "useTranscode": false,
    "is18": false,
    "uptime": 5400
  }
]
```

### POST /api/createchannel

Cria um novo canal.

**Request:**
```json
{
  "channelName": "Meu Canal",
  "sourceFolderName": "NomeDaPasta",
  "useTranscode": false,
  "is18": false
}
```

`sourceFolderName` pode ser:
- Nome de subpasta dentro de `24HORAS/` (ex: `"Filmes_Acao"`)
- Caminho absoluto (ex: `"/home/drmpremium/videos"`)
- `"."` para usar a raiz `24HORAS/`

**Response (200):**
```json
{
  "status": "success",
  "channel": {
    "id": 5,
    "name": "Meu Canal",
    "sourceFolder": "NomeDaPasta",
    "playlistFilePath": "/dev/shm/iptv_canais/5/playlist.txt",
    "inputType": "concat",
    "status": "offline",
    "useTranscode": false,
    "is18": false
  }
}
```

**Response (400) — pasta nao encontrada:**
```json
{"status": "error", "message": "O caminho especificado nao existe..."}
```

**Response (400) — sem videos validos:**
```json
{"status": "error", "message": "Nenhum video valido encontrado..."}
```

### POST /api/updatechannel

Edita um canal existente. O canal deve estar **parado**.

**Request:**
```json
{
  "id": 5,
  "channelName": "Novo Nome",
  "sourceFolderName": "OutraPasta",
  "useTranscode": true,
  "is18": true
}
```

**Response (200):**
```json
{"status": "success", "channel": {...}}
```

**Response (400) — canal rodando:**
```json
{"status": "error", "message": "Pare o canal antes de edita-lo."}
```

### POST /api/delete

Exclui canal e arquivos temporarios. Canal deve estar **parado**.

**Request:**
```json
{"id": 5}
```

**Response (200):**
```json
{"status": "deleted"}
```

A exclusao remove: registro do channels.json, pasta no RAM disk, log do canal (apos 1s de delay).

---

## Controle de Transmissao

### POST /api/start

Inicia a transmissao HLS de um canal.

**Request:**
```json
{"id": 1}
```

**Response (200):**
```json
{"status": "success", "pid": 12345}
```

**Response (400) — ja rodando:**
```json
{"status": "error", "message": "Canal ja rodando"}
```

### POST /api/stop

Para a transmissao de um canal (SIGKILL).

**Request:**
```json
{"id": 1}
```

**Response (200):**
```json
{"status": "stopped"}
```

### POST /api/startall

Inicia todos os canais offline.

**Response (200):**
```json
{"status": "success", "started": ["Canal A", "Canal B"]}
```

### POST /api/stopall

Para todos os canais ativos.

**Response (200):**
```json
{"status": "success", "stopped": ["Canal A", "Canal B"]}
```

---

## Utilitarios

### GET /api/videosources

Lista pastas de video disponiveis dentro de `24HORAS/`.

**Response (200):**
```json
[".", "Filmes_Acao", "Series", "Filmes_Acao/Subpasta"]
```

### GET /api/logs?id={id}

Retorna os ultimos 5KB do log FFmpeg de um canal.

**Response (200):** `text/plain`
```
--- INICIANDO CANAL 1 EM 01/01/2025 ...
[FFMPEG] frame=  120 fps=...
```

### POST /api/toggle18

Alterna a marcacao +18 de um canal.

**Request:**
```json
{"id": 1}
```

**Response (200):**
```json
{"status": "success", "is18": true}
```

---

## Endpoint Publico

### GET /playlist.m3u

Gera playlist M3U com todos os canais para players IPTV (VLC, TiviMate, etc).

**Response (200):** `application/x-mpegurl`
```
#EXTM3U
#EXTINF:-1 tvg-name="Canal A" tvg-logo="" group-title="",Canal A
http://host/canais/1/index.m3u8
#EXTINF:-1 tvg-name="Canal B" tvg-logo="" group-title="",Canal B
http://host/canais/2/index.m3u8
```

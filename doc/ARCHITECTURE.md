# Arquitetura do Sistema

## Visao Geral

```
Internet
  │
  ▼
Nginx (porta 80)
  ├── /canais/{id}/index.m3u8  → RAM disk (/dev/shm/iptv_canais)
  └── /*                        → Proxy reverso para Node.js (porta 8080)
                                      │
                                      ▼
                              Node.js (server.js)
                                ├── Auth (bcrypt + cookie)
                                ├── API REST
                                ├── Gerenciamento FFmpeg
                                └── Watchdog
                                      │
                                      ▼
                              FFmpeg (por canal)
                                ├── Input: concat de MP4s ou HLS existente
                                └── Output: HLS em /dev/shm/iptv_canais/{id}/
```

## Fluxo de Dados

### Criacao de Canal
```
1. Usuario preenche formulario no dashboard
2. script.js → POST /api/createchannel → server.js
3. server.js escaneia a pasta fonte:
   a. Lista MP4s recursivamente
   b. Valida cada video com ffprobe
   c. Gera playlist.txt com caminhos absolutos
4. Salva config em channels.json
5. Retorna canal criado para o frontend
```

### Inicio de Transmissao
```
1. Usuario clica "Iniciar"
2. server.js:
   a. Gera playlist.txt na RAM (se concat)
   b. Monta args do FFmpeg
   c. Spawna processo FFmpeg
   d. Redireciona stderr para logs/canal_{id}.log
   e. Registra em activeStreams Map
3. FFmpeg:
   a. Le inputs em loop (-stream_loop -1)
   b. Gera segmentos .ts de 15s
   c. Escreve index.m3u8 no RAM disk
4. Nginx serve /canais/{id}/index.m3u8 direto do RAM disk
```

### Watchdog (Recuperacao Automatica)
```
A cada 15s:
  Para cada canal online:
    Verifica mtime do index.m3u8
    Se sem atualizacao > 120s:
      → SIGKILL no FFmpeg
      → Aguarda 2s
      → Reinicia canal
```

## Decisoes Tecnicas

### RAM disk para segmentos HLS
- Path: `/dev/shm/iptv_canais/`
- Motivo: Evita desgaste do SSD com escritas constantes de segmentos .ts
- Tradeoff: Limitado a RAM disponivel (tipicamente 50% da RAM total)

### Modos de saida: Transcode vs Copy

| Modo | Flag | Uso CPU | Estabilidade | Uso recomendado |
|------|------|---------|-------------|-----------------|
| Copy | `useTranscode=false` | Baixo | Media | Videos com codecs homogeneos |
| Transcode | `useTranscode=true` | Alto | Alta | Videos com codecs/FPS variados |

Transcode usa libx264, 24fps, CRF 28, 1 thread, ultrarrapido — prioriza estabilidade sobre qualidade.

### Por que Node.js puro (sem frameworks)
- Zero dependencias alem do bcryptjs
- Ideal para ambientes com recursos limitados
- Arquivo unico (server.js) facilita deploy e debug

### Autenticacao via session estatica
- SESSION_ID gerado no startup via crypto.randomBytes
- Valido ate o servidor reiniciar
- Admins hardcoded com hashes bcrypt
- Nota: todos usuarios compartilham o mesmo cookie de sessao

## Convencoes de Codigo

| Aspecto | Convencao |
|---------|-----------|
| Backend | Node.js puro, CommonJS (require) |
| Frontend | HTML/CSS/JS vanilla |
| Polling | Stats a cada 5s, canais a cada 10s |
| Canais | Persistidos em channels.json |
| HLS | Segmentos de 15s, lista de 6 segmentos |
| Watchdog | Tolerancia de 120s |
| Logs | Rotacao a cada 48h |

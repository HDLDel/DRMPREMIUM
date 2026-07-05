# Documentacao do Codigo Fonte

## server.js (1058 linhas)

### Constantes Globais

| Constante | Valor | Descricao |
|-----------|-------|-----------|
| `PORT` | 8080 | Porta do servidor HTTP |
| `CHANNELS_DIR` | `/dev/shm/iptv_canais` | RAM disk para HLS |
| `VIDEO_SOURCE` | `./24HORAS` | Pasta raiz de videos fonte |
| `LOGS_DIR` | `./logs` | Logs FFmpeg por canal |
| `NGINX_LOG` | `/var/log/nginx/iptv_access.log` | Log de acesso Nginx |
| `FFMPEG_PATH` | `ffmpeg` | Binario do FFmpeg |
| `SESSION_ID` | `crypto.randomBytes(32)` | Token de sessao (regenerado no startup) |

### Variaveis Globais

| Variavel | Tipo | Descricao |
|----------|------|-----------|
| `channels` | `Array<Channel>` | Configuracoes dos canais carregadas do JSON |
| `activeStreams` | `Map<number, {process, startedAt}>` | Processos FFmpeg ativos |
| `prevBytesSent` | `number` | Bytes enviados na ultima medicao de rede |
| `lastNetTime` | `number` | Timestamp da ultima medicao de rede |
| `lastCpuTimes` | `{idle, total}` | Snapshot anterior de CPU para calculo diferencial |
| `cachedDisks` | `Array` | Cache de informacoes de disco |
| `lastDiskCheck` | `number` | Timestamp do ultimo check de disco |

### Funcoes

#### `getCpuTimes()` → `{idle, total}`
Le `os.cpus()` e soma todos os cores. Retorna tempo idle e total acumulado.
Usada como snapshot para calculo diferencial de CPU.

#### `getRealCpuUsage()` → `number` (0-100)
Calcula % de CPU real por diferenca entre snapshot atual e anterior.
Formula: `100 - (idleDiff / totalDiff * 100)`.
Chamada a cada requisicao `/api/status`.

#### `getCookies(req)` → `Object`
Parse do header `Cookie` em um objeto chave-valor.
Usa `decodeURI` para valores codificados.

#### `async loadChannels()`
Le `channels.json` do disco e popula o array global `channels`.
Adiciona `inputType: 'concat'` como fallback para canais antigos.
Chamada no startup do servidor.

#### `async saveChannels()`
Serializa `channels` em `channels.json` com indentacao 2.
Chamada apos qualquer criacao/edicao/exclusao/start/stop.

#### `async getDirectoriesRecursive(base, root)` → `String[]`
Lista todos os subdiretorios recursivamente a partir de `base`.
Usa `fs.realpathSync` para evitar loops de symlink.
Retorna caminhos relativos a `root`.
Inclui `"."` (a propria raiz) no inicio.
Usada para popular o select de pastas no modal.

#### `async getFilesRecursive(dir, extension)` → `String[]`
Busca todos os arquivos com determinada extensao recursivamente.
Filtra arquivos de 0 bytes (evita erro 'moov atom not found').
Usa `fs.realpathSync` para ciclos.
Usada para montar playlist de videos.

#### `isVideoValid(filePath)` → `Promise<boolean>`
Executa `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name`.
Retorna `true` se codigo de saida for 0.
Loga warning se falhar.

#### `getDiskUsage()` → `Promise<number>`
Executa `df / --output=pcent` (Linux).
Retorna % de uso do disco raiz.

#### `getNetworkUsage()` → `Promise<string>`
Le `/proc/net/dev` e calcula taxa de envio em Mbps.
Diferencial: subtrai bytes enviados anteriores, divide pelo tempo decorrido.
Retorna `"0.00"` se sem dados anteriores ou erro.

#### `getDiskSpaceDetails()` → `Promise<Array>`
Linux: Executa `df -Ph` filtrando tmpfs/devtmpfs/loop/udev/boot.
Retorna array de objetos `{filesystem, size, used, avail, usePercent, mounted}`.
Windows: Usa `wmic logicaldisk` (fallback legado).

#### `async getDiskSpaceDetailsCached()` → `Promise<Array>`
Cache de 60s para `getDiskSpaceDetails()`.
Evita execucao repetida de `df` a cada 5s de polling.

#### `async getSystemStats()` → `Object`
Coleta todas as metricas: CPU, IO, RAM, disco, rede, uptime, activeStreams, disks.
Agrega chamadas a `getRealCpuUsage()`, `getDiskUsage()`, `getNetworkUsage()`, etc.

#### `async startChannel(id)` → `{status, pid}`
Fluxo completo de inicio de transmissao:

1. **Validacao:** Canal existe? Ja rodando?
2. **Preparacao:** Cria pasta no RAM disk, limpa index.m3u8 antigo.
3. **Playlist (se concat):** Escaneia pasta, valida videos com ffprobe, gera playlist.txt.
4. **Args FFmpeg:** Monta array de argumentos:
   - Base: `-fflags +genpts+igndts+flush_packets -err_detect ignore_err -re -stream_loop -1`
   - Se concat: `-f concat -safe 0`
   - Se transcode: `-fps_mode cfr -c:v libx264 -preset ultrafast -tune zerolatency -r 24 -g 48 -crf 28 -threads 1 -c:a copy -sn -dn`
   - Se copy: `-fps_mode passthrough -c:v copy -c:a copy`
   - Output: `-f hls -hls_time 15 -hls_list_size 6 -hls_flags delete_segments+append_list+omit_endlist+independent_segments`
5. **Execucao:** `spawn(ffmpeg, args)`.
6. **Logging:** Redireciona stderr para `logs/canal_{id}.log`.
7. **Eventos:** Trata `error`, `close` para limpar `activeStreams` e status.
8. **Registro:** Salva PID e timestamp em `activeStreams`, marca canal `online`.

### Servidor HTTP

O servidor usa `http.createServer` com um unico callback que roteia por `url.pathname`.

#### Roteamento

| Path | Method | Auth | Descricao |
|------|--------|------|-----------|
| `/api/login` | POST | Nao | Login |
| `/api/logout` | POST | Nao | Logout |
| `/playlist.m3u` | GET | Nao | Playlist M3U publica |
| `/api/toggle18` | POST | Sim | Alterna +18 |
| `/api/status` | GET | Sim | Metricas |
| `/api/logs` | GET | Sim | Log FFmpeg |
| `/api/channels` | GET | Sim | Lista canais |
| `/api/videosources` | GET | Sim | Pastas disponiveis |
| `/api/start` | POST | Sim | Iniciar canal |
| `/api/stop` | POST | Sim | Parar canal |
| `/api/startall` | POST | Sim | Iniciar todos |
| `/api/stopall` | POST | Sim | Parar todos |
| `/api/createchannel` | POST | Sim | Criar canal |
| `/api/updatechannel` | POST | Sim | Editar canal |
| `/api/delete` | POST | Sim | Excluir canal |
| `/*` | GET | Sim | Arquivos estaticos |

#### Tratamento de Erros

O servidor inteiro esta envolvido em `try/catch` que retorna 500 em caso de excecao nao tratada.

### Watchdog (Intervalo)

```javascript
setInterval(fn, 15000)  // A cada 15s
```
Para cada canal em `activeStreams`:
1. Verifica `mtime` do `index.m3u8`.
2. Se `Date.now() - mtime > 120000` (2min):
   - Loga no arquivo do canal
   - `SIGKILL` no processo FFmpeg
   - Remove de `activeStreams`
   - Aguarda 2s e chama `startChannel(id)`

### Limpeza de Logs (Intervalo)

```javascript
setInterval(fn, 48 * 60 * 60 * 1000)  // A cada 48h
```
Remove logs de canais com `mtime` > 48h atras.

---

## script.js (536 linhas)

### Variaveis Globais

| Variavel | Descricao |
|----------|-----------|
| `allChannels` | Cache de todos os canais para busca/edicao |
| `currentSortColumn` | Coluna atual de ordenacao (`id`, `name`, `status`, `uptime`) |
| `currentSortDirection` | `asc` ou `desc` |
| `editingChannelId` | ID do canal sendo editado (ou `null` para criacao) |
| `isManualSource` | Se o input de pasta esta em modo manual (caminho absoluto) |

### Funcoes

#### `async updateStats()`
Fetch em `/api/status` a cada 5s. Atualiza:
- IO, CPU, RAM, Disco (porcentagens)
- Rede (Mbps)
- Streams ativos (numero)
- Cards de disco com barra de progresso colorida (>75% laranja, >90% vermelho)

#### `async logout()`
POST `/api/logout`, redireciona para `/login.html`.

#### `async start(id)`
POST `/api/start`, atualiza stats e channels.

#### `async stop(id)`
POST `/api/stop`, atualiza stats e channels.

#### `formatUptime(seconds)` → `string`
Converte segundos em `HH:MM:SS`. Retorna `00:00:00` se 0 ou null.

#### `sortTable(column)`
Alterna direcao se mesma coluna, reseta para asc se nova coluna.
Re-renderiza tabela chamando `loadAndRenderChannels`.

#### `updateSortIcons()`
Atualiza indicadores visuais (▲/▼) nos headers da tabela.

#### `async loadAndRenderChannels(filter = '')`
Fetch `/api/channels`, filtra por search text, filtro +18/family, ordena, renderiza tabela.
Cada linha tem: ID, Nome (com badge +18), Status (verde/vermelho), Uptime, Acoes (iniciar/parar/assistir/editar/logs/excluir).

#### `async viewLogs(id, name)`
Abre modal, fetch `/api/logs?id=...`, exibe texto monospace verde.

#### `async deleteChannel(id, status)`
Confirma, POST `/api/delete`. Bloqueia se canal online.

#### `showCreateChannelModal()`
Abre modal para novo canal, reseta campos, carrega opcoes de pasta.

#### `showEditChannelModal(id)`
Abre modal pre-preenchido com dados do canal. Bloqueia se canal online.

#### `toggleSourceInput(event)`
Alterna entre select de pastas e input de caminho absoluto manual.

#### `async loadVideoSourceOptions(selectedValue = "")`
Fetch `/api/videosources`, popula select. Se `selectedValue` for caminho absoluto, ativa modo manual.

#### `async createOrEditChannel()`
Valida campos, determina endpoint (`/api/createchannel` ou `/api/updatechannel`), envia POST.

#### `handleSearch()`
Filtra por texto, acionado por `input` event no search field.

#### `async toggle18(id)`
Alterna badge +18 no clique, POST `/api/toggle18`.

#### `downloadM3U()`
Redireciona para `/playlist.m3u`.

#### `copyM3ULink()`
Copia URL da playlist para clipboard.

#### `async startAll() / stopAll()`
Acoes em massa com confirmacao.

### Intervalos

| Intervalo | Funcao | Descricao |
|-----------|--------|-----------|
| 5000ms | `updateStats()` | Atualiza metricas |
| 10000ms | `loadAndRenderChannels(...)` | Atualiza lista de canais |

---

## index.html (138 linhas)

Estrutura do dashboard:

- **Header:** Titulo + botao Sair
- **Metricas (6 cards):** IO, CPU, RAM, Disco, Rede, Streams Ativos
- **Armazenamento:** Grid de cards de disco com barra de progresso
- **Canais:**
  - Barra de busca + filtro + botoes de acao em massa + criar canal
  - Tabela com colunas: ID, Nome, Status, Uptime, Acoes
- **Modal de criacao/edicao:** Nome, pasta fonte (select ou manual), transcode toggle, +18 toggle
- **Modal de logs:** Visualizador monospace verde com scroll

## login.html (97 linhas)

Tela de login dark com:
- Input de usuario
- Input de senha
- Botao entrar
- Mensagem de erro (oculta, exibida em falha)
- CSS inline (autosuficiente)

## style.css (151 linhas)

Tema dark premium:

| Variavel | Valor | Uso |
|----------|-------|-----|
| `--bg` | `#0a0e14` | Fundo da pagina |
| `--card` | `#151b23` | Background dos cards |
| `--accent` | `#00ff99` | Verde neon (botoes, valores) |
| `--text` | `#e6edf3` | Texto principal |

### Classes

- `.header`: Flex row, titulo + logout
- `.dashboard`: Grid responsivo (auto-fit, min 250px)
- `.card`: Card centralizado com borda
- `.channel-list`: Tabela com background
- `.search-bar`: Flex row com input e botoes
- `.stop`, `.btn-watch`, `.btn-logs`, `.btn-delete`, `.btn-logout`: Variantes de botoes
- `#scroll-to-top`: Botao circular fixo no canto inferior direito

### Comportamentos

- Hover nos botoes reduz opacidade para 0.8
- Hover nos headers da tabela muda cor para accent
- Scroll-to-top aparece apos 100px de scroll

## channels.json

Formato do registro de canal:

```json
{
  "id": 1,
  "name": "Nome do Canal",
  "sourceFolder": "PastaFonte",
  "playlistFilePath": "/dev/shm/iptv_canais/1/playlist.txt",
  "inputType": "concat",
  "status": "offline",
  "useTranscode": false,
  "is18": false
}
```

### Campos

| Campo | Tipo | Descricao |
|-------|------|-----------|
| `id` | number | Unico, menor disponivel (reutiliza IDs de canais excluidos) |
| `name` | string | Nome exibido no dashboard e M3U |
| `sourceFolder` | string | Relativo a `24HORAS/` ou caminho absoluto |
| `playlistFilePath` | string | Caminho completo para playlist gerada ou HLS existente |
| `inputType` | string | `"concat"` (MP4s) ou `"hls"` (HLS pronto) |
| `status` | string | `"online"` ou `"offline"` |
| `useTranscode` | boolean | `true` = libx264, `false` = stream copy |
| `is18` | boolean | Conteudo adulto |

### IDs Reutilizaveis

Ao criar um canal, o sistema busca o menor ID inteiro positivo disponivel. IDs de canais excluidos sao reutilizados.

---

## nginx_iptv.conf (30 linhas)

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8080;  # Tudo vai para Node.js
    }

    location ~ ^/canais/(\d+)/(.*\.m3u8|.*\.ts)$ {
        alias /dev/shm/iptv_canais/$1/$2;  # HLS direto do RAM disk
        add_header Cache-Control "no-cache";
        add_header Access-Control-Allow-Origin "*";
    }
}
```

Regex captura ID do canal e nome do arquivo, servindo direto do `/dev/shm/iptv_canais/{id}/{arquivo}` sem passar pelo Node.js.

## install_ubuntu.sh

Script de instalacao automatizada para Ubuntu:

1. `apt update && apt upgrade -y`
2. Instala curl, ffmpeg, nginx, git
3. Instala Node.js 20 LTS via NodeSource
4. `npm install` + `pm2` global
5. Cria pastas `canais/` e `24HORAS/`
6. Copia config Nginx e habilita site
7. Remove default Nginx
8. Testa config e reinicia Nginx

## update_nginx.sh

Script para reaplicar config Nginx:
- Verifica se executa como root
- Copia `nginx_iptv.conf` para sites-available
- Atualiza link simbolico
- Remove default
- `nginx -t && systemctl restart nginx`

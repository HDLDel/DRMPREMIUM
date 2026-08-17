# Manual do Usuário — Painel 24 Horas (DRM Premium)

## Acesso

1. Abra o navegador em `http://<IP_DO_SERVIDOR>:8081` (ou o endereço do
   painel fornecido pelo administrador).
2. Digite o **usuário** e a **senha** fornecidos pelo administrador.
3. Clique **Entrar**.

Erro: a mensagem "Usuário ou senha inválidos" aparece em vermelho acima
dos campos.

---

## Tema claro / escuro

- Botão de **sol/lua** no canto superior direito (masthead) alterna entre
  tema **escuro** (padrão) e **claro**.
- A preferência fica salva no navegador e é aplicada automaticamente nas
  próximas visitas (sem piscar na abertura).
- A tela de login também tem o mesmo botão de tema.

---

## Dashboard

### Cards de métricas (topo)

Atualizam automaticamente a cada 5 segundos:

| Card | Descrição |
| ---- | --------- |
| IO | Carga de I/O do sistema |
| CPU | % de uso da CPU em tempo real |
| RAM | % de memória RAM em uso |
| Disco | % de uso do disco principal |
| Rede | Taxa de upload em Mbps |
| Streams Ativos | Canais transmitindo agora (live + relay) |
| Cache Disco | **Clicável**: liga/desliga o `nocache` do FFmpeg |

### Badges de tendência (▲/▼/~)

Cada card numérico mostra um badge ao lado do valor:

- `▲ verde` — melhora (ex.: uso caiu, streams subiram).
- `▼ vermelho` — piora (ex.: uso subiu).
- `~ estável` — sem variação (ou primeiro valor).

### Armazenamento (SSDs/Discos)

Abaixo das métricas (aba Canais), mostra cada partição física:
- **Nome da montagem** (ex: `/`) e **sistema de arquivos**.
- **Barra de progresso** colorida (verde < 75%, laranja < 90%, vermelho > 90%).
- **Espaço disponível** e **total** + % usado.

---

## Abas P1 (Canais) e P2 (Segurança)

O painel usa duas abas no topo: **P1 Canais** e **P2 Segurança**.

### P1 — Canais

#### Barra de ferramentas

| Elemento | Função |
| -------- | ------ |
| Campo de busca | Filtra por nome ou ID |
| Filtro Todos / +18 / Livre | Filtra por tipo de conteúdo |
| Iniciar Todos | Liga todos os canais offline |
| Parar Todos | Desliga todos os canais ativos |
| Exportar M3U | Baixa a playlist `.m3u` para players IPTV |
| Limpar Logs | Esvazia os logs FFmpeg de todos os canais |
| Criar Novo Canal | Abre o modal para adicionar canal |

#### Tabela de canais

| Coluna | Descrição | Ordenável |
| ------ | --------- | --------- |
| ID | Número identificador | Sim (clique) |
| Nome | Nome do canal + badge 18+ | Sim |
| Status | ONLINE (verde), RELAY, VOD ou OFFLINE (vermelho) | Sim |
| Uptime | Tempo ligado (HH:MM:SS) | Sim |
| Ações | Botões de controle | Não |

#### Ações por canal (na coluna Ações)

- **Iniciar** / **Parar** — liga/desliga a transmissão.
- **Assistir** (online) — abre o player HLS integrado.
- **Mudar Modo** — abre o modal "Alterar Modo do Canal".
- **VOD** — alterna VOD ↔ live do canal.
- **Avançar** (relay-loop) — pula para a próxima URL da fila.
- **Copiar M3U** — copia o link direto do canal.
- **Editar** — altera nome, pasta, modo (apenas parado).
- **Logs** — vê o log do FFmpeg em tempo real.
- **Excluir** — remove o canal (bloqueado enquanto online).

> Canais **online** não podem ser editados nem excluídos; pare primeiro.

---

#### Modal "Criar/Editar Canal"

**Modo de Transmissão:**

- **Pasta Local (ao vivo / MP4s)** — escolha a pasta de vídeos (select) ou
  digite um caminho absoluto manual. Se a pasta tiver `index.m3u8`, usa HLS
  pronto; senão concatena os MP4s em loop.
- **Retransmissão (links externos / relay)** — escolha o tipo:
  - **FILA DE VÍDEOS (LOOP)** — retransmite URLs com 1 FFmpeg leve por viewer.
  - **RETRANSMISSÃO SINCRONIZADA (FFMPEG SYNC)** — retransmite com 1 FFmpeg compartilhado.
  - Opcional: importar links de um `.m3u` salvo no servidor
    (`/home/drmpremium`), ou digitar as URLs (uma por linha).

**Campos extras:**

- **Ativar Transcodificação** — converte para 24fps H.264 (estabilidade,
  consome mais CPU). Recomendado para arquivos com codecs variados.
- **Conteúdo +18** — marca o canal como adulto.

#### Modal "Alterar Modo do Canal"

Troca o modo sem recriar o canal:

| Opção | Descrição |
| ----- | --------- |
| DESATIVADO (OFFLINE) | Para e desativa |
| AO VIVO (PASTA LOCAL) | Transmissão contínua da pasta |
| VOD ESTÁTICO (PLAYLIST HLS) | Converte a pasta em VOD de duração total |
| RELAY LOOP (1 FFmpeg/viewer) | URLs externas via transmux on-the-fly |
| RELAY SYNC (1 FFmpeg/canal) | URLs externas com FFmpeg compartilhado |

#### Modal de Logs

Visualizador estilo terminal com a saída do FFmpeg, com scroll.

#### Player de Vídeo

Player HLS integrado (hls.js) com botão **Copiar Link**.

---

### Entendendo os modos de transmissão

Ao criar um canal, você escolhe como ele vai transmitir. Cada modo tem um
custo diferente de CPU, RAM e disco.

#### Tabela de custos por modo

| Modo | CPU | RAM | Disco | Quando usar |
| ---- | --- | --- | ----- | ----------- |
| **Ao Vivo** | 1-2% | ~80 MB | Temporário | Pasta de vídeos MP4, loop infinito |
| **VOD** | ~0% (depois de pronto) | ~0% | Fixo | Filme/série assistido do início ao fim |
| **Relay Sync** | 1-2% | ~80 MB | Temporário | Links externos, vários viewers |
| **Relay Loop** | ~0% + 1%/viewer | ~20 MB/viewer | Nenhum | Links externos, poucos viewers |
| **Loop-Cache** | 1-2% | ~80 MB | Vídeos inteiros | Links externos com estabilidade |
| **Sync-Cache** | 1-2% | ~80 MB | Vídeos inteiros | Acompanhar transmissão ao vivo |

#### Explicação simples de cada modo

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

---

### P2 — Segurança

Quatro seções para monitorar acesso ao painel:

1. **Registro de Tentativas de Login** — IP, usuário, data/hora, status
   (sucesso/falha) e User-Agent das últimas 200 tentativas. O contador no
   topo mostra o número de **IPs bloqueados**.
   - Botão **Bloquear** em uma tentativa adiciona o IP à lista de
     bloqueados (Nginx `deny` + UFW).
2. **Top IPs Suspeitos** — IPs agregados por total de tentativas, com
   falhas/sucessos e última tentativa. Botão **Bloquear** disponível.
3. **IPs Bloqueados** — lista com botão **Desbloquear** por IP.
4. **Acessos aos Canais** — resume os acessos registrados no log do Nginx:
   IPs únicos, total de requests, canais acessados por IP e top 5 canais.
   Botão **Atualizar** recarrega os dados.

---

## Playlist M3U para Players IPTV

Use o link `http://<IP>:8081/playlist.m3u` (ou exporte pelo botão no
dashboard) em players como:

- **VLC** — Mídia > Abrir fluxo de rede.
- **TiviMate** — Adicionar playlist.
- **IPTV Smarters** — URL da playlist.
- **Kodi** — Add-on PVR IPTV Simple Client.

---

## Troubleshooting

| Problema | Causa possível | Solução |
| -------- | -------------- | ------- |
| Login não funciona | Credenciais erradas | Verifique com o admin |
| Canal não inicia | Pasta sem vídeos válidos | Verifique se há MP4s não corrompidos |
| Canal trava sozinho | Vídeo corrompido ou falta CPU | Watchdog reinicia em ~1min |
| Log mostra "moov atom not found" | MP4 corrompido | Remova ou reconverta o arquivo |
| Stream não abre | Canal offline ou Nginx parado | Verifique status do canal e Nginx |
| IP bloqueado por engano | Tentativas falhas em massa | Desbloqueie na aba Segurança |

---

## Atalhos e comportamentos

- **Scroll-to-top:** botão circular no canto inferior direito ao rolar.
- **Busca:** filtra por nome ou ID, combinável com filtro +18/family.
- **Ordenação:** clique nos headers da tabela (ID, Nome, Status, Uptime).
- **Auto-update:** métricas a cada 5s, lista de canais a cada 10s.
- **Tema:** botão sol/lua no masthead e na tela de login.

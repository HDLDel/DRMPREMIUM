# Manual do Usuario — DRMPREMIUM Dashboard

## Acesso

1. Abra o navegador em `http://<IP_DO_SERVIDOR>:8080`
2. Se estiver configurado com Nginx, use `http://<IP_DO_SERVIDOR>`
3. Faça login com usuario e senha fornecidos pelo administrador

## Tela de Login

- Digite seu **usuario** (e-mail ou nome)
- Digite sua **senha**
- Clique **Entrar**
- Erro: mensagem "Usuario ou senha invalidos" aparece em vermelho

## Dashboard

### Cards de Métricas (topo)

Atualizam automaticamente a cada 5 segundos:

| Card | Descricao |
|------|-----------|
| IO | Carga de I/O do sistema |
| CPU | % de uso da CPU em tempo real |
| RAM | % de memoria RAM em uso |
| Disco | % de uso do disco principal |
| Rede | Taxa de upload em Mbps |
| Streams Ativos | Numero de canais transmitindo agora |

### Armazenamento (SSDs/Discos)

Abaixo das metricas, mostra cada partição fisica:
- **Nome da montagem** (ex: `/`)
- **Barra de progresso** colorida (verde < 75%, laranja < 90%, vermelho > 90%)
- **Espaço disponivel** e **total**

### Gerenciamento de Canais

#### Barra de Ferramentas

| Elemento | Funcao |
|----------|--------|
| Campo de busca | Digite nome ou ID para filtrar |
| Filtro "Todos / +18 / Livre" | Mostra canais por tipo de conteudo |
| Iniciar Todos | Liga todos os canais offline |
| Parar Todos | Desliga todos os canais ativos |
| Exportar M3U (Baixar) | Baixa playlist .m3u para players IPTV |
| Copiar Link M3U | Copia URL da playlist para area de transferencia |
| Criar Novo Canal | Abre modal para adicionar canal |

#### Tabela de Canais

| Coluna | Descricao | Ordenavel |
|--------|-----------|-----------|
| ID | Numero identificador | Sim (clique) |
| Nome | Nome do canal + badge 18+ | Sim |
| Status | ONLINE (verde) ou OFFLINE (vermelho) | Sim |
| Uptime | Tempo ligado (HH:MM:SS) | Sim |
| Ações | Botoes de controle | Nao |

#### Botoes de Ação (por canal)

**Canal OFFLINE:**
- **Iniciar** — liga a transmissao
- **Editar** — altera nome, pasta, modo
- **Logs** — ve o log do FFmpeg
- **Excluir** — remove o canal (confirmacao necessaria)

**Canal ONLINE:**
- **Parar** — desliga a transmissao
- **Assistir** — abre o stream HLS em nova aba
- **Editar** — disponivel apenas se parar primeiro
- **Logs** — ve o log em tempo real
- **Excluir** — bloqueado enquanto online

### Badge 18+

Clique no badge **18+** (vermelho) ou **+18?** (cinza) para alternar a classificacao:
- 🔞 18+ (vermelho) = conteudo adulto
- +18? (cinza) = conteudo livre

### Modal de Criar/Editar Canal

| Campo | Descricao |
|-------|-----------|
| Nome do Canal | Nome que aparece na lista e playlist |
| Pasta de Videos Fonte | Selecione pasta ou digite caminho absoluto |
| Ativar Transcodificacao | Marque para estabilidade (consome mais CPU) |
| Conteudo +18 | Marque para conteudo adulto |

**Dica:** Se marcar Transcodificacao, o video sera convertido para 24fps, H.264, garantindo compatibilidade mesmo com arquivos de codecs diferentes.

**Caminho absoluto manual:** Clique em "Usar caminho absoluto manual" para digitar um caminho fora da pasta `24HORAS/`. Ex: `/mnt/hd/videos`.

### Modal de Logs

Visualizador com fundo preto e texto verde (estilo terminal):
- Mostra saida do FFmpeg em tempo real
- Scroll automatico para o final
- Fecha clicando em "Fechar"

## Playlist M3U para Players IPTV

Use o link `http://<IP>/playlist.m3u` em players como:
- **VLC** — Media > Open Network Stream
- **TiviMate** — Adicionar playlist
- **IPTV Smarters** — URL playlist
- **Kodi** — Add-on PVR IPTV Simple Client

## Troubleshooting

| Problema | Causa possivel | Solucao |
|----------|---------------|---------|
| Login nao funciona | Credenciais erradas | Verifique com admin |
| Canal nao inicia | Pasta sem videos validos | Verifique se ha MP4s nao corrompidos |
| Canal trava sozinho | Video corrompido ou falta CPU | Watchdog reinicia automaticamente em 2min |
| Log mostra "moov atom not found" | Arquivo MP4 corrompido | Remova ou reconverta o arquivo |
| Stream nao abre | Canal offline ou Nginx parado | Verifique status do canal e nginx |

## Atalhos e Comportamentos

- **Scroll-to-top:** Botao verde circular aparece no canto inferior direito ao rolar para baixo
- **Busca:** Filtra por nome ou ID, combinavel com filtro +18/family
- **Ordenacao:** Clique nos headers da tabela (ID, Nome, Status, Uptime)
- **Auto-update:** Metricas a cada 5s, lista de canais a cada 10s

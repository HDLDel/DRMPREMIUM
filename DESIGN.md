# DESIGN — Painel 24 Horas (Teletexto)

Sistema de design do DRM PREMIUM. Mundo visual **TELETEXT / CEEFAX**,
sorteado pela skill `impeccable` (concept-seed key `6330c55c`, assigned #4)
e confirmado pelo usuário.

## THESIS

O painel é uma página de teletexto: um índice de transmissão onde cada
canal é um número de página e o estado do ar é lido como um relance de
tela CRT. Recusa o clichê de dashboard "fundo escuro + neon + cards
flutuantes".

## Principios

- Toda tela é uma "página" numerada (P100, P1, P2) lida da esquerda para a direita.
- Seções são barras de bloco coloridas com texto preto (reverse video).
- Estado ao vivo tem a própria cor de bloco, nunca texto colorido solto.
- Sem sombra, sem vidro, sem gradiente: tela CRT plana.
- Tipografia pixel monoespaçada VT323, auto-hospedada (sem CDN).
- Efeito CRT: linhas de varredura fixas sobre tudo, sem capturar cliques.

## Tokens (style.css `:root`)

Teletexto 16 cores, prefixo `--tt-`:

| Token | Valor | Uso |
|---|---|---|
| `--tt-bg` | `#000000` | fundo geral / CRT |
| `--tt-screen` | `#030303` | superfícies internas |
| `--tt-panel` | `#000000` | painéis/cartões |
| `--tt-ink` | `#f0f0f0` | texto principal |
| `--tt-dim` | `#a8a8a8` | texto secundário |
| `--tt-mute` | `#777777` | texto de apoio |
| `--tt-line` | `#262626` | separadores |
| `--tt-border` | `#4a4a4a` | bordas |
| `--tt-yellow` | `#ffd400` | masthead, block P100, destaque |
| `--tt-cyan` | `#2de0ff` | realce info / actions |
| `--tt-green` | `#3dff5b` | OK / LIVE / disponibilidade |
| `--tt-magenta` | `#ff2bd6` | destaque / ações primárias |
| `--tt-red` | `#ff4d4d` | erro / stop / offline |
| `--tt-blue` | `#4d9fff` | informação |
| `--tt-amber` | `#ffb300` | atenção / uso parcial |

Fonte: `--font-tt: 'VT323', 'Courier New', ui-monospace, monospace`.
Raio: `--radius: 2px`. Velocidade de transição: `--speed: 160ms`.

## Componentes

### Masthead (`.header`)
Bloco `P100` amarelo invertido à esquerda, nome do serviço ao centro,
relógio ao vivo à direita. Borda inferior `--tt-line`.

### Faixa de cor (`.color-strip`)
Barra de calibração magenta→cyan→amarelo→verde, separador entre masthead
e métricas.

### Métricas (`.disk-card`, `.stat-*`)
Células de tela CRT com nome do disco, barra de uso (`.disk-bar-fill`
com `transform: scaleX`), e disponibilidade com `.disk-avail strong`
em verde. Números em `.stat-num` tabulares.

### Navegação por página (`.tab-btn`)
Abas P1/P2/P3 em reverse video; a ativa fica com fundo de cor da seção
e número de página destacado.

### Barra de seção (`.section-bar`)
Barras de bloco (`.magenta/.yellow/.green`) com título em preto e
`.bar-hint` com o número da página à direita.

### Estado de canal (`.status-badge` + `.status-*`)
- `.status-live` — verde (AO VIVO)
- `.status-vod` — ciano (VOD)
- `.status-loop` — amarelo (LOOP)
- `.status-relay` — azul (RELAY)
- `.status-offline` — vermelho (OFFLINE)

### Botões (`.btn-*`)
Cores de bloco com hover escurecido: `.btn-primary` magenta,
`.btn-danger` vermelho, `.btn-blue` azul, `.btn-yellow` amarelo,
`.btn-cyan` ciano, `.btn-magenta` magenta, `.btn-stop` vermelho,
`.btn-neutral` cinza, `.btn-logout` vermelho, `.btn-edit` verde.
`.btn-icon` para ações com ícone SVG (sem emoji).

### Logs (`.log-content`)
Área de texto puro de terminal, monoespaçado.

### Modais (`.modal-head`)
Cabeçalho em bloco de cor (`.cyan/.magenta`) com título em preto.
Sem sombra, borda `--tt-border`.

### Login (`.login-card`)
Mesmo mundo visual: `.modal-head`, `.color-strip`, campos monoespaçados,
botão ENTRAR. `#error-msg` oculto por padrão.

### Responsivo (`@media max-width: 720px`)
Grade de métricas colapsa para coluna única, masthead empilha, tabela de
canais ganha `overflow-x: auto` (rolagem horizontal dentro do contêiner,
nunca overflow da página).

## Restrições de implementação

- Preservar IDs de DOM e endpoints existentes (ver PRODUCT.md) — o
  `script.js` e o `server.js` dependem deles.
- Ícones em SVG inline (`.svgIcon`/`ICON_PATHS`), nunca emoji.
- Nenhuma cor inline; tudo via classes CSS.
- Fonte VT323 auto-hospedada em `fonts/VT323.ttf`, servida sem auth
  (`/fonts/` liberado no `server.js`) e incluída no build
  (`COPY_DIRS = ['fonts']` no `build-obfuscated.py`).

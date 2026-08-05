# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Operadores de uma equipe pequena que administram o serviço IPTV DRM PREMIUM 24 HORAS. O operador principal acessa o painel diariamente para ligar/desligar canais, verificar telemetria do servidor, criar/editar canais e responder a incidentes de segurança (tentativas de login, IPs bloqueados, acessos suspeitos). Alguns operadores podem ser menos técnicos; clareza de estado e ações destrutivas protegidas importam.

## Product Purpose

Sistema de gerenciamento de canais de vídeo HLS em Node.js que transforma um servidor Linux em uma plataforma IPTV: fontes locais (pastas de MP4), retransmissão de links externos (relay loop e relay sync) e VOD são convertidos/servidos como streams HLS consumíveis por players. O painel web é a superfície de operação que permite controlar o que está no ar em tempo real.

## Positioning

É a sala de controle própria do serviço: o painel não vende TV, ela mantém a TV no ar — telemetria ao vivo do host, 590+ canais com controle individual, e proteção contra abuso de login/banda, tudo em um lugar, sem depender de terceiros.

## Operating Context

- Acesso autenticado via login (sessão HTTP + cookie); tela de login separada.
- Operador monitora continuamente: dashboard de métricas (CPU, RAM, disco, rede, IO, streams ativos, cache de disco) atualizado a cada 5s, lista de canais a cada 10s.
- Fluxos frequentes: iniciar/parar canal, avançar vídeo de relay loop, assistir via player pop-up, copiar link M3U, criar/editar canal (modo live/VOD/relay), alternar modo rápido, exportar playlist, limpar logs.
- Aba Segurança: tentativas de login, top IPs suspeitos, IPs bloqueados, acessos aos canais (auto-refresh 15s).
- Regras de segurança já conhecidas: bloquear/debloquear IP via nginx/iptables no servidor; excluir canal exige canal parado; editar canal exige canal parado.
- Conteúdo +18 é marcado por canal e filtrado por tabela (adulto / livre).

## Capabilities and Constraints

- Canais com modos: live (pasta local de vídeos), vod (playlist HLS estática), relay (loop via Node sem CPU / sync via FFmpeg).
- Opção de transcodificação por canal (estabilidade); flag +18 por canal.
- Telemetria: io, cpu, ram, disco, rede, streams ativos; status de cache de disco (toggle).
- Listagem de discos/SSDs com barras de uso.
- Ordenação por id/nome/status/uptime; busca por nome/id; filtro +18/livre.
- Player pop-up embutido com hls.js (rede/erro de mídia com recuperação).
- Ações em massa: iniciar todos, parar todos; exportar playlist M3U; limpar logs.
- Técnica: HTML/CSS/JS estático servido pelo próprio Node (porta 8080); streams servidos via nginx em `/canais/<id>/index.m3u8`; sem framework frontend; sem build step; hls.js via CDN.
- Frontend atualiza via polling (`/api/status`, `/api/channels`), sem websockets.
- Endpoints `/api/*` já estabelecidos não devem ser alterados (o frontend depende deles).
- IDs de elementos DOM usados por `script.js` devem permanecer (ou ser refatorados em conjunto).

## Brand Commitments

Decisão do operador: marca e identidade estão livres para serem repensadas. O nome "DRM PREMIUM 24 HORAS" aparece hoje no login e no cabeçalho, mas pode mudar. Não há logo, guia de estilo ou paleta obrigatória herdada.

## Evidence on Hand

- `index.html`, `login.html`, `style.css`, `script.js` — frontend atual (fonte da refatoração).
- `server.js` — backend Node (endpoints `/api/*`, lógica de canais/relay/watchdog).
- `nginx_iptv.conf` — proxy reverso que serve os streams.
- `channels.json` — dados reais dos canais (590+ canais, incluindo relay 591).

## Product Principles

1. A sala de controle deve ser legível num relance: estados de canal (LIVE/VOD/LOOP/RELAY/OFFLINE) e métricas críticas nunca ambíguos.
2. Ações destrutivas (parar, excluir, bloquear, iniciar todos) exigem confirmação clara.
3. Operar deve ser rápido e sem fricção: busca, filtro, ordenação e player embutido a um clique.
4. Confiabilidade acima de decoração: manter todos os modos de canal, monitoramento e segurança funcionando de forma idêntica.
5. Clareza de conteúdo: distinguir canais +18 sem estigmatizar e sem escondê-los.

## Accessibility & Inclusion

Painel web servido em navegador desktop e mobile. Contrastes adequados sobre fundo escuro (estado atual), estados de foco visíveis e alvos de clique com tamanho adequado para operação rápida em tela grande e uso em telas menores.

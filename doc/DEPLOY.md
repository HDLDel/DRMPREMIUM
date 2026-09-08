# Deploy — colocar o sistema de pé (máquina nova) e atualizar

> Guia passo a passo: o que cada script faz e a ordem certa de rodar.
> Para uma máquina **nova**, siga a sequência 1 → 2 → 3.

---

## Parte 1 — Instalar numa máquina nova

### Sequência correta

```bash
# 1. INSTALAR TUDO (Node, FFmpeg, Nginx, PM2, pastas, config, crons)
cd /caminho/do/projeto
sudo ./scripts/install_ubuntu.sh

# 2. ANTI-TRAVAMENTO (rede espalhada por todos os cores, filas grandes)
#    Troque "eno1" pela interface de rede da máquina (veja com: ip link)
sudo ./scripts/server-tuning/install.sh --interface eno1

# 3. REINICIAR (para os ajustes de rede valerem de vez)
sudo reboot
```

Depois do reboot o sistema já está no ar. Acesse o painel:
`http://<IP-do-servidor>:8081`

Na primeira vez:
- Confira os administradores em `server.js` (`ADMINS`, hashes bcrypt) e crie/ajuste se preciso
- Coloque os vídeos na pasta `24HORAS/` e configure os canais
- No dashboard, use **"Iniciar Tudo"** (os canais sobem em lotes, sem travamento)

### O que o passo 1 faz sozinho (não repita)

O `install_ubuntu.sh` **já inclui**:
- instalação do Node.js 20, FFmpeg, Nginx, PM2, dependências do projeto
- criação das pastas `logs/` e `24HORAS/`
- cópia da config do Nginx + `blocked_ips.conf`/`blocked_ips.json` vazios
- ajustes de desempenho do kernel (o conteúdo do `ajuste.sh`)
- os cron jobs (limpeza de logs + reboot diário 03:00 — conteúdo do `setup_crons.sh`)
- start automático com PM2

---

## Parte 2 — Atualizar um servidor que já está no ar (deploy de código)

```bash
# 1. Gerar o build (ofusca server.js/script.js, minifica HTML/CSS)
cd /caminho/do/projeto
python3 scripts/build-obfuscated.py    # gera a pasta DRMPREMIUM/

# 2. Enviar para o servidor (escolha a skill conforme o destino)
python3 .agents/skills/deploy-producao/scripts/deploy.py   # PRODUÇÃO
python3 .agents/skills/deploy-VPS-1/scripts/deploy.py      # testes
python3 .agents/skills/deploy-VPS-2/scripts/deploy.py      # testes
```

Se a configuração do **Nginx** mudou, depois do deploy:

```bash
sudo ./scripts/update_nginx.sh          # reaplica a config e reinicia o Nginx
```

---

## Referência — o que cada script faz

### `scripts/`

| Script | O que faz | Quando rodar |
|--------|-----------|--------------|
| `install_ubuntu.sh` | **Instala a máquina inteira**: Node, FFmpeg, Nginx, PM2, ajustes de desempenho, crons e start com PM2 | Só numa **máquina nova** |
| `server-tuning/install.sh` | **Anti-travamento**: rede espalhada pelos cores (RPS), filas de rede grandes, nginx `worker_connections 4096`. Idempotente (pode rodar de novo) e faz backup | 1 vez por máquina (logo após o passo 1) |
| `setup_crons.sh` | Cria os cron jobs: limpeza de logs (2h) + **reboot 03:00** | Já roda dentro do `install_ubuntu.sh` |
| `ajuste.sh` | Ajustes de desempenho do kernel (memória, buffers de rede, placa, swap) | Já roda dentro do `install_ubuntu.sh` |
| `update_nginx.sh` | Copia a config do Nginx do projeto para o sistema e a aplica | Toda vez que `nginx_iptv.conf` mudar |
| `sync_nginx_config.sh` | Direção oposta: puxa a config que está **ativa no servidor** de volta pro projeto (com commit) | Se o servidor e o projeto divergirem |
| `build-obfuscated.py` | Gera o `DRMPREMIUM/` (build ofuscado/minificado) | A cada deploy de código |

### `scripts/server-tuning/`

| Script | O que faz |
|--------|-----------|
| `install.sh` | O instalador do anti-travamento (chama o `rps-tune.sh` e instala o serviço) |
| `rps-tune.sh` | Só o RPS: espalha a rede por todos os cores. Roda sozinho e no boot (via systemd) |
| `iptv-rps.service` | Serviço do sistema que reaplica o RPS a cada ligação da máquina |
| `sysctl-iptv.conf` | Fragmento de referência das filas de rede (`somaxconn`, `netdev_max_backlog`) |

---

## Sequência de uma linha para máquina nova

```bash
sudo ./scripts/install_ubuntu.sh && sudo ./scripts/server-tuning/install.sh --interface eno1 && sudo reboot
```
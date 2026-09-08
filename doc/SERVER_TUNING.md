# Tuning de rede do servidor (anti travamento)

> **O que resolve:** micro-travamentos do painel e lentidão geral quando os
> canais IPTV sobem em massa (588+ FFmpeg) após reboot ou "Iniciar Tudo".

## O problema em resumo

Quando 590 canais FFmpeg sobem de uma vez, a placa de rede recebe uma rajada
enorme. Em servidores com **muitos cores, mas uma única fila de RX**, toda a
rede chega por **1 core só** — a fila estoura, o sistema operacional **descarta
pacotes** (`rx_dropped`) e as conexões voltam a ser reenviadas milhares de vezes
(`TcpRetransSegs`), causando travamentos no painel.

### Sintomas (como identificar)

| Indicador             | Comando                          | Valor "ruim"        |
| --------------------- | -------------------------------- | ------------------- |
| Retransmissões TCP    | `grep TcpRetransSegs /proc/net/netstat` | milhões acumulados |
| Descarte de pacotes   | `ethtool -S eno1 \| grep rx_dropped`    | crescendo rápido    |
| Overflow no accept    | `grep ListenOverflows /proc/net/netstat`| milhares           |
| RPS desligado (1 core) | `cat /sys/class/net/enX/queues/rx-0/rps_cpus` | `0`            |

## As 4 mudanças

| # | Mudança                          | Valor                     | Por quê                                    |
|---|----------------------------------|---------------------------|--------------------------------------------|
| 1 | Throttle de subida em massa (código) | lotes de 10 + pausa 500ms | evita a rajada de quase 600 FFmpeg juntos |
| 2 | RPS em todas as filas RX         | máscara = todos os cores  | espalha a rede por todos os cores          |
| 3 | Filas de aceite/backlog maiores  | `fs.file-max 2097152`, `somaxconn 4096`, `netdev_max_backlog 5000` | absorve o pico sem descartar |
| 4 | Nginx: fila 4096 + timeouts 600s | `backlog=4096 reuseport`, `proxy_read_timeout 600s` | "Iniciar Tudo" não dá timeout (504) |

O item **1** vive no código (`doc/DEVELOPER.md` → "Start em massa"). Os itens
**2, 3 e 4** vivem nesta pasta `scripts/server-tuning/` e são aplicados no servidor.

## Como aplicar numa máquina nova (uma vez só)

```bash
cd /caminho/do/projeto
sudo ./scripts/server-tuning/install.sh --interface eno1
```

O instalador é **idempotente** — aplica tudo com segurança, faz backup dos
arquivos do sistema (`nginx.conf.bak.<data>`, `sysctl.conf.bak.<data>`) e **não
pede reboot** ao final. Faça um reboot quando conveniente.

### O que o instalador faz passo a passo

1. **nginx.conf** → `worker_connections 4096` + `multi_accept on`
2. **nginx_iptv.conf** (do projeto) → copiado para `/etc/nginx/sites-available/`
   (+ symlink + remove default), `nginx -t` e `reload`
3. **sysctl** → `fs.file-max = 2097152`, `net.core.somaxconn = 4096` e
   `net.core.netdev_max_backlog = 5000` adicionados ao `/etc/sysctl.conf` e
   aplicados na hora (`sysctl -p`)
4. **RPS** → `/usr/local/sbin/iptv-rps-tune.sh` espalha o RX por todos os cores
   de TODAS as filas da interface + serviço `iptv-rps.service` (systemd) que
   reaplica no boot

> Obs.: o `install.sh` não mexe nos cron jobs (limpeza de logs e reboot 03:00).
> Isso é papel do `setup_crons.sh`, já existente no projeto:
> `sudo ./scripts/setup_crons.sh`

## Verificação pós-instalação

```bash
# Nginx
grep -E 'worker_connections|multi_accept' /etc/nginx/nginx.conf
ss -lnt | grep :8081          # Send-Q deve mostrar o backlog

# Sysctl (valores aplicados agora)
sysctl -n net.core.somaxconn net.core.netdev_max_backlog

# RPS (deve mostrar máscara cheia, ex.: ffff,ffffffff,ffffffff)
cat /sys/class/net/enX/queues/rx-0/rps_cpus
systemctl status iptv-rps.service

# Processos FFmpeg subindo em lotes (não mais de uma vez)
pm2 logs 24horas --lines 50 | grep "Lote"
```

## Arquivos desta pasta

| Arquivo              | Papel                                              |
| -------------------- | -------------------------------------------------- |
| `install.sh`         | Instalador idempotente (roda tudo seguro)          |
| `sysctl-iptv.conf`   | Fragmento de referência das filas do sistema       |
| `rps-tune.sh`        | Script que espalha RX pelos cores (independente do systemd) |
| `iptv-rps.service`   | Unit systemd que reaplica o RPS a cada boot        |
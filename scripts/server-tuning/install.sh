#!/bin/bash
# ============================================================
# Instalador do tuning de rede do IPTV (anti travamento).
#
# Aplica, de forma idempotente (pode rodar quantas vezes quiser):
#   1. nginx: worker_connections 4096 + multi_accept on
#   2. nginx_iptv.conf do projeto para /etc/nginx/sites-available/
#   3. sysctl: net.core.somaxconn = 4096 + netdev_max_backlog = 5000
#   4. RPS (uma fila de RX por core) + serviço systemd persistente
#
# Antes de mexer, faz backup dos arquivos do sistema com data/hora.
# O nginx é apenas TESTADO (nginx -t) e recarregado (reload) — sem parar.
# O rebot NÃO é solicitado por este script.
#
# Uso:  sudo ./install.sh [--interface ethX]
# ============================================================

set -euo pipefail

IFACE="eno1"
if [[ "${1:-}" == "--interface" ]]; then
    IFACE="${2:?Informe a interface, ex.: --interface eth0}"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"

REQ_BIN=(nginx sysctl systemctl)
for b in "${REQ_BIN[@]}"; do
    if ! command -v "$b" >/dev/null 2>&1; then
        echo "[ERRO] Comando '$b' ausente. Abortando." >&2
        exit 1
    fi
done

echo "==> Tuning de rede IPTV (interface: ${IFACE})"
echo ""

# ------------------------------------------------------------
# 1. nginx.conf: worker_connections + multi_accept
# ------------------------------------------------------------
NGINX_CONF="/etc/nginx/nginx.conf"
cp "$NGINX_CONF" "${NGINX_CONF}.bak.${TIMESTAMP}"
echo "[nginx] Backup: ${NGINX_CONF}.bak.${TIMESTAMP}"

sed -i -E 's/worker_connections[[:space:]]+[0-9]+;/worker_connections 4096;/' "$NGINX_CONF"
sed -i -E 's/#?multi_accept[[:space:]]+[a-z]+;/multi_accept on;/' "$NGINX_CONF"
if ! grep -q "multi_accept" "$NGINX_CONF"; then
    sed -i '/worker_connections/a\\tmulti_accept on;' "$NGINX_CONF"
fi
echo "[nginx] worker_connections -> 4096, multi_accept -> on"

# ------------------------------------------------------------
# 2. nginx_iptv.conf do projeto no sites-available
# ------------------------------------------------------------
cp "$PROJ_DIR/nginx_iptv.conf" /etc/nginx/sites-available/nginx_iptv.conf
ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/nginx_iptv.conf
rm -f /etc/nginx/sites-enabled/default
echo "[nginx] nginx_iptv.conf sincronizado (backlog=4096 reuseport + proxy_read_timeout 600s)"

nginx -t
systemctl reload nginx
echo "[nginx] sintaxe OK + reload aplicado"

# ------------------------------------------------------------
# 3. sysctl
# ------------------------------------------------------------
SYSCONF="/etc/sysctl.conf"
cp "$SYSCONF" "${SYSCONF}.bak.${TIMESTAMP}"
echo "[sysctl] Backup: ${SYSCONF}.bak.${TIMESTAMP}"

while read -r key val; do
    grep -qE "^${key}[[:space:]]*=" "$SYSCONF" || echo "${key} = ${val}" >> "$SYSCONF"
done <<'EOF'
net.core.somaxconn 4096
net.core.netdev_max_backlog 5000
EOF
sysctl -p
echo "[sysctl] somaxconn=4096 + netdev_max_backlog=5000 persistidos e aplicados"

# ------------------------------------------------------------
# 4. RPS + serviço systemd
# ------------------------------------------------------------
cp "$SCRIPT_DIR/rps-tune.sh" /usr/local/sbin/iptv-rps-tune.sh
chmod +x /usr/local/sbin/iptv-rps-tune.sh
IFACE="$IFACE" /usr/local/sbin/iptv-rps-tune.sh
echo "[rps] aplicado agora em ${IFACE}"

cp "$SCRIPT_DIR/iptv-rps.service" /etc/systemd/system/iptv-rps.service
systemctl daemon-reload
systemctl enable iptv-rps.service >/dev/null 2>&1
systemctl start iptv-rps.service
echo "[rps] serviço iptv-rps persistente (sobe sozinho no boot)"

# ------------------------------------------------------------
# Resumo
# ------------------------------------------------------------
echo ""
echo "==> ARRUMADO. Estado atual:"
echo "  worker_connections : $(grep -E '^\s*worker_connections' "$NGINX_CONF" | awk '{print $2}')"
echo "  multi_accept       : $(grep -E '^\s*multi_accept' "$NGINX_CONF" | awk '{print $2}')"
echo "  somaxconn          : $(sysctl -n net.core.somaxconn)"
echo "  netdev_max_backlog : $(sysctl -n net.core.netdev_max_backlog)"
echo "  rps service        : $(systemctl is-active iptv-rps.service) / enabled=$(systemctl is-enabled iptv-rps.service)"
echo ""
echo "Para aplicar de vez, reinicie a máquina quando for conveniente."
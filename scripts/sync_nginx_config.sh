#!/bin/bash
# Sincroniza a config do nginx do sistema com o projeto (versionado no git)
PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYS_CONF="/etc/nginx/sites-enabled/nginx_iptv.conf"
PROJ_CONF="$PROJ_DIR/nginx_iptv.conf"

if ! diff -q "$SYS_CONF" "$PROJ_CONF" >/dev/null 2>&1; then
    cp "$SYS_CONF" "$PROJ_CONF"
    cd "$PROJ_DIR" && git add nginx_iptv.conf && git commit -m "sync nginx config" -q 2>/dev/null || true
fi

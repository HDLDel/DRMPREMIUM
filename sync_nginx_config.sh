#!/bin/bash
# Sincroniza a config do nginx do sistema com o projeto (versionado no git)
SYS_CONF="/etc/nginx/sites-enabled/nginx_iptv.conf"
PROJ_CONF="/home/drmpremium/nginx_iptv.conf"
PROJ_DIR="/home/drmpremium"

if ! diff -q "$SYS_CONF" "$PROJ_CONF" >/dev/null 2>&1; then
    cp "$SYS_CONF" "$PROJ_CONF"
    cd "$PROJ_DIR" && git add nginx_iptv.conf && git commit -m "sync nginx config" -q 2>/dev/null || true
fi

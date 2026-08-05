#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "Este script precisa ser executado como root. Reexecutando com sudo..."
  exec sudo bash "$0" "$@"
fi

set -e

PROJDIR="$(cd "$(dirname "$0")" && pwd)"
APP_USER="drmpremium"

# ═══════════════════════════════════════════════
# VALIDAÇÃO PRÉVIA — todos os arquivos exigidos
# ═══════════════════════════════════════════════

# Se channels.json não existir, cria um banco de canais inicial vazio
if [ ! -f "$PROJDIR/channels.json" ]; then
  echo "[]" > "$PROJDIR/channels.json"
  echo "  Criado channels.json inicial (vazio)"
fi

REQUIRED_FILES=(
  server.js
  index.html
  login.html
  script.js
  style.css
  package.json
  nginx_iptv.conf
)

MISSING=0
echo "=== Verificando arquivos obrigatórios ==="
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$PROJDIR/$f" ]; then
    echo "  FALTANDO: $f"
    MISSING=1
  else
    echo "  OK: $f"
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "ERRO: Arquivos obrigatórios ausentes. Corrija antes de executar."
  echo "Execute este script dentro da pasta do projeto com todos os arquivos acima."
  exit 1
fi

echo "Todos os arquivos OK. Iniciando instalação..."
echo ""

# ═══════════════════════════════════════════════
# 1. ATUALIZAR REPOSITÓRIOS
# ═══════════════════════════════════════════════

echo "=== Atualizando repositórios ==="
apt update && apt upgrade -y

# ═══════════════════════════════════════════════
# 2. DEPENDÊNCIAS BASE
# ═══════════════════════════════════════════════

echo "=== Instalando dependências do sistema ==="
apt install -y curl ffmpeg nginx git

# ═══════════════════════════════════════════════
# 3. NODE.JS 20
# ═══════════════════════════════════════════════

echo "=== Instalando Node.js 20 LTS ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# ═══════════════════════════════════════════════
# 4. PM2 GLOBAL
# ═══════════════════════════════════════════════

echo "=== Instalando PM2 ==="
npm install -g pm2

# ═══════════════════════════════════════════════
# 5. DEPENDÊNCIAS DO PROJETO
# ═══════════════════════════════════════════════

echo "=== Instalando dependências do projeto ==="
cd "$PROJDIR"
npm install --production

# ═══════════════════════════════════════════════
# 6. PASTAS NECESSÁRIAS
# ═══════════════════════════════════════════════

echo "=== Criando pastas ==="
mkdir -p "$PROJDIR/canais" "$PROJDIR/24HORAS"

# ═══════════════════════════════════════════════
# 7. CONFIGURAÇÃO NGINX
# ═══════════════════════════════════════════════

echo "=== Configurando Nginx ==="
cp "$PROJDIR/nginx_iptv.conf" /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/nginx_iptv.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/iptv

if [ ! -f /etc/nginx/blocked_ips.conf ]; then
  touch /etc/nginx/blocked_ips.conf
  echo "  blocked_ips.conf criado"
fi

if [ ! -f /etc/nginx/blocked_ips.json ]; then
  echo "[]" > /etc/nginx/blocked_ips.json
  echo "  blocked_ips.json criado"
fi

nginx -t
systemctl restart nginx
echo "  Nginx OK"

# ═══════════════════════════════════════════════
# 8. AJUSTES DE DESEMPENHO (inline do ajuste.sh)
# ═══════════════════════════════════════════════

echo "=== Aplicando ajustes de desempenho ==="

# Kernel parameters — memória/VM
sysctl -w vm.dirty_ratio=5
sysctl -w vm.dirty_background_ratio=3
sysctl -w vm.vfs_cache_pressure=500

# Kernel parameters — rede
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216"
sysctl -w net.core.netdev_budget=600
sysctl -w net.core.netdev_budget_usecs=4000
sysctl -w net.core.optmem_max=262144
sysctl -w net.ipv4.tcp_congestion_control=cubic
sysctl -w net.ipv4.tcp_syncookies=1

# Persistência via sysctl.d
cat > /etc/sysctl.d/99-iptv-performance.conf << 'SYSCTL'
vm.dirty_ratio = 5
vm.dirty_background_ratio = 3
vm.vfs_cache_pressure = 500

net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.netdev_budget = 600
net.core.netdev_budget_usecs = 4000
net.ipv4.tcp_congestion_control = cubic
net.core.optmem_max = 262144
net.ipv4.tcp_syncookies = 1
SYSCTL
echo "  /etc/sysctl.d/99-iptv-performance.conf criado"

# Módulo tcp_bbr
modprobe tcp_bbr 2>/dev/null || true
echo 'tcp_bbr' > /etc/modules-load.d/bbr.conf
echo "  bbr module configurado"

# Ring buffer da NIC
if ethtool eno1 >/dev/null 2>&1; then
  ethtool -G eno1 rx 8192 tx 8192 2>/dev/null || ethtool -G eno1 rx 4096 tx 4096 2>/dev/null || true
  echo "  Ring buffer eno1 configurado (ou mantido limite da placa)"
else
  echo "  NIC eno1 não encontrada, ring buffer ignorado"
fi

# Swap off
swapoff -a 2>/dev/null || true
sed -i '/\sswap\s/ s/^/#/' /etc/fstab 2>/dev/null || true
echo "  Swap desativado e removido do fstab"

sysctl --system >/dev/null 2>&1 || true
echo "  sysctl --system reload OK"

echo "=== Ajustes de desempenho aplicados ==="

# ═══════════════════════════════════════════════
# 8.1. CONFIGURAR CRONS DO SISTEMA
# ═══════════════════════════════════════════════

if [ -f "$PROJDIR/setup_crons.sh" ]; then
  echo "=== Configurando crons do sistema ==="
  bash "$PROJDIR/setup_crons.sh"
fi

# ═══════════════════════════════════════════════
# 9. INICIAR APLICAÇÃO COM PM2
# ═══════════════════════════════════════════════

echo "=== Iniciando aplicação com PM2 ==="
pm2 delete 24horas 2>/dev/null || true
cd "$PROJDIR"
pm2 start server.js --name 24horas
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ═══════════════════════════════════════════════
# 10. MENSAGEM FINAL
# ═══════════════════════════════════════════════

echo ""
echo "═══════════════════════════════════════════"
echo "  INSTALAÇÃO CONCLUÍDA!"
echo "  O sistema já está online."
echo "  Acesse: http://$(curl -s http://checkip.amazonaws.com 2>/dev/null || hostname -I | awk '{print $1}'):8081"
echo "═══════════════════════════════════════════"

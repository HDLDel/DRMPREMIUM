#!/bin/bash
set -e

echo "=== Aplicando ajustes de desempenho do sistema ==="

# ─── Kernel parameters (memória/VM) ───
sysctl -w vm.dirty_ratio=5
sysctl -w vm.dirty_background_ratio=3
sysctl -w vm.vfs_cache_pressure=500

# ─── Kernel parameters (rede 10GbE) ───
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216"
sysctl -w net.core.netdev_budget=600
sysctl -w net.core.netdev_budget_usecs=4000
sysctl -w net.core.optmem_max=262144
sysctl -w net.ipv4.tcp_congestion_control=cubic

# ─── Persistência via sysctl.d ───
cat > /etc/sysctl.d/99-iptv-performance.conf << 'EOF'
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
EOF
echo "  → /etc/sysctl.d/99-iptv-performance.conf criado"

# ─── Módulo tcp_bbr (para quem quiser testar BBR no futuro) ───
modprobe tcp_bbr
echo 'tcp_bbr' > /etc/modules-load.d/bbr.conf
echo "  → /etc/modules-load.d/bbr.conf criado"

# ─── Ring buffer da NIC ───
ethtool -G eno1 rx 8192 tx 8192
echo "  → Ring buffer eno1: RX=8192 TX=8192"

# ─── Swap off ───
swapoff -a 2>/dev/null || true
# Remove entrada do swap do fstab (comenta linhas com 'swap')
sed -i '/\sswap\s/ s/^/#/' /etc/fstab 2>/dev/null || true
echo "  → Swap desativado e removido do fstab"

echo ""
echo "=== Ajustes aplicados com sucesso ==="
echo "Recomendado: sysctl --system (recarregar tudo) ou reboot"

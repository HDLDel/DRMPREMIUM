#!/bin/bash
# Espalha o processamento de rede (RPS) por todos os cores.
# Resolve o gargalo do core único de RX (rx_dropped / retransmissões).
#
# Uso:
#   INTERFACE=eno1 ./rps-tune.sh
#   ./rps-tune.sh eno1
#
# A máscara é calculada pelo número de CPUs (nproc) — não precisa ajustar à mão.

IFACE="${INTERFACE:-${1:-eno1}}"

if [ ! -d "/sys/class/net/${IFACE}/queues" ]; then
    echo "[RPS] Interface de rede '${IFACE}' não encontrada." >&2
    exit 1
fi

n=$(nproc)
words=$(( (n + 31) / 32 ))
parts=()
for ((w = words - 1; w >= 0; w--)); do
    start=$(( w * 32 ))
    remaining=$(( n - start ))
    if [ "$remaining" -ge 32 ]; then
        parts+=("ffffffff")
    else
        val=$(( (1 << remaining) - 1 ))
        parts+=("$(printf '%08x' "$val")")
    fi
done
MASK=$(IFS=,; echo "${parts[*]}")

applied=0
for q in /sys/class/net/${IFACE}/queues/rx-*; do
    if [ -f "$q/rps_cpus" ]; then
        echo "$MASK" > "$q/rps_cpus" 2>/dev/null && applied=$((applied + 1))
    fi
done

echo "[RPS] ${applied} filas RX do ${IFACE} configuradas (máscara ${MASK})."
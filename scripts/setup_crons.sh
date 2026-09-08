#!/bin/bash
# Configura cron jobs do sistema IPTV
# 1. Limpa logs dos canais a cada 2 horas
# 2. Reinicia a máquina diariamente às 3:00

PROJDIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGS_DIR="$PROJDIR/logs"

# Garante que a pasta de logs existe
mkdir -p "$LOGS_DIR"

# Cria o script de limpeza de logs
cat > /usr/local/bin/limpar_logs_iptv.sh << EOF
#!/bin/bash
# Remove logs de canais IPTV mais antigos que 2 horas
find "$LOGS_DIR" -name "canal_*.log" -mmin +120 -delete 2>/dev/null
EOF
chmod +x /usr/local/bin/limpar_logs_iptv.sh

# Adiciona cron jobs de forma atômica (sem apagar a regra anterior)
(crontab -l 2>/dev/null | grep -v "limpar_logs_iptv\|reboot"
 echo "0 */2 * * * /usr/local/bin/limpar_logs_iptv.sh"
 echo "0 3 * * * /sbin/reboot"
) | crontab -

echo "Cron jobs configurados com sucesso:"
crontab -l

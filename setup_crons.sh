#!/bin/bash
# Configura cron jobs do sistema IPTV
# 1. Limpa logs dos canais a cada 2 horas
# 2. Reinicia a máquina diariamente às 3:00

LOGS_DIR="/home/drmpremium/logs"

# Cria o script de limpeza de logs
cat > /usr/local/bin/limpar_logs_iptv.sh << 'EOF'
#!/bin/bash
# Remove logs de canais IPTV mais antigos que 2 horas
find /home/drmpremium/logs -name "canal_*.log" -mmin +120 -delete 2>/dev/null
EOF
chmod +x /usr/local/bin/limpar_logs_iptv.sh

# Adiciona cron jobs (evita duplicar)
(crontab -l 2>/dev/null | grep -v "limpar_logs_iptv\|reboot" ; echo "0 */2 * * * /usr/local/bin/limpar_logs_iptv.sh") | crontab -
(crontab -l 2>/dev/null | grep -v "limpar_logs_iptv\|reboot" ; echo "0 3 * * * /sbin/reboot") | crontab -

echo "Cron jobs configurados:"
crontab -l

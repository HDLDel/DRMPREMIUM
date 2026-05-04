Configurações e Regras: .aiexclude, .gitignore, GEMINI.md, package.json, readme.md.
Backend (Node.js): server.js.
Frontend (HTML/JS/CSS): index.html, login.html, script.js, style.css.
Scripts de Deploy/Servidor: install_ubuntu.sh, update_nginx.sh, nginx_iptv.conf.
Dados e Logs: playlist.txt, grok_logs.csv.


O que procurar no Log:

Non-matching parameters in input streams: Confirmaria que os vídeos da pasta são diferentes entre si.
Error demuxing / Input/output error: Indica que o arquivo de vídeo está corrompido ou o disco falhou na leitura.
Frame rate very high / Spewing statistics: Pode indicar que o servidor está sem CPU para processar aquele canal específico em tempo real.


1. Sobre outros logs do sistema: Sim, você pode verificar se o sistema operacional está interrompendo o processo por falta de recursos (como memória) usando estes comandos no terminal:

dmesg | tail -n 50: Verifica se o "OOM Killer" (matador de processos por falta de memória) agiu.
journalctl -u nginx --since "1 hour ago": Verifica se o Nginx reportou erros de conexão.
pm2 logs iptv-pro: Mostra se o próprio Node.js está sofrendo algum crash interno.

comando para configurar a inicialização automática definitiva.

pm2 start /home/drmpremium/server.js --name iptv-pro

pm2 startup

pm2 save


ls -ld /home/drmpremium/canais/*


pm2 restart iptv-pro

find /home/drmpremium/canais/ -maxdepth 1 -type l -delete


ADMIN_USER=meuusuario ADMIN_PASS=minhasenha pm2 restart iptv-pro


<BCRYPT_HASH_PLACEHOLDER>

node -e "console.log(require('bcryptjs').hashSync('<REDACTED_PASSWORD>', 10))"


ls -lh /dev/shm/iptv_canais/21

ls -lh /dev/shm/iptv_canais

ls -ld /home/drmpremium/canais/*


monitoramento

ps -fp $(pgrep -f "iptv_canais/5/") >> canal5.txt


while true; do date >> canal5_full_monitor.txt; ps -fp $(pgrep -f "iptv_canais/5/") >> canal5_full_monitor.txt 2>&1; echo "--------------------------------" >> canal5_full_monitor.txt; sleep 5; done



mkdir -p convertidos && for f in *.mp4; do ffmpeg -i "$f" -c:v libx264 -profile:v high -level:v 4.0 -r 24 -vf "scale=1280:720" -c:a aac -ac 2 -ar 44100 "convertidos/$f"; done

-profile:v high -level:v 4.0: Define o perfil High e Nível 4.0.

-r 24: Estabelece o framerate fixo de 24 FPS (CFR).

-vf "scale=1280:720": Altera a resolução para as dimensões fixas de 1280x720.

-c:a aac: Força a re-encodagem de áudio para AAC.

-ac 2: Reduz ou mapeia os canais para Stereo.

-ar 44100: Define a taxa de amostragem em 44.1 kHz.







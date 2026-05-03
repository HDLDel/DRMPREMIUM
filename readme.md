Configurações e Regras: .aiexclude, .gitignore, GEMINI.md, package.json, readme.md.
Backend (Node.js): server.js.
Frontend (HTML/JS/CSS): index.html, login.html, script.js, style.css.
Scripts de Deploy/Servidor: install_ubuntu.sh, update_nginx.sh, nginx_iptv.conf.
Dados e Logs: playlist.txt, grok_logs.csv.


O que procurar no Log:

Non-matching parameters in input streams: Confirmaria que os vídeos da pasta são diferentes entre si.
Error demuxing / Input/output error: Indica que o arquivo de vídeo está corrompido ou o disco falhou na leitura.
Frame rate very high / Spewing statistics: Pode indicar que o servidor está sem CPU para processar aquele canal específico em tempo real.

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







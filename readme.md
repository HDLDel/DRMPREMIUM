Configurações e Regras: .aiexclude, .gitignore, GEMINI.md, package.json, readme.md.
Backend (Node.js): server.js.
Frontend (HTML/JS/CSS): index.html, login.html, script.js, style.css.
Scripts de Deploy/Servidor: install_ubuntu.sh, update_nginx.sh, nginx_iptv.conf.
Dados e Logs: playlist.txt, grok_logs.csv.


comando para configurar a inicialização automática definitiva.

pm2 start /home/drmpremium/server.js --name iptv-pro

pm2 startup

pm2 save


ls -ld /home/drmpremium/canais/*


pm2 restart iptv-pro

find /home/drmpremium/canais/ -maxdepth 1 -type l -delete


ADMIN_USER=meuusuario ADMIN_PASS=minhasenha pm2 restart iptv-pro


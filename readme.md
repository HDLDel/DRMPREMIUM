comando para configurar a inicialização automática definitiva.

pm2 start /home/drmpremium/server.js --name iptv-pro

pm2 startup

pm2 save


ls -ld /home/drmpremium/canais/*


pm2 restart iptv-pro

find /home/drmpremium/canais/ -maxdepth 1 -type l -delete


ADMIN_USER=meuusuario ADMIN_PASS=minhasenha pm2 restart iptv-pro


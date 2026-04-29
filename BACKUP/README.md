# IPTV Pro - Sistema de Gerenciamento de Canais 24h

Este projeto é um painel de controle robusto para a criação de canais lineares de IPTV. Ele transforma coleções de vídeos locais (MP4) em transmissões contínuas utilizando o protocolo **HLS (HTTP Live Streaming)** e o motor de processamento **FFmpeg**.

## 📁 Estrutura do Projeto

O projeto divide as responsabilidades em dois diretórios principais:

*   **Aplicação (`/home/drmpremium/`)**: Contém o painel, scripts de controle e a pasta `/canais/` (HLS temporário).
*   **Acervo de Vídeos (`/home/drmpremium/`)**: Diretório onde residem os arquivos MP4 originais.
*   **Dashboard (`index.php`)**: Gestão centralizada e telemetria.
*   **Core Scripts**: Automação de streaming e correção de vídeo no mesmo nível do painel.
## 🚀 Tecnologias Utilizadas

*   **PHP 7.4+**: Lógica de servidor e gestão de processos.
*   **FFmpeg**: Transcodificação e geração de segmentos HLS.
*   **Nginx**: Servidor web e distribuidor dos segmentos de vídeo.
*   **Bash/Shell**: Gerenciamento de loops e resiliência de processos.

## ⚙️ Fluxo de Funcionamento

1.  **Ingestão**: O usuário seleciona pastas de vídeo via `canais.php`.
2.  **Preparação**: O sistema gera um arquivo `playlist.txt` com o caminho absoluto de cada vídeo.
3.  **Normalização**: O script `normalizar.php` analisa os vídeos. Se houver erro de *timestamp*, ele reconstrói o arquivo para evitar travamentos no streaming.
4.  **Processamento**: O FFmpeg inicia o canal em loop. Ele lê a playlist, transcodifica o vídeo em tempo real para garantir estabilidade e gera pequenos blocos `.ts`.
5.  **Distribuição**: O Nginx serve o arquivo `.m3u8` (índice) e os blocos `.ts`. O player do cliente baixa esses pedaços sequencialmente.

## 📂 Mapa de Arquivos (Detalhamento)

*   `index.php`: Dashboard com telemetria e controle dos canais ativos.
*   `canais.php`: Explorador de arquivos para selecionar vídeos e criar a estrutura do canal.
*   `conexoes.php`: Monitor em tempo real que mostra quem está assistindo e qual IP está conectado.
*   `player.php`: Visualizador interno para testar o stream.
*   `config.php`: Definições de segurança e credenciais de acesso.
*   `gerar_m3u.php`: Gera a lista de reprodução para o admin.
*   `rede.php`: API que fornece dados de tráfego de rede para o dashboard.
*   `normalizar.php`: Ferramenta que corrige vídeos com "timestamp quebrado" antes da transmissão.
*   `start.php`: Responsável por disparar o comando FFmpeg com as flags de estabilidade.
*   `stop.php`: Encerra os processos PID e limpa o cache HLS.
*   `monitor_streams.php`: Script "Watchdog" que reinicia canais automaticamente caso o FFmpeg feche.
*   `status.php`: API que retorna o estado geral do servidor em JSON.
*   `play.php`: Proxy de autenticação e entrega de playlist corrigida.

## 📺 Funcionamento dos Arquivos de Stream

*   **`.ts` (Transport Stream)**: O vídeo é cortado em pedaços de ~6 a 10 segundos. Isso permite que o player mude de vídeo ou recupere de quedas de internet sem carregar o arquivo todo.
*   **`.m3u8`**: O arquivo mestre. Ele é atualizado a cada segundo pelo FFmpeg para dizer ao player: "baixe agora o segmento 005.ts".

## ⚠️ Configuração do Nginx

Certifique-se de que o seu Nginx aponta corretamente para a raiz do projeto e para a pasta de saída dos canais:

```nginx
location /live/ {
    alias /home/drmpremium/; # Onde os vídeos e .m3u8 são gerados
    add_header 'Access-Control-Allow-Origin' '*';
}
```

---
*Documentação gerada para o sistema de gerenciamento de fluxos HLS.*
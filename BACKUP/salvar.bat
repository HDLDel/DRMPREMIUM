@echo off
REM Muda para o diretorio do script
cd /d "%~dp0"

cls
echo ======================================================
echo           IPTV PRO - SISTEMA DE BACKUP (GIT)
echo ======================================================
echo.

:: Verifica se o Git foi inicializado, se não, inicializa
if not exist .git (
    echo [!] Inicializando o controle de versao pela primeira vez...
    git init
    git branch -M main
)

echo [+] Arquivos modificados:
git status -s
echo.

:: 1. Pergunta qual a mensagem do commit
set /p mensagem="O que voce alterou? : "

:: Se o usuario der enter sem digitar nada, define uma mensagem padrao
if "%mensagem%"=="" set mensagem="Atualizacao de rotina em %date% %time%"

echo.
echo [+] Adicionando arquivos ao ponto de restauracao...
git add .

:: Verifica se ha algo de fato para commitar para evitar erro de commit vazio
git diff --cached --quiet
if %errorlevel% neq 0 (
    echo [+] Criando a versao: "%mensagem%"
    git commit -m "%mensagem%"
    echo.
    echo ======================================================
    echo           SUCESSO! PROJETO VERSIONADO
    echo ======================================================
) else (
    echo [!] Nenhuma alteracao encontrada para salvar.
)

echo.
echo Ultimos registros no historico:
git log --oneline -n 5
echo.
pause

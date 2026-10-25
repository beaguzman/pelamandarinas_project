@echo off
cd /d "%~dp0"
echo === Rol 1: subir cliente TS, doc y limpieza a GitHub ===
git pull --ff-only
git rm --cached --quiet --ignore-unmatch settings.json invoke.log
if exist settings.json del /q settings.json
if exist invoke.log del /q invoke.log
git add .gitignore docs packages
git status --short
git commit -m "Rol 1: cliente TS (packages/cascada), doc del contrato en testnet y limpieza"
git push
echo.
echo LISTO. Puedes borrar este SUBIR-ROL1.bat
pause

@echo off
echo.
echo  ===================================
echo   TempMail UI - Demarrage
echo  ===================================
echo.

cd /d "%~dp0"

:: Verifie si node_modules existe
if not exist "node_modules" (
  echo  Installation des dependances...
  npm install
  echo.
)

echo  Serveur disponible sur http://localhost:3000
echo  (Ctrl+C pour arreter)
echo.

:: Ouvre le navigateur apres 1.5s
start "" timeout /t 2 >nul && start http://localhost:3000

node server.js
pause

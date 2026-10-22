@echo off
title CCTV Manager - Local Bridge
color 0A
echo ====================================================
echo   CCTV Manager - Local CCTV Bridge (Port 3880)
echo ====================================================
echo.
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js ในระบบ กรุณาติดตั้ง Node.js จาก https://nodejs.org
    pause
    exit /b
)

echo กำลังเริ่มการทำงานของ Local Bridge...
node server.js
pause

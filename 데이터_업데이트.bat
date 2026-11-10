@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo [박상순부동산] 노원구 부동산 데이터 업데이트를 시작합니다...
node scripts/fetch_data.mjs
echo.
echo 완료되었습니다. index.html 을 새로고침하세요.
pause

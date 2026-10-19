@echo off
setlocal
cd /d "%~dp0"

title EstatePro Server

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   Node.js is not installed, so the EstatePro server cannot start.
    echo   Install the LTS build from https://nodejs.org and run this file again.
    echo.
    pause
    exit /b 1
)

echo.
echo   Starting EstatePro...
echo   Keep this window open while you use the site.
echo   Site: http://localhost:3000/
echo.

sc query MongoDB | find "RUNNING" >nul
if errorlevel 1 (
    echo   Starting the MongoDB Windows service...
    net start MongoDB
    if errorlevel 1 (
        echo.
        echo   MongoDB could not be started. Start the MongoDB service with Windows administrator permission,
        echo   then run this launcher again.
        pause
        exit /b 1
    )
)

start "" "http://localhost:3000/"
node server.js

echo.
echo   The EstatePro server has stopped.
pause

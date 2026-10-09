@echo off
REM Start Chrome with remote debugging port for CDP publishing
REM Usage: start-chrome-cdp.bat

echo Starting Chrome with remote debugging port 9222...

REM Find Chrome executable
set "CHROME_PATH="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) else (
    echo Chrome not found. Please specify Chrome path manually:
    echo   "C:\path\to\chrome.exe" --remote-debugging-port=9222
    pause
    exit /b 1
)

echo Chrome found at: %CHROME_PATH%
echo.
echo Starting Chrome with debugging port...
echo.
echo IMPORTANT:
echo   1. Log in to Zhihu (知乎) and CSDN in the opened Chrome
echo   2. Then run: node cdp-publish.js zhihu
echo   3. Or:        node cdp-publish.js csdn
echo.

start "" "%CHROME_PATH%" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-cdp-profile"

echo Chrome started. Check http://localhost:9222 to verify.
pause

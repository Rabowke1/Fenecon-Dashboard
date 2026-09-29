@echo off
rem Baut dist\FeneconDashboard.exe auf einem Windows-PC mit installiertem Python 3.
cd /d "%~dp0.."
python -m pip install --upgrade pyinstaller || goto :error
python -m unittest test_server test_exports test_tariff || goto :error
python -m PyInstaller -y FeneconDashboard.spec || goto :error
echo.
echo Fertig: dist\FeneconDashboard.exe
goto :eof
:error
echo Build fehlgeschlagen.
exit /b 1

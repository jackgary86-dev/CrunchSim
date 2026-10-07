@echo off
rem Installs or updates CrunchSim on this PC (Desktop and Start Menu shortcuts). See tools\install.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install.ps1" %*
if errorlevel 1 pause

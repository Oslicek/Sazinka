@echo off
REM Sazinka - Stop Full Stack (wrapper)
powershell -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*

@echo off
rem Avvia la versione di prova di Famiglia sul PC (dati finti, niente Supabase) e apre il browser.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0strumenti\server-locale.ps1" -Apri

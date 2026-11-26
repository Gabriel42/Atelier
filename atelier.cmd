@echo off
rem Atelier main menu: double-click this file, or type "atelier" in this folder.
node "%~dp0tools\menu\menu.mjs" %*
if errorlevel 1 pause

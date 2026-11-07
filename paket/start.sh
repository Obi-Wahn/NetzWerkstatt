#!/bin/sh
# Startet die NetzWerkstatt aus dem Ordner, in dem dieses Skript liegt.
cd "$(dirname "$0")" || exit 1
if [ ! -x ./netzwerkstatt ]; then
  chmod +x ./netzwerkstatt 2>/dev/null || {
    echo "Das Programm konnte nicht ausführbar gemacht werden."
    echo "Bitte den Ordner an einen Ort kopieren, an dem du schreiben darfst."
    read -r _
    exit 1
  }
fi
exec ./netzwerkstatt "$@"

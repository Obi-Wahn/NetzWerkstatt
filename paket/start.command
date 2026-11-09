#!/bin/sh
# Startet die NetzWerkstatt auf dem Mac aus dem Ordner, in dem dieses Skript liegt.
# Wählt selbst das passende Programm für Apple-Chips (M1, M2, …) oder Intel.
cd "$(dirname "$0")" || exit 1

case "$(uname -m)" in
  arm64) PROGRAMM=./netzwerkstatt-apple ;;
  *)     PROGRAMM=./netzwerkstatt-intel ;;
esac

# Das Programm ist nicht bei Apple registriert. Nach dem Herunterladen markiert
# macOS alle Dateien als „aus dem Internet“ und würde das Programm blockieren.
# Diese Markierung wird hier für den eigenen Ordner entfernt.
xattr -dr com.apple.quarantine . 2>/dev/null

if [ ! -x "$PROGRAMM" ]; then
  chmod +x "$PROGRAMM" 2>/dev/null || {
    echo "Das Programm konnte nicht ausführbar gemacht werden."
    echo "Bitte den Ordner an einen Ort kopieren, an dem du schreiben darfst,"
    echo "z. B. in „Dokumente“."
    read -r _
    exit 1
  }
fi
exec "$PROGRAMM" "$@"

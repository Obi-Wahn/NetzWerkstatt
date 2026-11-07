#!/bin/sh
# Erzeugt die Programmdateien für Windows und Linux im Ordner dist/.
set -e
cd "$(dirname "$0")"
node test/simulation.test.js
mkdir -p dist
export CGO_ENABLED=0
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dist/netzwerkstatt-windows.exe .
GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dist/netzwerkstatt-linux .
echo "Fertig: dist/netzwerkstatt-windows.exe und dist/netzwerkstatt-linux"

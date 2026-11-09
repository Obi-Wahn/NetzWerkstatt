#!/bin/sh
# Erzeugt die Download-Pakete für Windows, Linux und Mac im Ordner dist/.
# Aufruf: ./build.sh [Version]   z. B. ./build.sh v0.2.0
set -e
cd "$(dirname "$0")"
VERSION="${1:-Entwicklungsstand}"
node test/simulation.test.js
node test/demos.test.js
rm -rf dist
mkdir -p dist/NetzWerkstatt-Windows dist/NetzWerkstatt-Linux dist/NetzWerkstatt-Mac
export CGO_ENABLED=0
FLAGS="-s -w -X main.Version=$VERSION"
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$FLAGS" -o dist/NetzWerkstatt-Windows/NetzWerkstatt.exe .
GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "$FLAGS" -o dist/NetzWerkstatt-Linux/netzwerkstatt .
# Mac: je ein Programm für Apple-Chips und Intel; start.command wählt das passende
GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags "$FLAGS" -o dist/NetzWerkstatt-Mac/netzwerkstatt-apple .
GOOS=darwin  GOARCH=amd64 go build -trimpath -ldflags "$FLAGS" -o dist/NetzWerkstatt-Mac/netzwerkstatt-intel .
# Windows-Anleitung mit Windows-Zeilenenden, damit sie im Editor richtig aussieht
sed 's/$/\r/' paket/LIESMICH-Windows.txt > dist/NetzWerkstatt-Windows/LIESMICH.txt
cp paket/LIESMICH-Linux.txt dist/NetzWerkstatt-Linux/LIESMICH.txt
cp paket/start.sh dist/NetzWerkstatt-Linux/start.sh
chmod +x dist/NetzWerkstatt-Linux/start.sh dist/NetzWerkstatt-Linux/netzwerkstatt
cp paket/LIESMICH-Mac.txt dist/NetzWerkstatt-Mac/LIESMICH.txt
cp paket/start.command dist/NetzWerkstatt-Mac/start.command
chmod +x dist/NetzWerkstatt-Mac/start.command dist/NetzWerkstatt-Mac/netzwerkstatt-apple dist/NetzWerkstatt-Mac/netzwerkstatt-intel
# zip speichert die Ausführrechte; das Archivprogramm des Mac übernimmt sie beim Entpacken
(cd dist && zip -qr NetzWerkstatt-Windows.zip NetzWerkstatt-Windows && tar -czf NetzWerkstatt-Linux.tar.gz NetzWerkstatt-Linux && zip -qr NetzWerkstatt-Mac.zip NetzWerkstatt-Mac)
echo "Fertig: dist/NetzWerkstatt-Windows.zip, dist/NetzWerkstatt-Linux.tar.gz und dist/NetzWerkstatt-Mac.zip"

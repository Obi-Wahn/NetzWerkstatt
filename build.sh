#!/bin/sh
# Erzeugt die Download-Pakete für Windows und Linux im Ordner dist/.
# Aufruf: ./build.sh [Version]   z. B. ./build.sh v0.2.0
set -e
cd "$(dirname "$0")"
VERSION="${1:-Entwicklungsstand}"
node test/simulation.test.js
node test/demos.test.js
rm -rf dist
mkdir -p dist/NetzWerkstatt-Windows dist/NetzWerkstatt-Linux
export CGO_ENABLED=0
FLAGS="-s -w -X main.Version=$VERSION"
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$FLAGS" -o dist/NetzWerkstatt-Windows/NetzWerkstatt.exe .
GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "$FLAGS" -o dist/NetzWerkstatt-Linux/netzwerkstatt .
# Windows-Anleitung mit Windows-Zeilenenden, damit sie im Editor richtig aussieht
sed 's/$/\r/' paket/LIESMICH-Windows.txt > dist/NetzWerkstatt-Windows/LIESMICH.txt
cp paket/LIESMICH-Linux.txt dist/NetzWerkstatt-Linux/LIESMICH.txt
cp paket/start.sh dist/NetzWerkstatt-Linux/start.sh
chmod +x dist/NetzWerkstatt-Linux/start.sh dist/NetzWerkstatt-Linux/netzwerkstatt
(cd dist && zip -qr NetzWerkstatt-Windows.zip NetzWerkstatt-Windows && tar -czf NetzWerkstatt-Linux.tar.gz NetzWerkstatt-Linux)
echo "Fertig: dist/NetzWerkstatt-Windows.zip und dist/NetzWerkstatt-Linux.tar.gz"

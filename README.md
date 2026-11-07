# NetzWerkstatt

**Ein Lernspiel, in dem Schülerinnen und Schüler Netzwerke selbst bauen und den Datenpaketen bei der Arbeit zuschauen.**

Die NetzWerkstatt ist für den Informatikunterricht der Sekundarstufe I gedacht. Sie ist bewusst einfach gehalten: Bauen und Testen passieren auf derselben Fläche, es gibt keine verschachtelten Fenster, und Fehler werden in verständlicher Sprache direkt am Paket erklärt.

## Was kann der Prototyp?

- **Baukasten:** PC, Tablet, Smartphone, Server, Switch, Access Point und Router auf die Arbeitsfläche setzen und per Kabel oder WLAN verbinden. Funktioniert mit Maus und Finger (Windows-PCs und iPads).
- **Netzwerk-Einstellungen:** IP-Adresse (IPv4), Subnetzmaske, Gateway und DNS-Server mit sofortigen Hinweisen, z. B. „lokale (private) Adresse“ oder „Das Gateway muss im selben Netz liegen“.
- **Simulation mit Animation:** Ping (Anfrage und Antwort) sowie Webseiten-Aufruf mit DNS-Anfrage, DNS-Antwort, HTTP-Request und HTTP-Response. Router verbinden verschiedene Netze, Switches und Access Points leiten innerhalb eines Netzes weiter.
- **Dienste auf Servern:** Webserver mit eigener Seite und DNS-Server mit eigenen Einträgen.
- **Aufgaben mit automatisch abgehakten Teilzielen:**
  1. Zwei PCs verbinden
  2. Sternnetz im Computerraum
  3. Heimnetz mit WLAN
  4. Eine Webseite aufrufen (DNS, Router, lokale und externe IP-Adresse)
  5. Freies Bauen
- **Lehrkraft-Ansicht:** Live-Übersicht über alle Schülerinnen und Schüler, Abgaben am Beamer zeigen (auf Wunsch ohne Namen), zwei Lösungen nebeneinander vergleichen, Musterlösungen zeigen oder für die Klasse freigeben, Abgaben zurückgeben.

## Start im Unterricht

1. Die passende Programmdatei auf den Lehrer-Rechner kopieren:
   - Windows: `netzwerkstatt-windows.exe`
   - Linux: `netzwerkstatt-linux` (bei Bedarf vorher `chmod +x netzwerkstatt-linux`)
2. Per Doppelklick starten. Es ist keine Installation nötig. Beim ersten Start fragt Windows eventuell, ob das Programm im Netzwerk erreichbar sein darf – das bitte für das private bzw. Schulnetz erlauben.
3. Das Fenster zeigt die **Adresse für die Schülerinnen und Schüler**, den **Raumcode** und das **Lehrer-Passwort** an. Das Fenster während der Stunde offen lassen.
4. Die Lehrkraft-Ansicht im Browser öffnen: `http://localhost:8080/lehrer`. Mit „Zugang am Beamer zeigen“ erscheinen Adresse und Raumcode groß für alle.
5. Die Schülerinnen und Schüler öffnen die Adresse im Browser (Edge, Chrome, Firefox oder Safari auf dem iPad) und melden sich mit Vornamen oder Kürzel und dem Raumcode an.

Optionen beim Start über die Kommandozeile:

```
netzwerkstatt -port 8080 -raumcode 1234 -passwort geheim -daten pfad/zur/datei.json
```

Raumcode und Passwort bleiben gespeichert, bis sie geändert werden.

## Datenschutz

- Alle Daten (Vornamen bzw. Kürzel und die gebauten Netzwerke) werden **nur auf dem Lehrer-Rechner** in der Datei `netzwerkstatt-daten.json` neben dem Programm gespeichert.
- Das Programm lädt **nichts aus dem Internet** und sendet nichts dorthin. Alle Schriften, Bilder und Skripte sind im Programm enthalten. Der Browser wird zusätzlich per Content-Security-Policy angewiesen, nur Inhalte vom eigenen Server zu laden.
- Es gibt keine Passwörter oder E-Mail-Adressen für Schülerinnen und Schüler, kein Tracking und keine Cookies. Im Browser wird nur ein Anmelde-Schlüssel gespeichert, damit man nach einem Neuladen angemeldet bleibt.
- Nach der Unterrichtseinheit kann die Datendatei einfach gelöscht werden. Einzelne Personen lassen sich auch in der Lehrkraft-Ansicht löschen.

## Entwicklung

Voraussetzung: [Go](https://go.dev) ab Version 1.22 und für die Tests [Node.js](https://nodejs.org).

```
go run .                      # Server lokal starten
node test/simulation.test.js  # Tests für Simulation und Aufgaben
./build.sh                    # Programmdateien für Windows und Linux in dist/ erzeugen
```

Aufbau:

| Datei | Inhalt |
| --- | --- |
| `main.go` | Server: Anmeldung, Speichern, Lehrkraft-Schnittstelle, Auslieferung der Webseiten |
| `web/js/sim.js` | Netzwerkmodell und Simulation (Weg der Pakete, DNS, HTTP) |
| `web/js/tasks.js` | Aufgaben, Teilziele und Musterlösungen |
| `web/js/view.js` | Darstellung des Netzwerks und Paketanimation |
| `web/js/app.js` | Oberfläche für Schülerinnen und Schüler |
| `web/js/teacher.js` | Lehrkraft-Ansicht |

Neue Aufgaben werden in `web/js/tasks.js` ergänzt. Der Test prüft automatisch, dass jede Musterlösung alle Teilziele erfüllt.

## Geplant

- TCP und UDP im Vergleich (z. B. Video-Streaming und Videotelefonie)
- Bus- und Ringtopologie, Peer-to-Peer im Vergleich zu Client-Server
- PAN, LAN, MAN und WAN
- IPv6-Adressen, NAT
- Weitere Internetdienste wie E-Mail und Online-Spiele

## Lizenz

MIT – siehe [LICENSE](LICENSE).

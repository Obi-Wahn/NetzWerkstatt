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

## Start im Unterricht (für Lehrkräfte)

Es muss nichts installiert werden.

1. Unter [**Releases**](https://github.com/Obi-Wahn/NetzWerkstatt/releases/latest) das passende Paket herunterladen:
   - Windows: `NetzWerkstatt-Windows.zip`
   - Linux: `NetzWerkstatt-Linux.tar.gz`
2. Das Paket entpacken und den Ordner an einen festen Ort legen (z. B. „Dokumente“ oder USB-Stick).
3. Starten: unter Windows Doppelklick auf `NetzWerkstatt.exe`, unter Linux `start.sh`.
   - Windows zeigt beim ersten Start evtl. „Der Computer wurde durch Windows geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“. Die Frage nach dem Netzwerkzugriff mit „Zugriff zulassen“ beantworten.
4. Das Programm prüft Speicherort, Port und Netzwerkverbindung selbst, meldet Probleme verständlich und öffnet danach die **Lehrkraft-Ansicht** im Browser – bereits angemeldet.
5. In der Lehrkraft-Ansicht „Zugang am Beamer zeigen“ wählen. Die Schülerinnen und Schüler öffnen die angezeigte Adresse im Browser (Edge, Chrome, Firefox oder Safari auf dem iPad) und melden sich mit Vornamen oder Kürzel und dem Raumcode an.

Das Fenster mit den Startmeldungen während der Stunde offen lassen. Wird das Programm ein zweites Mal gestartet, öffnet es nur die Lehrkraft-Ansicht der bereits laufenden NetzWerkstatt.

Optionen für Fortgeschrittene (Kommandozeile):

```
NetzWerkstatt.exe -port 8080 -raumcode 1234 -passwort geheim -daten pfad/zur/datei.json -kein-browser
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
./build.sh v0.2.0             # Download-Pakete für Windows und Linux in dist/ erzeugen
```

**Neue Version veröffentlichen:** Auf GitHub unter Releases → „Draft a new release“ einen neuen Tag wie `v0.2.0` anlegen und veröffentlichen. GitHub baut die Pakete dann automatisch und hängt sie an das Release an. Auf einem Windows-Rechner genügt zum Bauen auch `go build -o NetzWerkstatt.exe .`

Aufbau:

| Datei | Inhalt |
| --- | --- |
| `start.go` | Start: Prüfungen, Meldungen, Browser öffnen |
| `main.go` | Server: Anmeldung, Speichern, Lehrkraft-Schnittstelle, Auslieferung der Webseiten |
| `paket/` | Anleitungen und Startskript für die Download-Pakete |
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

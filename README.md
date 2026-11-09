# NetzWerkstatt

**Ein Lernspiel, in dem Schülerinnen und Schüler Netzwerke selbst bauen und den Datenpaketen bei der Arbeit zuschauen.**

Die NetzWerkstatt ist für den Informatikunterricht der Sekundarstufe I gedacht. Sie ist bewusst einfach gehalten: Bauen und Testen passieren auf derselben Fläche, es gibt keine verschachtelten Fenster, und Fehler werden in verständlicher Sprache direkt am Paket erklärt.

## Was kann der Prototyp?

- **Baukasten:** Die Leiste links ist nach Kategorien sortiert, die sich einklappen lassen: Endgeräte (PC, Laptop, Tablet, Smartphone, Kopfhörer), aktive Komponenten (Switch, Access Point, Router), Verbindungen als passive Komponenten (Netzwerkkabel, Glasfaser, WLAN, Bluetooth, Bus-Kabel), Server (leer oder als Web-, DNS-, Mail-, Video-, Telefonie- oder Spiele-Server) und Internet (Internetanbieter, Rechenzentrum). In Aufgaben erscheint nur, was gebraucht wird. Funktioniert mit Maus und Finger (Windows-PCs und iPads).
- **Netzwerk-Einstellungen:** IP-Adresse (IPv4), Subnetzmaske, Gateway und DNS-Server mit sofortigen Hinweisen, z. B. „lokale (private) Adresse“ oder „Das Gateway muss im selben Netz liegen“. Beim Eintragen von Hand werden passende freie Adressen, der Router als Gateway und ein vorhandener DNS-Server vorgeschlagen.
- **Heimrouter:** Drei LAN-Anschlüsse und eingebautes WLAN bilden zusammen das Heimnetz (wie ein eingebauter Switch), dazu ein Internet-Anschluss (WAN) mit abschaltbarem eingebautem Modem. Ab Werk hat das Heimnetz eine freie Adresse (192.168.0.1, beim nächsten Router 192.168.1.1 …) und DHCP ist an. Kabel lassen sich zwischen LAN und WAN umstecken.
- **DHCP:** Neue Endgeräte stehen wie in echt auf „Automatisch (DHCP)“ und holen sich beim Verbinden selbst eine Adresse; in Aufgaben zum Eintragen von Hand ist DHCP aus. Der Ablauf Discover → Offer → Request → Ack wird animiert, Discover und Request gehen sichtbar „an alle“. Findet ein Gerät keinen DHCP-Server, gibt es sich eine Notfall-Adresse 169.254.x.x (APIPA) – so erreichen sich z. B. zwei direkt verbundene PCs.
- **Internetanbieter und Internet:** Der Internetanbieter verteilt öffentliche (externe) Adressen per DHCP an angeschlossene Router und Server und gibt einen DNS-Server weiter, den der Heimrouter an das Heimnetz durchreicht. Mehrere verbundene Internetanbieter bilden zusammen das Internet. So lassen sich im freien Modus Webserver und DNS-Server ins Internet stellen und vom Heimnetz aus aufrufen.
- **Rechenzentren für Internetserver:** Ein Rechenzentrum hat ein eigenes öffentliches Netz (z. B. 198.51.100.0/24), getrennt von den Netzen der Internetanbieter. Server dort bekommen ihre Adresse per DHCP aus diesem Netz und sind über die Leitung zum Internetanbieter im ganzen Internet erreichbar. So entstehen mehrere Internetserver mit verschiedenen Diensten in verschiedenen Netzen.
- **Eigener DNS-Server und Weiterleitung:** Jeder Server kann DNS-Server sein. Kennt er einen Namen nicht, kann er ihn bei einem anderen DNS-Server erfragen (Weiterleitung). Der Heimrouter kann wie die meisten echten Router selbst DNS-Server sein: Er verteilt per DHCP seine eigene Adresse und leitet die Anfragen an den DNS-Server des Anbieters weiter. Das Protokoll zeigt jede DNS-Anfrage und -Antwort entlang der Kette.
- **NAT:** Pakete aus dem Heimnetz gehen mit der externen Adresse des Routers ins Internet; das Protokoll zeigt die Übersetzung hin und zurück. Lokale (private) Adressen werden im Internet nicht weitergeleitet, und Anfragen aus dem Internet kommen nicht ins Heimnetz.
- **IPv6:** Jedes Gerät hat automatisch eine Link-Local-Adresse (fe80::…), die nur im eigenen Netz gilt. Ist der Router mit einem Internetanbieter verbunden, bekommt er von ihm ein eigenes IPv6-Netz für das Heimnetz, und die Geräte bilden daraus selbst ihre globale Adresse (2001:db8:…, der für Beispiele reservierte Bereich). Ping funktioniert auch per IPv6 – ohne NAT, also auch aus dem Internet ins Heimnetz. Ein Umschalter zeigt auf der Arbeitsfläche wahlweise IPv4- oder IPv6-Adressen, und ein Vergleich erklärt die Unterschiede (Länge, Schreibweise, Anzahl, NAT).
- **Simulation mit Animation:** Ping (Anfrage und Antwort) sowie Webseiten-Aufruf mit DNS-Anfrage, DNS-Antwort, HTTP-Request und HTTP-Response. Router verbinden verschiedene Netze, Switches und Access Points leiten innerhalb eines Netzes weiter.
- **Dienste auf Servern:** Webserver mit eigener Seite, DNS-Server mit eigenen Einträgen, Dateiablage (Cloud-Speicher), E-Mail-Server (Senden per SMTP, Abrufen per IMAP), Video-Streaming, Video- und Audio-Telefonie und Spiele-Server. Zu jedem dieser Internetdienste stehen Protokoll, Port und eine kurze Begründung, warum er TCP oder UDP nutzt. Beim Server lässt sich für jeden Dienst ein Name im Internet eintragen (z. B. `www.meineseite.de`) und per Knopfdruck bei einem DNS-Server anmelden. Der Browser schickt den Namen im HTTP-Request mit, und ein Webserver mit anderem Namen antwortet mit „404 Not Found“.
- **Peer-to-Peer und Client-Server:** Endgeräte tauschen Dateien direkt miteinander (Peer-to-Peer, jedes Gerät ist Client und Server zugleich) oder laden sie auf einen Server hoch und holen sie dort ab (Client-Server). Das Protokoll erklärt jeweils, wer Client und wer Server ist.
- **Netzarten PAN, LAN, MAN, WAN:** Eine Anzeige auf der Arbeitsfläche erkennt, welche Netzarten im Aufbau stecken, und hebt beim Antippen die zugehörigen Geräte hervor. Bluetooth-Kopfhörer bilden mit dem Smartphone ein PAN, mit „Glasfaser“ aus der Geräteleiste (oder durch Antippen eines Kabels) entsteht eine Glasfaserleitung quer durch die Stadt (MAN), der Internetanbieter führt ins WAN.
- **TCP und UDP:** Auf Wunsch zeigt die Animation bei TCP den Verbindungsaufbau (SYN, SYN-ACK, ACK), die Bestätigungen und den Verbindungsabbau. Jede Verbindung lässt sich auf „gestört“ stellen: Dann geht ein Paket verloren. TCP wartet vergeblich auf die Bestätigung und sendet neu, bei UDP bleibt das Paket verloren (Bild ruckelt kurz).
- **Aufgaben mit automatisch abgehakten Teilzielen:**
  1. Zwei PCs verbinden
  2. Sternnetz im Computerraum
  3. Heimnetz mit WLAN
  4. Eine Webseite aufrufen (DNS, Router, lokale und externe IP-Adresse)
  5. Automatische Adressen mit DHCP
  6. IPv6: Eine Adresse für jedes Gerät
  7. Busnetz
  8. Ringnetz
  9. Topologien im Ausfalltest
  10. Dateien teilen: Peer-to-Peer und Client-Server
  11. Musik über Bluetooth (PAN)
  12. Stadtnetz für zwei Schulgebäude (MAN)
  13. Vom PAN bis zum WAN
  14. TCP und UDP im Vergleich (Video-Streaming und Videoanruf über eine gestörte WLAN-Verbindung)
  15. Dienste einordnen: TCP oder UDP? (Dienste ausprobieren und Anwendungen zuordnen)
  16. Eigene Internetdienste anbieten (E-Mail-Server und Spiele-Server mit DNS-Namen)
  17. Freies Bauen
- **Lehrkraft-Ansicht:** Live-Übersicht über alle Schülerinnen und Schüler, Abgaben am Beamer zeigen (auf Wunsch ohne Namen), zwei Lösungen nebeneinander vergleichen, Musterlösungen zeigen oder für die Klasse freigeben, Abgaben zurückgeben.
- **Aufgaben freischalten:** Die Lehrkraft bestimmt, welche Aufgaben und Themen (auch das freie Bauen) die Klasse sieht. Änderungen erscheinen bei den Schülern sofort, ohne Neuladen. Ab Werk sind die Aufgaben 1–5 und das freie Bauen freigeschaltet.
- **Eigene Aufgaben:** Im Aufgaben-Editor der Lehrkraft-Ansicht entstehen eigene Aufgaben aus Text, automatisch geprüften Zielen, Startaufbau und Musterlösung. Start und Musterlösung baut die Lehrkraft im „Baukasten“ (Schüleransicht mit allen Aufgaben) oder übernimmt sie aus einer Schülerarbeit oder einer eingebauten Aufgabe. Eigene Aufgaben lassen sich als Datei exportieren und bei anderen Lehrkräften importieren. Importierte Dateien werden genau geprüft; sie enthalten keinen Programmcode.

## Start im Unterricht (für Lehrkräfte)

Es muss nichts installiert werden.

1. Unter [**Releases**](https://github.com/Obi-Wahn/NetzWerkstatt/releases/latest) das passende Paket herunterladen:
   - Windows: `NetzWerkstatt-Windows.zip`
   - Linux: `NetzWerkstatt-Linux.tar.gz`
2. Das Paket entpacken und den Ordner an einen festen Ort legen (z. B. „Dokumente“ oder USB-Stick).
3. Starten: unter Windows Doppelklick auf `NetzWerkstatt.exe`, unter Linux `start.sh`.
   - Windows zeigt beim ersten Start evtl. „Der Computer wurde durch Windows geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“. Die Frage nach dem Netzwerkzugriff mit „Zugriff zulassen“ beantworten.
4. Das Programm prüft Speicherort, Port und Netzwerkverbindung selbst, meldet Probleme verständlich und öffnet danach die **Lehrkraft-Ansicht** im Browser – bereits angemeldet.
5. In der Lehrkraft-Ansicht „Zugang am Beamer zeigen“ wählen. Die Schülerinnen und Schüler öffnen die angezeigte Adresse im Browser (Edge, Chrome, Firefox oder Safari auf dem iPad) und melden sich mit Vornamen oder Kürzel, dem Raumcode und einem selbst ausgedachten vierstelligen Code an. Mit diesem Code kann sich niemand unter fremdem Namen anmelden. Hat jemand den Code vergessen, setzt ihn die Lehrkraft in ihrer Ansicht mit „Code zurücksetzen“ zurück; beim nächsten Anmelden gilt dann der neu eingegebene Code.

Das Fenster mit den Startmeldungen während der Stunde offen lassen. Wird das Programm ein zweites Mal gestartet, öffnet es nur die Lehrkraft-Ansicht der bereits laufenden NetzWerkstatt.

Optionen für Fortgeschrittene (Kommandozeile):

```
NetzWerkstatt.exe -port 8080 -raumcode 1234 -passwort geheim -daten pfad/zur/datei.json -kein-browser
```

Der Raumcode wird bei jedem Start neu ausgewürfelt (außer er wird mit `-raumcode` festgelegt). Wer schon angemeldet ist, kann nach einem Neustart trotzdem weiterarbeiten. Das Lehrer-Passwort bleibt gespeichert, bis es geändert wird.

## Datenschutz

- Alle Daten (Vornamen bzw. Kürzel und die gebauten Netzwerke) werden **nur auf dem Lehrer-Rechner** in der Datei `netzwerkstatt-daten.json` neben dem Programm gespeichert.
- Das Programm lädt **nichts aus dem Internet** und sendet nichts dorthin. Alle Schriften, Bilder und Skripte sind im Programm enthalten. Der Browser wird zusätzlich per Content-Security-Policy angewiesen, nur Inhalte vom eigenen Server zu laden.
- Es gibt keine E-Mail-Adressen für Schülerinnen und Schüler, nur einen vierstelligen Code (gespeichert wird nur ein Prüfwert, nicht der Code selbst), kein Tracking und keine Cookies. Im Browser wird nur ein Anmelde-Schlüssel gespeichert, damit man nach einem Neuladen angemeldet bleibt.
- Nach der Unterrichtseinheit kann die Datendatei einfach gelöscht werden. Einzelne Personen lassen sich auch in der Lehrkraft-Ansicht löschen.

## Entwicklung

Voraussetzung: [Go](https://go.dev) ab Version 1.24 und für die Tests [Node.js](https://nodejs.org).

Unter Linux lassen sich beide über die Paketverwaltung installieren, z. B. `sudo dnf install golang nodejs` (Fedora) oder `sudo apt install golang-go nodejs` (Debian/Ubuntu). Mit `go version` prüfen, ob die Go-Version neu genug ist.

```
go run .                      # Server lokal starten
node test/simulation.test.js  # Tests für Simulation und Aufgaben
./build.sh v0.2.0             # Download-Pakete für Windows und Linux in dist/ erzeugen
```

**Neue Version veröffentlichen:** Auf GitHub unter Releases → „Draft a new release“ einen neuen Tag wie `v0.2.0` anlegen und veröffentlichen. GitHub baut die Pakete dann automatisch und hängt sie an das Release an. Auf einem Windows-Rechner genügt zum Bauen auch `go build -o NetzWerkstatt.exe .`, unter Linux `go build -o netzwerkstatt .`

Aufbau:

| Datei | Inhalt |
| --- | --- |
| `start.go` | Start: Prüfungen, Meldungen, Browser öffnen |
| `main.go` | Server: Anmeldung, Speichern, Lehrkraft-Schnittstelle, Auslieferung der Webseiten |
| `paket/` | Anleitungen und Startskript für die Download-Pakete |
| `web/js/sim.js` | Netzwerkmodell und Simulation (Weg der Pakete, DNS, HTTP) |
| `web/js/tasks.js` | Aufgaben, Teilziele und Musterlösungen |
| `web/js/eigene.js` | Eigene Aufgaben: Dateiformat, Prüfung beim Import, Ziel-Bausteine |
| `web/js/view.js` | Darstellung des Netzwerks und Paketanimation |
| `web/js/app.js` | Oberfläche für Schülerinnen und Schüler |
| `web/js/teacher.js` | Lehrkraft-Ansicht |

Neue Aufgaben werden in `web/js/tasks.js` ergänzt. Der Test prüft automatisch, dass jede Musterlösung alle Teilziele erfüllt.

## Geplant

- Bus- und Ringtopologie, Peer-to-Peer im Vergleich zu Client-Server
- PAN, LAN, MAN und WAN
- IPv6-Adressen, NAT

## Lizenz

MIT – siehe [LICENSE](LICENSE).

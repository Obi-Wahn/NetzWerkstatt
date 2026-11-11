/* NetzWerkstatt – Lösungswege zu den eingebauten Aufgaben
 *
 * Für die Lehrkraft (und für Schüler, wenn die Musterlösung freigegeben ist):
 *   steps   – der Lösungsweg Schritt für Schritt
 *   answers – mögliche Antworten auf die Fragen im Denkanstoß
 * Das Netzwerk der Musterlösung selbst steht bei der Aufgabe in tasks.js (solution()).
 */
(function (root) {
  'use strict';

  const L = {
    'zwei-pcs': {
      steps: [
        'Zwei PCs aus der Geräteleiste auf die Arbeitsfläche setzen.',
        'Mit dem Werkzeug „Kabel“ erst den einen, dann den anderen PC antippen.',
        'PC 1 antippen: IP-Adresse 192.168.1.1.',
        'PC 2 antippen: IP-Adresse 192.168.1.2.',
        'Bei PC 1 einen Ping an 192.168.1.2 senden.',
      ],
      answers: [
        'Beide Adressen beginnen mit 192.168.1. Damit liegen sie im selben Netz und finden sich direkt. Nur die letzte Zahl unterscheidet die Geräte.',
      ],
    },
    stern: {
      steps: [
        'Einen Switch in die Mitte setzen.',
        'Jeden der vier PCs mit einem eigenen Kabel mit dem Switch verbinden.',
        'Adressen von Hand eintragen: 192.168.10.1 bis 192.168.10.4.',
        'Von einem PC aus einen anderen anpingen, z. B. von PC 1 an 192.168.10.4.',
      ],
      answers: [
        'Kabelbruch zu einem PC: Nur dieser eine PC ist abgeschnitten, alle anderen erreichen sich weiter.',
        'Switch fällt aus: Das ganze Netz ist gestört, weil alle Daten über den Switch laufen. Er ist die Schwachstelle der Sterntopologie.',
      ],
    },
    heimnetz: {
      steps: [
        'Tablet und Smartphone auf die Arbeitsfläche setzen und mit dem Werkzeug „WLAN“ mit dem Router verbinden.',
        'Einen PC mit einem Kabel an einen LAN-Anschluss des Routers anschließen.',
        'Bei allen drei Geräten eine eigene Adresse im Netz 192.168.178.x eintragen, z. B. PC 192.168.178.20, Tablet .30, Smartphone .31.',
        'Bei allen drei Geräten den Router 192.168.178.1 als Gateway eintragen.',
        'Beim Smartphone einen Ping an die Adresse des PCs senden.',
      ],
      answers: [
        'Kabel und WLAN des Routers gehören zum selben Heimnetz. Deshalb erreicht das Smartphone den PC direkt.',
        'Das Gateway braucht man erst für Ziele außerhalb des Heimnetzes, z. B. im Internet. Dann schickt das Gerät die Pakete an den Router.',
      ],
    },
    webseite: {
      steps: [
        'Einen PC mit einem Kabel an einen LAN-Anschluss des Heimrouters anschließen.',
        'PC antippen: IP-Adresse z. B. 192.168.178.20.',
        'Gateway: 192.168.178.1 (der Router).',
        'DNS-Server: 203.0.113.53.',
        'Im Browser des PCs http://www.netzwerkstatt.de aufrufen.',
      ],
      answers: [
        'Pakete im Internet brauchen eine IP-Adresse als Ziel. Der DNS-Server übersetzt den Namen www.netzwerkstatt.de in die Adresse 203.0.113.80 des Webservers.',
        'Mit http://203.0.113.80 klappt es auch ohne DNS-Server, weil die Adresse schon bekannt ist. Namen kann man sich aber viel besser merken.',
      ],
    },
    dhcp: {
      steps: [
        'Den Router antippen und im Heimnetz (LAN) den DHCP-Server einschalten.',
        'Tablet und Smartphone mit dem Werkzeug „WLAN“ mit dem Access Point (oder dem Router) verbinden.',
        'Bei Tablet und Smartphone die Netzwerk-Einstellung auf „Automatisch (DHCP)“ stellen. Sie bekommen Adressen aus 192.168.0.x und den Router 192.168.0.1 als Gateway.',
        'Beim Smartphone einen Ping an die Adresse des Tablets senden.',
      ],
      answers: [
        'Das Gerät hat noch keine Adresse und kennt den DHCP-Server noch nicht. Deshalb fragt es „an alle“ (Broadcast). Nur der DHCP-Server antwortet.',
        'Ist der Adressbereich zu klein, bekommt das dritte Gerät keine Adresse. Es gibt sich selbst eine Notadresse (169.254.x.x) und kann damit die anderen nicht erreichen.',
      ],
    },
    ipv6: {
      steps: [
        'Einen PC per Kabel an den Heimrouter anschließen. Unter „IPv6“ steht sofort eine globale Adresse (2001:db8:…).',
        'Ein Tablet mit dem Werkzeug „WLAN“ mit dem Router verbinden.',
        'Vom PC aus die Link-Local-Adresse des Tablets (fe80::…) anpingen.',
        'Vom PC aus die globale IPv6-Adresse des Spieleservers anpingen.',
        'Vom Spieleserver aus die globale IPv6-Adresse des PCs anpingen.',
      ],
      answers: [
        'Per IPv4 kennt der Spieleserver nur die externe Adresse des Routers. Der PC hat eine private Adresse, die im Internet nicht weitergeleitet wird (NAT). Per IPv6 hat der PC eine eigene, weltweit eindeutige Adresse.',
        'Link-Local-Adressen (fe80::) gelten nur im eigenen Netz. Ein Router leitet sie nicht weiter, deshalb ist die Link-Local-Adresse des Spieleservers vom Heimnetz aus nicht erreichbar.',
      ],
    },
    bus: {
      steps: [
        'Ein Bus-Kabel aus der Geräteleiste in die Mitte setzen.',
        'Jeden der vier PCs mit einem Kabel an das Bus-Kabel anschließen.',
        'Adressen 192.168.20.1 bis 192.168.20.4 eintragen.',
        'Von einem PC aus einen anderen anpingen.',
        'Das Bus-Kabel antippen, „Kabelbruch im Bus-Kabel simulieren“ wählen und erneut pingen. Der Ping scheitert.',
        'Das Bus-Kabel wieder reparieren.',
      ],
      answers: [
        'Datenschutz: Jedes Signal kommt bei allen PCs an. Ein PC könnte also mitlesen, was gar nicht für ihn bestimmt ist.',
        'Senden zwei PCs gleichzeitig, überlagern sich die Signale (Kollision). Beide müssen es später noch einmal versuchen.',
        'Fällt nur ein PC aus, arbeiten die anderen weiter. Ein Bruch im Bus-Kabel legt dagegen das ganze Netz lahm.',
      ],
    },
    ring: {
      steps: [
        'PC 1 mit PC 2, PC 2 mit PC 3, PC 3 mit PC 4 und PC 4 mit PC 1 verbinden.',
        'Adressen 192.168.30.1 bis 192.168.30.4 eintragen.',
        'Von einem PC aus einen anderen anpingen, z. B. von PC 1 an 192.168.30.3.',
        'Einen PC ausschalten (oder einen Kabelbruch simulieren) und erneut pingen. Der Ping scheitert.',
        'Den PC wieder einschalten bzw. das Kabel reparieren.',
      ],
      answers: [
        'Die Daten laufen immer in dieselbe Richtung von PC zu PC. Die Antwort nimmt deshalb den restlichen Weg um den Ring herum.',
        'Jeder PC muss die Daten weiterreichen. Fällt einer aus, ist der Ring unterbrochen und nichts kommt mehr an.',
        'Im Sternnetz fällt bei einem defekten PC nur dieser eine aus. Dafür ist dort der Switch die Schwachstelle.',
      ],
    },
    topologien: {
      steps: [
        'Stern: Ein Kabel zwischen Switch und PC antippen, Kabelbruch simulieren und zwischen den beiden anderen PCs pingen. Der Ping klappt.',
        'Stern: Den Switch ausfallen lassen und pingen. Der Ping scheitert.',
        'Bus: Einen PC ausfallen lassen und zwischen den beiden anderen pingen. Der Ping klappt.',
        'Bus: Kabelbruch im Bus-Kabel simulieren und pingen. Der Ping scheitert.',
        'Ring: Einen PC ausfallen lassen und zwischen den beiden anderen pingen. Der Ping scheitert.',
        'Nach jedem Test das Kabel reparieren bzw. das Gerät wieder einschalten.',
      ],
      answers: [
        'Der Stern verkraftet Ausfälle am besten: Ein kaputtes Kabel oder ein ausgefallener PC betrifft nur dieses eine Gerät.',
        'Die Schwachstelle beim Stern ist der zentrale Switch. Fällt er aus, ist das ganze Netz gestört.',
        'Sternnetze sind leicht zu erweitern, ein Fehler ist schnell gefunden, und Switches sind günstig und zuverlässig.',
      ],
    },
    dateien: {
      steps: [
        'Toms PC antippen und „Dateien direkt tauschen (Peer-to-Peer)“ einschalten.',
        'Lenas PC antippen und das Klassenfoto an Toms Adresse 192.168.20.12 schicken.',
        'Die Schul-Cloud antippen und die Dateiablage einschalten.',
        'Bei Lenas PC das Klassenfoto an die Schul-Cloud 192.168.20.2 schicken (hochladen).',
        'Bei Mias PC unter „Dateien“ die Dateien von 192.168.20.2 holen.',
      ],
      answers: [
        'Ohne das Kabel von Lenas PC bekommt Mia das Foto trotzdem über den Server, weil es dort schon liegt. Direkt von Lena geht es nicht mehr, weil Lenas PC nicht erreichbar ist.',
        'Beim Peer-to-Peer sind beide Geräte gleichberechtigt: Wer eine Datei anbietet, ist gerade Server, wer sie holt, ist Client.',
        'Fällt der Server aus, kommt niemand mehr an die Dateien, die nur dort liegen.',
      ],
    },
    pan: {
      steps: [
        'Mit dem Werkzeug „Bluetooth“ erst das Smartphone und dann die Kopfhörer antippen.',
        'Beim Smartphone „Musik abspielen“ drücken.',
        'Mit dem Werkzeug „WLAN“ das Smartphone mit dem Heimrouter verbinden. Es bekommt per DHCP eine Adresse.',
        'Beim Smartphone einen Ping an die Adresse des PCs senden.',
      ],
      answers: [
        'Bluetooth ist eine direkte Funkverbindung zwischen zwei Geräten. Es gibt dort keine Router und keine IP-Pakete, deshalb brauchen die Kopfhörer keine IP-Adresse.',
        'Der PC kann die Kopfhörer nicht anpingen, weil sie keine IP-Adresse haben und nicht im Heimnetz sind.',
        'Bluetooth reicht ungefähr 10 Meter, WLAN im Haus ungefähr 30 bis 50 Meter.',
      ],
    },
    man: {
      steps: [
        'Mit dem Werkzeug „Glasfaser“ erst den Switch im Hauptgebäude und dann den Switch in der Außenstelle antippen.',
        'Alternativ: Ein normales Kabel verlegen, die Linie antippen und bei „Art der Leitung“ auf „Glasfaser“ umstellen.',
        'Beim PC in der Außenstelle im Browser http://10.10.0.2 aufrufen.',
      ],
      answers: [
        'Jedes Gebäude hat einen eigenen Switch mit seinen Geräten (je ein LAN). Die Glasfaserleitung quer durch die Stadt verbindet sie zu einem MAN.',
        'Liegt die Außenstelle in einer anderen Stadt oder einem anderen Land, verbindet man die Gebäude über das Internet oder über Leitungen eines Anbieters. Dann entsteht ein WAN.',
      ],
    },
    netzarten: {
      steps: [
        'Den Heimrouter mit einem Kabel an den Internetanbieter anschließen. Er bekommt eine externe Adresse und den DNS-Server.',
        'Mit dem Werkzeug „Bluetooth“ das Smartphone mit den Kopfhörern koppeln (PAN).',
        'Mit dem Werkzeug „WLAN“ das Smartphone mit dem Heimrouter verbinden (LAN). Es bekommt per DHCP Adresse, Gateway und DNS-Server.',
        'Auf dem Smartphone im Browser http://www.netzwerkstatt.de aufrufen (über das WAN).',
      ],
      answers: [
        'Das Smartphone gehört gleichzeitig zum PAN (mit den Kopfhörern), zum LAN (Heimnetz) und über den Router zum WAN (Internet).',
        'Das WAN hat die größte Reichweite (weltweit), das PAN die kleinste (wenige Meter).',
      ],
    },
    'tcp-udp': {
      steps: [
        'Mit dem Werkzeug „WLAN“ das Tablet mit dem Heimrouter verbinden.',
        'Beim Tablet unter „Internetdienste nutzen“ das Video von video.netzwerkstatt.de ansehen.',
        'Einen Videoanruf über konferenz.netzwerkstatt.de starten.',
        'Die WLAN-Linie antippen und „Gestörte Verbindung“ einschalten.',
        'Noch einmal das Video ansehen und noch einmal anrufen. Beim Video wird das verlorene Paket neu gesendet, beim Anruf nicht.',
      ],
      answers: [
        'Beim Video ist Zeit, weil es im Voraus geladen wird. Deshalb lohnt sich das erneute Senden (TCP). Beim Anruf käme ein neu gesendetes Paket zu spät, deshalb geht es ohne Warten weiter (UDP).',
        'Vor dem Video kommt der Verbindungsaufbau von TCP: SYN, SYN-ACK und ACK (Drei-Wege-Handschlag). UDP schickt einfach los und braucht keinen Verbindungsaufbau.',
      ],
    },
    'dienste-sortieren': {
      steps: [
        'Am PC unter „Internetdienste nutzen“ mindestens drei Dienste ausprobieren, z. B. E-Mail an mail.netzwerkstatt.de, Video von video.netzwerkstatt.de und Online-Spiel auf spiel.netzwerkstatt.de.',
        'Im Protokoll nachsehen, ob TCP oder UDP benutzt wurde.',
        'TCP: Webseite, E-Mail, Datei herunterladen, Sprachnachricht. UDP: Videoanruf, Telefonat über das Internet, Online-Rennspiel.',
      ],
      answers: [
        'Eine Sprachnachricht wird erst vollständig aufgenommen und dann verschickt. Sie muss komplett ankommen, Zeit spielt kaum eine Rolle (TCP). Beim Telefonat zählt jede Zehntelsekunde, ein fehlendes Stückchen fällt kaum auf (UDP).',
      ],
    },
    dienste: {
      steps: [
        'Einen neuen Server mit einem Kabel an den Internetanbieter anschließen. Er bekommt automatisch eine öffentliche Adresse.',
        'Beim neuen Server den E-Mail-Server und den Spiele-Server einschalten.',
        'Beim DNS-Server unter „+ Eintrag“ mail.schule.de und spiel.schule.de mit der Adresse des neuen Servers eintragen.',
        'Am PC eine E-Mail über mail.schule.de senden.',
        'Am Smartphone die E-Mails über mail.schule.de abrufen.',
        'Am PC über spiel.schule.de online spielen.',
      ],
      answers: [
        'Das Smartphone ist nicht immer eingeschaltet oder erreichbar. Der E-Mail-Server bewahrt die E-Mail auf, bis sie abgerufen wird. Außerdem kennt der PC die Adresse des Smartphones gar nicht.',
        'Eine E-Mail muss vollständig ankommen (TCP). Beim Spiel ist Schnelligkeit wichtiger, und das nächste Paket bringt ohnehin den neuesten Stand (UDP).',
      ],
    },
    'fehler-computerraum': {
      steps: [
        'Bei PC 1 nacheinander die anderen PCs anpingen: 192.168.50.12 klappt, 192.168.50.13 und 192.168.50.14 nicht. Betroffen sind also PC 3 und PC 4.',
        'Das Kabel von PC 3 antippen: Der Stecker bei PC 3 steckt nicht richtig. Auf „Kabel richtig einstecken“ tippen.',
        'Das Kabel von PC 4 antippen (oder PC 4 antippen und unter „Kabel prüfen“ auf „Kabeltester“): Von außen sieht es normal aus. „Mit dem Kabeltester prüfen“ zeigt: Das Kabel ist kaputt. Auf „Kabel austauschen“ tippen.',
        'Bei PC 3 einen Ping an 192.168.50.14 (PC 4) senden.',
      ],
      answers: [
        'Bei einem Kabelbruch sind oft nur einzelne dünne Adern im Inneren gerissen, zum Beispiel weil das Kabel geknickt oder eingeklemmt wurde. Die Hülle bleibt dabei heil.',
        'Schritt für Schritt eingrenzen: Erst mit einem Ping prüfen, welche Geräte betroffen sind und wo das Paket hängen bleibt. Dann genau diese Stelle untersuchen: Stecker ansehen, Kabel testen, Einstellungen prüfen. Nach jeder Reparatur erneut testen.',
      ],
    },
    'fehler-heimnetz': {
      steps: [
        'Beim Tablet einen Ping an den Router (192.168.178.1) senden: Zwischen Router und Tablet kommt kein Signal an.',
        'Das Tablet antippen: Unter „WLAN“ ist das WLAN ausgeschaltet. „WLAN eingeschaltet“ ankreuzen.',
        'Beim Laptop einen Ping an den Router senden: Zwischen Laptop und Router kommt kein Signal an.',
        'Das Kabel vom Laptop zum Router antippen: Der Stecker beim Router steckt nicht richtig. Auf „Kabel richtig einstecken“ tippen.',
        'Beim Tablet einen Ping an 192.168.178.21 (Laptop) senden.',
      ],
      answers: [
        'Das Zeichen auf dem Bildschirm zeigt nur, dass eine WLAN-Verbindung eingerichtet ist. Ist das WLAN am Gerät aus (z. B. im Flugmodus) oder steckt ein Kabel nicht richtig, fließen trotzdem keine Daten.',
        'Zu Hause kann man selbst prüfen: Ist das WLAN bzw. der Flugmodus richtig eingestellt? Stecken alle Kabel fest? Ist der Router eingeschaltet? Oft hilft auch, Router und Gerät neu zu starten.',
      ],
    },
    'fehler-internet': {
      steps: [
        'Am PC die Seite www.netzwerkstatt.de öffnen: Schon zwischen PC und Switch kommt kein Signal an.',
        'Das Kabel vom PC zum Switch antippen: Der Stecker beim Switch steckt nicht richtig. Auf „Kabel richtig einstecken“ tippen.',
        'Die Seite erneut öffnen: Jetzt bleibt das Paket zwischen Switch und Router hängen.',
        'Das Kabel vom Switch zum Router mit dem Kabeltester prüfen: Es ist kaputt. Auf „Kabel austauschen“ tippen.',
        'Die Seite am PC noch einmal öffnen – jetzt klappt es.',
        'Das Smartphone antippen: Das WLAN ist ausgeschaltet. „WLAN eingeschaltet“ ankreuzen und die Seite auch am Smartphone öffnen.',
      ],
      answers: [
        'Es können mehrere Fehler hintereinander auf demselben Weg liegen. Das Paket bleibt immer am ersten Fehler hängen. Erst nach der Reparatur sieht man, ob es noch einen weiteren gibt.',
        'Klappt der Ping zum Router, liegt der Fehler hinter dem Router (Internet, DNS, Server). Klappt er nicht, liegt der Fehler im eigenen Netz, also bei Kabeln, Switch, WLAN oder Einstellungen des Geräts.',
      ],
    },
  };

  /** Lösungsweg zu einer Aufgabe: {steps, answers} oder null. */
  function of(task) {
    return (task && !task.custom && L[task.id]) || null;
  }

  const api = { LOESUNGEN: L, of };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NWLoesungen = api;
})(typeof window !== 'undefined' ? window : globalThis);

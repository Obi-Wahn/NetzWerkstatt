/* NetzWerkstatt – Schwierigkeitsgrade
 *
 * Jede Aufgabe lässt sich auf drei Stufen spielen:
 *   leicht – Tipp offen, 💡-Vorschläge an, Hinweis zum nächsten offenen Ziel
 *   mittel – Tipp auf Knopfdruck, 💡-Vorschläge an (so wie bisher)
 *   schwer – kein Tipp, keine 💡-Vorschläge
 * Die gewählte Stufe wird im Netzwerk gespeichert (net.level), damit die Lehrkraft sie bei der Abgabe sieht.
 */
(function (root) {
  'use strict';

  // Die Stufen regeln nur, wie viel Hilfe es gibt – die Aufgabe selbst bleibt gleich.
  const LEVELS = [
    { id: 'leicht', label: 'Viel Hilfe', short: 'viel', text: 'Der Tipp ist offen, beim nächsten Ziel steht, wo du tippen musst, und es gibt 💡-Vorschläge.' },
    { id: 'mittel', label: 'Etwas Hilfe', short: 'etwas', text: 'Den Tipp kannst du bei Bedarf aufklappen. Es gibt 💡-Vorschläge.' },
    { id: 'schwer', label: 'Wenig Hilfe', short: 'wenig', text: 'Kein Tipp und keine 💡-Vorschläge: Du überlegst alles selbst.' },
  ];
  const DEFAULT = 'mittel';

  // Hinweise für die Stufe „Leicht“: je Aufgabe ein Text pro Ziel (in derselben Reihenfolge wie die Ziele)
  const HELP = {
    'zwei-pcs': [
      'Tippe in der Geräteleiste zweimal auf „PC“.',
      'Tippe in der Geräteleiste auf „Netzwerkkabel“ und dann nacheinander auf die beiden PCs.',
      'Tippe einen PC an. Unter „Netzwerk-Einstellungen“ trägst du z. B. 192.168.1.1 ein, beim anderen PC 192.168.1.2.',
      'Tippe einen PC an, schreibe unter „Ping“ die Adresse des anderen PCs in das Feld und sende den Ping.',
    ],
    stern: [
      'Tippe in der Geräteleiste auf „Switch“.',
      'Nimm das Werkzeug „Netzwerkkabel“ und verbinde jeden PC einzeln mit dem Switch.',
      'Tippe nacheinander jeden PC an und trage 192.168.10.1, 192.168.10.2, 192.168.10.3 und 192.168.10.4 ein.',
      'Tippe einen PC an und pinge unter „Ping“ die Adresse eines anderen PCs an.',
    ],
    heimnetz: [
      'Setze ein Tablet und ein Smartphone auf die Arbeitsfläche. Nimm das Werkzeug „WLAN“ und tippe auf den Router und dann auf das Gerät.',
      'Setze einen PC auf die Arbeitsfläche und verbinde ihn mit dem „Netzwerkkabel“ mit dem Router.',
      'Tippe jedes Endgerät an: IP-Adresse z. B. 192.168.178.20, 192.168.178.21 …, und im Feld „Gateway“ 192.168.178.1.',
      'Tippe das Smartphone an und pinge die IP-Adresse des PCs an.',
    ],
    webseite: [
      'Setze einen PC auf die Arbeitsfläche und verbinde ihn per „Netzwerkkabel“ mit dem Heimrouter.',
      'Tippe den PC an und trage als IP-Adresse z. B. 192.168.178.20 ein.',
      'Trage beim PC im Feld „Gateway“ die Adresse des Routers ein: 192.168.178.1.',
      'Trage beim PC im Feld „DNS-Server“ 203.0.113.53 ein.',
      'Tippe den PC an, schreibe unter „Browser“ http://www.netzwerkstatt.de in das Feld und öffne die Seite.',
    ],
    dhcp: [
      'Tippe den Router an. Schalte unter „Heimnetz (LAN)“ den DHCP-Server ein.',
      'Nimm das Werkzeug „WLAN“ und verbinde Tablet und Smartphone mit dem Access Point.',
      'Tippe Tablet und Smartphone an und wähle unter „Netzwerk-Einstellungen“ den Knopf „Automatisch (DHCP)“.',
      'Tippe das Smartphone an und pinge die Adresse an, die das Tablet bekommen hat.',
    ],
    ipv6: [
      'Setze einen PC auf die Arbeitsfläche und verbinde ihn per Kabel mit dem Heimrouter. Tippe ihn an und schau unter „IPv6 (automatisch)“ nach.',
      'Setze ein Tablet auf die Arbeitsfläche und verbinde es mit dem Werkzeug „WLAN“ mit dem Router.',
      'Tippe den PC an. Unter „Ping“ findest du Knöpfe, die die Link-Local-Adresse (fe80::…) des Tablets eintragen.',
      'Pinge vom PC aus die globale IPv6-Adresse (2001:db8:…) des Spieleservers an.',
      'Tippe jetzt den Spieleserver an und pinge die globale IPv6-Adresse des PCs an.',
    ],
    bus: [
      'Das Bus-Kabel findest du in der Geräteleiste unter „Verbindungen“.',
      'Nimm das Werkzeug „Netzwerkkabel“ und verbinde jeden PC mit dem Bus-Kabel.',
      'Tippe jeden PC an und trage 192.168.20.1 bis 192.168.20.4 ein.',
      'Tippe einen PC an und pinge einen anderen PC an.',
      'Tippe das Bus-Kabel an, simuliere unter „Ausfall testen“ einen Kabelbruch, sende einen Ping und repariere das Kabel danach.',
    ],
    ring: [
      'Nimm das „Netzwerkkabel“: PC 1 mit PC 2, PC 2 mit PC 3, PC 3 mit PC 4 und PC 4 mit PC 1.',
      'Tippe jeden PC an und trage 192.168.30.1 bis 192.168.30.4 ein.',
      'Tippe einen PC an und pinge den PC gegenüber an.',
      'Tippe einen PC an und schalte ihn unter „Ausfall testen“ aus. Pinge dann zwischen zwei anderen PCs und schalte ihn danach wieder ein.',
    ],
    topologien: [
      'Tippe im Stern das Kabel zu einem PC an und simuliere einen Kabelbruch. Pinge dann zwischen den beiden anderen PCs am Switch.',
      'Tippe im Stern den Switch an, lass ihn unter „Ausfall testen“ ausfallen und sende einen Ping.',
      'Tippe im Bus einen PC an und lass ihn ausfallen. Pinge dann zwischen den beiden anderen PCs am Bus.',
      'Tippe das Bus-Kabel an, simuliere einen Kabelbruch und sende einen Ping.',
      'Tippe im Ring einen PC an und lass ihn ausfallen. Pinge dann zwischen den beiden anderen PCs im Ring.',
    ],
    dateien: [
      'Tippe Toms PC an und schalte „Dateien direkt tauschen (Peer-to-Peer)“ ein. Dann tippst du Lenas PC an und schickst das Foto an Toms IP-Adresse.',
      'Tippe den Server an und schalte die Dateiablage ein. Dann schickst du von Lenas PC das Foto an die IP-Adresse des Servers.',
      'Tippe Mias PC an und hole unter „Dateien“ die Dateien von der IP-Adresse des Servers.',
    ],
    pan: [
      'Nimm das Werkzeug „Bluetooth“ und tippe auf das Smartphone und dann auf die Kopfhörer.',
      'Tippe das Smartphone an und drücke auf „Musik abspielen“.',
      'Nimm das Werkzeug „WLAN“ und tippe auf den Heimrouter und dann auf das Smartphone.',
      'Tippe das Smartphone an und pinge die IP-Adresse des PCs an.',
    ],
    man: [
      'Nimm das Werkzeug „Glasfaser“ und tippe nacheinander auf die beiden Switches.',
      'Hast du ein normales Kabel verlegt? Tippe die Linie an und wähle bei „Art der Leitung“ den Knopf „Glasfaser“.',
      'Tippe den PC in der Außenstelle an und öffne im „Browser“ http://10.10.0.2.',
    ],
    netzarten: [
      'Nimm das Werkzeug „Bluetooth“ und tippe auf das Smartphone und dann auf die Kopfhörer.',
      'Nimm das Werkzeug „WLAN“ und tippe auf den Heimrouter und dann auf das Smartphone.',
      'Verbinde den Heimrouter per „Netzwerkkabel“ mit dem Internetanbieter.',
      'Tippe das Smartphone an und öffne im „Browser“ http://www.netzwerkstatt.de.',
    ],
    'tcp-udp': [
      'Nimm das Werkzeug „WLAN“ und tippe auf den Heimrouter und dann auf das Tablet.',
      'Tippe das Tablet an. Unter „Internetdienste nutzen“ wählst du video.netzwerkstatt.de und drückst auf „Video ansehen“.',
      'Wähle beim Tablet konferenz.netzwerkstatt.de und drücke auf „Videoanruf“.',
      'Tippe die gestrichelte WLAN-Linie an und schalte „Gestörte Verbindung“ ein. Dann wiederholst du Video und Videoanruf.',
    ],
    'dienste-sortieren': [
      'Tippe den PC an. Unter „Internetdienste nutzen“ probierst du nacheinander drei Knöpfe aus, z. B. E-Mail, Video und Online-Spiel.',
      'Ordne rechts jede Anwendung TCP oder UDP zu. Frage dich: Muss alles vollständig ankommen oder muss es schnell gehen?',
    ],
    dienste: [
      'Setze einen Server auf die Arbeitsfläche, verbinde ihn per Kabel mit dem Internetanbieter und schalte unter „Dienste des Servers“ den E-Mail-Server ein.',
      'Tippe den DNS-Server an, drücke auf „+ Eintrag“ und trage mail.schule.de mit der IP-Adresse deines Servers ein.',
      'Tippe den PC an und schicke unter „Internetdienste nutzen“ eine E-Mail an mail.schule.de.',
      'Tippe das Smartphone an und drücke bei mail.schule.de auf „E-Mails abrufen“.',
      'Schalte beim Server auch den Spiele-Server ein, trage spiel.schule.de beim DNS-Server ein und spiele vom PC aus online.',
    ],
    'fehler-computerraum': [
      'Pinge von PC 1 aus alle anderen PCs an. Tippe dann das Kabel des PCs an, der nicht antwortet, und sieh dir den Stecker an.',
      'Tippe das Kabel des anderen PCs an, der nicht antwortet, und drücke auf „Mit dem Kabeltester prüfen“.',
      'Tippe PC 3 an und pinge unter „Ping“ die Adresse von PC 4 an: 192.168.50.14.',
    ],
    'fehler-heimnetz': [
      'Tippe das Tablet an und sieh dir den Abschnitt „WLAN“ ganz oben an.',
      'Tippe das Kabel zwischen Laptop und Router an und sieh dir an, wie der Stecker sitzt.',
      'Tippe das Tablet an und pinge die Adresse des Laptops an: 192.168.178.21.',
    ],
    'fehler-internet': [
      'Öffne am PC die Seite und schau, wo das Paket hängen bleibt. Tippe dieses Kabel an. Prüfe danach auch das nächste Kabel mit dem Kabeltester.',
      'Tippe das Smartphone an und sieh dir den Abschnitt „WLAN“ ganz oben an.',
    ],
  };

  const valid = id => LEVELS.some(l => l.id === id);
  /** Stufe eines Netzwerks (ohne Angabe: mittel). */
  const of = net => (net && valid(net.level) ? net.level : DEFAULT);
  const label = id => (LEVELS.find(l => l.id === id) || LEVELS[1]).label;
  /** Kurzform für die Lehreransicht, z. B. „Hilfe: viel“. */
  const badge = id => 'Hilfe: ' + (LEVELS.find(l => l.id === id) || LEVELS[1]).short;
  /** Hinweis für die Stufe „Leicht“ zum Ziel mit Index i (oder ''). */
  const help = (task, i) => (task && !task.custom && HELP[task.id] && HELP[task.id][i]) || '';
  /** Sterne für den Anspruch einer Aufgabe (Feld level 1–3 in tasks.js). */
  const stars = task => {
    const n = task && !task.free ? Number(task.level) || 0 : 0;
    return n > 0 ? '★'.repeat(Math.min(3, n)) + '☆'.repeat(Math.max(0, 3 - n)) : '';
  };

  root.NWStufen = { LEVELS, DEFAULT, HELP, valid, of, label, badge, help, stars };
  if (typeof module !== 'undefined') module.exports = root.NWStufen;
})(typeof window !== 'undefined' ? window : globalThis);

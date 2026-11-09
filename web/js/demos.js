/* NetzWerkstatt – Vorführungen
 *
 * Eine Vorführung ist ein fertiges Netz mit einer Erklärung Schritt für Schritt.
 * Jeder Schritt kann
 *   prep(net)          – das Netz vorher verändern (z. B. Kabelbruch, Gerät dazu)
 *   run(net)           – eine echte Aktion der Simulation ausführen (Ping, Webseite, DHCP …)
 *   pick(step)         – nur einen Teil der Paket-Schritte zeigen
 *   apply(net, res)    – das Ergebnis übernehmen (z. B. die per DHCP bezogene Adresse)
 *   expect             – erwartetes Ergebnis von run (wird automatisch getestet)
 *   focus              – Geräte, die hervorgehoben werden
 * Der Zustand eines Schritts entsteht immer neu aus dem Startnetz und allen Schritten davor.
 * So funktionieren „Zurück“ und „Noch einmal“ zuverlässig.
 */
(function (root) {
  'use strict';
  const NW = root.NW || (typeof require !== 'undefined' ? require('./sim.js') : null);
  const NWTasks = root.NWTasks || (typeof require !== 'undefined' ? require('./tasks.js') : null);

  const solved = id => () => { const net = NWTasks.byId(id).solution(); net.events = []; return net; };
  const started = id => () => NWTasks.byId(id).start();
  const isTcpSetup = s => /^Verbindungsaufbau/.test(s.text || '');
  const isTcpEnd = s => /FIN/.test(s.label || '');
  const noDns = s => !/DNS/.test(s.label || '');

  const DEMOS = [
    {
      id: 'webseite',
      title: 'Was passiert beim Aufruf einer Webseite?',
      short: 'DNS, TCP-Verbindung, HTTP-Request und HTTP-Response',
      task: 'webseite',
      net: solved('webseite'),
      steps: [
        { title: 'Ausgangslage', focus: ['pc', 'web'],
          text: 'PC 1 steht im Heimnetz und soll die Webseite www.netzwerkstatt.de anzeigen. Die Seite liegt auf dem Webserver im Internet. Der PC kennt aber nur den Namen der Seite, nicht die IP-Adresse des Servers. Pakete brauchen jedoch immer eine IP-Adresse als Ziel.' },
        { title: '1. DNS: Name in IP-Adresse übersetzen', focus: ['pc', 'dns'],
          text: 'Zuerst fragt der PC beim DNS-Server nach: „Welche IP-Adresse hat www.netzwerkstatt.de?“ Der DNS-Server funktioniert wie ein Telefonbuch und antwortet mit 203.0.113.80. Die DNS-Anfrage ist kurz und nutzt UDP.',
          run: net => NW.browse(net, 'pc', 'http://www.netzwerkstatt.de', { tcp: true }), pick: s => /DNS/.test(s.label), expect: true },
        { title: '2. TCP: Verbindung aufbauen', focus: ['pc', 'web'],
          text: 'Jetzt kennt der PC die Adresse. Bevor er die Webseite anfordert, baut er mit TCP eine Verbindung zum Webserver auf. Das geschieht in drei Schritten (SYN, SYN-ACK, ACK), ähnlich wie bei einem Telefonat: „Hallo?“ – „Ja, ich höre dich.“ – „Gut, dann legen wir los.“',
          run: net => NW.browse(net, 'pc', 'http://www.netzwerkstatt.de', { tcp: true }), pick: isTcpSetup, expect: true },
        { title: '3. HTTP-Request und HTTP-Response', focus: ['pc', 'web'],
          text: 'Über die Verbindung schickt der Browser einen HTTP-Request: „Schick mir bitte die Webseite.“ Der Webserver antwortet mit einer HTTP-Response, darin steckt die Webseite. TCP bestätigt jedes Paket, damit nichts verloren geht.',
          run: net => NW.browse(net, 'pc', 'http://www.netzwerkstatt.de', { tcp: true }), pick: s => !/DNS/.test(s.label) && !isTcpSetup(s) && !isTcpEnd(s), expect: true },
        { title: '4. Verbindung abbauen', focus: ['pc', 'web'],
          text: 'Wenn alles angekommen ist, wird die TCP-Verbindung wieder beendet. Erst jetzt zeigt der Browser die fertige Seite an.',
          run: net => NW.browse(net, 'pc', 'http://www.netzwerkstatt.de', { tcp: true }), pick: isTcpEnd, expect: true },
        { title: 'Alles zusammen', focus: ['pc', 'r', 'dns', 'web'],
          text: 'Hier läuft alles noch einmal am Stück, ohne die TCP-Einzelheiten. Merke dir die Reihenfolge: Erst DNS (Name → IP-Adresse), dann HTTP-Request und HTTP-Response. Jedes Paket läuft über den Heimrouter und den Internetanbieter.',
          run: net => NW.browse(net, 'pc', 'http://www.netzwerkstatt.de'), expect: true },
      ],
    },
    {
      id: 'nat',
      title: 'Lokale und öffentliche IP-Adressen (NAT)',
      short: 'Warum alle Geräte im Heimnetz mit einer Adresse ins Internet gehen',
      task: 'webseite',
      net: solved('webseite'),
      steps: [
        { title: 'Zwei Adressen am Router', focus: ['r'],
          text: 'Der Heimrouter verbindet zwei Netze. Im Heimnetz (LAN) hat er die lokale Adresse 192.168.178.1. Am Internet-Anschluss (WAN) hat er die öffentliche Adresse 203.0.113.10, die ihm der Internetanbieter gegeben hat.' },
        { title: 'Ein Gerät mehr im Heimnetz', focus: ['pc', 'tb'],
          prep: net => {
            NW.createDevice(net, 'tablet', 160, 420, { id: 'tb', name: 'Tablet 1', ip: '192.168.178.21', gw: '192.168.178.1', dns: '203.0.113.53', dhcp: false });
            NW.addLink(net, 'r', 'tb', 'wlan');
          },
          text: 'Jetzt ist auch ein Tablet im WLAN. PC 1 hat die lokale Adresse 192.168.178.20, das Tablet 192.168.178.21. Adressen, die mit 192.168. beginnen, sind privat: Sie gelten nur im eigenen Heimnetz und kommen in vielen Heimnetzen auf der Welt gleichzeitig vor.' },
        { title: 'PC 1 pingt den Webserver an', focus: ['pc', 'r', 'web'],
          text: 'Achte im Protokoll auf die Zeile mit „NAT“: Der Router tauscht die lokale Absender-Adresse des PCs gegen seine öffentliche Adresse 203.0.113.10 aus. Bei der Antwort tauscht er wieder zurück.',
          run: net => NW.ping(net, 'pc', '203.0.113.80'), expect: true },
        { title: 'Das Tablet pingt den Webserver an', focus: ['tb', 'r', 'web'],
          text: 'Auch beim Tablet sieht der Webserver nur 203.0.113.10. Alle Geräte im Heimnetz teilen sich die eine öffentliche Adresse des Routers. Der Router merkt sich, welche Antwort zu welchem Gerät gehört.',
          run: net => NW.ping(net, 'tb', '203.0.113.80'), expect: true },
        { title: 'Umgekehrt geht es nicht', focus: ['web', 'pc'],
          text: 'Jetzt versucht der Webserver, PC 1 unter seiner lokalen Adresse 192.168.178.20 zu erreichen. Das klappt nicht: Private Adressen werden im Internet nicht weitergeleitet. Von außen ist nur der Router sichtbar.',
          run: net => NW.ping(net, 'web', '192.168.178.20'), expect: false },
      ],
    },
    {
      id: 'dhcp',
      title: 'DHCP: Wie ein Gerät seine Adresse bekommt',
      short: 'Die vier DHCP-Nachrichten und die Notfall-Adresse',
      task: 'dhcp',
      net: () => {
        const net = NWTasks.byId('dhcp').start();
        NW.dev(net, 'r').ports[NW.LAN].dhcp.on = true;
        NW.addLink(net, 'ap', 'tb', 'wlan');
        NW.addLink(net, 'ap', 'sp', 'wlan');
        for (const id of ['tb', 'sp']) Object.assign(NW.dev(net, id), { dhcp: true, ip: '', gw: '', dns: '' });
        return net;
      },
      steps: [
        { title: 'Ausgangslage', focus: ['tb', 'sp', 'r'],
          text: 'Tablet und Smartphone sind mit dem WLAN im Schulcafé verbunden, haben aber noch keine IP-Adresse. Im Router läuft ein DHCP-Server. Er verwaltet einen Vorrat an Adressen und verteilt sie an Geräte, die danach fragen.' },
        { title: 'Das Tablet fragt nach einer Adresse', focus: ['tb', 'r'],
          text: 'Das Tablet kennt den DHCP-Server noch nicht. Darum ruft es „an alle“ (Discover). Der DHCP-Server bietet eine Adresse an (Offer), das Tablet nimmt sie (Request), und der Server bestätigt (Acknowledge). Mit der Adresse bekommt das Tablet auch das Gateway und den DNS-Server.',
          run: net => NW.dhcp(net, 'tb'), apply: (net, r) => NW.applyLease(NW.dev(net, 'tb'), r.lease), expect: true },
        { title: 'Das Smartphone bekommt die nächste Adresse', focus: ['sp', 'r'],
          text: 'Beim Smartphone läuft dasselbe ab. Der DHCP-Server gibt ihm eine andere Adresse, denn jede Adresse darf im Netz nur einmal vorkommen.',
          run: net => NW.dhcp(net, 'sp'), apply: (net, r) => NW.applyLease(NW.dev(net, 'sp'), r.lease), expect: true },
        { title: 'Jetzt klappt der Ping', focus: ['sp', 'tb'],
          text: 'Beide Geräte haben automatisch eine passende Adresse im selben Netz bekommen. Niemand musste etwas von Hand eintragen.',
          run: net => NW.ping(net, 'sp', NW.dev(net, 'tb').ip), expect: true },
        { title: 'Und ohne DHCP-Server?', focus: ['r', 'ls'],
          prep: net => {
            NW.dev(net, 'r').ports[NW.LAN].dhcp.on = false;
            NW.createDevice(net, 'laptop', 640, 470, { id: 'ls', name: 'Laptop Gast', dhcp: true, ip: '', gw: '', dns: '' });
            NW.addLink(net, 'ap', 'ls', 'wlan');
          },
          text: 'Jetzt ist der DHCP-Server ausgeschaltet, und ein Gast-Laptop kommt dazu. Niemand antwortet auf seine Frage. Der Laptop gibt sich deshalb selbst eine Notfall-Adresse, die mit 169.254. beginnt (APIPA). Damit kommt er nicht ins Internet.',
          run: net => NW.dhcp(net, 'ls'), apply: (net, r) => { if (r.apipa) NW.applyLease(NW.dev(net, 'ls'), r.apipa); }, expect: false },
      ],
    },
    {
      id: 'gateway',
      title: 'Wozu braucht man das Gateway?',
      short: 'Im eigenen Netz direkt, in fremde Netze über den Router',
      task: 'heimnetz',
      net: () => {
        const net = solved('webseite')();
        Object.assign(NW.dev(net, 'pc'), { gw: '' });
        NW.createDevice(net, 'pc', 160, 420, { id: 'pc2', name: 'PC 2', ip: '192.168.178.21', gw: '192.168.178.1', dns: '203.0.113.53', dhcp: false });
        NW.addLink(net, 'r', 'pc2', 'kabel');
        return net;
      },
      steps: [
        { title: 'Ausgangslage', focus: ['pc', 'pc2'],
          text: 'PC 1 und PC 2 hängen im selben Heimnetz 192.168.178.x. Bei PC 1 fehlt aber das Gateway: Das Feld ist leer. Das Gateway ist die Adresse des Routers, das „Tor“ in andere Netze.' },
        { title: 'Im eigenen Netz geht es auch ohne Gateway', focus: ['pc', 'pc2'],
          text: 'PC 1 vergleicht die Zieladresse 192.168.178.21 mit seiner eigenen Adresse und Subnetzmaske. Ergebnis: Das Ziel ist im selben Netz. Also schickt er das Paket direkt dorthin, ein Gateway braucht er dafür nicht.',
          run: net => NW.ping(net, 'pc', '192.168.178.21'), expect: true },
        { title: 'In ein fremdes Netz geht es nicht', focus: ['pc', 'web'],
          text: 'Der Webserver hat die Adresse 203.0.113.80. Sie liegt in einem anderen Netz. PC 1 weiß nicht, wohin er das Paket schicken soll, weil er kein Gateway kennt.',
          run: net => NW.ping(net, 'pc', '203.0.113.80'), expect: false },
        { title: 'Mit Gateway klappt es', focus: ['pc', 'r', 'web'],
          prep: net => { NW.dev(net, 'pc').gw = '192.168.178.1'; },
          text: 'Jetzt ist bei PC 1 der Router 192.168.178.1 als Gateway eingetragen. Alle Pakete für fremde Netze schickt der PC an den Router, und der Router leitet sie weiter ins Internet. Merke: Das Gateway muss im eigenen Netz liegen.',
          run: net => NW.ping(net, 'pc', '203.0.113.80'), expect: true },
      ],
    },
    {
      id: 'topologien',
      title: 'Bus, Ring und Stern im Ausfalltest',
      short: 'Was passiert, wenn ein Kabel bricht oder ein Gerät ausfällt?',
      task: 'topologien',
      net: started('topologien'),
      steps: [
        { title: 'Drei Topologien', focus: ['ts', 'tb', 'g1', 'g2', 'g3'],
          text: 'Links ist ein Stern: Alle PCs hängen an einem Switch. In der Mitte ist ein Bus: Alle PCs hängen an einem gemeinsamen Kabel. Rechts ist ein Ring: Jeder PC ist mit genau zwei Nachbarn verbunden.' },
        { title: 'Stern: Ein Kabel bricht', focus: ['k3', 'k1', 'k2'],
          prep: net => { const l = net.links.find(x => x.a === 'k3' || x.b === 'k3'); NW.setFault(net, l.id, true); },
          text: 'Das Kabel zu Stern 3 ist kaputt. Nur Stern 3 ist jetzt abgeschnitten. Stern 1 und Stern 2 erreichen sich weiterhin über den Switch.',
          run: net => NW.ping(net, 'k1', '192.168.1.2'), expect: true },
        { title: 'Stern: Der Switch fällt aus', focus: ['ts'],
          prep: net => { NW.setFault(net, 'ts', true); },
          text: 'Fällt dagegen der Switch in der Mitte aus, geht im ganzen Stern nichts mehr. Der zentrale Verteiler ist die Schwachstelle des Sterns.',
          run: net => NW.ping(net, 'k1', '192.168.1.2'), expect: false },
        { title: 'Bus: Ein PC fällt aus', focus: ['u2', 'u1', 'u3'],
          prep: net => { NW.setFault(net, 'u2', true); },
          text: 'Im Bus fällt Bus 2 aus. Die anderen beiden PCs merken davon nichts und arbeiten weiter.',
          run: net => NW.ping(net, 'u1', '192.168.2.3'), expect: true },
        { title: 'Bus: Das Bus-Kabel bricht', focus: ['tb'],
          prep: net => { NW.setFault(net, 'u2', false); NW.setFault(net, 'tb', true); },
          text: 'Bricht aber das gemeinsame Bus-Kabel, ist das ganze Netz gestört. An der Bruchstelle werden die Signale zurückgeworfen und überlagern sich.',
          run: net => NW.ping(net, 'u1', '192.168.2.3'), expect: false },
        { title: 'Ring: Ein PC fällt aus', focus: ['g2', 'g1', 'g3'],
          prep: net => { NW.setFault(net, 'g2', true); },
          text: 'Im Ring reicht jeder PC die Daten an seinen Nachbarn weiter. Fällt Ring 2 aus, ist der Ring unterbrochen, und die Daten kommen nicht mehr rundherum.',
          run: net => NW.ping(net, 'g1', '192.168.3.3'), expect: false },
        { title: 'Vergleich', focus: [],
          text: 'Stern: Ein kaputtes Kabel trifft nur einen PC, aber der Switch darf nicht ausfallen. Bus: Ein ausgefallener PC stört nicht, ein kaputtes Bus-Kabel legt alles lahm. Ring: Schon ein einziger Ausfall unterbricht den Ring. Deshalb baut man heute fast nur noch Sternnetze mit Switches.' },
      ],
    },
    {
      id: 'tcp-udp',
      title: 'TCP oder UDP: Was passiert bei Paketverlust?',
      short: 'Video-Streaming mit TCP, Videoanruf mit UDP',
      task: 'tcp-udp',
      net: () => {
        const net = solved('tcp-udp')();
        for (const l of net.links) l.loss = false;
        return net;
      },
      steps: [
        { title: 'Ausgangslage', focus: ['tb', 'video', 'konf'],
          text: 'Das Tablet ist per WLAN im Heimnetz. Im Internet stehen ein Video-Server und ein Konferenz-Server für Videoanrufe. Beide schicken Bild und Ton in vielen kleinen Paketen.' },
        { title: 'Video ansehen (TCP)', focus: ['tb', 'video'],
          text: 'Beim Video-Streaming nutzt der Server TCP: Erst wird eine Verbindung aufgebaut, dann wird jedes Paket bestätigt.',
          run: net => NW.useService(net, 'tb', 'video', 'video.netzwerkstatt.de', { tcp: true }), pick: noDns, expect: true },
        { title: 'Das WLAN wird gestört', focus: ['tb', 'r'],
          prep: net => { for (const l of net.links) if (l.kind === 'wlan') l.loss = true; },
          text: 'Jetzt ist die WLAN-Verbindung gestört (Blitz auf der Linie). Ab und zu geht ein Paket verloren.' },
        { title: 'Video mit Störung (TCP)', focus: ['tb', 'video'],
          text: 'Ein Paket geht unterwegs verloren. Weil die Bestätigung ausbleibt, sendet der Server es noch einmal. Das Video kommt vollständig an, nur etwas später.',
          run: net => NW.useService(net, 'tb', 'video', 'video.netzwerkstatt.de', { tcp: true }), pick: noDns, expect: true },
        { title: 'Videoanruf mit Störung (UDP)', focus: ['tb', 'konf'],
          text: 'Beim Videoanruf kommt UDP zum Einsatz: kein Verbindungsaufbau, keine Bestätigung. Das verlorene Paket bleibt verloren, das Bild ruckelt kurz. Dafür gibt es keine Verzögerung, und das Gespräch läuft flüssig weiter.',
          run: net => NW.useService(net, 'tb', 'call', 'konferenz.netzwerkstatt.de', { tcp: true }), pick: noDns, expect: true },
        { title: 'Vergleich', focus: [],
          text: 'TCP: zuverlässig, alles kommt vollständig an, dafür etwas langsamer. Gut für Webseiten, E-Mails, Downloads und Videos zum Anschauen. UDP: schnell und ohne Warten, dafür können Pakete fehlen. Gut für Telefonie, Videoanrufe und Online-Spiele.' },
      ],
    },
  ];

  const byId = id => DEMOS.find(d => d.id === id) || null;

  /** Baut das Netz für Schritt k: Startnetz, dann prep/run/apply aller Schritte davor und prep von Schritt k. */
  function stateAt(demo, k) {
    const net = demo.net();
    net.events = [];
    for (let j = 0; j <= k && j < demo.steps.length; j++) {
      const st = demo.steps[j];
      if (st.prep) st.prep(net);
      if (j < k && st.run && st.apply) st.apply(net, st.run(net));
    }
    return net;
  }

  /** Führt Schritt k aus: liefert {net, res, steps} (steps = gezeigte Paket-Schritte). */
  function runStep(demo, k) {
    const net = stateAt(demo, k);
    const st = demo.steps[k];
    if (!st.run) return { net, res: null, steps: [] };
    const res = st.run(net);
    const steps = (res.steps || []).filter(st.pick || (() => true));
    if (st.apply) st.apply(net, res);
    return { net, res, steps };
  }

  const api = { DEMOS, byId, stateAt, runStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NWDemos = api;
})(typeof window !== 'undefined' ? window : globalThis);

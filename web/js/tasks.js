/* NetzWerkstatt – Aufgaben
 *
 * Jede Aufgabe hat:
 *   id, title, intro      – Text für die Schülerinnen und Schüler
 *   goals                 – Teilziele, die automatisch geprüft werden
 *   start()               – Netzwerk, mit dem die Aufgabe beginnt
 *   solution()            – Musterlösung (für die Lehrkraft)
 */
(function (root) {
  'use strict';
  const NW = root.NW || (typeof require !== 'undefined' ? require('./sim.js') : null);
  const T = NW.TYPES;

  // ---------------------------------------------------------------- Hilfen zum Prüfen
  function ctx(net) {
    const byType = t => net.devices.filter(d => d.type === t);
    const hosts = net.devices.filter(d => T[d.type].host);
    const neighbors = id => NW.linksOf(net, id).map(l => ({ dev: NW.dev(net, l.a === id ? l.b : l.a), kind: l.kind }));
    const linked = (a, b, kind) => net.links.some(l => ((l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id)) && (!kind || l.kind === kind));
    const inNet = (d, netAddr, prefix) => { const ip = NW.parseIP(d.ip); return ip !== null && NW.parseMask(d.mask) === prefix && NW.sameNet(ip, NW.parseIP(netAddr), prefix) && !NW.ipProblem(d.ip, d.mask); };
    const distinctIPs = list => new Set(list.map(d => NW.parseIP(d.ip))).size === list.length;
    // Gab es einen erfolgreichen Ping (der auch jetzt noch klappen würde)?
    const pingOk = (srcFilter, dstFilter) => (net.events || []).some(e => {
      if (e.type !== 'ping' || !e.ok || e.v6) return false;
      const s = NW.dev(net, e.src), t = NW.dev(net, e.target);
      if (!s || !t || s === t || !T[t.type].host || !srcFilter(s) || !dstFilter(t)) return false;
      return NW.roundTrip(net, s.id, NW.parseIP(t.ip)).ok;
    });
    // Gab es einen erfolgreichen Ping per IPv6 (kind: 'll' = Link-Local, 'gua' = global), der jetzt noch klappen würde?
    const ping6Ok = (srcFilter, dstFilter, kind) => (net.events || []).some(e => {
      if (e.type !== 'ping' || !e.ok || !e.v6 || (e.ll ? 'll' : 'gua') !== kind) return false;
      const s = NW.dev(net, e.src), t = NW.dev(net, e.target);
      if (!s || !t || s === t || !T[t.type].host || !srcFilter(s) || !dstFilter(t)) return false;
      const a = NW.ip6Of(net, t, 0);
      return !!a && !!a[kind] && NW.ping6(net, s.id, a[kind]).ok;
    });
    const hasGua = d => { const a = NW.ip6Of(net, d, 0); return !!(a && a.gua); };
    const webOk = host => (net.events || []).some(e => {
      if (e.type !== 'web' || !e.ok || e.host !== host) return false;
      const s = NW.dev(net, e.src);
      return s && NW.browse(net, s.id, 'http://' + host).ok;
    });
    const pings = () => (net.events || []).filter(e => e.type === 'ping');
    const topos = kind => NW.topologies(net).filter(t => t.kind === kind);
    return { net, byType, hosts, neighbors, linked, inNet, distinctIPs, pingOk, ping6Ok, hasGua, webOk, pings, topos };
  }

  const isType = t => d => d.type === t;
  const any = () => true;

  /** Baut ein Netzwerk mit festen IDs (für Startnetze und Musterlösungen). */
  function build(fn) {
    const net = NW.emptyNetwork();
    const add = (id, type, x, y, extra) => NW.createDevice(net, type, x, y, Object.assign({ id }, extra || {}));
    const link = (a, b, kind, extra) => { const r = NW.addLink(net, a, b, kind || 'kabel'); if (!r.ok) throw new Error(r.reason); Object.assign(r.link, extra || {}); return r.link; };
    fn({ net, add, link });
    return net;
  }

  function evPing(net, src, target) { NW.logEvent(net, { type: 'ping', src, target, ok: true }); }
  function evPing6(net, src, target, ll) { NW.logEvent(net, { type: 'ping', v6: true, ll: !!ll, src, target, ok: true }); }

  // ---------------------------------------------------------------- Aufgaben
  const TASKS = [
    {
      id: 'zwei-pcs',
      title: 'Zwei PCs verbinden',
      level: 1,
      manual: true,
      intro: 'Das kleinste Netzwerk besteht aus zwei Computern, die direkt mit einem Kabel verbunden sind. Damit sie sich gegenseitig finden, braucht jeder eine eigene IP-Adresse im selben Netz.',
      tip: 'Ohne Router gibt es keinen DHCP-Server – hier trägst du die Adressen von Hand ein. Mit 255.255.255.0 als Subnetzmaske gehören alle Adressen, die mit 192.168.1. beginnen, zum selben Netz. Nur die letzte Zahl muss unterschiedlich sein (1 bis 254).',
      goals: [
        { text: 'Setze zwei PCs auf die Arbeitsfläche.', check: c => c.byType('pc').length >= 2 },
        { text: 'Verbinde die beiden PCs mit einem Kabel.', check: c => c.byType('pc').some(a => c.byType('pc').some(b => a !== b && c.linked(a, b, 'kabel'))) },
        { text: 'Gib beiden PCs eine eigene IP-Adresse im Netz 192.168.1.0/24.', check: c => { const p = c.byType('pc').filter(d => c.inNet(d, '192.168.1.0', 24)); return p.length >= 2 && c.distinctIPs(p); } },
        { text: 'Teste die Verbindung mit einem Ping von einem PC zum anderen.', check: c => c.pingOk(isType('pc'), isType('pc')) },
      ],
      start: () => NW.emptyNetwork(),
      solution: () => build(({ net, add, link }) => {
        add('p1', 'pc', 260, 260, { name: 'PC 1', ip: '192.168.1.1' });
        add('p2', 'pc', 560, 260, { name: 'PC 2', ip: '192.168.1.2' });
        link('p1', 'p2');
        evPing(net, 'p1', 'p2');
      }),
    },
    {
      id: 'stern',
      title: 'Sternnetz im Computerraum',
      level: 1,
      manual: true,
      intro: 'Im Computerraum sollen vier PCs miteinander verbunden werden. Ein PC hat aber nur einen Netzwerkanschluss. Baue ein Netz in Sterntopologie: Alle PCs hängen an einem zentralen Verteiler.',
      tip: 'Der zentrale Verteiler ist ein Switch. Er braucht selbst keine IP-Adresse – nur die PCs.',
      think: 'Überlege: Was passiert, wenn ein Kabel zu einem PC kaputtgeht? Und was, wenn der Switch ausfällt? Probiere es aus: Tippe ein Kabel oder den Switch an und simuliere einen Ausfall.',
      goals: [
        { text: 'Setze einen Switch auf die Arbeitsfläche.', check: c => c.byType('switch').length >= 1 },
        { text: 'Verbinde alle vier PCs per Kabel mit dem Switch (Sterntopologie).', check: c => { const pcs = c.byType('pc'); return pcs.length >= 4 && c.byType('switch').some(s => pcs.every(p => c.linked(p, s, 'kabel'))); } },
        { text: 'Gib jedem PC eine eigene IP-Adresse im Netz 192.168.10.0/24.', check: c => { const pcs = c.byType('pc'); return pcs.length >= 4 && pcs.every(d => c.inNet(d, '192.168.10.0', 24)) && c.distinctIPs(pcs); } },
        { text: 'Teste mit einem Ping, ob ein PC einen anderen über den Switch erreicht.', check: c => c.pingOk(isType('pc'), isType('pc')) },
      ],
      start: () => build(({ add }) => {
        add('s1', 'pc', 180, 140, { name: 'PC 1' });
        add('s2', 'pc', 620, 140, { name: 'PC 2' });
        add('s3', 'pc', 180, 420, { name: 'PC 3' });
        add('s4', 'pc', 620, 420, { name: 'PC 4' });
      }),
      solution: () => build(({ net, add, link }) => {
        add('s1', 'pc', 180, 140, { name: 'PC 1', ip: '192.168.10.1' });
        add('s2', 'pc', 620, 140, { name: 'PC 2', ip: '192.168.10.2' });
        add('s3', 'pc', 180, 420, { name: 'PC 3', ip: '192.168.10.3' });
        add('s4', 'pc', 620, 420, { name: 'PC 4', ip: '192.168.10.4' });
        add('sw', 'switch', 400, 280, { name: 'Switch 1' });
        ['s1', 's2', 's3', 's4'].forEach(p => link(p, 'sw'));
        evPing(net, 's1', 's4');
      }),
    },
    {
      id: 'heimnetz',
      title: 'Heimnetz mit WLAN',
      level: 2,
      intro: 'Familie Yilmaz hat einen Router mit eingebautem WLAN. Baue das Heimnetz: Der PC im Arbeitszimmer hängt am Kabel, Tablet und Smartphone sind per WLAN verbunden. Der Router ist das Tor zu anderen Netzen – deshalb tragen alle Geräte ihn als Gateway ein.',
      tip: 'Hier vergibst du die Adressen von Hand (der DHCP-Server des Routers ist aus). Der Router hat im Heimnetz die IP-Adresse 192.168.178.1. Seine drei LAN-Anschlüsse und sein WLAN gehören alle zum selben Heimnetz.',
      manual: true,
      goals: [
        { text: 'Verbinde ein Tablet und ein Smartphone per WLAN mit dem Router.', check: c => ['tablet', 'smartphone'].every(t => c.byType(t).some(d => c.neighbors(d.id).some(n => n.kind === 'wlan' && (n.dev.type === 'ap' || n.dev.type === 'router')))) },
        { text: 'Schließe einen PC per Kabel im Heimnetz an.', check: c => c.byType('pc').some(p => NW.l2Endpoints(c.net, p.id, 0).some(e => e.dev.type === 'router')) },
        { text: 'Gib allen Endgeräten eine eigene IP-Adresse im Netz 192.168.178.0/24 und trage den Router (192.168.178.1) als Gateway ein.', check: c => { const h = c.hosts; return h.length >= 3 && h.every(d => c.inNet(d, '192.168.178.0', 24) && d.gw.trim() === '192.168.178.1') && c.distinctIPs(h); } },
        { text: 'Teste mit einem Ping vom Smartphone zum PC.', check: c => c.pingOk(isType('smartphone'), isType('pc')) },
      ],
      start: () => build(({ add }) => {
        const r = add('r', 'router', 200, 280, { name: 'Heimrouter' });
        r.ports[1].ip = '192.168.178.1';
      }),
      solution: () => build(({ net, add, link }) => {
        const r = add('r', 'router', 200, 280, { name: 'Heimrouter' });
        r.ports[1].ip = '192.168.178.1';
        add('pc', 'pc', 520, 430, { name: 'PC Arbeitszimmer', ip: '192.168.178.20', gw: '192.168.178.1' });
        add('tb', 'tablet', 560, 120, { name: 'Tablet 1', ip: '192.168.178.30', gw: '192.168.178.1' });
        add('sp', 'smartphone', 720, 260, { name: 'Smartphone 1', ip: '192.168.178.31', gw: '192.168.178.1' });
        link('r', 'pc');
        link('r', 'tb', 'wlan'); link('r', 'sp', 'wlan');
        evPing(net, 'sp', 'pc');
      }),
    },
    {
      id: 'webseite',
      title: 'Eine Webseite aufrufen',
      level: 2,
      intro: 'Rechts siehst du den Internetanbieter. Bei ihm stehen ein Webserver und ein DNS-Server im Internet. Schließe einen PC an den Heimrouter an und rufe im Browser die Seite http://www.netzwerkstatt.de auf. Beobachte genau, welche Pakete unterwegs sind!',
      manual: true,
      tip: 'Der Router hat zwei IP-Adressen: eine lokale im Heimnetz (LAN, 192.168.178.1) und eine externe am Internet-Anschluss (WAN, 203.0.113.10). Dein PC braucht eine IP-Adresse im Heimnetz, den Router als Gateway und den DNS-Server 203.0.113.53.',
      think: 'Warum braucht der PC einen DNS-Server, obwohl er doch nur eine Webseite laden will? Was würde passieren, wenn du statt des Namens direkt http://203.0.113.80 eingibst?',
      goals: [
        { text: 'Schließe einen PC per Kabel an den Heimrouter an.', check: c => c.byType('pc').some(p => NW.l2Endpoints(c.net, p.id, 0).some(e => e.dev.id === 'r' && e.port === 1)) },
        { text: 'Gib dem PC eine IP-Adresse im Heimnetz 192.168.178.0/24.', check: c => c.byType('pc').some(p => c.inNet(p, '192.168.178.0', 24) && p.ip.trim() !== '192.168.178.1') },
        { text: 'Trage beim PC den Router als Gateway ein.', check: c => c.byType('pc').some(p => p.gw.trim() === '192.168.178.1') },
        { text: 'Trage beim PC den DNS-Server ein.', check: c => c.byType('pc').some(p => p.dns.trim() === '203.0.113.53') },
        { text: 'Öffne im Browser des PCs die Seite http://www.netzwerkstatt.de.', check: c => c.webOk('www.netzwerkstatt.de') },
      ],
      start: () => internetStart(),
      solution: () => {
        const net = internetStart();
        NW.createDevice(net, 'pc', 160, 160, { id: 'pc', name: 'PC 1', ip: '192.168.178.20', gw: '192.168.178.1', dns: '203.0.113.53' });
        NW.addLink(net, 'pc', 'r', 'kabel');
        NW.logEvent(net, { type: 'web', src: 'pc', host: 'www.netzwerkstatt.de', ok: true });
        return net;
      },
    },
    {
      id: 'dhcp',
      title: 'Automatische Adressen mit DHCP',
      level: 2,
      intro: 'Im Schulcafé wollen viele Gäste ins WLAN. Niemand möchte dort IP-Adressen von Hand eintragen. Das übernimmt ein DHCP-Server im Router: Er verteilt die Adressen automatisch an alle Geräte, die danach fragen.',
      tip: 'Tippe den Router an und schalte im Heimnetz (LAN) den DHCP-Server ein. Stelle danach bei Tablet und Smartphone die Netzwerk-Einstellungen auf „Automatisch (DHCP)". Beobachte die vier DHCP-Pakete!',
      think: 'Warum schickt ein Gerät seine erste DHCP-Nachricht „an alle" und nicht direkt an den Router? Was passiert, wenn der Adressbereich nur zwei Adressen enthält, aber drei Geräte eine wollen? Probiere es aus!',
      goals: [
        { text: 'Schalte beim Router den DHCP-Server für das Netz 192.168.0.0/24 ein.', check: c => c.byType('router').some(r => r.ports.some((p, i) => p.dhcp && p.dhcp.on && NW.ifaceAddr(r, i) && NW.sameNet(NW.ifaceAddr(r, i).ip, NW.parseIP('192.168.0.0'), 24))) },
        { text: 'Verbinde ein Tablet und ein Smartphone per WLAN (mit dem Access Point oder dem WLAN des Routers).', check: c => ['tablet', 'smartphone'].every(t => c.byType(t).some(d => c.neighbors(d.id).some(n => n.kind === 'wlan' && (n.dev.type === 'ap' || n.dev.type === 'router')))) },
        { text: 'Lass Tablet und Smartphone ihre IP-Adresse automatisch per DHCP beziehen.', check: c => ['tablet', 'smartphone'].every(t => c.byType(t).some(d => d.dhcp && c.inNet(d, '192.168.0.0', 24) && d.gw.trim() === '192.168.0.1')) },
        { text: 'Teste mit einem Ping vom Smartphone zum Tablet.', check: c => c.pingOk(isType('smartphone'), isType('tablet')) },
      ],
      start: () => dhcpStart(),
      solution: () => {
        const net = dhcpStart();
        NW.dev(net, 'r').ports[1].dhcp.on = true;
        NW.addLink(net, 'ap', 'tb', 'wlan');
        NW.addLink(net, 'ap', 'sp', 'wlan');
        for (const id of ['tb', 'sp']) {
          const d = NW.dev(net, id);
          d.dhcp = true;
          NW.applyLease(d, NW.dhcp(net, id).lease);
        }
        evPing(net, 'sp', 'tb');
        return net;
      },
    },
    {
      id: 'ipv6',
      title: 'IPv6: Eine Adresse für jedes Gerät',
      level: 3,
      intro: 'Mit IPv4 gehen alle Geräte im Heimnetz mit derselben externen Adresse ins Internet (NAT). Deshalb kann der Spieleserver im Internet deinen PC nicht direkt erreichen. Mit IPv6 bekommt jedes Gerät eine eigene, weltweit eindeutige Adresse – ganz automatisch. Probiere es aus!',
      tip: 'IPv6-Adressen musst du nicht eintragen: Tippe ein Gerät an, dann siehst du unter „IPv6" seine Adressen. Beim Ping kannst du sie mit den Knöpfen unter dem Eingabefeld übernehmen. Die Link-Local-Adresse beginnt mit fe80::, die globale Adresse mit 2001:db8:.',
      think: 'Pinge den PC vom Spieleserver aus auch einmal per IPv4 an. Warum klappt das nicht, mit IPv6 aber schon? Und warum kommt ein Ping an die Link-Local-Adresse des Spieleservers nicht an? Übrigens: In echt schützt eine Firewall im Router das Heimnetz vor unerwünschten Anfragen aus dem Internet.',
      goals: [
        { text: 'Schließe einen PC per Kabel an den Heimrouter an. Schau nach: Er hat sofort eine globale IPv6-Adresse.', check: c => c.byType('pc').some(p => NW.l2Endpoints(c.net, p.id, 0).some(e => e.dev.id === 'r' && e.port === NW.LAN) && c.hasGua(p)) },
        { text: 'Verbinde ein Tablet per WLAN mit dem Router.', check: c => c.byType('tablet').some(d => c.neighbors(d.id).some(n => n.kind === 'wlan' && n.dev.id === 'r')) },
        { text: 'Pinge vom PC aus die Link-Local-Adresse (fe80::…) des Tablets an.', check: c => c.ping6Ok(isType('pc'), isType('tablet'), 'll') },
        { text: 'Pinge vom PC aus den Spieleserver über seine globale IPv6-Adresse an.', check: c => c.ping6Ok(isType('pc'), d => d.id === 'game', 'gua') },
        { text: 'Pinge jetzt umgekehrt vom Spieleserver aus deinen PC per IPv6 an – das geht ohne NAT!', check: c => c.ping6Ok(d => d.id === 'game', isType('pc'), 'gua') },
      ],
      start: () => ipv6Start(),
      solution: () => {
        const net = ipv6Start();
        NW.createDevice(net, 'pc', 160, 160, { id: 'pc', name: 'PC 1' });
        NW.createDevice(net, 'tablet', 160, 420, { id: 'tb', name: 'Tablet 1' });
        NW.addLink(net, 'pc', 'r', 'kabel');
        NW.addLink(net, 'r', 'tb', 'wlan');
        for (const id of ['pc', 'tb']) NW.applyLease(NW.dev(net, id), NW.dhcp(net, id).lease);
        evPing6(net, 'pc', 'tb', true);
        evPing6(net, 'pc', 'game');
        evPing6(net, 'game', 'pc');
        return net;
      },
    },
    {
      id: 'bus',
      title: 'Busnetz',
      level: 1,
      manual: true,
      intro: 'Früher wurden viele Netze als Bus gebaut: Ein langes Kabel führt durch den Raum, und alle Rechner werden daran angeschlossen. Baue ein Busnetz mit vier PCs und finde heraus, was bei einem Kabelbruch passiert.',
      tip: 'Das Bus-Kabel findest du links bei den Geräten. Verbinde jeden PC mit einem Kabel mit dem Bus-Kabel. Adressen: 192.168.20.1 bis 192.168.20.4, Subnetzmaske 255.255.255.0. Einen Kabelbruch simulierst du, indem du das Bus-Kabel antippst.',
      think: 'Beim Ping siehst du: Das Signal kommt bei allen PCs am Bus an. Was bedeutet das für den Datenschutz? Was passiert, wenn zwei PCs gleichzeitig senden? Und was, wenn nur ein einzelner PC ausfällt?',
      goals: [
        { text: 'Setze ein Bus-Kabel auf die Arbeitsfläche.', check: c => c.byType('bus').length >= 1 },
        { text: 'Schließe alle vier PCs per Kabel an das Bus-Kabel an (Bustopologie).', check: c => { const pcs = c.byType('pc'); return pcs.length >= 4 && c.byType('bus').some(b => pcs.every(p => c.linked(p, b, 'kabel'))); } },
        { text: 'Gib jedem PC eine eigene IP-Adresse im Netz 192.168.20.0/24.', check: c => { const pcs = c.byType('pc'); return pcs.length >= 4 && pcs.every(d => c.inNet(d, '192.168.20.0', 24)) && c.distinctIPs(pcs); } },
        { text: 'Teste mit einem Ping, ob ein PC einen anderen über den Bus erreicht.', check: c => c.pingOk(isType('pc'), isType('pc')) },
        { text: 'Simuliere einen Kabelbruch im Bus-Kabel und sende einen Ping. Repariere das Kabel danach wieder.', check: c => c.pings().some(e => !e.ok && e.fault === 'bus') && c.byType('bus').length >= 1 && c.byType('bus').every(b => !b.broken) },
      ],
      start: () => build(({ add }) => {
        add('b1', 'pc', 250, 120, { name: 'PC 1' });
        add('b2', 'pc', 650, 120, { name: 'PC 2' });
        add('b3', 'pc', 250, 430, { name: 'PC 3' });
        add('b4', 'pc', 650, 430, { name: 'PC 4' });
      }),
      solution: () => build(({ net, add, link }) => {
        add('b1', 'pc', 250, 120, { name: 'PC 1', ip: '192.168.20.1' });
        add('b2', 'pc', 650, 120, { name: 'PC 2', ip: '192.168.20.2' });
        add('b3', 'pc', 250, 430, { name: 'PC 3', ip: '192.168.20.3' });
        add('b4', 'pc', 650, 430, { name: 'PC 4', ip: '192.168.20.4' });
        add('bus', 'bus', 450, 280, { name: 'Bus-Kabel 1' });
        ['b1', 'b2', 'b3', 'b4'].forEach(p => link(p, 'bus'));
        evPing(net, 'b1', 'b4');
        NW.logEvent(net, { type: 'ping', src: 'b1', target: null, ok: false, fault: 'bus', faults: ['bus:bus'] });
      }),
    },
    {
      id: 'ring',
      title: 'Ringnetz',
      level: 1,
      manual: true,
      intro: 'In einem Ringnetz ist jeder Rechner mit genau zwei Nachbarn verbunden – ganz ohne Switch. Die Daten werden immer in dieselbe Richtung von Station zu Station weitergereicht, bis sie beim Empfänger ankommen. Baue einen Ring aus vier PCs.',
      tip: 'Verbinde PC 1 mit PC 2, PC 2 mit PC 3, PC 3 mit PC 4 und zum Schluss PC 4 wieder mit PC 1. Adressen: 192.168.30.1 bis 192.168.30.4, Subnetzmaske 255.255.255.0. Einen Ausfall simulierst du, indem du einen PC oder ein Kabel antippst.',
      think: 'Schau dir beim Ping genau an, welchen Weg die Antwort nimmt. Warum fällt das ganze Netz aus, wenn nur ein PC ausgeschaltet wird? Vergleiche mit dem Sternnetz.',
      goals: [
        { text: 'Verbinde die vier PCs per Kabel zu einem geschlossenen Ring.', check: c => { const pcs = c.byType('pc'); return pcs.length >= 4 && c.topos('ring').some(t => t.closed && pcs.every(p => t.members.includes(p.id))); } },
        { text: 'Gib jedem PC eine eigene IP-Adresse im Netz 192.168.30.0/24.', check: c => { const pcs = c.byType('pc'); return pcs.length >= 4 && pcs.every(d => c.inNet(d, '192.168.30.0', 24)) && c.distinctIPs(pcs); } },
        { text: 'Teste mit einem Ping, ob die Daten durch den Ring laufen.', check: c => c.pingOk(isType('pc'), isType('pc')) },
        { text: 'Schalte einen PC aus oder simuliere einen Kabelbruch und sende dann einen Ping. Behebe den Fehler danach wieder.', check: c => c.pings().some(e => !e.ok && e.fault === 'ring') && c.topos('ring').length >= 1 && c.topos('ring').every(t => t.ok) },
      ],
      start: () => build(({ add }) => {
        add('r1', 'pc', 250, 120, { name: 'PC 1' });
        add('r2', 'pc', 650, 120, { name: 'PC 2' });
        add('r3', 'pc', 650, 420, { name: 'PC 3' });
        add('r4', 'pc', 250, 420, { name: 'PC 4' });
      }),
      solution: () => build(({ net, add, link }) => {
        add('r1', 'pc', 250, 120, { name: 'PC 1', ip: '192.168.30.1' });
        add('r2', 'pc', 650, 120, { name: 'PC 2', ip: '192.168.30.2' });
        add('r3', 'pc', 650, 420, { name: 'PC 3', ip: '192.168.30.3' });
        add('r4', 'pc', 250, 420, { name: 'PC 4', ip: '192.168.30.4' });
        link('r1', 'r2'); link('r2', 'r3'); link('r3', 'r4'); link('r4', 'r1');
        evPing(net, 'r1', 'r3');
        NW.logEvent(net, { type: 'ping', src: 'r1', target: null, ok: false, fault: 'ring', faults: ['off:r2'] });
      }),
    },
    {
      id: 'topologien',
      title: 'Topologien im Ausfalltest',
      level: 2,
      manual: true,
      intro: 'Hier sind drei kleine Netze schon fertig aufgebaut: ein Stern, ein Bus und ein Ring. Teste, wie gut sie Ausfälle verkraften. Tippe dafür Kabel und Geräte an und simuliere einen Kabelbruch oder einen Ausfall. Sende danach jeweils einen Ping.',
      tip: 'Oben links siehst du, welche Topologien erkannt wurden. Tippe darauf, um Vor- und Nachteile nachzulesen. Nach jedem Test kannst du das Kabel reparieren oder das Gerät wieder einschalten.',
      think: 'Welche Topologie verkraftet Ausfälle am besten? Wo ist die Schwachstelle beim Stern? Warum werden heute fast nur noch Sternnetze mit Switches gebaut?',
      goals: [
        { text: 'Stern: Simuliere einen Kabelbruch zu einem PC. Zeige mit einem Ping, dass sich die anderen beiden PCs trotzdem erreichen.', check: c => c.pings().some(e => e.ok && TOPO_TEST.stern.includes(e.src) && TOPO_TEST.stern.includes(e.target) && (e.faults || []).some(f => TOPO_TEST.starLink(c.net, f))) },
        { text: 'Stern: Lass den Switch ausfallen und sende einen Ping. Was passiert?', check: c => c.pings().some(e => !e.ok && TOPO_TEST.stern.includes(e.src) && (e.faults || []).includes('off:ts')) },
        { text: 'Bus: Lass einen PC ausfallen. Zeige mit einem Ping, dass die beiden anderen trotzdem weiterarbeiten.', check: c => c.pings().some(e => e.ok && TOPO_TEST.bus.includes(e.src) && TOPO_TEST.bus.includes(e.target) && (e.faults || []).some(f => TOPO_TEST.bus.some(id => f === 'off:' + id))) },
        { text: 'Bus: Simuliere einen Kabelbruch im Bus-Kabel und sende einen Ping.', check: c => c.pings().some(e => !e.ok && e.fault === 'bus' && TOPO_TEST.bus.includes(e.src)) },
        { text: 'Ring: Lass einen PC ausfallen und sende einen Ping zwischen den beiden anderen.', check: c => c.pings().some(e => !e.ok && e.fault === 'ring' && TOPO_TEST.ring.includes(e.src) && (e.faults || []).some(f => TOPO_TEST.ring.some(id => f === 'off:' + id && id !== e.src))) },
      ],
      start: () => topoStart(),
      solution: () => {
        const net = topoStart();
        const starLink = net.links.find(l => l.a === 'k3' || l.b === 'k3');
        NW.logEvent(net, { type: 'ping', src: 'k1', target: 'k2', ok: true, faults: ['link:' + starLink.id] });
        NW.logEvent(net, { type: 'ping', src: 'k1', target: null, ok: false, fault: 'off', faults: ['off:ts'] });
        NW.logEvent(net, { type: 'ping', src: 'u1', target: 'u3', ok: true, faults: ['off:u2'] });
        NW.logEvent(net, { type: 'ping', src: 'u1', target: null, ok: false, fault: 'bus', faults: ['bus:tb'] });
        NW.logEvent(net, { type: 'ping', src: 'g1', target: null, ok: false, fault: 'ring', faults: ['off:g2'] });
        return net;
      },
    },
    {
      id: 'frei',
      title: 'Freies Bauen',
      level: 0,
      free: true,
      intro: 'Hier kannst du ohne Vorgaben eigene Netzwerke bauen und ausprobieren.',
      tip: 'Ideen: Schließe deinen Heimrouter an einen Internetanbieter an und stelle beim Anbieter einen Webserver und einen DNS-Server ins Internet. Rufe die Seite dann vom Heimnetz aus auf und achte auf NAT im Protokoll. Was passiert, wenn ein Server im Internet einen PC in deinem Heimnetz anpingen will? Was passiert, wenn zwei Geräte dieselbe IP-Adresse haben? Vergleiche außerdem einen Ping per IPv4 und per IPv6 zwischen Internet und Heimnetz.',
      goals: [],
      start: () => NW.emptyNetwork(),
      solution: null,
    },
  ];

  /** Geräte-IDs im Ausfalltest (die Geräte sind gesperrt, die IDs bleiben also gleich). */
  const TOPO_TEST = {
    stern: ['k1', 'k2', 'k3'], bus: ['u1', 'u2', 'u3'], ring: ['g1', 'g2', 'g3'],
    starLink: (net, f) => { const l = f.startsWith('link:') && net.links.find(x => 'link:' + x.id === f); return !!l && (l.a === 'ts' || l.b === 'ts'); },
  };

  function topoStart() {
    return build(({ add, link }) => {
      const L = { locked: true };
      // Stern (links)
      add('ts', 'switch', 150, 300, Object.assign({ name: 'Switch' }, L));
      add('k1', 'pc', 70, 110, Object.assign({ name: 'Stern 1', ip: '192.168.1.1' }, L));
      add('k2', 'pc', 230, 110, Object.assign({ name: 'Stern 2', ip: '192.168.1.2' }, L));
      add('k3', 'pc', 150, 470, Object.assign({ name: 'Stern 3', ip: '192.168.1.3' }, L));
      ['k1', 'k2', 'k3'].forEach(p => link(p, 'ts', 'kabel', L));
      // Bus (Mitte)
      add('tb', 'bus', 450, 300, Object.assign({ name: 'Bus-Kabel' }, L));
      add('u1', 'pc', 360, 110, Object.assign({ name: 'Bus 1', ip: '192.168.2.1' }, L));
      add('u2', 'pc', 540, 110, Object.assign({ name: 'Bus 2', ip: '192.168.2.2' }, L));
      add('u3', 'pc', 450, 470, Object.assign({ name: 'Bus 3', ip: '192.168.2.3' }, L));
      ['u1', 'u2', 'u3'].forEach(p => link(p, 'tb', 'kabel', L));
      // Ring (rechts)
      add('g1', 'pc', 750, 110, Object.assign({ name: 'Ring 1', ip: '192.168.3.1' }, L));
      add('g2', 'pc', 840, 300, Object.assign({ name: 'Ring 2', ip: '192.168.3.2' }, L));
      add('g3', 'pc', 670, 300, Object.assign({ name: 'Ring 3', ip: '192.168.3.3' }, L));
      link('g1', 'g2', 'kabel', L); link('g2', 'g3', 'kabel', L); link('g3', 'g1', 'kabel', L);
    });
  }

  function dhcpStart() {
    return build(({ add, link }) => {
      const r = add('r', 'router', 160, 280, { name: 'Café-Router' });
      r.ports[1].ip = '192.168.0.1';
      r.ports[1].dhcp.on = false;
      add('ap', 'ap', 400, 280, { name: 'Café-WLAN' });
      add('tb', 'tablet', 680, 150, { name: 'Tablet 1', dhcp: false });
      add('sp', 'smartphone', 680, 410, { name: 'Smartphone 1', dhcp: false });
      link('r', 'ap');
    });
  }

  function internetStart() {
    return build(({ add, link }) => {
      const r = add('r', 'router', 360, 280, { name: 'Heimrouter', locked: true });
      Object.assign(r.ports[0], { ip: '203.0.113.10', gw: '203.0.113.1', dns: '203.0.113.53' });
      r.ports[1].ip = '192.168.178.1';
      add('inet', 'isp', 560, 280, { name: 'Internetanbieter', locked: true, ip: '203.0.113.1', dns: '203.0.113.53' });
      add('dns', 'server', 760, 160, { name: 'DNS-Server', locked: true, ip: '203.0.113.53', gw: '203.0.113.1',
        services: { web: { on: false, title: '', text: '' }, dns: { on: true, entries: [{ name: 'www.netzwerkstatt.de', ip: '203.0.113.80' }] } } });
      add('web', 'server', 760, 400, { name: 'Webserver', locked: true, ip: '203.0.113.80', gw: '203.0.113.1',
        services: { web: { on: true, title: 'Willkommen in der NetzWerkstatt!', text: 'Glückwunsch – dein PC hat diese Seite über DNS, den Router und das Internet geladen.' }, dns: { on: false, entries: [] } } });
      link('r', 'inet', 'kabel', { locked: true });
      link('inet', 'dns', 'kabel', { locked: true });
      link('inet', 'web', 'kabel', { locked: true });
    });
  }

  function ipv6Start() {
    return build(({ add, link }) => {
      const r = add('r', 'router', 360, 280, { name: 'Heimrouter', locked: true });
      Object.assign(r.ports[0], { ip: '85.17.4.100', gw: '85.17.4.1', dns: '' });
      r.ports[1].ip = '192.168.178.1';
      add('inet', 'isp', 560, 280, { name: 'Internetanbieter', locked: true, ip: '85.17.4.1' });
      add('game', 'server', 760, 280, { name: 'Spieleserver', locked: true, ip: '85.17.4.101', gw: '85.17.4.1', dhcp: false });
      link('r', 'inet', 'kabel', { locked: true });
      link('inet', 'game', 'kabel', { locked: true });
    });
  }

  /** In Aufgaben mit „manual" werden Adressen von Hand vergeben: DHCP überall aus. */
  function manualize(net) {
    for (const d of net.devices) {
      if (T[d.type].host) d.dhcp = false;
      if (T[d.type].router) d.ports.forEach(p => { if (p.dhcp) p.dhcp.on = false; });
    }
    return net;
  }
  for (const t of TASKS) if (t.manual) {
    const st = t.start, so = t.solution;
    t.start = () => manualize(st());
    if (so) t.solution = () => manualize(so());
  }

  function evaluate(task, net) {
    const c = ctx(net);
    return task.goals.map(g => { try { return !!g.check(c); } catch (e) { return false; } });
  }

  function byId(id) { return TASKS.find(t => t.id === id) || null; }

  const api = { TASKS, evaluate, byId, manualize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NWTasks = api;
})(typeof window !== 'undefined' ? window : globalThis);

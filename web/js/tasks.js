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
  // Eigene Aufgaben der Lehrkraft (werden von eigene.js eingetragen)
  let CUSTOM = [];

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
    // Wurde eine Datei erfolgreich getauscht, und liegt sie noch beim Empfänger?
    const fileOk = (mode, dir, srcId, targetId) => (net.events || []).some(e => {
      if (e.type !== 'file' || !e.ok || e.mode !== mode || e.dir !== dir) return false;
      if ((srcId && e.src !== srcId) || (targetId && e.target !== targetId)) return false;
      const s = NW.dev(net, e.src), t = NW.dev(net, e.target);
      if (!s || !t) return false;
      const recv = dir === 'send' ? t : s;
      const have = mode === 'server' && dir === 'send' ? NW.fileStore(recv).files : NW.filesOf(recv);
      return (e.files || []).length > 0 && e.files.every(f => have.includes(f));
    });
    const musicOk = srcFilter => (net.events || []).some(e => {
      if (e.type !== 'music' || !e.ok) return false;
      const s = NW.dev(net, e.src);
      return s && srcFilter(s) && NW.playMusic(net, s.id).ok;
    });
    const kinds = NW.netKinds(net);
    const hasKind = (kind, id) => kinds.some(k => k.kind === kind && (!id || k.devices.includes(id)));
    // Wurde ein Internetdienst erfolgreich genutzt (und klappt das auch jetzt noch)? opts: {host, lost}
    const svcOk = (action, srcFilter, opts) => (net.events || []).some(e => {
      opts = opts || {};
      if (e.type !== 'svc' || e.action !== action || !e.ok) return false;
      if (opts.host && e.host !== opts.host) return false;
      if (opts.lost && !e.lost) return false;
      const s = NW.dev(net, e.src);
      return s && srcFilter(s) && NW.useService(net, s.id, action, e.host).ok;
    });
    // Wurde eine Webseite per Name aufgerufen, und hat dabei ein passender DNS-Server mitgewirkt (jetzt noch)?
    // dnsFilter bekommt die Liste der befragten DNS-Server (in Reihenfolge).
    const webDnsOk = (host, dnsFilter) => (net.events || []).some(e => {
      if (e.type !== 'web' || !e.ok || (host && e.host !== host)) return false;
      const s = NW.dev(net, e.src);
      if (!s) return false;
      const r = NW.browse(net, s.id, 'http://' + e.host);
      return r.ok && (r.dns || []).length > 0 && dnsFilter((r.dns || []).map(id => NW.dev(net, id)).filter(Boolean));
    });
    const svcKinds = () => new Set((net.events || []).filter(e => e.ok && (e.type === 'web' || e.type === 'svc')).map(e => e.type === 'web' ? 'web' : e.action === 'mailget' ? 'mail' : e.action));
    return { net, byType, hosts, neighbors, linked, inNet, distinctIPs, pingOk, ping6Ok, hasGua, webOk, fileOk, musicOk, kinds, hasKind, pings, topos, svcOk, svcKinds, webDnsOk };
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

  function evSvc(net, src, action, host, lost) { NW.logEvent(net, { type: 'svc', action, src, host, ok: true, lost: !!lost }); }

  /** Holt für die genannten Geräte eine Adresse per DHCP (für Startnetze und Musterlösungen). */
  function lease(net, ...ids) {
    for (const id of ids) { const r = NW.dhcp(net, id); if (!r.ok) throw new Error(r.error); NW.applyLease(NW.dev(net, id), r.lease); }
  }

  /** Server mit festen Einstellungen und den angegebenen Diensten. */
  function server(add, id, x, y, name, ip, on, extra) {
    const services = NW.defaultServices();
    for (const k of on) services[k].on = true;
    return add(id, 'server', x, y, Object.assign({ name, ip, gw: '203.0.113.1', dhcp: false, locked: true, services }, extra || {}));
  }

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
      tip: 'Das Bus-Kabel findest du links bei den Geräten. Verbinde jeden PC mit einem Kabel mit dem Bus-Kabel. Adressen: 192.168.20.1 bis 192.168.20.4, Subnetzmaske 255.255.255.0. Einen Kabelbruch simulierst du so: Wähle oben „Auswählen“, tippe das Bus-Kabel an und dann auf „Kabelbruch simulieren“.',
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
      tip: 'Verbinde PC 1 mit PC 2, PC 2 mit PC 3, PC 3 mit PC 4 und zum Schluss PC 4 wieder mit PC 1. Adressen: 192.168.30.1 bis 192.168.30.4, Subnetzmaske 255.255.255.0. Einen Ausfall simulierst du so: Wähle oben „Auswählen“ und tippe einen PC oder ein Kabel an. In den Einstellungen findest du „Ausfall testen“.',
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
      tip: 'Oben links siehst du, welche Topologien erkannt wurden. Tippe darauf, um Vor- und Nachteile nachzulesen. Für die Tests wählst du oben „Auswählen“ und tippst ein Kabel oder Gerät an: Unter „Ausfall testen“ findest du die Knöpfe. Nach jedem Test kannst du das Kabel reparieren oder das Gerät wieder einschalten.',
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
      id: 'dateien',
      title: 'Dateien teilen: Peer-to-Peer und Client-Server',
      level: 2,
      manual: true,
      intro: 'Lena möchte das Klassenfoto mit Tom und Mia teilen. Das geht auf zwei Arten: direkt von Gerät zu Gerät (Peer-to-Peer) oder über einen zentralen Server, die Schul-Cloud (Client-Server). Probiere beide Wege aus. Die Netzwerk-Einstellungen sind schon fertig.',
      tip: 'Tippe einen PC an. Unter „Dateien“ kannst du eine Datei an eine IP-Adresse schicken oder von dort holen. Bei Peer-to-Peer muss der Empfänger mitmachen: Schalte bei ihm „Dateien direkt tauschen (Peer-to-Peer)“ ein. Für den Weg über den Server schaltest du beim Server die Dateiablage ein.',
      think: 'Lösche das Kabel von Lenas PC. Kann Mia das Foto jetzt noch bekommen – über den Server? Und direkt von Lena? Wer ist beim Peer-to-Peer der Client und wer der Server? Was passiert mit allen Dateien, wenn der Server ausfällt?',
      goals: [
        { text: 'Peer-to-Peer: Schicke das Klassenfoto von Lenas PC direkt an Toms PC.', check: c => c.fileOk('p2p', 'send', 'lena', 'tom') },
        { text: 'Client-Server: Schalte beim Server die Dateiablage ein und lade das Klassenfoto von Lenas PC hoch.', check: c => c.fileOk('server', 'send', 'lena', 'srv') },
        { text: 'Hole das Klassenfoto auf Mias PC vom Server.', check: c => c.fileOk('server', 'get', 'mia', 'srv') },
      ],
      start: () => filesStart(),
      solution: () => {
        const net = filesStart();
        NW.dev(net, 'tom').share = true;
        NW.fileStore(NW.dev(net, 'srv')).on = true;
        const ev = (src, dst, dir, r) => NW.logEvent(net, { type: 'file', src, target: r.target, mode: r.mode, dir, files: r.files, ok: r.ok });
        ev('lena', 'tom', 'send', NW.sendFile(net, 'lena', '192.168.20.12', 'Klassenfoto.jpg'));
        ev('lena', 'srv', 'send', NW.sendFile(net, 'lena', '192.168.20.2', 'Klassenfoto.jpg'));
        ev('mia', 'srv', 'get', NW.getFiles(net, 'mia', '192.168.20.2'));
        return net;
      },
    },
    {
      id: 'pan',
      title: 'Musik über Bluetooth (PAN)',
      level: 1,
      intro: 'Jonas hört mit kabellosen Kopfhörern Musik vom Smartphone. Kopfhörer und Smartphone bilden zusammen ein winziges Netz: ein PAN (Personal Area Network). Gleichzeitig ist das Smartphone im WLAN des Heimnetzes (LAN). Achte unten auf der Arbeitsfläche auf die Anzeige der Netzarten.',
      tip: 'Tippe in der Geräteleiste auf „Bluetooth“ und dann auf das Smartphone und auf die Kopfhörer. Danach findest du beim Smartphone den Knopf „Musik abspielen“. Für das Heimnetz nimmst du „WLAN“.',
      think: 'Warum brauchen die Kopfhörer keine IP-Adresse? Kann der PC die Kopfhörer anpingen? Wie weit reicht Bluetooth ungefähr – und wie weit WLAN?',
      goals: [
        { text: 'Kopple die Kopfhörer per Bluetooth mit dem Smartphone.', check: c => c.byType('headset').some(h => c.byType('smartphone').some(s => c.linked(h, s, 'bluetooth'))) },
        { text: 'Spiele auf dem Smartphone Musik über die Kopfhörer ab.', check: c => c.musicOk(isType('smartphone')) },
        { text: 'Verbinde das Smartphone per WLAN mit dem Heimrouter.', check: c => c.byType('smartphone').some(s => c.hasKind('PAN', s.id) && c.hasKind('LAN', s.id) && c.neighbors(s.id).some(n => n.kind === 'wlan')) },
        { text: 'Teste mit einem Ping vom Smartphone zum PC.', check: c => c.pingOk(isType('smartphone'), isType('pc')) },
      ],
      start: () => panStart(),
      solution: () => {
        const net = panStart();
        NW.addLink(net, 'sp', 'hs', 'bluetooth');
        NW.logEvent(net, { type: 'music', src: 'sp', target: 'hs', ok: true });
        NW.addLink(net, 'r', 'sp', 'wlan');
        NW.applyLease(NW.dev(net, 'sp'), NW.dhcp(net, 'sp').lease);
        evPing(net, 'sp', 'pc');
        return net;
      },
    },
    {
      id: 'man',
      title: 'Stadtnetz für zwei Schulgebäude (MAN)',
      level: 2,
      manual: true,
      intro: 'Die Schule hat eine Außenstelle am anderen Ende der Stadt. Beide Gebäude haben schon ein eigenes lokales Netz (LAN). Die Stadtwerke verlegen eine Glasfaserleitung zwischen den Gebäuden. Verbinde die beiden LANs zu einem Stadtnetz (MAN), damit die Außenstelle den Vertretungsplan vom Schulserver abrufen kann.',
      tip: 'Tippe in der Geräteleiste auf „Glasfaser“ und dann nacheinander auf die beiden Switches. Hast du schon ein normales Kabel verlegt? Dann tippe auf die Linie zwischen den Switches und wähle bei „Art der Leitung“ den Knopf „Glasfaser“. Die Adressen sind schon eingetragen: Alle Geräte liegen im Netz 10.10.0.0/24.',
      think: 'Woran erkennt man, dass hier zwei LANs und ein MAN entstanden sind? Wie müsste das Netz aussehen, wenn die Außenstelle in einer anderen Stadt oder einem anderen Land läge?',
      goals: [
        { text: 'Verbinde die Switches der beiden Gebäude miteinander.', check: c => c.linked(NW.dev(c.net, 'swa') || {}, NW.dev(c.net, 'swb') || {}, 'kabel') },
        { text: 'Die Verbindung muss eine Glasfaserleitung quer durch die Stadt sein (Werkzeug „Glasfaser“), sodass ein MAN entsteht.', check: c => c.hasKind('MAN', 'swa') && c.hasKind('MAN', 'swb') },
        { text: 'Rufe am PC in der Außenstelle den Vertretungsplan auf: http://10.10.0.2', check: c => (c.net.events || []).some(e => e.type === 'web' && e.ok && e.src === 'pcb' && e.host === '10.10.0.2') && c.webOk('10.10.0.2') },
      ],
      start: () => manStart(),
      solution: () => {
        const net = manStart();
        NW.addLink(net, 'swa', 'swb', 'kabel').link.stadt = true;
        NW.logEvent(net, { type: 'web', src: 'pcb', host: '10.10.0.2', ok: true });
        return net;
      },
    },
    {
      id: 'netzarten',
      title: 'Vom PAN bis zum WAN',
      level: 2,
      intro: 'Vom Kopfhörer bis ins Internet: Baue ein Netz, in dem alle Netzarten vorkommen. Kopfhörer und Smartphone bilden ein PAN, das Heimnetz ist ein LAN, und über den Internetanbieter geht es ins Internet, das größte WAN. Die Anzeige unten auf der Arbeitsfläche zeigt dir, welche Netzarten schon da sind.',
      tip: 'Tippe in der Anzeige auf eine Netzart: Dann leuchten die Geräte auf, die dazugehören. Am einfachsten verbindest du zuerst den Heimrouter mit dem Internetanbieter und danach das Smartphone mit dem WLAN – dann bekommt es per DHCP auch gleich den DNS-Server.',
      think: 'Zu welchen Netzarten gehört das Smartphone gleichzeitig? Welche Netzart hat die größte Reichweite, welche die kleinste?',
      goals: [
        { text: 'PAN: Kopple die Kopfhörer per Bluetooth mit dem Smartphone.', check: c => c.byType('smartphone').some(s => c.hasKind('PAN', s.id) && c.byType('headset').some(h => c.hasKind('PAN', h.id))) },
        { text: 'LAN: Verbinde das Smartphone per WLAN mit dem Heimrouter.', check: c => c.byType('smartphone').some(s => c.byType('router').some(r => c.kinds.some(k => k.kind === 'LAN' && k.devices.includes(s.id) && k.devices.includes(r.id)))) },
        { text: 'WAN: Schließe den Heimrouter an den Internetanbieter an.', check: c => c.byType('router').some(r => c.hasKind('WAN', r.id) && c.hasKind('LAN', r.id)) },
        { text: 'Rufe auf dem Smartphone die Seite http://www.netzwerkstatt.de auf.', check: c => c.webOk('www.netzwerkstatt.de') && (c.net.events || []).some(e => e.type === 'web' && e.ok && NW.dev(c.net, e.src) && NW.dev(c.net, e.src).type === 'smartphone') },
      ],
      start: () => kindsStart(),
      solution: () => {
        const net = kindsStart();
        NW.addLink(net, 'r', 'inet', 'kabel');
        NW.applyLease(NW.dev(net, 'r'), NW.dhcp(net, 'r').lease);
        NW.addLink(net, 'sp', 'hs', 'bluetooth');
        NW.addLink(net, 'r', 'sp', 'wlan');
        NW.applyLease(NW.dev(net, 'sp'), NW.dhcp(net, 'sp').lease);
        NW.logEvent(net, { type: 'web', src: 'sp', host: 'www.netzwerkstatt.de', ok: true });
        return net;
      },
    },
    {
      id: 'tcp-udp',
      title: 'TCP und UDP im Vergleich',
      level: 3,
      intro: 'Im Internet stehen ein Video-Server und ein Server für Videokonferenzen. Verbinde das Tablet mit dem WLAN des Heimrouters, sieh dir ein Video an und starte einen Videoanruf. Danach störst du das WLAN – und beobachtest genau, was mit einem verlorenen Paket passiert.',
      tip: 'Tippe das Tablet an: Unter „Testen" findest du die Internetdienste. Tippe einen der Namen an, damit er im Feld „Server" steht. Um das WLAN zu stören, tippst du die gestrichelte WLAN-Linie an und schaltest „Gestörte Verbindung" ein. Schalte auch einmal „TCP genau zeigen" ein.',
      think: 'Beim Video wurde das verlorene Paket neu gesendet, beim Videoanruf nicht. Warum ist das jeweils sinnvoll? Welche drei Pakete gehen dem Video voraus, wenn du „TCP genau zeigen" einschaltest – und warum fehlen sie beim Videoanruf?',
      goals: [
        { text: 'Verbinde das Tablet per WLAN mit dem Heimrouter.', check: c => c.byType('tablet').some(t => c.neighbors(t.id).some(n => n.kind === 'wlan' && n.dev.type === 'router')) },
        { text: 'Sieh dir auf dem Tablet das Video von video.netzwerkstatt.de an (Video-Streaming über TCP).', check: c => c.svcOk('video', isType('tablet'), { host: 'video.netzwerkstatt.de' }) },
        { text: 'Starte vom Tablet einen Videoanruf über konferenz.netzwerkstatt.de (Videotelefonie über UDP).', check: c => c.svcOk('call', isType('tablet'), { host: 'konferenz.netzwerkstatt.de' }) },
        { text: 'Schalte bei der WLAN-Verbindung „Gestörte Verbindung" ein. Sieh dir dann noch einmal das Video an und telefoniere noch einmal.', check: c => c.svcOk('video', isType('tablet'), { lost: true }) && c.svcOk('call', isType('tablet'), { lost: true }) },
      ],
      start: () => tcpUdpStart(),
      solution: () => {
        const net = tcpUdpStart();
        NW.addLink(net, 'r', 'tb', 'wlan').link.loss = true;
        lease(net, 'tb');
        evSvc(net, 'tb', 'video', 'video.netzwerkstatt.de');
        evSvc(net, 'tb', 'call', 'konferenz.netzwerkstatt.de');
        evSvc(net, 'tb', 'video', 'video.netzwerkstatt.de', true);
        evSvc(net, 'tb', 'call', 'konferenz.netzwerkstatt.de', true);
        return net;
      },
    },
    {
      id: 'dienste-sortieren',
      title: 'Dienste einordnen: TCP oder UDP?',
      level: 2,
      intro: 'Im Internet stehen Server für Webseiten, E-Mail, Videos, Videoanrufe und ein Online-Spiel. Probiere die Dienste am PC aus und beobachte im Protokoll, ob sie TCP oder UDP benutzen. Ordne danach die Anwendungen rechts zu.',
      tip: 'TCP baut zuerst eine Verbindung auf, bestätigt jedes Paket und sendet verlorene Pakete neu: Alles kommt vollständig an. UDP schickt einfach los – ohne Verbindungsaufbau und ohne Bestätigung: Das ist schneller, aber verlorene Pakete bleiben verloren. Frage dich bei jeder Anwendung: Was ist wichtiger – vollständig oder schnell?',
      think: 'Eine Sprachnachricht und ein Telefonanruf übertragen beide deine Stimme. Warum nutzen sie trotzdem verschiedene Protokolle?',
      goals: [
        { text: 'Probiere am PC mindestens drei verschiedene Internetdienste aus (z. B. Webseite, E-Mail, Video, Videoanruf, Online-Spiel).', check: c => c.svcKinds().size >= 3 },
        { text: 'Ordne alle Anwendungen richtig zu: TCP oder UDP?', check: c => QUIZ.items.every(it => (c.net.quiz || {})[it.id] === it.answer) },
      ],
      quiz: null, // wird unten gesetzt
      start: () => diensteStart(),
      solution: () => {
        const net = diensteStart();
        evSvc(net, 'pc', 'mail', 'mail.netzwerkstatt.de');
        evSvc(net, 'pc', 'video', 'video.netzwerkstatt.de');
        evSvc(net, 'pc', 'game', 'spiel.netzwerkstatt.de');
        net.quiz = {};
        for (const it of QUIZ.items) net.quiz[it.id] = it.answer;
        return net;
      },
    },
    {
      id: 'dienste',
      title: 'Eigene Internetdienste anbieten',
      level: 3,
      intro: 'Die Schule möchte einen eigenen E-Mail-Server und einen Spiele-Server für die Pause betreiben. Stelle die Server ins Internet, trage ihre Namen beim DNS-Server ein und teste sie: Vom PC geht eine E-Mail los, auf dem Smartphone wird sie abgerufen.',
      tip: 'Ein Server, den du per Kabel an den Internetanbieter anschließt, bekommt automatisch eine öffentliche Adresse. Ein Server kann auch mehrere Dienste gleichzeitig anbieten. Beim DNS-Server ergänzt du unter „+ Eintrag" den Namen und die IP-Adresse deines Servers.',
      think: 'Die E-Mail ging zuerst vom PC zum E-Mail-Server und erst später vom Server zum Smartphone. Warum schickt der PC die E-Mail nicht direkt an das Smartphone? Und warum nutzt der Spiele-Server UDP, der E-Mail-Server aber TCP?',
      goals: [
        { text: 'Schließe einen neuen Server an den Internetanbieter an und schalte bei ihm den E-Mail-Server ein.', check: c => mailServers(c).length > 0 },
        { text: 'Trage beim DNS-Server den Namen mail.schule.de mit der IP-Adresse deines E-Mail-Servers ein.', check: c => mailServers(c).some(s => dnsHas(c, 'mail.schule.de', s.ip)) },
        { text: 'Schicke vom PC eine E-Mail über mail.schule.de.', check: c => c.svcOk('mail', isType('pc'), { host: 'mail.schule.de' }) },
        { text: 'Rufe die E-Mails auf dem Smartphone über mail.schule.de ab.', check: c => c.svcOk('mailget', isType('smartphone'), { host: 'mail.schule.de' }) },
        { text: 'Biete auch einen Spiele-Server unter dem Namen spiel.schule.de an und spiele vom PC aus online.', check: c => c.svcOk('game', isType('pc'), { host: 'spiel.schule.de' }) },
      ],
      start: () => eigeneStart(),
      solution: () => {
        const net = eigeneStart();
        const srv = NW.createDevice(net, 'server', 680, 440, { id: 'srv', name: 'Schulserver' });
        NW.addLink(net, 'srv', 'inet', 'kabel');
        lease(net, 'srv');
        srv.services.mail.on = true;
        srv.services.game.on = true;
        srv.services.mail.box.push({ from: 'PC 1', text: 'Hallo! Viele Grüße von PC 1' });
        const entries = NW.dev(net, 'dns').services.dns.entries;
        entries.push({ name: 'mail.schule.de', ip: srv.ip }, { name: 'spiel.schule.de', ip: srv.ip });
        evSvc(net, 'pc', 'mail', 'mail.schule.de');
        evSvc(net, 'sp', 'mailget', 'mail.schule.de');
        evSvc(net, 'pc', 'game', 'spiel.schule.de');
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

  function filesStart() {
    return build(({ add, link }) => {
      const pc = (id, name, x, y, ip, extra) => add(id, 'pc', x, y, Object.assign({ name, ip }, extra || {}));
      add('sw', 'switch', 420, 290, { name: 'Switch 1' });
      pc('lena', 'Lenas PC', 160, 140, '192.168.20.11', { files: ['Klassenfoto.jpg'] });
      pc('tom', 'Toms PC', 160, 440, '192.168.20.12');
      pc('mia', 'Mias PC', 680, 440, '192.168.20.13');
      add('srv', 'server', 680, 140, { name: 'Schul-Cloud', ip: '192.168.20.2' });
      ['lena', 'tom', 'mia', 'srv'].forEach(id => link(id, 'sw'));
    });
  }

  function panStart() {
    return build(({ net, add, link }) => {
      add('r', 'router', 220, 300, { name: 'Heimrouter' });
      add('pc', 'pc', 220, 110, { name: 'PC' });
      add('sp', 'smartphone', 560, 300, { name: 'Smartphone von Jonas' });
      add('hs', 'headset', 760, 430, { name: 'Kopfhörer' });
      link('r', 'pc');
      NW.applyLease(NW.dev(net, 'pc'), NW.dhcp(net, 'pc').lease);
    });
  }

  function manStart() {
    return build(({ add, link }) => {
      add('swa', 'switch', 230, 300, { name: 'Switch Hauptgebäude' });
      add('srv', 'server', 90, 140, { name: 'Schulserver', ip: '10.10.0.2',
        services: { web: { on: true, title: 'Vertretungsplan', text: 'Heute: Informatik in Raum 112 statt 104.' }, dns: { on: false, entries: [] }, files: { on: false, files: [] } } });
      add('pca', 'pc', 90, 450, { name: 'PC Lehrerzimmer', ip: '10.10.0.10' });
      add('swb', 'switch', 670, 300, { name: 'Switch Außenstelle' });
      add('pcb', 'pc', 810, 140, { name: 'PC Außenstelle', ip: '10.10.0.20' });
      add('pcc', 'pc', 810, 450, { name: 'PC Bibliothek', ip: '10.10.0.21' });
      link('srv', 'swa'); link('pca', 'swa');
      link('pcb', 'swb'); link('pcc', 'swb');
    });
  }

  function kindsStart() {
    return build(({ add, link }) => {
      add('r', 'router', 360, 300, { name: 'Heimrouter' });
      add('sp', 'smartphone', 130, 170, { name: 'Smartphone 1' });
      add('hs', 'headset', 130, 420, { name: 'Kopfhörer' });
      add('inet', 'isp', 590, 300, { name: 'Internetanbieter', locked: true, ip: '203.0.113.1', dns: '203.0.113.53' });
      add('dns', 'server', 790, 160, { name: 'DNS-Server', locked: true, ip: '203.0.113.53', gw: '203.0.113.1', dhcp: false,
        services: { web: { on: false, title: '', text: '' }, dns: { on: true, entries: [{ name: 'www.netzwerkstatt.de', ip: '203.0.113.80' }] }, files: { on: false, files: [] } } });
      add('web', 'server', 790, 430, { name: 'Webserver', locked: true, ip: '203.0.113.80', gw: '203.0.113.1', dhcp: false,
        services: { web: { on: true, title: 'Vom PAN bis zum WAN', text: 'Diese Seite kam über das Internet (WAN), dein Heimnetz (LAN) und dein Smartphone – die Musik läuft derweil im PAN weiter.' }, dns: { on: false, entries: [] }, files: { on: false, files: [] } } });
      link('inet', 'dns', 'kabel', { locked: true });
      link('inet', 'web', 'kabel', { locked: true });
    });
  }

  const QUIZ = {
    title: 'TCP oder UDP?',
    options: ['TCP', 'UDP'],
    items: [
      { id: 'web', text: 'Eine Webseite aufrufen', answer: 'TCP' },
      { id: 'mail', text: 'Eine E-Mail verschicken', answer: 'TCP' },
      { id: 'download', text: 'Eine Datei herunterladen', answer: 'TCP' },
      { id: 'voice', text: 'Eine Sprachnachricht im Messenger verschicken', answer: 'TCP' },
      { id: 'call', text: 'Ein Videoanruf mit Freunden', answer: 'UDP' },
      { id: 'phone', text: 'Ein Telefonat über das Internet', answer: 'UDP' },
      { id: 'game', text: 'Ein schnelles Online-Rennspiel', answer: 'UDP' },
      { id: 'dns', text: 'Eine DNS-Anfrage (Name → IP-Adresse)', answer: 'UDP' },
    ],
  };
  byId('dienste-sortieren').quiz = QUIZ;

  /** Heimrouter, Internetanbieter und DNS-Server – Grundlage für die Dienste-Aufgaben. */
  function serviceBase(add, link, dnsLocked) {
    const r = add('r', 'router', 300, 280, { name: 'Heimrouter', locked: true });
    Object.assign(r.ports[0], { ip: '203.0.113.10', gw: '203.0.113.1', dns: '203.0.113.53' });
    r.ports[1].ip = '192.168.178.1';
    add('inet', 'isp', 500, 280, { name: 'Internetanbieter', locked: true, ip: '203.0.113.1', dns: '203.0.113.53' });
    server(add, 'dns', 700, 90, 'DNS-Server', '203.0.113.53', ['dns'], { locked: dnsLocked });
    link('r', 'inet', 'kabel', { locked: true });
    link('inet', 'dns', 'kabel', { locked: true });
  }

  function tcpUdpStart() {
    return build(({ net, add, link }) => {
      serviceBase(add, link, true);
      add('tb', 'tablet', 110, 280, { name: 'Tablet 1' });
      server(add, 'video', 780, 280, 'Video-Server', '203.0.113.81', ['video']);
      server(add, 'konf', 700, 470, 'Konferenz-Server', '203.0.113.82', ['call']);
      link('inet', 'video', 'kabel', { locked: true });
      link('inet', 'konf', 'kabel', { locked: true });
      NW.dev(net, 'dns').services.dns.entries.push({ name: 'video.netzwerkstatt.de', ip: '203.0.113.81' }, { name: 'konferenz.netzwerkstatt.de', ip: '203.0.113.82' });
    });
  }

  function diensteStart() {
    return build(({ net, add, link }) => {
      serviceBase(add, link, true);
      add('pc', 'pc', 110, 280, { name: 'PC 1', locked: true });
      server(add, 'web', 790, 200, 'Webserver', '203.0.113.80', ['web'], { services: Object.assign(NW.defaultServices(), { web: { on: true, title: 'Willkommen in der NetzWerkstatt!', text: 'Diese Seite kam per HTTP über TCP.' } }) });
      server(add, 'mail', 790, 360, 'E-Mail-Server', '203.0.113.25', ['mail']);
      server(add, 'video', 640, 470, 'Video-Server', '203.0.113.81', ['video']);
      server(add, 'konf', 440, 480, 'Konferenz-Server', '203.0.113.82', ['call']);
      server(add, 'spiel', 250, 480, 'Spiele-Server', '203.0.113.77', ['game']);
      for (const id of ['web', 'mail', 'video', 'konf', 'spiel']) link('inet', id, 'kabel', { locked: true });
      link('pc', 'r', 'kabel', { locked: true });
      NW.dev(net, 'dns').services.dns.entries.push(
        { name: 'www.netzwerkstatt.de', ip: '203.0.113.80' }, { name: 'mail.netzwerkstatt.de', ip: '203.0.113.25' },
        { name: 'video.netzwerkstatt.de', ip: '203.0.113.81' }, { name: 'konferenz.netzwerkstatt.de', ip: '203.0.113.82' },
        { name: 'spiel.netzwerkstatt.de', ip: '203.0.113.77' });
      lease(net, 'pc');
    });
  }

  function eigeneStart() {
    return build(({ net, add, link }) => {
      serviceBase(add, link, false);
      add('pc', 'pc', 110, 180, { name: 'PC 1' });
      add('sp', 'smartphone', 110, 420, { name: 'Smartphone 1' });
      link('pc', 'r');
      link('r', 'sp', 'wlan');
      lease(net, 'pc', 'sp');
    });
  }

  /** Server mit E-Mail-Dienst, die am Internetanbieter hängen. */
  function mailServers(c) {
    return c.byType('server').filter(s => NW.svcOn(s, 'mail') && NW.parseIP(s.ip) !== null && NW.l2Endpoints(c.net, s.id, 0).some(e => NW.TYPES[e.dev.type].isp));
  }
  function dnsHas(c, name, ip) {
    return c.byType('server').some(d => NW.svcOn(d, 'dns') && (d.services.dns.entries || []).some(e => (e.name || '').trim().toLowerCase() === name && NW.parseIP(e.ip) !== null && NW.parseIP(e.ip) === NW.parseIP(ip)));
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

  // Themen, nach denen die Aufgaben in der Übersicht gruppiert werden.
  // Die Reihenfolge der Aufgaben (und damit ihre Nummern) bleibt unverändert.
  const GROUPS = [
    { id: 'grundlagen', title: 'Erste Netze und Adressen', tasks: ['zwei-pcs', 'stern', 'heimnetz', 'webseite', 'dhcp', 'ipv6'] },
    { id: 'topologien', title: 'Topologien', tasks: ['bus', 'ring', 'topologien'] },
    { id: 'netzarten', title: 'Architekturen und Netzarten', tasks: ['dateien', 'pan', 'man', 'netzarten'] },
    { id: 'dienste', title: 'Protokolle und Internetdienste', tasks: ['tcp-udp', 'dienste-sortieren', 'dienste'] },
    { id: 'eigene', title: 'Eigene Aufgaben', tasks: [] },
    { id: 'frei', title: 'Freies Bauen', tasks: ['frei'] },
  ];
  TASKS.forEach((t, i) => { t.num = i + 1; });
  for (const g of GROUPS) for (const id of g.tasks) TASKS.find(t => t.id === id).group = g.id;

  function byId(id) { return TASKS.find(t => t.id === id) || CUSTOM.find(t => t.id === id) || null; }

  /** Eigene Aufgaben setzen; sie bekommen die Nummern E1, E2, … */
  function setCustom(list) {
    CUSTOM = list.slice();
    CUSTOM.forEach((t, i) => { t.num = 'E' + (i + 1); t.group = 'eigene'; });
  }
  /** Eingebaute und eigene Aufgaben. */
  function all() { return TASKS.concat(CUSTOM); }

  // ---------------------------------------------------------------- Welche Funktionen sieht man?
  // Damit die Oberfläche übersichtlich bleibt, blendet jede Aufgabe nur die Werkzeuge,
  // Geräte und Einstellungen ein, die sie braucht. Grundfunktionen (IPv4-Adresse,
  // Subnetzmaske, Kabel, Ping) sind immer da.
  const FEATURES = [
    { id: 'gateway', label: 'Router und Gateway', text: 'Feld „Gateway“ bei den Endgeräten' },
    { id: 'wlan', label: 'WLAN', text: 'Werkzeug „WLAN“ und Access Point' },
    { id: 'dhcp', label: 'DHCP', text: 'Adressen automatisch vergeben lassen' },
    { id: 'web', label: 'Webseiten und DNS', text: 'Browser, Webserver, DNS-Server und Feld „DNS-Server“' },
    { id: 'internet', label: 'Internet', text: 'Internetanbieter, Internet-Anschluss des Routers, NAT' },
    { id: 'v6', label: 'IPv6', text: 'IPv6-Adressen anzeigen und anpingen' },
    { id: 'topologie', label: 'Bus-Kabel', text: 'Bus-Kabel für die Bustopologie' },
    { id: 'ausfall', label: 'Ausfälle testen', text: 'Kabelbruch und Geräteausfall simulieren' },
    { id: 'dateien', label: 'Dateien tauschen', text: 'Peer-to-Peer und Dateiablage auf dem Server' },
    { id: 'pan', label: 'Bluetooth', text: 'Kopfhörer und Werkzeug „Bluetooth“ (PAN)' },
    { id: 'netzarten', label: 'Netzarten', text: 'Anzeige PAN, LAN, MAN, WAN und Werkzeug „Glasfaser“' },
    { id: 'dienste', label: 'Internetdienste', text: 'E-Mail, Video, Telefonie, Spiele, TCP und UDP' },
  ];
  const WEBNET = ['gateway', 'wlan', 'dhcp', 'web', 'internet'];
  const SHOW = {
    'zwei-pcs': [],
    stern: ['ausfall'],
    heimnetz: ['gateway', 'wlan'],
    webseite: ['gateway', 'web', 'internet'],
    dhcp: ['gateway', 'wlan', 'dhcp'],
    ipv6: ['gateway', 'wlan', 'dhcp', 'internet', 'v6'],
    bus: ['topologie', 'ausfall'],
    ring: ['ausfall'],
    topologien: ['topologie', 'ausfall'],
    dateien: ['dateien'],
    pan: ['gateway', 'wlan', 'dhcp', 'pan', 'netzarten'],
    man: ['web', 'netzarten'],
    netzarten: WEBNET.concat('pan', 'netzarten'),
    'tcp-udp': WEBNET.concat('dienste'),
    'dienste-sortieren': WEBNET.concat('dienste'),
    dienste: WEBNET.concat('dienste'),
  };
  // Im freien Bauen ist alles verfügbar (übersichtlich in einklappbaren Abschnitten).
  TASKS.forEach(t => { t.show = (!t.free && SHOW[t.id]) || FEATURES.map(f => f.id); });

  /** Funktionen, die ein Netzwerk schon benutzt – sie werden immer eingeblendet, damit nichts verborgen bleibt. */
  function usedFeatures(net) {
    const s = new Set();
    const has = (k, cond) => { if (cond) s.add(k); };
    for (const d of net.devices) {
      const t = T[d.type] || {};
      has('gateway', t.router || (t.host && (d.gw || '').trim()));
      has('wlan', d.type === 'ap');
      has('dhcp', (t.host && d.dhcp) || (t.router && d.ports.some(p => p.dhcp && p.dhcp.on)));
      has('web', t.host && (d.dns || '').trim());
      has('web', t.router && d.dnsRelay);
      has('internet', t.isp);
      has('pan', t.btOnly);
      has('topologie', t.bus);
      has('ausfall', d.off || d.broken);
      has('dateien', t.host && d.share);
      if (d.services) {
        has('web', ['web', 'dns'].some(k => d.services[k] && d.services[k].on));
        has('dateien', d.services.files && d.services.files.on);
        has('dienste', ['mail', 'video', 'call', 'game'].some(k => d.services[k] && d.services[k].on));
      }
    }
    for (const l of net.links) {
      has('wlan', l.kind === 'wlan');
      has('pan', l.kind === 'bluetooth');
      has('ausfall', l.broken);
      has('netzarten', l.stadt);
      has('dienste', l.loss);
    }
    return s;
  }

  /** Freigegebene Funktionen einer Aufgabe; ohne Angabe (z. B. eigene Aufgaben ohne Auswahl) ist alles frei. */
  function showOf(task) {
    return Array.isArray(task.show) && !task.free ? task.show : FEATURES.map(f => f.id);
  }

  /** Alle Funktionen, die in dieser Aufgabe mit diesem Netzwerk sichtbar sind. */
  function featuresFor(task, net) {
    const s = usedFeatures(net);
    showOf(task).forEach(k => s.add(k));
    return s;
  }

  const api = { TASKS, GROUPS, FEATURES, evaluate, byId, manualize, setCustom, all, featuresFor, usedFeatures, showOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NWTasks = api;
})(typeof window !== 'undefined' ? window : globalThis);

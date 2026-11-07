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
      if (e.type !== 'ping' || !e.ok) return false;
      const s = NW.dev(net, e.src), t = NW.dev(net, e.target);
      if (!s || !t || s === t || !T[t.type].host || !srcFilter(s) || !dstFilter(t)) return false;
      return NW.roundTrip(net, s.id, NW.parseIP(t.ip)).ok;
    });
    const webOk = host => (net.events || []).some(e => {
      if (e.type !== 'web' || !e.ok || e.host !== host) return false;
      const s = NW.dev(net, e.src);
      return s && NW.browse(net, s.id, 'http://' + host).ok;
    });
    return { net, byType, hosts, neighbors, linked, inNet, distinctIPs, pingOk, webOk };
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
      think: 'Überlege: Was passiert, wenn ein Kabel zu einem PC kaputtgeht? Und was, wenn der Switch ausfällt? Probiere es aus, indem du eine Verbindung löschst.',
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
      intro: 'Im Internet (rechts) stehen ein Webserver und ein DNS-Server. Schließe einen PC an den Heimrouter an und rufe im Browser die Seite http://www.netzwerkstatt.de auf. Beobachte genau, welche Pakete unterwegs sind!',
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
      id: 'frei',
      title: 'Freies Bauen',
      level: 0,
      free: true,
      intro: 'Hier kannst du ohne Vorgaben eigene Netzwerke bauen und ausprobieren.',
      tip: 'Ideen: Verbinde zwei Netze mit einem Router. Baue einen eigenen Webserver mit DNS-Eintrag. Was passiert, wenn zwei Geräte dieselbe IP-Adresse haben?',
      goals: [],
      start: () => NW.emptyNetwork(),
      solution: null,
    },
  ];

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
      r.ports[0].ip = '203.0.113.10';
      r.ports[1].ip = '192.168.178.1';
      add('inet', 'switch', 560, 280, { name: 'Internet', locked: true, cloud: true });
      add('dns', 'server', 760, 160, { name: 'DNS-Server', locked: true, ip: '203.0.113.53', gw: '203.0.113.10',
        services: { web: { on: false, title: '', text: '' }, dns: { on: true, entries: [{ name: 'www.netzwerkstatt.de', ip: '203.0.113.80' }] } } });
      add('web', 'server', 760, 400, { name: 'Webserver', locked: true, ip: '203.0.113.80', gw: '203.0.113.10',
        services: { web: { on: true, title: 'Willkommen in der NetzWerkstatt!', text: 'Glückwunsch – dein PC hat diese Seite über DNS, den Router und das Internet geladen.' }, dns: { on: false, entries: [] } } });
      link('r', 'inet', 'kabel', { locked: true });
      link('inet', 'dns', 'kabel', { locked: true });
      link('inet', 'web', 'kabel', { locked: true });
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

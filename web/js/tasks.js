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
      intro: 'Das kleinste Netzwerk besteht aus zwei Computern, die direkt mit einem Kabel verbunden sind. Damit sie sich gegenseitig finden, braucht jeder eine eigene IP-Adresse im selben Netz.',
      tip: 'Mit 255.255.255.0 als Subnetzmaske gehören alle Adressen, die mit 192.168.1. beginnen, zum selben Netz. Nur die letzte Zahl muss unterschiedlich sein (1 bis 254).',
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
      intro: 'Familie Yilmaz hat einen Router. Baue das Heimnetz: Der PC im Arbeitszimmer hängt am Kabel, Tablet und Smartphone sind per WLAN verbunden. Der Router ist das Tor zu anderen Netzen – deshalb tragen alle Geräte ihn als Gateway ein.',
      tip: 'Ein Access Point hat nur einen Kabelanschluss, der Router-Anschluss auch. Mit einem Switch kannst du am Router-Anschluss mehrere Geräte anschließen. Der Router hat im Heimnetz die IP-Adresse 192.168.178.1.',
      goals: [
        { text: 'Schließe einen Access Point per Kabel an (über einen Switch an den Router).', check: c => c.byType('ap').some(ap => c.neighbors(ap.id).some(n => n.kind === 'kabel')) },
        { text: 'Verbinde ein Tablet und ein Smartphone per WLAN mit dem Access Point.', check: c => ['tablet', 'smartphone'].every(t => c.byType(t).some(d => c.neighbors(d.id).some(n => n.kind === 'wlan' && n.dev.type === 'ap'))) },
        { text: 'Schließe einen PC per Kabel im Heimnetz an.', check: c => c.byType('pc').some(p => NW.l2Endpoints(c.net, p.id, 0).some(e => e.dev.type === 'router')) },
        { text: 'Gib allen Endgeräten eine eigene IP-Adresse im Netz 192.168.178.0/24 und trage den Router (192.168.178.1) als Gateway ein.', check: c => { const h = c.hosts; return h.length >= 3 && h.every(d => c.inNet(d, '192.168.178.0', 24) && d.gw.trim() === '192.168.178.1') && c.distinctIPs(h); } },
        { text: 'Teste mit einem Ping vom Smartphone zum PC.', check: c => c.pingOk(isType('smartphone'), isType('pc')) },
      ],
      start: () => build(({ add }) => {
        const r = add('r', 'router', 140, 280, { name: 'Heimrouter' });
        r.ports[0].ip = '192.168.178.1';
      }),
      solution: () => build(({ net, add, link }) => {
        const r = add('r', 'router', 140, 280, { name: 'Heimrouter' });
        r.ports[0].ip = '192.168.178.1';
        add('sw', 'switch', 340, 280, { name: 'Switch 1' });
        add('ap', 'ap', 540, 170, { name: 'AP 1' });
        add('pc', 'pc', 540, 420, { name: 'PC Arbeitszimmer', ip: '192.168.178.20', gw: '192.168.178.1' });
        add('tb', 'tablet', 720, 100, { name: 'Tablet 1', ip: '192.168.178.30', gw: '192.168.178.1' });
        add('sp', 'smartphone', 740, 250, { name: 'Smartphone 1', ip: '192.168.178.31', gw: '192.168.178.1' });
        link('r', 'sw'); link('sw', 'ap'); link('sw', 'pc');
        link('ap', 'tb', 'wlan'); link('ap', 'sp', 'wlan');
        evPing(net, 'sp', 'pc');
      }),
    },
    {
      id: 'webseite',
      title: 'Eine Webseite aufrufen',
      level: 2,
      intro: 'Im Internet (rechts) stehen ein Webserver und ein DNS-Server. Schließe einen PC an den Heimrouter an und rufe im Browser die Seite http://www.netzwerkstatt.de auf. Beobachte genau, welche Pakete unterwegs sind!',
      tip: 'Der Router hat zwei IP-Adressen: eine lokale im Heimnetz (192.168.178.1) und eine externe im Internet (203.0.113.10). Dein PC braucht eine IP-Adresse im Heimnetz, den Router als Gateway und den DNS-Server 203.0.113.53.',
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

  function evaluate(task, net) {
    const c = ctx(net);
    return task.goals.map(g => { try { return !!g.check(c); } catch (e) { return false; } });
  }

  function byId(id) { return TASKS.find(t => t.id === id) || null; }

  const api = { TASKS, evaluate, byId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NWTasks = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* NetzWerkstatt – Netzwerkmodell und Simulation
 *
 * Ein Netzwerk ist ein einfaches Objekt:
 *   { devices: [Gerät, ...], links: [Verbindung, ...], events: [...] }
 * Diese Datei enthält keine Darstellung, nur die Logik. Sie läuft im Browser
 * (globales Objekt NW) und unter Node (für automatische Tests).
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ Gerätetypen
  const TYPES = {
    pc:         { label: 'PC',           host: true,  cable: 1, wlan: false, icon: 'pc' },
    tablet:     { label: 'Tablet',       host: true,  cable: 0, wlan: true,  icon: 'tablet' },
    smartphone: { label: 'Smartphone',   host: true,  cable: 0, wlan: true,  icon: 'smartphone' },
    server:     { label: 'Server',       host: true,  cable: 1, wlan: false, icon: 'server', services: true },
    switch:     { label: 'Switch',       l2: true,    cable: 8, icon: 'switch' },
    ap:         { label: 'Access Point', l2: true,    cable: 1, apWlan: 8, icon: 'ap' },
    router:     { label: 'Router',       router: true, cable: 4, icon: 'router' },
  };

  const DESCRIPTIONS = {
    pc: 'Ein Endgerät. Es wird per Kabel angeschlossen und braucht eine IP-Adresse, um im Netz erreichbar zu sein.',
    tablet: 'Ein Endgerät ohne Netzwerkkabel. Es verbindet sich per WLAN mit einem Access Point.',
    smartphone: 'Ein Endgerät ohne Netzwerkkabel. Es verbindet sich per WLAN mit einem Access Point.',
    server: 'Ein Rechner, der Dienste für andere anbietet (Server im Client-Server-Modell), z. B. Webseiten oder die Namensauflösung (DNS).',
    switch: 'Verbindet mehrere Geräte im selben Netz (LAN). Er leitet Pakete gezielt an das Gerät weiter, für das sie bestimmt sind. Er braucht keine IP-Adresse.',
    ap: 'Der Access Point (Zugangspunkt) bringt Geräte per Funk (WLAN) ins Kabelnetz. Er braucht keine IP-Adresse.',
    router: 'Verbindet verschiedene Netze miteinander. Jeder Anschluss hat eine eigene IP-Adresse im jeweiligen Netz. Endgeräte tragen ihn als Gateway ein.',
  };

  // ------------------------------------------------------------------ IP-Hilfen
  function parseIP(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    let n = 0;
    for (let i = 1; i <= 4; i++) {
      const o = Number(m[i]);
      if (o > 255) return null;
      n = n * 256 + o;
    }
    return n;
  }

  function ipStr(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  /** Subnetzmaske → Präfixlänge (z. B. "255.255.255.0" oder "/24" → 24), sonst null. */
  function parseMask(s) {
    if (typeof s !== 'string') return null;
    s = s.trim();
    const p = s.match(/^\/?(\d{1,2})$/);
    if (p) {
      const n = Number(p[1]);
      return n >= 1 && n <= 30 ? n : null;
    }
    const n = parseIP(s);
    if (n === null) return null;
    let bits = 0, seenZero = false;
    for (let i = 31; i >= 0; i--) {
      if ((n >>> i) & 1) { if (seenZero) return null; bits++; } else seenZero = true;
    }
    return bits >= 1 && bits <= 30 ? bits : null;
  }

  function maskOf(prefix) { return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; }
  function sameNet(a, b, prefix) { const m = maskOf(prefix); return ((a & m) >>> 0) === ((b & m) >>> 0); }
  function netStr(ip, prefix) { return ipStr((ip & maskOf(prefix)) >>> 0) + '/' + prefix; }

  /** Prüft eine IP auf typische Fehler und liefert einen Hinweis (oder null). */
  function ipProblem(ipS, maskS) {
    const ip = parseIP(ipS), pre = parseMask(maskS);
    if (ip === null || pre === null) return null;
    const m = maskOf(pre);
    if (((ip & ~m) >>> 0) === 0) return 'Diese Adresse ist die Netzadresse und kann keinem Gerät gegeben werden.';
    if (((ip & ~m) >>> 0) === ((~m) >>> 0)) return 'Diese Adresse ist die Broadcast-Adresse und kann keinem Gerät gegeben werden.';
    return null;
  }

  function isPrivate(ip) {
    return sameNet(ip, parseIP('10.0.0.0'), 8) || sameNet(ip, parseIP('172.16.0.0'), 12) || sameNet(ip, parseIP('192.168.0.0'), 16);
  }

  // ------------------------------------------------------------------ Netzwerk-Grundfunktionen
  function emptyNetwork() { return { devices: [], links: [], events: [] }; }

  let idCounter = 0;
  function newId(prefix) {
    idCounter++;
    return prefix + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6) + idCounter;
  }

  function nextName(net, type) {
    const base = TYPES[type].label.replace('Access Point', 'AP');
    let i = 1;
    const names = new Set(net.devices.map(d => d.name));
    while (names.has(base + ' ' + i)) i++;
    return base + ' ' + i;
  }

  function createDevice(net, type, x, y, extra) {
    const d = { id: newId('d'), type, name: nextName(net, type), x, y };
    const t = TYPES[type];
    if (t.host) { d.ip = ''; d.mask = '255.255.255.0'; d.gw = ''; d.dns = ''; }
    if (t.router) d.ports = [0, 1, 2, 3].map(() => ({ ip: '', mask: '255.255.255.0' }));
    if (t.services) d.services = { web: { on: false, title: 'Willkommen!', text: 'Das ist meine erste Webseite.' }, dns: { on: false, entries: [] } };
    Object.assign(d, extra || {});
    net.devices.push(d);
    return d;
  }

  function dev(net, id) { return net.devices.find(d => d.id === id) || null; }

  function linksOf(net, id) { return net.links.filter(l => l.a === id || l.b === id); }

  function portOf(link, id) { return link.a === id ? link.aPort : link.bPort; }

  function cableCount(net, id) { return linksOf(net, id).filter(l => l.kind === 'kabel').length; }
  function wlanCount(net, id) { return linksOf(net, id).filter(l => l.kind === 'wlan').length; }

  function freeRouterPort(net, r) {
    const used = new Set(linksOf(net, r.id).map(l => portOf(l, r.id)));
    for (let i = 0; i < r.ports.length; i++) if (!used.has(i)) return i;
    return -1;
  }

  /** Prüft, ob zwei Geräte verbunden werden dürfen. Liefert {ok, reason}. */
  function canLink(net, aId, bId, kind) {
    const a = dev(net, aId), b = dev(net, bId);
    if (!a || !b) return { ok: false, reason: 'Gerät nicht gefunden.' };
    if (a === b) return { ok: false, reason: 'Ein Gerät kann nicht mit sich selbst verbunden werden.' };
    if (net.links.some(l => (l.a === aId && l.b === bId) || (l.a === bId && l.b === aId)))
      return { ok: false, reason: `${a.name} und ${b.name} sind schon verbunden.` };
    const ta = TYPES[a.type], tb = TYPES[b.type];
    if (kind === 'kabel') {
      for (const [d, t] of [[a, ta], [b, tb]]) {
        if (!t.cable) return { ok: false, reason: `${d.name} hat keinen Netzwerkanschluss für ein Kabel. Verbinde es per WLAN mit einem Access Point.` };
        if (cableCount(net, d.id) >= t.cable)
          return { ok: false, reason: `Alle Anschlüsse von ${d.name} sind belegt (${t.cable} ${t.cable === 1 ? 'Anschluss' : 'Anschlüsse'}).` + (t.host ? ' Nutze einen Switch, um mehrere Geräte zu verbinden.' : '') };
      }
      return { ok: true };
    }
    if (kind === 'wlan') {
      let apD, other;
      if (a.type === 'ap') { apD = a; other = b; } else if (b.type === 'ap') { apD = b; other = a; }
      if (!apD) return { ok: false, reason: 'Eine WLAN-Verbindung braucht immer einen Access Point.' };
      const to = TYPES[other.type];
      if (!to.wlan) return { ok: false, reason: `${other.name} hat kein WLAN. Schließe es per Kabel an.` };
      if (wlanCount(net, other.id) >= 1) return { ok: false, reason: `${other.name} ist schon mit einem WLAN verbunden.` };
      if (wlanCount(net, apD.id) >= TYPES.ap.apWlan) return { ok: false, reason: `${apD.name} kann höchstens ${TYPES.ap.apWlan} WLAN-Geräte versorgen.` };
      return { ok: true };
    }
    return { ok: false, reason: 'Unbekannte Verbindungsart.' };
  }

  function addLink(net, aId, bId, kind) {
    const chk = canLink(net, aId, bId, kind);
    if (!chk.ok) return chk;
    const l = { id: newId('l'), a: aId, b: bId, kind };
    const a = dev(net, aId), b = dev(net, bId);
    if (TYPES[a.type].router) l.aPort = freeRouterPort(net, a);
    if (TYPES[b.type].router) l.bPort = freeRouterPort(net, b);
    net.links.push(l);
    return { ok: true, link: l };
  }

  function removeDevice(net, id) {
    net.devices = net.devices.filter(d => d.id !== id);
    net.links = net.links.filter(l => l.a !== id && l.b !== id);
  }

  function removeLink(net, id) { net.links = net.links.filter(l => l.id !== id); }

  // ------------------------------------------------------------------ Schnittstellen
  /** IP und Präfix einer Schnittstelle (Endgerät: port 0; Router: Anschlussnummer). */
  function ifaceAddr(d, port) {
    if (!d) return null;
    if (TYPES[d.type].router) {
      const p = d.ports[port];
      if (!p) return null;
      const ip = parseIP(p.ip), pre = parseMask(p.mask);
      return ip === null || pre === null ? null : { ip, prefix: pre };
    }
    if (TYPES[d.type].host) {
      const ip = parseIP(d.ip), pre = parseMask(d.mask);
      return ip === null || pre === null ? null : { ip, prefix: pre };
    }
    return null;
  }

  /**
   * Sucht alle Endpunkte (Endgeräte und Router-Anschlüsse), die von einer
   * Schnittstelle aus ohne Router erreichbar sind (gleiches „Kabelnetz").
   * Switches und Access Points werden durchlaufen.
   */
  function l2Endpoints(net, startId, startPort) {
    const start = dev(net, startId);
    const out = [];
    const seen = new Set([startId]);
    const queue = [];
    for (const l of linksOf(net, startId)) {
      if (TYPES[start.type].router && portOf(l, startId) !== startPort) continue;
      const other = l.a === startId ? l.b : l.a;
      queue.push({ id: other, port: portOf(l, other), path: [startId, other] });
    }
    while (queue.length) {
      const cur = queue.shift();
      if (seen.has(cur.id)) continue;
      seen.add(cur.id);
      const d = dev(net, cur.id);
      const t = TYPES[d.type];
      if (t.l2) {
        for (const l of linksOf(net, d.id)) {
          const other = l.a === d.id ? l.b : l.a;
          if (!seen.has(other)) queue.push({ id: other, port: portOf(l, other), path: cur.path.concat(other) });
        }
      } else {
        out.push({ dev: d, port: t.router ? cur.port : 0, path: cur.path });
      }
    }
    return out;
  }

  function devicesWithIP(net, ip) {
    const res = [];
    for (const d of net.devices) {
      if (TYPES[d.type].host && parseIP(d.ip) === ip) res.push(d);
      if (TYPES[d.type].router) d.ports.forEach(p => { if (parseIP(p.ip) === ip) res.push(d); });
    }
    return res;
  }

  /**
   * Weg eines Pakets von einem Endgerät zu einer IP-Adresse.
   * Ergebnis: {ok, path:[Geräte-IDs], target, error, hint}
   * Bei Fehlern enthält path den Weg bis zur Stelle, an der es nicht weitergeht.
   */
  function route(net, srcId, dstIP) {
    const src = dev(net, srcId);
    const fail = (path, error, hint) => ({ ok: false, path, error, hint: hint || '' });
    if (!src || !TYPES[src.type].host) return fail([srcId], 'Nur Endgeräte können Pakete senden.');
    if (!linksOf(net, srcId).length) return fail([srcId], `${src.name} ist mit nichts verbunden.`, TYPES[src.type].wlan && !TYPES[src.type].cable ? 'Verbinde es per WLAN mit einem Access Point.' : 'Verbinde es mit einem Kabel.');
    const sa = ifaceAddr(src, 0);
    if (!sa) {
      if (parseIP(src.ip) === null) return fail([srcId], `${src.name} hat noch keine gültige IP-Adresse.`, 'Tippe das Gerät an und trage eine IP-Adresse ein, z. B. 192.168.1.10.');
      return fail([srcId], `Die Subnetzmaske von ${src.name} ist ungültig.`, 'Üblich ist 255.255.255.0.');
    }
    if (sa.ip === dstIP) return { ok: true, path: [srcId], target: src };

    let curId = srcId, curPort = 0, path = [srcId];
    const visitedRouters = new Set();
    for (let step = 0; step < 12; step++) {
      const cd = dev(net, curId);
      const ca = ifaceAddr(cd, curPort);
      const eps = l2Endpoints(net, curId, curPort);
      if (sameNet(ca.ip, dstIP, ca.prefix)) {
        const hits = eps.filter(e => { const a = ifaceAddr(e.dev, e.port); return a && a.ip === dstIP; });
        if (hits.length > 1) return fail(path, `Die IP-Adresse ${ipStr(dstIP)} ist im Netz mehrfach vergeben (${hits.map(h => h.dev.name).join(', ')}).`, 'Jede IP-Adresse darf in einem Netz nur einmal vorkommen.');
        if (hits.length === 1) return { ok: true, path: path.concat(hits[0].path.slice(1)), target: hits[0].dev };
        const elsewhere = devicesWithIP(net, dstIP);
        let hint = `Kein Gerät im Netz ${netStr(ca.ip, ca.prefix)} hat diese Adresse.`;
        if (elsewhere.length) hint = `${elsewhere[0].name} hat die Adresse ${ipStr(dstIP)}, ist aber nicht mit diesem Netz verbunden.`;
        return fail(path, `Im Netz von ${cd.name} antwortet niemand unter ${ipStr(dstIP)}.`, hint);
      }
      // Ziel liegt in einem anderen Netz → Gateway / Router nötig
      let routerHit;
      if (TYPES[cd.type].host) {
        const gw = parseIP(cd.gw);
        if (gw === null) return fail(path, `${cd.name}: Das Ziel ${ipStr(dstIP)} liegt in einem anderen Netz. Dafür braucht ${cd.name} ein Gateway.`, 'Trage beim Gerät als Gateway die IP-Adresse des Routers ein.');
        if (!sameNet(gw, ca.ip, ca.prefix)) return fail(path, `Das Gateway ${ipStr(gw)} von ${cd.name} liegt nicht im eigenen Netz.`, 'Das Gateway muss im selben Netz liegen wie das Gerät selbst.');
        routerHit = eps.find(e => { const a = ifaceAddr(e.dev, e.port); return TYPES[e.dev.type].router && a && a.ip === gw; });
        if (!routerHit) {
          const other = eps.find(e => { const a = ifaceAddr(e.dev, e.port); return a && a.ip === gw; });
          if (other) return fail(path, `Das Gateway ${ipStr(gw)} ist ${other.dev.name} – das ist kein Router.`, 'Als Gateway muss ein Router eingetragen werden.');
          return fail(path, `Das Gateway ${ipStr(gw)} ist von ${cd.name} aus nicht erreichbar.`, 'Ist der Router angeschlossen und hat sein Anschluss genau diese IP-Adresse?');
        }
      } else {
        return fail(path, `${cd.name} kennt keinen Weg zu ${ipStr(dstIP)}.`);
      }
      path = path.concat(routerHit.path.slice(1));
      const r = routerHit.dev;
      if (visitedRouters.has(r.id)) return fail(path, 'Das Paket läuft im Kreis.');
      visitedRouters.add(r.id);
      // Ziel ist ein Anschluss des Routers selbst?
      if (r.ports.some(p => parseIP(p.ip) === dstIP)) return { ok: true, path, target: r };
      // Passenden Anschluss suchen (direkt angeschlossene Netze)
      const used = new Set(linksOf(net, r.id).map(l => portOf(l, r.id)));
      let outPort = -1;
      r.ports.forEach((p, i) => {
        const a = ifaceAddr(r, i);
        if (outPort < 0 && a && used.has(i) && i !== routerHit.port && sameNet(a.ip, dstIP, a.prefix)) outPort = i;
      });
      if (outPort < 0) return fail(path, `Der Router ${r.name} kennt kein Netz, in dem ${ipStr(dstIP)} liegt.`, 'Ein Router kennt die Netze, an die seine Anschlüsse angeschlossen sind. Prüfe die IP-Adressen der Router-Anschlüsse.');
      curId = r.id; curPort = outPort;
    }
    return fail(path, 'Das Paket hat zu viele Stationen passiert und wurde verworfen.');
  }

  /** Hin- und Rückweg (z. B. Ping oder Anfrage/Antwort). */
  function roundTrip(net, srcId, dstIP) {
    const there = route(net, srcId, dstIP);
    if (!there.ok) return { ok: false, there, error: there.error, hint: there.hint };
    const target = there.target;
    if (TYPES[target.type].host && target.id !== srcId) {
      const src = dev(net, srcId);
      const back = route(net, target.id, parseIP(src.ip));
      if (!back.ok) return { ok: false, there, back, target, error: `Die Anfrage kommt bei ${target.name} an, aber die Antwort findet nicht zurück: ${back.error}`, hint: back.hint };
      return { ok: true, there, back, target };
    }
    return { ok: true, there, back: { ok: true, path: there.path.slice().reverse() }, target };
  }

  // ------------------------------------------------------------------ Aktionen: Ping und Browser
  /** Liefert eine Folge von Schritten zum Animieren und ein Ergebnis. */
  function ping(net, srcId, dstText) {
    const src = dev(net, srcId);
    const dstIP = parseIP(dstText || '');
    if (dstIP === null) return { ok: false, steps: [], error: `„${dstText || ''}" ist keine gültige IPv4-Adresse.`, hint: 'Eine IPv4-Adresse besteht aus vier Zahlen von 0 bis 255, getrennt durch Punkte.' };
    const rt = roundTrip(net, srcId, dstIP);
    const steps = [{ kind: 'request', label: 'Ping-Anfrage', proto: 'ICMP', text: `${src.name} → ${ipStr(dstIP)}: „Bist du da?"`, path: rt.there.path, ok: rt.there.ok }];
    if (rt.back) steps.push({ kind: 'response', label: 'Ping-Antwort', proto: 'ICMP', text: `${rt.target.name} → ${src.name}: „Ja, ich bin da!"`, path: rt.back.path, ok: rt.back.ok });
    return { ok: rt.ok, steps, error: rt.error, hint: rt.hint, target: rt.target ? rt.target.id : null };
  }

  function parseURL(url) {
    let u = (url || '').trim();
    const m = u.match(/^(?:(https?):\/\/)?([^/:\s]+)(?::(\d+))?(\/[^\s]*)?$/i);
    if (!m) return null;
    return { scheme: (m[1] || 'http').toLowerCase(), host: m[2].toLowerCase(), path: m[4] || '/' };
  }

  function browse(net, srcId, url) {
    const src = dev(net, srcId);
    const u = parseURL(url);
    const steps = [];
    const res = (ok, extra) => Object.assign({ ok, steps }, extra);
    if (!u) return res(false, { error: `„${url}" ist keine gültige Adresse (URL).`, hint: 'Beispiel: http://www.beispiel.de' });
    let ip = parseIP(u.host);
    if (ip === null) {
      // Namensauflösung über DNS
      const dnsIP = parseIP(src.dns || '');
      if (dnsIP === null) return res(false, { error: `${src.name} kennt keinen DNS-Server und kann den Namen ${u.host} nicht in eine IP-Adresse übersetzen.`, hint: 'Trage beim Gerät die IP-Adresse eines DNS-Servers ein.' });
      const rt = roundTrip(net, srcId, dnsIP);
      steps.push({ kind: 'request', label: 'DNS-Anfrage', proto: 'UDP · Port 53', text: `Welche IP-Adresse hat ${u.host}?`, path: rt.there.path, ok: rt.there.ok });
      if (!rt.ok) {
        if (rt.back) steps.push({ kind: 'response', label: 'DNS-Antwort', proto: 'UDP · Port 53', text: '', path: rt.back.path, ok: false });
        return res(false, { error: 'DNS-Server nicht erreichbar: ' + rt.error, hint: rt.hint });
      }
      const ds = rt.target;
      if (!(ds.services && ds.services.dns && ds.services.dns.on))
        return res(false, { error: `Unter ${ipStr(dnsIP)} (${ds.name}) läuft kein DNS-Server.`, hint: 'Prüfe die DNS-Adresse oder schalte beim Server den DNS-Dienst ein.' });
      const entry = (ds.services.dns.entries || []).find(e => (e.name || '').trim().toLowerCase() === u.host);
      if (!entry || parseIP(entry.ip) === null) {
        steps.push({ kind: 'response', label: 'DNS-Antwort', proto: 'UDP · Port 53', text: `Den Namen ${u.host} kenne ich nicht.`, path: rt.back.path, ok: true, bad: true });
        return res(false, { error: `Der DNS-Server kennt den Namen ${u.host} nicht.`, hint: 'Prüfe die Schreibweise der Adresse oder ergänze den Eintrag beim DNS-Server.' });
      }
      ip = parseIP(entry.ip);
      steps.push({ kind: 'response', label: 'DNS-Antwort', proto: 'UDP · Port 53', text: `${u.host} hat die IP-Adresse ${ipStr(ip)}`, path: rt.back.path, ok: true });
    }
    const rt = roundTrip(net, srcId, ip);
    steps.push({ kind: 'request', label: 'HTTP-Request', proto: 'TCP · Port 80', text: `GET ${u.path} – „Schick mir bitte die Webseite ${u.host}"`, path: rt.there.path, ok: rt.there.ok });
    if (!rt.ok) {
      if (rt.back) steps.push({ kind: 'response', label: 'HTTP-Response', proto: 'TCP · Port 80', text: '', path: rt.back.path, ok: false });
      return res(false, { error: 'Webserver nicht erreichbar: ' + rt.error, hint: rt.hint });
    }
    const ws = rt.target;
    if (!(ws.services && ws.services.web && ws.services.web.on))
      return res(false, { error: `Unter ${ipStr(ip)} (${ws.name}) läuft kein Webserver.`, hint: 'Schalte beim Server den Webserver-Dienst ein.' });
    steps.push({ kind: 'response', label: 'HTTP-Response', proto: 'TCP · Port 80', text: '200 OK – hier ist die Webseite', path: rt.back.path, ok: true });
    return res(true, { page: { host: u.host, ip: ipStr(ip), title: ws.services.web.title || '', text: ws.services.web.text || '' }, target: ws.id });
  }

  // ------------------------------------------------------------------ Ereignisse
  function logEvent(net, ev) {
    if (!net.events) net.events = [];
    net.events.push(Object.assign({ t: Date.now() }, ev));
    if (net.events.length > 40) net.events.splice(0, net.events.length - 40);
  }

  // ------------------------------------------------------------------ Topologie
  /** Erkennt einfache Topologien zwischen Endgeräten: 'stern', 'bus', 'ring' oder null. */
  function topology(net) {
    const hosts = net.devices.filter(d => TYPES[d.type].host);
    if (hosts.length < 3) return null;
    const sw = net.devices.filter(d => TYPES[d.type].l2);
    // Stern: alle Endgeräte hängen direkt an demselben Verteiler
    for (const s of sw) {
      const nb = new Set(linksOf(net, s.id).map(l => l.a === s.id ? l.b : l.a));
      if (hosts.every(h => nb.has(h.id))) return 'stern';
    }
    return null;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  const NW = {
    TYPES, DESCRIPTIONS, parseIP, ipStr, parseMask, sameNet, netStr, ipProblem, isPrivate,
    emptyNetwork, createDevice, dev, linksOf, portOf, canLink, addLink, removeDevice, removeLink,
    ifaceAddr, l2Endpoints, route, roundTrip, ping, browse, parseURL, logEvent, topology, clone, newId,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NW;
  else root.NW = NW;
})(typeof window !== 'undefined' ? window : globalThis);

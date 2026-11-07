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
    pc:         { label: 'PC',           host: true,  cable: 1, wlan: false, bt: true, icon: 'pc' },
    tablet:     { label: 'Tablet',       host: true,  cable: 0, wlan: true,  bt: true, icon: 'tablet' },
    smartphone: { label: 'Smartphone',   host: true,  cable: 0, wlan: true,  bt: true, icon: 'smartphone' },
    headset:    { label: 'Kopfhörer',    cable: 0, wlan: false, bt: true, btOnly: true, icon: 'headset' },
    server:     { label: 'Server',       host: true,  cable: 1, wlan: false, icon: 'server', services: true },
    switch:     { label: 'Switch',       l2: true,    cable: 8, icon: 'switch' },
    ap:         { label: 'Access Point', l2: true,    cable: 1, apWlan: 8, icon: 'ap' },
    router:     { label: 'Router',       router: true, cable: 4, icon: 'router' },
    isp:        { label: 'Internetanbieter', isp: true, cable: 8, icon: 'isp' },
    bus:        { label: 'Bus-Kabel',    l2: true,    bus: true, cable: 8, icon: 'bus' },
  };

  const DESCRIPTIONS = {
    pc: 'Ein Endgerät. Es wird per Kabel angeschlossen und braucht eine IP-Adresse, um im Netz erreichbar zu sein. Für ein Ringnetz kann ein PC direkt mit zwei Nachbar-PCs verbunden werden.',
    tablet: 'Ein Endgerät ohne Netzwerkkabel. Es verbindet sich per WLAN mit einem Access Point.',
    smartphone: 'Ein Endgerät ohne Netzwerkkabel. Es verbindet sich per WLAN mit einem Access Point.',
    server: 'Ein Rechner, der Dienste für andere anbietet (Server im Client-Server-Modell), z. B. Webseiten, E-Mail, Videos, Videotelefonie, Online-Spiele oder die Namensauflösung (DNS).',
    switch: 'Verbindet mehrere Geräte im selben Netz (LAN). Er leitet Pakete gezielt an das Gerät weiter, für das sie bestimmt sind. Er braucht keine IP-Adresse.',
    ap: 'Der Access Point (Zugangspunkt) bringt Geräte per Funk (WLAN) ins Kabelnetz. Er braucht keine IP-Adresse.',
    router: 'Verbindet verschiedene Netze miteinander, z. B. das Heimnetz mit dem Internet. Er hat drei LAN-Anschlüsse für das Heimnetz (wie ein eingebauter Switch) und einen Internet-Anschluss (WAN). In jedem der beiden Netze hat er eine eigene IP-Adresse. Endgeräte tragen ihn als Gateway ein.',
    bus: 'Ein langes Kabel, an das alle Geräte angeschlossen werden (Bustopologie). Jedes Signal läuft über das ganze Kabel und kommt bei allen Geräten an – nur der Empfänger nimmt es an. Es darf immer nur ein Gerät gleichzeitig senden. Ist das Bus-Kabel an einer Stelle unterbrochen, ist das ganze Netz gestört. Es ist eine passive Komponente und braucht keine IP-Adresse.',
    headset: 'Kabellose Kopfhörer verbinden sich per Bluetooth mit einem Smartphone, Tablet oder PC in der Nähe (wenige Meter). Sie haben keine IP-Adresse und gehören nicht zum Heimnetz, sondern zum persönlichen Netz (PAN) ihres Besitzers.',
    isp: 'Der Internetanbieter (Provider) verbindet Heimnetze und Server mit dem Internet. Jeder Router, der an seine Leitung angeschlossen wird, bekommt von ihm automatisch eine öffentliche (externe) IP-Adresse. Mehrere Internetanbieter, die per Kabel miteinander verbunden sind, bilden zusammen das Internet.',
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

  /** Öffentliche Adressbereiche für Internetanbieter (je ein Netz /24, der Anbieter selbst hat .1). */
  const ISP_NETS = ['85.17.4', '91.64.12', '62.157.8', '78.42.30', '93.120.5', '217.80.21', '188.96.3', '46.5.77'];
  function freeIspNet(net) {
    const all = allAddrs(net);
    const cand = ISP_NETS.find(n => all.every(a => !sameNet(a.ip, parseIP(n + '.0'), Math.min(24, a.prefix))));
    return cand ? cand + '.1' : '';
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
    if (t.host) d.dhcp = true; // wie bei echten Geräten: Adresse automatisch beziehen
    if (t.router) {
      // Wie ein Heimrouter: Anschluss 0 ist der Internet-Anschluss (WAN), die Anschlüsse 1–3
      // bilden zusammen das Heimnetz (LAN). Die Einstellungen des LAN stehen bei ports[1].
      // Ab Werk hat das LAN eine feste lokale Adresse in einem noch freien Netz (192.168.0.1, …).
      const port = ip => ({ ip, mask: '255.255.255.0', dhcp: { on: false, from: '', to: '', dns: '' } });
      d.ports = [port(''), port(freeNets(net, 1)[0]), port(''), port('')];
      d.ports[1].dhcp.on = true; // DHCP im Heimnetz ist ab Werk an
      d.wlan = true;             // eingebautes WLAN (wie ein Access Point)
      d.modem = true;            // eingebautes Internet-Modem (DSL/Kabel)
    }
    if (t.isp) { d.ip = freeIspNet(net); d.mask = '255.255.255.0'; d.dns = ''; }
    if (t.services) d.services = defaultServices();
    else if (t.host) { d.files = []; d.share = false; }
    Object.assign(d, extra || {});
    net.devices.push(d);
    return d;
  }

  /** Alle gültigen Adressen im Netzwerk (Endgeräte und Router-Anschlüsse), optional ohne einen Anschluss. */
  function allAddrs(net, skipDev, skipPort) {
    const all = [];
    for (const d of net.devices) {
      if (TYPES[d.type].host || TYPES[d.type].isp) { const a = ifaceAddr(d, 0); if (a) all.push(a); }
      if (TYPES[d.type].router) IFACES.forEach(i => { if (d === skipDev && i === iface(skipPort)) return; const a = ifaceAddr(d, i); if (a) all.push(a); });
    }
    return all;
  }

  /** Liefert count Router-Adressen 192.168.N.1 in Netzen, die noch niemand benutzt. */
  function freeNets(net, count, skipDev, skipPort) {
    const all = allAddrs(net, skipDev, skipPort);
    const out = [];
    for (let n = 0; n < 256 && out.length < count; n++) {
      const cand = parseIP(`192.168.${n}.0`);
      if (all.every(a => !sameNet(a.ip, cand, Math.min(24, a.prefix)))) out.push(`192.168.${n}.1`);
    }
    while (out.length < count) out.push('');
    return out;
  }

  function dev(net, id) { return net.devices.find(d => d.id === id) || null; }

  /** Verbindungen im IP-Netz (Kabel und WLAN). Bluetooth-Kopplungen gehören nicht dazu. */
  function linksOf(net, id) { return net.links.filter(l => (l.a === id || l.b === id) && l.kind !== 'bluetooth'); }
  /** Alle Verbindungen eines Geräts, auch Bluetooth. */
  function allLinksOf(net, id) { return net.links.filter(l => l.a === id || l.b === id); }
  function btCount(net, id) { return allLinksOf(net, id).filter(l => l.kind === 'bluetooth').length; }

  function portOf(link, id) { return link.a === id ? link.aPort : link.bPort; }

  function cableCount(net, id) { return linksOf(net, id).filter(l => l.kind === 'kabel').length; }
  function wlanCount(net, id) { return linksOf(net, id).filter(l => l.kind === 'wlan').length; }

  // ------------------------------------------------------------------ Router: LAN und WAN
  const WAN = 0, LAN = 1, IFACES = [WAN, LAN];
  /** Schnittstelle eines Router-Anschlusses: 0 = Internet (WAN), 1 = Heimnetz (LAN, Anschlüsse 1–3). */
  function iface(port) { return port >= 1 ? LAN : WAN; }
  function ifaceName(i) { return i === WAN ? 'Internet-Anschluss (WAN)' : 'Heimnetz (LAN)'; }

  function freePortIn(net, r, which) {
    const used = new Set(linksOf(net, r.id).map(l => portOf(l, r.id)));
    const cands = which === WAN ? [0] : [1, 2, 3];
    for (const i of cands) if (!used.has(i)) return i;
    return -1;
  }

  /** WLAN-Verbindungen zum Router zählen zum Heimnetz (LAN), belegen aber keinen Kabelanschluss. */
  const WLAN_PORT = 9;
  /** Kann das Gerät WLAN-Verbindungen annehmen (Access Point oder Router mit WLAN)? */
  function wlanHub(d) { return d.type === 'ap' || (TYPES[d.type].router && !!d.wlan); }

  /** Freien Anschluss wählen: zu einem anderen Router oder ins Internet → WAN, sonst LAN. */
  function freeRouterPort(net, r, other) {
    const wanFirst = other && (TYPES[other.type].router || TYPES[other.type].isp || other.cloud);
    const order = wanFirst ? [WAN, LAN] : [LAN, WAN];
    for (const w of order) { const p = freePortIn(net, r, w); if (p >= 0) return p; }
    return -1;
  }

  /** Router-WLAN ein/aus. Beim Ausschalten werden die WLAN-Verbindungen getrennt. Liefert die Zahl getrennter Geräte. */
  function setRouterWlan(net, r, on) {
    r.wlan = !!on;
    if (on) return 0;
    const ls = linksOf(net, r.id).filter(l => l.kind === 'wlan');
    net.links = net.links.filter(l => !ls.includes(l));
    return ls.length;
  }

  /** Internetanbieter, an dessen Leitung der Internet-Anschluss (WAN) des Routers hängt (oder null). */
  function ispOf(net, r) {
    const e = l2Endpoints(net, r.id, WAN).find(x => TYPES[x.dev.type].isp);
    return e ? e.dev : null;
  }

  /** Modem ein/aus. Ohne Modem wird die Leitung zum Internetanbieter getrennt. Liefert die Zahl getrennter Leitungen. */
  function setModem(net, r, on) {
    r.modem = !!on;
    if (on) return 0;
    const ls = linksOf(net, r.id).filter(l => { const o = dev(net, l.a === r.id ? l.b : l.a); return o && TYPES[o.type].isp; });
    net.links = net.links.filter(l => !ls.includes(l));
    return ls.length;
  }

  /** Steckt ein Kabel am Router zwischen LAN und WAN um. Liefert {ok, reason}. */
  function replug(net, linkId, routerId) {
    const l = net.links.find(x => x.id === linkId);
    const r = dev(net, routerId);
    if (!l || !r) return { ok: false, reason: 'Verbindung nicht gefunden.' };
    if (l.kind !== 'kabel') return { ok: false, reason: 'Nur Kabel können umgesteckt werden.' };
    const key = l.a === routerId ? 'aPort' : 'bPort';
    const target = iface(l[key]) === WAN ? LAN : WAN;
    const other = dev(net, l.a === routerId ? l.b : l.a);
    if (other && TYPES[other.type].isp && target === LAN) return { ok: false, reason: `Die Leitung von ${other.name} gehört in den Internet-Anschluss (WAN) von ${r.name}.` };
    const p = freePortIn(net, r, target);
    if (p < 0) return { ok: false, reason: target === WAN ? `Der Internet-Anschluss von ${r.name} ist schon belegt.` : `Alle LAN-Anschlüsse von ${r.name} sind belegt.` };
    l[key] = p;
    return { ok: true, iface: target };
  }

  /** Prüft, ob zwei Geräte verbunden werden dürfen. Liefert {ok, reason}. */
  function canLink(net, aId, bId, kind) {
    const a = dev(net, aId), b = dev(net, bId);
    if (!a || !b) return { ok: false, reason: 'Gerät nicht gefunden.' };
    if (a === b) return { ok: false, reason: 'Ein Gerät kann nicht mit sich selbst verbunden werden.' };
    if (net.links.some(l => (l.a === aId && l.b === bId) || (l.a === bId && l.b === aId)))
      return { ok: false, reason: `${a.name} und ${b.name} sind schon verbunden.` };
    const ta = TYPES[a.type], tb = TYPES[b.type];
    if (kind === 'bluetooth') {
      for (const d of [a, b]) if (!TYPES[d.type].bt) return { ok: false, reason: `${d.name} hat kein Bluetooth. Bluetooth haben z. B. Smartphone, Tablet, PC und Kopfhörer.` };
      if (ta.btOnly && tb.btOnly) return { ok: false, reason: 'Zwei Kopfhörer können nicht miteinander gekoppelt werden. Verbinde die Kopfhörer mit einem Smartphone, Tablet oder PC.' };
      for (const d of [a, b]) if (TYPES[d.type].btOnly && btCount(net, d.id) >= 1) return { ok: false, reason: `${d.name} ist schon mit einem anderen Gerät gekoppelt.` };
      return { ok: true };
    }
    for (const [d, t] of [[a, ta], [b, tb]]) if (t.btOnly) return { ok: false, reason: `${d.name} verbindet sich nur per Bluetooth. Nimm das Werkzeug „Bluetooth“.` };
    if (kind === 'kabel') {
      for (const [d, t, o] of [[a, ta, b], [b, tb, a]]) {
        if (!t.cable) return { ok: false, reason: `${d.name} hat keinen Netzwerkanschluss für ein Kabel. Verbinde es per WLAN mit einem Access Point.` };
        if (t.host && TYPES[o.type].host && cableCount(net, d.id) === 1 && hostCablesOnlyToHosts(net, d.id)) continue; // Ring: zweiter Nachbar
        if (t.host && cableCount(net, d.id) >= 2)
          return { ok: false, reason: `${d.name} ist schon mit zwei Nachbarn verbunden. In einem Ring hat jede Station genau zwei Nachbarn.` };
        if (cableCount(net, d.id) >= t.cable)
          return { ok: false, reason: `Alle Anschlüsse von ${d.name} sind belegt (${t.cable} ${t.cable === 1 ? 'Anschluss' : 'Anschlüsse'}).` + (t.host ? ' Nutze einen Switch, um mehrere Geräte zu verbinden.' : '') };
      }
      // Router an die Leitung des Internetanbieters: nur über den Internet-Anschluss (WAN) mit Modem
      const isp = [a, b].find(x => TYPES[x.type].isp), r = [a, b].find(x => TYPES[x.type].router);
      if (isp && r) {
        if (!r.modem) return { ok: false, reason: `${r.name} hat kein eingeschaltetes Modem und kann nicht direkt an die Leitung von ${isp.name}. Tippe den Router an und schalte das eingebaute Modem ein.` };
        if (freePortIn(net, r, WAN) < 0) return { ok: false, reason: `Der Internet-Anschluss (WAN) von ${r.name} ist schon belegt.` };
      }
      return { ok: true };
    }
    if (kind === 'wlan') {
      let apD, other;
      if (wlanHub(a)) { apD = a; other = b; } else if (wlanHub(b)) { apD = b; other = a; }
      if (!apD) {
        const r = [a, b].find(x => TYPES[x.type].router);
        if (r) return { ok: false, reason: `Das WLAN von ${r.name} ist ausgeschaltet. Tippe den Router an und schalte es ein.` };
        return { ok: false, reason: 'Eine WLAN-Verbindung braucht immer einen Access Point oder einen Router mit WLAN.' };
      }
      const to = TYPES[other.type];
      if (!to.wlan) return { ok: false, reason: `${other.name} hat kein WLAN. Schließe es per Kabel an.` };
      if (wlanCount(net, other.id) >= 1) return { ok: false, reason: `${other.name} ist schon mit einem WLAN verbunden.` };
      if (wlanCount(net, apD.id) >= TYPES.ap.apWlan) return { ok: false, reason: `${apD.name} kann höchstens ${TYPES.ap.apWlan} WLAN-Geräte versorgen.` };
      return { ok: true };
    }
    return { ok: false, reason: 'Unbekannte Verbindungsart.' };
  }

  /** Hängen alle Kabel des Endgeräts an anderen Endgeräten (direkte Verbindung oder Ring)? */
  function hostCablesOnlyToHosts(net, id) {
    return linksOf(net, id).filter(l => l.kind === 'kabel').every(l => { const o = dev(net, l.a === id ? l.b : l.a); return o && TYPES[o.type].host; });
  }

  function addLink(net, aId, bId, kind) {
    const chk = canLink(net, aId, bId, kind);
    if (!chk.ok) return chk;
    const l = { id: newId('l'), a: aId, b: bId, kind };
    const a = dev(net, aId), b = dev(net, bId);
    if (kind === 'bluetooth') { net.links.push(l); return { ok: true, link: l }; }
    const rport = (r, o) => kind === 'wlan' ? WLAN_PORT : TYPES[o.type].isp ? WAN : freeRouterPort(net, r, o);
    if (TYPES[a.type].router) l.aPort = rport(a, b);
    if (TYPES[b.type].router) l.bPort = rport(b, a);
    net.links.push(l);
    return { ok: true, link: l };
  }

  function removeDevice(net, id) {
    net.devices = net.devices.filter(d => d.id !== id);
    net.links = net.links.filter(l => l.a !== id && l.b !== id);
  }

  function removeLink(net, id) { net.links = net.links.filter(l => l.id !== id); }

  // ------------------------------------------------------------------ Schnittstellen
  /** IP und Präfix einer Schnittstelle (Endgerät: port 0; Router: Anschlussnummer, LAN-Anschlüsse teilen sich eine Adresse). */
  function ifaceAddr(d, port) {
    if (!d) return null;
    if (TYPES[d.type].router) {
      const p = d.ports[iface(port)];
      if (!p) return null;
      const ip = parseIP(p.ip), pre = parseMask(p.mask);
      return ip === null || pre === null ? null : { ip, prefix: pre };
    }
    if (TYPES[d.type].host || TYPES[d.type].isp) {
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
  function l2Endpoints(net, startId, startPort, ignoreFaults) {
    const start = dev(net, startId);
    const out = [];
    // Ringnetz: Die Daten laufen in einer Richtung von Station zu Station – nur wenn der Ring heil ist
    const ring = TYPES[start.type].host ? ringOf(net, startId) : null;
    if (ring) {
      if (!ignoreFaults && ringFaults(net, ring).length) return out;
      const n = ring.members.length, i = ring.members.indexOf(startId);
      const path = [startId];
      for (let k = 1; k < n; k++) {
        const id = ring.members[(i + k) % n];
        path.push(id);
        out.push({ dev: dev(net, id), port: 0, path: path.slice() });
      }
      return out;
    }
    const seen = new Set([startId]);
    const queue = [];
    const usable = l => ignoreFaults || !l.broken;
    for (const l of linksOf(net, startId)) {
      if (!usable(l)) continue;
      if (TYPES[start.type].router && iface(portOf(l, startId)) !== iface(startPort)) continue;
      const other = l.a === startId ? l.b : l.a;
      queue.push({ id: other, port: portOf(l, other), path: [startId, other] });
    }
    while (queue.length) {
      const cur = queue.shift();
      if (seen.has(cur.id)) continue;
      seen.add(cur.id);
      const d = dev(net, cur.id);
      const t = TYPES[d.type];
      if (!ignoreFaults && (d.off || (t.bus && d.broken))) continue; // ausgefallen oder Kabelbruch im Bus
      if (t.l2) {
        for (const l of linksOf(net, d.id)) {
          if (!usable(l)) continue;
          const other = l.a === d.id ? l.b : l.a;
          if (!seen.has(other)) queue.push({ id: other, port: portOf(l, other), path: cur.path.concat(other) });
        }
      } else if (t.router) {
        const i = iface(cur.port);
        out.push({ dev: d, port: i, path: cur.path });
        // Die LAN-Anschlüsse sind wie ein eingebauter Switch miteinander verbunden
        if (i === LAN) for (const l of linksOf(net, d.id)) {
          if (!usable(l)) continue;
          if (iface(portOf(l, d.id)) !== LAN) continue;
          const other = l.a === d.id ? l.b : l.a;
          if (!seen.has(other)) queue.push({ id: other, port: portOf(l, other), path: cur.path.concat(other) });
        }
      } else {
        out.push({ dev: d, port: 0, path: cur.path });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ Ring, Bus und Störungen
  /**
   * Ringnetz, zu dem ein Endgerät gehört: Endgeräte, die direkt per Kabel miteinander
   * verbunden sind (mindestens drei). Ergebnis {members (in Laufrichtung), links, closed} oder null.
   * links[i] verbindet members[i] mit members[i + 1] (beim geschlossenen Ring zuletzt wieder members[0]).
   */
  function ringOf(net, hostId) {
    const hostLinks = id => linksOf(net, id).filter(l => {
      if (l.kind !== 'kabel') return false;
      const o = dev(net, l.a === id ? l.b : l.a);
      return o && TYPES[o.type].host;
    });
    const comp = new Set([hostId]);
    const queue = [hostId];
    while (queue.length) {
      const id = queue.shift();
      for (const l of hostLinks(id)) {
        const o = l.a === id ? l.b : l.a;
        if (!comp.has(o)) { comp.add(o); queue.push(o); }
      }
    }
    if (comp.size < 3) return null;
    // Feste Laufrichtung: beim ersten Gerät (Reihenfolge der Geräte) beginnen, bei einer offenen Kette am Ende
    const ordered = net.devices.filter(d => comp.has(d.id)).map(d => d.id);
    const closed = ordered.every(id => hostLinks(id).length === 2);
    const first = closed ? ordered[0] : ordered.find(id => hostLinks(id).length === 1) || ordered[0];
    const members = [first], links = [];
    let cur = first, prevLink = null;
    while (true) {
      const next = hostLinks(cur).find(l => l !== prevLink);
      if (!next) break;
      const o = next.a === cur ? next.b : next.a;
      links.push(next);
      if (o === first) break;
      if (members.includes(o)) break;
      members.push(o);
      prevLink = next; cur = o;
    }
    return { members, links, closed };
  }

  /** Störungen in einem Ring: [{kind:'off'|'link'|'open', dev?, link?}] */
  function ringFaults(net, ring) {
    const out = [];
    if (!ring.closed) out.push({ kind: 'open' });
    for (const id of ring.members) { const d = dev(net, id); if (d.off) out.push({ kind: 'off', dev: d }); }
    for (const l of ring.links) if (l.broken) out.push({ kind: 'link', link: l });
    return out;
  }

  function linkBetween(net, a, b) { return net.links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a)) || null; }

  function faultText(net, f) {
    if (f.kind === 'off') return `${f.dev.name} ist ausgefallen`;
    if (f.kind === 'link') return `das Kabel zwischen ${dev(net, f.link.a).name} und ${dev(net, f.link.b).name} hat einen Kabelbruch`;
    if (f.kind === 'bus') return `${f.dev.name} hat einen Kabelbruch`;
    return 'der Ring ist nicht geschlossen';
  }

  /**
   * Erklärt, warum eine Adresse im eigenen Netz nicht erreichbar ist, falls ein
   * Ausfall (Gerät aus, Kabelbruch, Ring unterbrochen) schuld ist. Sonst null.
   * Ergebnis: {path (bis zur Störung), error, hint, fault:'ring'|'bus'|'link'|'off'}
   */
  function explainFault(net, startId, startPort, dstIP) {
    const start = dev(net, startId);
    const ring = TYPES[start.type].host ? ringOf(net, startId) : null;
    if (ring) {
      const fs = ringFaults(net, ring);
      if (!fs.length) return null;
      // Paket läuft in Ringrichtung bis zur ersten Störung
      const n = ring.members.length, i = ring.members.indexOf(startId);
      const path = [startId];
      for (let k = 0; k < n - 1; k++) {
        const j = (i + k) % n;
        const l = ring.links[j];
        if (!l || l.broken) break;
        const nx = ring.members[(j + 1) % n];
        path.push(nx);
        if (dev(net, nx).off) break;
      }
      const what = fs.filter(f => f.kind !== 'open').map(f => faultText(net, f));
      const reason = what.length ? what.join(', ') : 'er ist nicht geschlossen';
      return {
        path, fault: 'ring',
        error: `Der Ring ist unterbrochen: ${reason}.`,
        hint: ring.closed
          ? 'Im Ring reicht jede Station die Daten an ihre Nachbarin weiter. Fehlt ein Glied, kommen die Daten nicht mehr herum – das ganze Netz fällt aus.'
          : 'In einem Ring ist jede Station mit genau zwei Nachbarn verbunden. Verbinde die letzte Station wieder mit der ersten.',
      };
    }
    const hit = l2Endpoints(net, startId, startPort, true).find(e => { const a = ifaceAddr(e.dev, e.port); return a && a.ip === dstIP; });
    if (!hit) return null;
    const p = hit.path;
    for (let k = 1; k < p.length; k++) {
      const l = linkBetween(net, p[k - 1], p[k]);
      if (l && l.broken) return { path: p.slice(0, k), fault: 'link', error: `Das Paket kommt nicht weiter: ${faultText(net, { kind: 'link', link: l })}.`, hint: 'Ein kaputtes Kabel überträgt keine Signale. Tippe es an und repariere es.' };
      const d = dev(net, p[k]);
      if (d.off) {
        const last = k === p.length - 1;
        return { path: p.slice(0, k + 1), fault: 'off', error: last ? `${d.name} ist ausgefallen und kann nicht antworten.` : `Das Paket kommt nicht weiter: ${d.name} ist ausgefallen.`, hint: last ? 'Tippe das Gerät an und schalte es wieder ein.' : `Alle Pakete müssen durch ${d.name}. Fällt dieses Gerät aus, sind alle dahinter abgeschnitten.` };
      }
      if (TYPES[d.type].bus && d.broken) return { path: p.slice(0, k + 1), fault: 'bus', error: `${d.name} hat einen Kabelbruch – das ganze Busnetz ist gestört.`, hint: 'An der Bruchstelle werden die Signale zurückgeworfen und überlagern sich. Deshalb kommt bei keinem Gerät am Bus mehr etwas an. Tippe das Bus-Kabel an und repariere es.' };
    }
    return null;
  }

  /** Alle Störungen im Netz als kurze Kennungen (für Ereignisse): 'off:ID', 'link:ID', 'bus:ID'. */
  function activeFaults(net) {
    const out = [];
    for (const d of net.devices) { if (d.off) out.push('off:' + d.id); if (TYPES[d.type].bus && d.broken) out.push('bus:' + d.id); }
    for (const l of net.links) if (l.broken) out.push('link:' + l.id);
    return out;
  }

  /** Gerät ausfallen lassen / wieder einschalten (beim Bus-Kabel: Kabelbruch). */
  function setFault(net, id, on) {
    const d = dev(net, id);
    if (d) { if (TYPES[d.type].bus) d.broken = !!on; else d.off = !!on; return true; }
    const l = net.links.find(x => x.id === id);
    if (l && l.kind === 'kabel') { l.broken = !!on; return true; }
    return false;
  }

  /**
   * Am Bus kommt jedes Signal bei allen angeschlossenen Geräten an. Für die Animation
   * bekommt ein Schritt, der über ein Bus-Kabel läuft, zusätzliche Wege zu allen Geräten.
   */
  function busSpread(net, step) {
    if (step.ok === false || step.paths || !step.path) return step;
    const k = step.path.findIndex(id => { const d = dev(net, id); return d && TYPES[d.type].bus; });
    if (k < 0) return step;
    const bus = step.path[k];
    const extra = linksOf(net, bus).filter(l => !l.broken).map(l => l.a === bus ? l.b : l.a)
      .filter(id => id !== step.path[k - 1] && id !== step.path[k + 1] && !dev(net, id).off)
      .map(id => step.path.slice(0, k + 1).concat(id));
    if (!extra.length) return step;
    const to = dev(net, step.path[step.path.length - 1]);
    const note = `Bus: Das Signal kommt bei allen Geräten am Bus an – nur ${to ? to.name : 'der Empfänger'} nimmt es an`;
    return Object.assign({}, step, { paths: [step.path].concat(extra), note: step.note ? step.note + ' · ' + note : note });
  }

  // ------------------------------------------------------------------ Topologien
  const TOPOLOGY_INFO = {
    stern: {
      name: 'Sterntopologie',
      text: 'Alle Geräte hängen einzeln an einem zentralen Verteiler (Switch, Access Point oder Router).',
      pro: ['Fällt ein Kabel oder ein Gerät aus, funktioniert der Rest weiter.', 'Neue Geräte lassen sich einfach anschließen.', 'Der Switch schickt jedes Paket nur zum Empfänger.'],
      con: ['Fällt der Verteiler aus, ist das ganze Netz gestört.', 'Man braucht viel Kabel (zu jedem Gerät eins) und einen Verteiler.'],
      try: 'Tippe ein Kabel an und simuliere einen Kabelbruch. Tippe den Switch an und lass ihn ausfallen.',
    },
    bus: {
      name: 'Bustopologie',
      text: 'Alle Geräte hängen an einem gemeinsamen Kabel, dem Bus.',
      pro: ['Wenig Kabel und kein Verteiler nötig.', 'Fällt ein einzelnes Gerät aus, arbeiten die anderen weiter.'],
      con: ['Ein Kabelbruch im Bus legt das ganze Netz lahm.', 'Jedes Signal kommt bei allen an – jeder kann mithören.', 'Es kann immer nur ein Gerät gleichzeitig senden. Senden zwei gleichzeitig, stören sich die Signale (Kollision).'],
      try: 'Tippe das Bus-Kabel an und simuliere einen Kabelbruch. Tippe einen PC an und lass ihn ausfallen.',
    },
    ring: {
      name: 'Ringtopologie',
      text: 'Jedes Gerät ist mit genau zwei Nachbarn verbunden. Die Daten werden in einer Richtung von Station zu Station weitergereicht.',
      pro: ['Kein Verteiler nötig.', 'Jede Station verstärkt das Signal beim Weiterreichen – so sind große Entfernungen möglich.'],
      con: ['Fällt eine Station oder ein Kabel aus, ist der ganze Ring unterbrochen.', 'Die Daten müssen oft durch viele Stationen laufen.', 'Neue Geräte einfügen heißt: den Ring auftrennen.'],
      try: 'Tippe einen PC an und lass ihn ausfallen. Sende dann einen Ping zwischen zwei anderen PCs.',
    },
  };

  /**
   * Erkennt die Topologien im Netzwerk.
   * Ergebnis: [{kind:'stern'|'bus'|'ring', center?, members:[IDs], ok, closed?, problem?}]
   * ok = false, wenn ein Ausfall das Teilnetz stört.
   */
  function topologies(net) {
    const out = [];
    const isHost = id => { const d = dev(net, id); return d && TYPES[d.type].host; };
    for (const d of net.devices) {
      const t = TYPES[d.type];
      if (t.bus) {
        const members = linksOf(net, d.id).map(l => l.a === d.id ? l.b : l.a);
        if (members.length >= 2) out.push({ kind: 'bus', center: d.id, members, ok: !d.broken && !d.off, problem: d.broken ? `${d.name}: Kabelbruch` : '' });
      } else if (t.l2 || t.router) {
        const members = linksOf(net, d.id).filter(l => !t.router || iface(portOf(l, d.id)) === LAN).map(l => l.a === d.id ? l.b : l.a).filter(isHost);
        if (members.length >= 3) out.push({ kind: 'stern', center: d.id, members, ok: !d.off, problem: d.off ? `${d.name} ausgefallen` : '' });
      }
    }
    const seen = new Set();
    for (const d of net.devices) {
      if (!TYPES[d.type].host || seen.has(d.id)) continue;
      const r = ringOf(net, d.id);
      if (!r) continue;
      r.members.forEach(id => seen.add(id));
      const fs = ringFaults(net, r);
      out.push({ kind: 'ring', members: r.members, closed: r.closed, ok: !fs.length, problem: !r.closed ? 'nicht geschlossen' : fs.length ? 'unterbrochen' : '' });
    }
    return out;
  }

  /** Erkennt die Topologie zwischen Endgeräten: 'stern', 'bus', 'ring' oder null (erste gefundene). */
  function topology(net) {
    const t = topologies(net);
    return t.length ? t[0].kind : null;
  }

  function devicesWithIP(net, ip) {
    const res = [];
    for (const d of net.devices) {
      if ((TYPES[d.type].host || TYPES[d.type].isp) && parseIP(d.ip) === ip) res.push(d);
      if (TYPES[d.type].router) IFACES.forEach(i => { if (parseIP(d.ports[i].ip) === ip) res.push(d); });
    }
    return res;
  }

  /**
   * Weg eines Pakets von einem Endgerät zu einer IP-Adresse.
   * Ergebnis: {ok, path:[Geräte-IDs], target, error, hint, nat:[…], seenSrc}
   * Bei Fehlern enthält path den Weg bis zur Stelle, an der es nicht weitergeht.
   * nat: Adressübersetzungen unterwegs ({router, inside, outside}); seenSrc: Absender,
   * den das Ziel sieht (nach NAT die externe Adresse des Routers).
   */
  function route(net, srcId, dstIP) {
    const src = dev(net, srcId);
    const nat = [];
    const fail = (path, error, hint) => ({ ok: false, path, error, hint: hint || '', nat });
    if (!src || !TYPES[src.type].host) return fail([srcId], 'Nur Endgeräte können Pakete senden.');
    if (src.off) return fail([srcId], `${src.name} ist ausgefallen (ausgeschaltet) und kann nichts senden.`, 'Tippe das Gerät an und schalte es wieder ein.');
    if (!linksOf(net, srcId).length) return fail([srcId], `${src.name} ist mit nichts verbunden.`, TYPES[src.type].wlan && !TYPES[src.type].cable ? 'Verbinde es per WLAN mit einem Access Point.' : 'Verbinde es mit einem Kabel.');
    const sa = ifaceAddr(src, 0);
    if (!sa) {
      if (parseIP(src.ip) === null) return fail([srcId], `${src.name} hat noch keine gültige IP-Adresse.`, src.dhcp ? 'Tippe das Gerät an und fordere per DHCP eine Adresse an.' : 'Tippe das Gerät an und trage eine IP-Adresse ein, z. B. 192.168.1.10.');
      return fail([srcId], `Die Subnetzmaske von ${src.name} ist ungültig.`, 'Üblich ist 255.255.255.0.');
    }
    let seenSrc = sa.ip;
    const done = (path, target) => ({ ok: true, path, target, nat, seenSrc });
    if (sa.ip === dstIP) return done([srcId], src);

    let curId = srcId, curPort = 0, path = [srcId];
    const visited = new Set();
    for (let step = 0; step < 16; step++) {
      const cd = dev(net, curId);
      const ca = ifaceAddr(cd, curPort);
      const eps = l2Endpoints(net, curId, curPort);
      if (sameNet(ca.ip, dstIP, ca.prefix)) {
        const hits = eps.filter(e => { const a = ifaceAddr(e.dev, e.port); return a && a.ip === dstIP; });
        if (hits.length > 1) return fail(path, `Die IP-Adresse ${ipStr(dstIP)} ist im Netz mehrfach vergeben (${hits.map(h => h.dev.name).join(', ')}).`, 'Jede IP-Adresse darf in einem Netz nur einmal vorkommen.');
        if (hits.length === 1) return done(path.concat(hits[0].path.slice(1)), hits[0].dev);
        // Im Netz eines Internetanbieters sind die Kunden nicht direkt verbunden: Der Anbieter stellt zu
        const ispE = eps.find(e => TYPES[e.dev.type].isp);
        if (ispE) {
          const res = ispForward(net, ispE.dev, dstIP, path.concat(ispE.path.slice(1)));
          return res.ok ? done(res.path, res.target) : fail(res.path, res.error, res.hint);
        }
        const fx = explainFault(net, curId, curPort, dstIP);
        if (fx) return Object.assign(fail(path.concat(fx.path.slice(1)), fx.error, fx.hint), { fault: fx.fault });
        const elsewhere = devicesWithIP(net, dstIP);
        let hint = `Kein Gerät im Netz ${netStr(ca.ip, ca.prefix)} hat diese Adresse.`;
        if (elsewhere.length) hint = `${elsewhere[0].name} hat die Adresse ${ipStr(dstIP)}, ist aber nicht mit diesem Netz verbunden.`;
        return fail(path, `Im Netz von ${cd.name} antwortet niemand unter ${ipStr(dstIP)}.`, hint);
      }
      // Ziel liegt in einem anderen Netz → weiter zum Gateway (Router oder Internetanbieter)
      const isHost = TYPES[cd.type].host;
      const gw = parseIP(isHost ? cd.gw : (cd.ports[WAN].gw || ''));
      if (gw === null) {
        if (isHost) return fail(path, `${cd.name}: Das Ziel ${ipStr(dstIP)} liegt in einem anderen Netz. Dafür braucht ${cd.name} ein Gateway.`, 'Trage beim Gerät als Gateway die IP-Adresse des Routers ein.');
        return fail(path, `Der Router ${cd.name} kennt kein Netz, in dem ${ipStr(dstIP)} liegt.`, 'Ein Router kennt die Netze, an die er angeschlossen ist. Alles andere schickt er über den Internet-Anschluss (WAN) weiter – dafür braucht er dort ein Gateway, z. B. vom Internetanbieter.');
      }
      if (!sameNet(gw, ca.ip, ca.prefix)) return fail(path, `Das Gateway ${ipStr(gw)} von ${cd.name} liegt nicht im eigenen Netz.`, 'Das Gateway muss im selben Netz liegen wie das Gerät selbst.');
      const hop = eps.find(e => { const a = ifaceAddr(e.dev, e.port); return (TYPES[e.dev.type].router || TYPES[e.dev.type].isp) && a && a.ip === gw; });
      if (!hop) {
        const fx = explainFault(net, curId, curPort, gw);
        if (fx) return Object.assign(fail(path.concat(fx.path.slice(1)), fx.error, fx.hint), { fault: fx.fault });
        const other = eps.find(e => { const a = ifaceAddr(e.dev, e.port); return a && a.ip === gw; });
        if (other) return fail(path, `Das Gateway ${ipStr(gw)} ist ${other.dev.name} – das ist kein Router.`, 'Als Gateway muss ein Router eingetragen werden.');
        return fail(path, `Das Gateway ${ipStr(gw)} ist von ${cd.name} aus nicht erreichbar.`, 'Ist der Router angeschlossen und hat sein Anschluss genau diese IP-Adresse?');
      }
      path = path.concat(hop.path.slice(1));
      const r = hop.dev;
      if (TYPES[r.type].isp) {
        const res = ispForward(net, r, dstIP, path);
        return res.ok ? done(res.path, res.target) : fail(res.path, res.error, res.hint);
      }
      if (visited.has(r.id)) return fail(path, 'Das Paket läuft im Kreis.');
      visited.add(r.id);
      // Ziel ist ein Anschluss des Routers selbst?
      if (IFACES.some(i => parseIP(r.ports[i].ip) === dstIP)) return done(path, r);
      // Passenden Anschluss suchen: zuerst die direkt angeschlossenen Netze (LAN oder WAN) …
      const used = new Set(linksOf(net, r.id).map(l => iface(portOf(l, r.id))));
      let outPort = -1;
      IFACES.forEach(i => {
        const a = ifaceAddr(r, i);
        if (outPort < 0 && a && used.has(i) && i !== hop.port && sameNet(a.ip, dstIP, a.prefix)) outPort = i;
      });
      // … sonst alles Unbekannte über den Internet-Anschluss (WAN) hinaus
      if (outPort < 0 && hop.port !== WAN && used.has(WAN) && ifaceAddr(r, WAN) && parseIP(r.ports[WAN].gw || '') !== null) outPort = WAN;
      if (outPort < 0) return fail(path, `Der Router ${r.name} kennt kein Netz, in dem ${ipStr(dstIP)} liegt.`, 'Ein Router kennt die Netze, an die er angeschlossen ist (Heimnetz und Internet-Anschluss). Alles andere schickt er ins Internet – dafür muss sein Internet-Anschluss mit einem Internetanbieter verbunden sein. Prüfe auch, ob das Kabel im richtigen Anschluss steckt.');
      const wan = ifaceAddr(r, WAN);
      if (hop.port === WAN && outPort === LAN && wan && !isPrivate(wan.ip))
        return fail(path, `${r.name} lässt die Anfrage aus dem Internet nicht ins Heimnetz.`, 'Geräte im Heimnetz haben lokale Adressen. Der Router lässt nur Antworten auf Anfragen herein, die vorher aus dem Heimnetz gestellt wurden (NAT).');
      // NAT: Pakete aus dem Heimnetz gehen mit der externen Adresse des Routers hinaus
      if (hop.port === LAN && outPort === WAN) {
        nat.push({ router: r.id, inside: seenSrc, outside: wan.ip });
        seenSrc = wan.ip;
      }
      curId = r.id; curPort = outPort;
    }
    return fail(path, 'Das Paket hat zu viele Stationen passiert und wurde verworfen.');
  }

  /**
   * Weiterleitung im Internet: Ein Internetanbieter stellt Pakete an seine eigenen
   * Kunden zu oder reicht sie an andere, per Kabel verbundene Internetanbieter weiter.
   */
  function ispForward(net, isp, dstIP, path) {
    const fail = (p, error, hint) => ({ ok: false, path: p, error, hint: hint || '' });
    if (isPrivate(dstIP) || isApipa(dstIP))
      return fail(path, `${isp.name} leitet das Paket nicht weiter: ${ipStr(dstIP)} ist eine lokale (private) Adresse.`, 'Lokale Adressen wie 192.168.… gibt es in sehr vielen Heimnetzen gleichzeitig. Im Internet sind sie deshalb nicht erreichbar – nur öffentliche Adressen.');
    const queue = [{ d: isp, path }];
    const seen = new Set([isp.id]);
    while (queue.length) {
      const cur = queue.shift();
      const a = ifaceAddr(cur.d, 0);
      const eps = l2Endpoints(net, cur.d.id, 0);
      if (a && a.ip === dstIP) return { ok: true, path: cur.path, target: cur.d };
      if (a && sameNet(a.ip, dstIP, a.prefix)) {
        const hits = eps.filter(e => { const x = ifaceAddr(e.dev, e.port); return x && x.ip === dstIP; });
        if (hits.length > 1) return fail(cur.path, `Die IP-Adresse ${ipStr(dstIP)} ist bei ${cur.d.name} mehrfach vergeben (${hits.map(h => h.dev.name).join(', ')}).`, 'Jede öffentliche IP-Adresse gibt es im Internet nur einmal.');
        if (hits.length === 1) return { ok: true, path: cur.path.concat(hits[0].path.slice(1)), target: hits[0].dev };
        return fail(cur.path, `${cur.d.name} hat keinen Kunden mit der Adresse ${ipStr(dstIP)}.`, 'Prüfe die Adresse. Angeschlossene Geräte bekommen ihre Adresse vom Internetanbieter.');
      }
      for (const e of eps) if (TYPES[e.dev.type].isp && !seen.has(e.dev.id)) {
        seen.add(e.dev.id);
        queue.push({ d: e.dev, path: cur.path.concat(e.path.slice(1)) });
      }
    }
    return fail(path, `Im Internet ist die Adresse ${ipStr(dstIP)} nicht bekannt.`, 'Ist das Ziel an einen Internetanbieter angeschlossen? Verschiedene Internetanbieter müssen miteinander verbunden sein.');
  }

  /** Hin- und Rückweg (z. B. Ping oder Anfrage/Antwort). Die Antwort geht an den Absender, den das Ziel sieht. */
  function roundTrip(net, srcId, dstIP) {
    const there = route(net, srcId, dstIP);
    if (!there.ok) return { ok: false, there, error: there.error, hint: there.hint, fault: there.fault };
    const target = there.target;
    if (TYPES[target.type].host && target.id !== srcId) {
      const back = route(net, target.id, there.seenSrc);
      if (!back.ok) return { ok: false, there, back, target, error: `Die Anfrage kommt bei ${target.name} an, aber die Antwort findet nicht zurück: ${back.error}`, hint: back.hint, fault: back.fault };
      // NAT rückgängig machen: Der Router weiß noch, wem im Heimnetz die Antwort gehört
      back.unnat = [];
      for (let k = there.nat.length - 1; k >= 0; k--) {
        const n = there.nat[k];
        if (back.target.id !== n.router) break;
        const hit = l2Endpoints(net, n.router, LAN).find(e => { const a = ifaceAddr(e.dev, e.port); return a && a.ip === n.inside; });
        if (!hit) return { ok: false, there, back, target, error: `Die Antwort kommt bei ${back.target.name} an, aber ${ipStr(n.inside)} ist im Heimnetz nicht mehr zu finden.` };
        back.path = back.path.concat(hit.path.slice(1));
        back.target = hit.dev;
        back.unnat.push(n);
      }
      return { ok: true, there, back, target };
    }
    return { ok: true, there, back: { ok: true, path: there.path.slice().reverse() }, target };
  }

  /** Kurzinfo zur NAT-Übersetzung für die Ergebnismeldung (oder null). */
  function natInfo(net, rt) {
    if (!rt.ok || !rt.there.nat || !rt.there.nat.length) return null;
    const first = rt.there.nat[0], last = rt.there.nat[rt.there.nat.length - 1];
    const r = dev(net, last.router);
    return { router: r ? r.name : '', inside: ipStr(first.inside), outside: ipStr(last.outside), target: rt.target.name };
  }

  /** Erklärt die Adressübersetzung (NAT) für das Protokoll. */
  function natNote(net, rt, dir) {
    const list = dir === 'back' ? (rt.back && rt.back.unnat) || [] : rt.there.nat || [];
    return list.map(n => {
      const r = dev(net, n.router);
      return dir === 'back'
        ? `NAT in ${r ? r.name : 'Router'}: Empfänger ${ipStr(n.outside)} wird wieder zu ${ipStr(n.inside)}`
        : `NAT in ${r ? r.name : 'Router'}: Absender ${ipStr(n.inside)} wird zu ${ipStr(n.outside)}`;
    }).join(' · ');
  }

  // ------------------------------------------------------------------ Aktionen: Ping und Browser
  /** Liefert eine Folge von Schritten zum Animieren und ein Ergebnis. */
  function ping(net, srcId, dstText) {
    const src = dev(net, srcId);
    if ((dstText || '').includes(':')) return ping6(net, srcId, dstText);
    const dstIP = parseIP(dstText || '');
    if (dstIP === null) return { ok: false, steps: [], error: `„${dstText || ''}" ist keine gültige IP-Adresse.`, hint: 'Eine IPv4-Adresse besteht aus vier Zahlen von 0 bis 255, getrennt durch Punkte. Eine IPv6-Adresse erkennt man an den Doppelpunkten.' };
    const rt = roundTrip(net, srcId, dstIP);
    const steps = [{ kind: 'request', label: 'Ping-Anfrage', proto: 'ICMP', text: `${src.name} → ${ipStr(dstIP)}: „Bist du da?"`, note: natNote(net, rt, 'there'), path: rt.there.path, ok: rt.there.ok }];
    if (rt.back) steps.push({ kind: 'response', label: 'Ping-Antwort', proto: 'ICMP', text: `${rt.target.name} → ${rt.back.ok && rt.there.nat.length ? ipStr(rt.there.seenSrc) : src.name}: „Ja, ich bin da!"`, note: natNote(net, rt, 'back'), path: rt.back.path, ok: rt.back.ok });
    return { ok: rt.ok, steps: steps.map(st => busSpread(net, st)), error: rt.error, hint: rt.hint, fault: rt.fault || '', target: rt.target ? rt.target.id : null, nat: natInfo(net, rt) };
  }

  function parseURL(url) {
    let u = (url || '').trim();
    const m = u.match(/^(?:(https?):\/\/)?([^/:\s]+)(?::(\d+))?(\/[^\s]*)?$/i);
    if (!m) return null;
    return { scheme: (m[1] || 'http').toLowerCase(), host: m[2].toLowerCase(), path: m[4] || '/' };
  }

  // ------------------------------------------------------------------ Internetdienste, TCP und UDP
  /**
   * Dienste, die ein Server anbieten kann.
   * proto: Transportprotokoll, port: Port des Dienstes, why: Begründung für das Protokoll.
   */
  const SERVICES = {
    web:   { label: 'Webserver (HTTP)', server: 'Webserver', proto: 'TCP', port: 80,
      why: 'Eine Webseite muss vollständig und fehlerfrei ankommen. TCP bestätigt jedes Paket und sendet verlorene Pakete neu.' },
    dns:   { label: 'DNS-Server', server: 'DNS-Server', proto: 'UDP', port: 53,
      why: 'Eine DNS-Anfrage ist nur ein kleines Paket. UDP spart den Verbindungsaufbau. Kommt keine Antwort, fragt das Gerät einfach noch einmal.' },
    mail:  { label: 'E-Mail-Server', server: 'E-Mail-Server', proto: 'TCP', port: 25,
      why: 'Eine E-Mail muss vollständig ankommen, kein Buchstabe darf fehlen. Deshalb TCP. Senden heißt SMTP (Port 25), Abrufen heißt IMAP (Port 143). Der Server bewahrt die E-Mails auf, bis sie abgerufen werden.' },
    video: { label: 'Video-Streaming', server: 'Video-Server', proto: 'TCP', port: 80,
      why: 'Ein Video auf Abruf (z. B. aus einer Mediathek) wird über HTTP und TCP ein paar Sekunden im Voraus in einen Puffer geladen. Geht ein Paket verloren, wird es neu gesendet, bevor es gebraucht wird.' },
    call:  { label: 'Video- und Audio-Telefonie', server: 'Telefonie-Server', proto: 'UDP', port: 5004,
      why: 'Im Gespräch zählt jede Zehntelsekunde. Ein neu gesendetes Paket käme zu spät. Deshalb UDP: Fehlt ein Paket, ruckelt das Bild kurz, aber das Gespräch läuft weiter.' },
    game:  { label: 'Spiele-Server (Online-Spiel)', server: 'Spiele-Server', proto: 'UDP', port: 7777,
      why: 'Ein Online-Spiel schickt viele Male pro Sekunde die aktuellen Positionen. Geht ein Paket verloren, bringt das nächste ohnehin den neuesten Stand. Warten wäre schlimmer als ein fehlendes Paket.' },
  };

  /** Was ein Endgerät mit einem Dienst tun kann. */
  const ACTIONS = {
    web:     { svc: 'web',   label: 'Webseite öffnen' },
    mail:    { svc: 'mail',  label: 'E-Mail senden', port: 25 },
    mailget: { svc: 'mail',  label: 'E-Mails abrufen', port: 143 },
    video:   { svc: 'video', label: 'Video ansehen' },
    call:    { svc: 'call',  label: 'Videoanruf' },
    game:    { svc: 'game',  label: 'Online spielen' },
  };

  function defaultServices() {
    return {
      web: { on: false, title: 'Willkommen!', text: 'Das ist meine erste Webseite.' },
      dns: { on: false, entries: [] },
      mail: { on: false, box: [] },
      video: { on: false },
      call: { on: false },
      game: { on: false },
      files: { on: false, files: [] },
    };
  }

  function svcOn(d, k) { return !!(d && d.services && d.services[k] && d.services[k].on); }

  function linkBetween(net, a, b) {
    return net.links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a)) || null;
  }

  /** Erste gestörte Verbindung auf einem Weg: Index i (zwischen path[i] und path[i+1]) oder -1. */
  function lossAt(net, path) {
    for (let i = 0; i + 1 < path.length; i++) {
      const l = linkBetween(net, path[i], path[i + 1]);
      if (l && l.loss) return i;
    }
    return -1;
  }

  /** Name per DNS in eine IP-Adresse übersetzen (DNS-Schritte landen in steps). */
  function resolveHost(net, src, host, steps) {
    const direct = parseIP(host);
    if (direct !== null) return { ip: direct };
    const dnsIP = parseIP(src.dns || '');
    if (dnsIP === null) return { error: `${src.name} kennt keinen DNS-Server und kann den Namen ${host} nicht in eine IP-Adresse übersetzen.`, hint: 'Trage beim Gerät die IP-Adresse eines DNS-Servers ein.' };
    const rt = roundTrip(net, src.id, dnsIP);
    steps.push({ kind: 'request', label: 'DNS-Anfrage', proto: 'UDP · Port 53', text: `Welche IP-Adresse hat ${host}?`, note: natNote(net, rt, 'there'), path: rt.there.path, ok: rt.there.ok });
    if (!rt.ok) {
      if (rt.back) steps.push({ kind: 'response', label: 'DNS-Antwort', proto: 'UDP · Port 53', text: '', path: rt.back.path, ok: false });
      return { error: 'DNS-Server nicht erreichbar: ' + rt.error, hint: rt.hint };
    }
    const ds = rt.target;
    if (!svcOn(ds, 'dns'))
      return { error: `Unter ${ipStr(dnsIP)} (${ds.name}) läuft kein DNS-Server.`, hint: 'Prüfe die DNS-Adresse oder schalte beim Server den DNS-Dienst ein.' };
    const entry = (ds.services.dns.entries || []).find(e => (e.name || '').trim().toLowerCase() === host);
    if (!entry || parseIP(entry.ip) === null) {
      steps.push({ kind: 'response', label: 'DNS-Antwort', proto: 'UDP · Port 53', text: `Den Namen ${host} kenne ich nicht.`, path: rt.back.path, ok: true, bad: true });
      return { error: `Der DNS-Server kennt den Namen ${host} nicht.`, hint: 'Prüfe die Schreibweise der Adresse oder ergänze den Eintrag beim DNS-Server.' };
    }
    const ip = parseIP(entry.ip);
    steps.push({ kind: 'response', label: 'DNS-Antwort', proto: 'UDP · Port 53', text: `${host} hat die IP-Adresse ${ipStr(ip)}`, note: natNote(net, rt, 'back'), path: rt.back.path, ok: true });
    return { ip };
  }

  const plural = (n, one, many) => n === 1 ? `1 ${one}` : `${n} ${many}`;

  /** Die Nachrichten eines Dienstes (ohne TCP-Verwaltungspakete). dir: 'up' = zum Server, 'down' = zurück. */
  const MESSAGES = {
    web: (src, srv, u) => [
      { dir: 'up', label: 'HTTP-Request', short: 'Die Anfrage', text: `GET ${u.path} – „Schick mir bitte die Webseite ${u.host}"` },
      { dir: 'down', label: 'HTTP-Response', short: 'Die Webseite', text: '200 OK – hier ist die Webseite' },
    ],
    mail: (src, srv) => [
      { dir: 'up', label: 'SMTP: E-Mail', short: 'Die E-Mail', text: `${src.name} übergibt eine E-Mail: „Hallo! Viele Grüße von ${src.name}"` },
      { dir: 'down', label: 'SMTP: 250 OK', short: 'Die Antwort', text: `${srv.name}: „E-Mail angenommen und im Postfach gespeichert."` },
    ],
    mailget: (src, srv) => {
      const n = ((srv.services.mail || {}).box || []).length;
      return [
        { dir: 'up', label: 'IMAP: Abrufen', short: 'Die Anfrage', text: `${src.name}: „Gibt es E-Mails im Postfach?"` },
        { dir: 'down', label: 'IMAP: E-Mails', short: 'Die Antwort', text: n ? `${srv.name}: „Hier sind ${plural(n, 'E-Mail', 'E-Mails')}."` : `${srv.name}: „Das Postfach ist leer."` },
      ];
    },
    video: () => [
      { dir: 'up', label: 'Video-Anfrage', short: 'Die Anfrage', text: 'GET /video – „Schick mir bitte das Video."' },
      { dir: 'down', label: 'Videodaten 1/3', short: 'Teil 1', text: 'Teil 1 des Videos – kommt in den Puffer' },
      { dir: 'down', label: 'Videodaten 2/3', short: 'Teil 2', text: 'Teil 2 des Videos – kommt in den Puffer' },
      { dir: 'down', label: 'Videodaten 3/3', short: 'Teil 3', text: 'Teil 3 des Videos – kommt in den Puffer' },
    ],
    call: (src, srv) => [
      { dir: 'up', label: 'Bild + Ton', short: 'Paket 1', text: `Paket 1: Bild und Ton von ${src.name}` },
      { dir: 'down', label: 'Bild + Ton', short: 'Paket 2', text: `Paket 2: Bild und Ton der anderen Teilnehmer (über ${srv.name})` },
      { dir: 'up', label: 'Bild + Ton', short: 'Paket 3', text: `Paket 3: Bild und Ton von ${src.name}` },
      { dir: 'down', label: 'Bild + Ton', short: 'Paket 4', text: 'Paket 4: Bild und Ton der anderen Teilnehmer' },
    ],
    game: (src) => [
      { dir: 'up', label: 'Spielzug', short: 'Update 1', text: `Update 1: Position und Aktion von ${src.name}` },
      { dir: 'down', label: 'Spielstand', short: 'Update 2', text: 'Update 2: Positionen aller Spieler' },
      { dir: 'up', label: 'Spielzug', short: 'Update 3', text: `Update 3: Position und Aktion von ${src.name}` },
      { dir: 'down', label: 'Spielstand', short: 'Update 4', text: 'Update 4: Positionen aller Spieler' },
    ],
  };

  /**
   * Baut die Paketfolge eines Dienstes. TCP: auf Wunsch mit Verbindungsaufbau (SYN, SYN-ACK, ACK),
   * Bestätigungen und Verbindungsabbau; verlorene Pakete werden neu gesendet. UDP: keine
   * Verbindung, keine Bestätigung, verlorene Pakete bleiben verloren.
   * Auf einem Weg mit gestörter Verbindung geht genau ein Datenpaket verloren
   * (das zweite, wenn es über die Störung läuft, sonst das erste betroffene).
   */
  function exchange(net, rt, src, srv, msgs, proto, details) {
    const steps = [];
    const tcp = proto.startsWith('TCP');
    const pathOf = dir => dir === 'up' ? rt.there.path : rt.back.path;
    const noted = {};
    const note = dir => { if (noted[dir]) return ''; noted[dir] = true; return natNote(net, rt, dir === 'up' ? 'there' : 'back'); };
    const kindOf = dir => dir === 'up' ? 'request' : 'response';
    const push = (dir, label, text, extra) => steps.push(Object.assign({ kind: kindOf(dir), label, proto, text, note: note(dir), path: pathOf(dir), ok: true }, extra || {}));
    const ack = (dir, m) => push(dir === 'up' ? 'down' : 'up', 'TCP: ACK', `Bestätigung: „${m.short} ist angekommen."`, { tcp: true });

    if (tcp && details) {
      push('up', 'TCP: SYN', `Verbindungsaufbau 1/3 – ${src.name}: „Ich möchte eine Verbindung aufbauen."`, { tcp: true });
      push('down', 'TCP: SYN-ACK', `Verbindungsaufbau 2/3 – ${srv.name}: „Einverstanden, ich bin bereit."`, { tcp: true });
      push('up', 'TCP: ACK', `Verbindungsaufbau 3/3 – ${src.name}: „Alles klar, die Verbindung steht."`, { tcp: true });
    }
    const lossIdx = msgs.map(m => lossAt(net, pathOf(m.dir)));
    const lostK = msgs.length > 1 && lossIdx[1] >= 0 ? 1 : lossIdx.findIndex(x => x >= 0);
    let lost = null;
    msgs.forEach((m, k) => {
      if (k !== lostK) {
        push(m.dir, m.label, m.text);
        if (tcp && details) ack(m.dir, m);
        return;
      }
      const p = pathOf(m.dir), i = lossIdx[k];
      lost = m;
      steps.push({ kind: kindOf(m.dir), label: m.label, proto, text: m.text + ' – geht unterwegs verloren!', note: note(m.dir),
        path: p.slice(0, i + 1).concat([{ mid: [p[i], p[i + 1]] }]), ok: false, lost: true });
      if (tcp) {
        const sender = m.dir === 'up' ? src.name : srv.name;
        steps.push({ kind: 'wait', label: 'Keine Bestätigung', proto, text: `${sender} wartet auf die Bestätigung (ACK) – vergeblich. Nach kurzer Wartezeit wird das Paket noch einmal gesendet.`, path: [p[0]], ok: true });
        push(m.dir, m.label + ' (neu gesendet)', m.text);
        ack(m.dir, m);
      }
    });
    if (tcp && details) {
      push('up', 'TCP: FIN', `Verbindungsabbau – ${src.name}: „Ich bin fertig."`, { tcp: true });
      push('down', 'TCP: FIN-ACK', `Verbindungsabbau – ${srv.name}: „Verstanden, Verbindung beendet."`, { tcp: true });
    }
    return { steps, lost };
  }

  /** Erfolgsmeldung für das Protokoll. */
  function serviceMessage(action, srv, page, lost, n) {
    switch (action) {
      case 'web':
        return `Webseite ${page.host} geladen (Server-IP ${page.ip}).` + (lost ? ' Ein Paket ging unterwegs verloren und wurde neu gesendet (TCP). Die Seite ist trotzdem vollständig angekommen.' : '');
      case 'mail':
        return `E-Mail an ${srv.name} übergeben (SMTP über TCP). Der E-Mail-Server bewahrt sie im Postfach auf, bis sie jemand abruft.` + (lost ? ' Unterwegs ging ein Paket verloren und wurde neu gesendet.' : '');
      case 'mailget':
        return `${n ? plural(n, 'E-Mail', 'E-Mails') : 'Keine E-Mails'} von ${srv.name} abgerufen (IMAP über TCP).` + (lost ? ' Unterwegs ging ein Paket verloren und wurde neu gesendet.' : '');
      case 'video':
        return lost
          ? `Das Video läuft ohne Aussetzer. ${lost.short} ging unterwegs verloren. Weil keine Bestätigung kam, wurde er noch einmal gesendet (TCP). Der Puffer hat die kurze Wartezeit überbrückt.`
          : 'Das Video läuft. Alle Teile sind vollständig angekommen – dafür sorgt TCP mit Bestätigungen.';
      case 'call':
        return lost
          ? `Der Videoanruf läuft – aber kurz ruckelt das Bild und der Ton knackt: ${lost.short} ging verloren und wurde nicht neu gesendet (UDP). Ein neu gesendetes Paket käme zu spät, denn im Gespräch zählt jede Zehntelsekunde.`
          : `Der Videoanruf über ${srv.name} läuft. Bild und Ton gehen per UDP hin und her – ohne Verbindungsaufbau und ohne Bestätigungen. Das spart Zeit.`;
      case 'game':
        return lost
          ? `Das Spiel läuft weiter. ${lost.short} ging verloren und wurde nicht neu gesendet (UDP). Das nächste Update bringt ohnehin den neuesten Stand.`
          : `Du spielst online über ${srv.name}. Die Spielzüge gehen per UDP hin und her – schnell und ohne Wartezeit.`;
    }
    return '';
  }

  /**
   * Ein Endgerät nutzt einen Internetdienst (Webseite, E-Mail, Video, Videoanruf, Online-Spiel).
   * opts.tcp: TCP-Verbindungsaufbau und Bestätigungen zeigen.
   * Das Netzwerk wird nicht verändert. Ergebnis: {ok, steps, error, hint, message, target, lost, ...}
   */
  function useService(net, srcId, action, target, opts) {
    opts = opts || {};
    const A = ACTIONS[action];
    const steps = [];
    const res = (ok, extra) => Object.assign({ ok, steps: steps.map(st => busSpread(net, st)), action }, extra);
    if (!A) return res(false, { error: 'Unbekannter Dienst.' });
    const S = SERVICES[A.svc];
    const src = dev(net, srcId);
    const u = parseURL(target);
    if (!u) return res(false, action === 'web'
      ? { error: `„${target || ''}" ist keine gültige Adresse (URL).`, hint: 'Beispiel: http://www.beispiel.de' }
      : { error: (target || '').trim() ? `„${target}" ist kein gültiger Name und keine IP-Adresse.` : 'Gib zuerst den Namen oder die IP-Adresse des Servers ein.', hint: 'Beispiel: mail.beispiel.de' });
    const r = resolveHost(net, src, u.host, steps);
    if (r.error) return res(false, { error: r.error, hint: r.hint });
    const ip = r.ip;
    const port = A.port || S.port;
    const proto = `${S.proto} · Port ${port}`;
    const details = !!opts.tcp && S.proto === 'TCP';
    const rt = roundTrip(net, srcId, ip);
    if (!rt.ok) {
      const ms = MESSAGES[action](src, { name: '', services: {} }, u);
      const first = details ? { label: 'TCP: SYN', text: `Verbindungsaufbau 1/3 – ${src.name}: „Ich möchte eine Verbindung aufbauen."` } : ms[0];
      steps.push({ kind: 'request', label: first.label, proto, text: first.text, note: natNote(net, rt, 'there'), path: rt.there.path, ok: rt.there.ok });
      if (rt.back) steps.push({ kind: 'response', label: details ? 'TCP: SYN-ACK' : (ms.find(m => m.dir === 'down') || ms[0]).label, proto, text: '', path: rt.back.path, ok: false });
      return res(false, { error: `${S.server} nicht erreichbar: ` + rt.error, hint: rt.hint });
    }
    const srv = rt.target;
    if (!svcOn(srv, A.svc)) {
      const msgs = srv.services ? MESSAGES[action](src, srv, u) : null;
      if (details) {
        steps.push({ kind: 'request', label: 'TCP: SYN', proto, text: `Verbindungsaufbau 1/3 – ${src.name}: „Ich möchte eine Verbindung aufbauen."`, note: natNote(net, rt, 'there'), path: rt.there.path, ok: true });
        steps.push({ kind: 'response', label: 'TCP: RST', proto, text: `${srv.name}: „An Port ${port} läuft bei mir kein Dienst."`, path: rt.back.path, ok: true, bad: true });
      } else {
        const m = msgs ? msgs[0] : MESSAGES[action](src, { name: srv.name, services: {} }, u)[0];
        steps.push({ kind: 'request', label: m.label, proto, text: m.text, note: natNote(net, rt, 'there'), path: rt.there.path, ok: true });
      }
      return res(false, { error: `Unter ${ipStr(ip)} (${srv.name}) läuft kein ${S.server}.`, hint: TYPES[srv.type].services ? `Schalte beim Server den Dienst „${S.label}" ein.` : `${srv.name} ist kein Server. Dienste wie ${S.label} bieten nur Server an.` });
    }
    const msgs = MESSAGES[action](src, srv, u);
    const ex = exchange(net, rt, src, srv, msgs, proto, details);
    steps.push(...ex.steps);
    const extra = { target: srv.id, nat: natInfo(net, rt), lost: !!ex.lost, resent: !!ex.lost && S.proto === 'TCP', tcp: details, proto: S.proto, host: u.host };
    let page = null, n = 0;
    if (action === 'web') {
      page = { host: u.host, ip: ipStr(ip), title: srv.services.web.title || '', text: srv.services.web.text || '' };
      extra.page = page;
    }
    if (action === 'mail') extra.mail = { from: src.name, text: `Hallo! Viele Grüße von ${src.name}` };
    if (action === 'mailget') { extra.mails = ((srv.services.mail || {}).box || []).slice(); n = extra.mails.length; }
    extra.message = serviceMessage(action, srv, page, ex.lost, n);
    return res(true, extra);
  }

  function browse(net, srcId, url, opts) { return useService(net, srcId, 'web', url, opts); }

  // ------------------------------------------------------------------ DHCP
  /** DHCP-Einstellungen eines Router-Anschlusses (fehlen bei älteren Netzen). */
  function dhcpOf(port) {
    if (!port.dhcp) port.dhcp = { on: false, from: '', to: '', dns: '' };
    return port.dhcp;
  }

  /** Standard-Adressbereich für einen Anschluss, z. B. .100 bis .199 in einem /24-Netz. */
  function dhcpDefaultRange(ip, prefix) {
    const net = (ip & maskOf(prefix)) >>> 0;
    const size = 2 ** (32 - prefix);
    if (size >= 256) return { from: net + 100, to: net + 199 };
    return { from: net + Math.floor(size / 2), to: net + size - 2 };
  }

  /** Tatsächlich verwendeter Adressbereich eines Router-Anschlusses (oder null). */
  function dhcpRange(r, port) {
    const a = ifaceAddr(r, port);
    if (!a) return null;
    const cfg = dhcpOf(r.ports[port]);
    const def = dhcpDefaultRange(a.ip, a.prefix);
    let from = parseIP(cfg.from || ''), to = parseIP(cfg.to || '');
    if (from === null || !sameNet(from, a.ip, a.prefix) || ipProblem(ipStr(from), r.ports[port].mask)) from = def.from;
    if (to === null || !sameNet(to, a.ip, a.prefix) || ipProblem(ipStr(to), r.ports[port].mask)) to = def.to;
    if (to < from) return { from: def.from, to: def.to };
    return { from, to };
  }

  /**
   * Schlägt eine feste IP-Adresse für einen Router-Anschluss vor, z. B. beim
   * Einschalten des DHCP-Servers. Gibt es im angeschlossenen Netz schon Geräte
   * mit Adresse, passt sich der Vorschlag diesem Netz an (bevorzugt .1).
   * Sonst wird ein freies Netz 192.168.N.0/24 gewählt.
   * Ergebnis: {ip, mask} als Text.
   */
  function suggestPortIP(net, r, port) {
    const eps = l2Endpoints(net, r.id, port);
    const known = eps.map(e => ifaceAddr(e.dev, e.port)).filter(a => a && !ipProblem(ipStr(a.ip), ipStr(maskOf(a.prefix))));
    if (known.length) {
      const ref = known[0];
      const used = new Set(known.map(a => a.ip));
      const base = (ref.ip & maskOf(ref.prefix)) >>> 0;
      const size = 2 ** (32 - ref.prefix);
      for (let i = 1; i < size - 1; i++) if (!used.has(base + i)) return { ip: ipStr(base + i), mask: ipStr(maskOf(ref.prefix)) };
    }
    return { ip: freeNets(net, 1, r, port)[0] || '10.0.0.1', mask: '255.255.255.0' };
  }

  /**
   * Ein Endgerät fragt per DHCP nach einer IP-Adresse.
   * Ablauf wie in echt: Discover (an alle) → Offer → Request (an alle) → Ack.
   * Das Netzwerk wird nicht verändert; das Ergebnis steht in lease.
   * Ergebnis: {ok, steps, error, hint, lease:{ip, mask, gw, dns}, server}
   */
  function dhcp(net, hostId) {
    const h = dev(net, hostId);
    const steps = [];
    const res = (ok, extra) => Object.assign({ ok, steps }, extra);
    const P_REQ = 'UDP · Port 67', P_RESP = 'UDP · Port 68';
    // Ein Router fragt an seinem Internet-Anschluss (WAN), z. B. beim Internetanbieter
    const isRouter = h && TYPES[h.type].router;
    if (!h || !(TYPES[h.type].host || isRouter)) return res(false, { error: 'Nur Endgeräte und Router können per DHCP eine Adresse anfordern.' });
    if (h.off) return res(false, { error: `${h.name} ist ausgefallen (ausgeschaltet).`, hint: 'Tippe das Gerät an und schalte es wieder ein.' });
    const myLinks = linksOf(net, hostId).filter(l => !isRouter || iface(portOf(l, hostId)) === WAN);
    if (!myLinks.length) return res(false, { error: isRouter ? `Am Internet-Anschluss (WAN) von ${h.name} ist nichts angeschlossen.` : `${h.name} ist mit nichts verbunden und kann niemanden nach einer Adresse fragen.`, hint: isRouter ? 'Verbinde den Router mit einem Internetanbieter.' : TYPES[h.type].cable ? 'Verbinde es mit einem Kabel.' : 'Verbinde es per WLAN mit einem Access Point.' });
    const eps = l2Endpoints(net, hostId, isRouter ? WAN : 0);
    const servers = eps.filter(e => (TYPES[e.dev.type].isp && ifaceAddr(e.dev, 0)) || (TYPES[e.dev.type].router && e.port === LAN && ifaceAddr(e.dev, e.port) && dhcpOf(e.dev.ports[e.port]).on));
    const bcPaths = eps.length ? eps.map(e => e.path) : [[hostId]];
    steps.push({ kind: 'request', label: 'DHCP-Discover', proto: P_REQ + ' · an alle', text: `${h.name} an alle im Netz: „Ich brauche eine IP-Adresse! Gibt es hier einen DHCP-Server?"`, paths: bcPaths, path: bcPaths[0], ok: servers.length > 0 });
    if (!servers.length) {
      const router = eps.find(e => TYPES[e.dev.type].router);
      let hint = 'Ein DHCP-Server (meist im Router) muss im selben Netz eingeschaltet sein.';
      const blocked = l2Endpoints(net, hostId, isRouter ? WAN : 0, true).find(e => (TYPES[e.dev.type].isp || TYPES[e.dev.type].router) && !eps.some(x => x.dev === e.dev));
      const fx = blocked && ifaceAddr(blocked.dev, blocked.port) ? explainFault(net, hostId, isRouter ? WAN : 0, ifaceAddr(blocked.dev, blocked.port).ip) : null;
      if (isRouter) return res(false, { error: 'Kein DHCP-Server hat geantwortet.', hint: fx ? fx.error + ' ' + fx.hint : 'Schließe den Internet-Anschluss (WAN) an einen Internetanbieter an oder trage die externe Adresse von Hand ein.' });
      if (fx) hint = fx.error + ' ' + fx.hint;
      else if (router && router.port === WAN) hint = `Das Gerät hängt am Internet-Anschluss (WAN) von ${router.dev.name}. Adressen per DHCP gibt es im Heimnetz: Stecke das Kabel an einen LAN-Anschluss.`;
      else if (router && !ifaceAddr(router.dev, router.port)) hint = `${router.dev.name} braucht im Heimnetz (LAN) zuerst eine eigene IP-Adresse. Danach kannst du dort den DHCP-Server einschalten.`;
      else if (router) hint = `Tippe ${router.dev.name} an und schalte im Heimnetz (LAN) den DHCP-Server ein.`;
      // Wie echte Rechner: ohne DHCP-Server eine Notfall-Adresse (APIPA) aus 169.254.0.0/16 wählen
      return res(false, { error: 'Kein DHCP-Server hat geantwortet.', hint, apipa: apipaLease(h, eps) });
    }
    const srv = servers.find(e => TYPES[e.dev.type].isp) || servers[0];
    const r = srv.dev, port = srv.port;
    const ra = ifaceAddr(r, port);
    const ispSrv = !!TYPES[r.type].isp;
    const range = ispSrv ? dhcpDefaultRange(ra.ip, ra.prefix) : dhcpRange(r, port);
    const back = srv.path.slice().reverse();
    // Freie Adresse suchen: Bisherige Adresse behalten, wenn möglich
    const used = new Set();
    // Beim Internetanbieter zählen alle seine Kunden (sie sind untereinander nicht direkt verbunden)
    const known = ispSrv ? eps.concat(l2Endpoints(net, r.id, 0).filter(e => e.dev.id !== hostId)) : eps;
    for (const e of known) { const a = ifaceAddr(e.dev, e.port); if (a) used.add(a.ip); }
    let ip = null;
    const own = parseIP((isRouter ? h.ports[WAN].ip : h.ip) || '');
    if (own !== null && own >= range.from && own <= range.to && !used.has(own)) ip = own;
    for (let c = range.from; ip === null && c <= range.to; c++) if (!used.has(c)) ip = c;
    if (ip === null) {
      steps.push({ kind: 'response', label: 'DHCP-Offer', proto: P_RESP, text: `${r.name}: „Tut mir leid, alle Adressen sind vergeben."`, path: back, ok: true, bad: true });
      return res(false, { error: `Der DHCP-Server von ${r.name} hat keine freie Adresse mehr (${ipStr(range.from)} bis ${ipStr(range.to)}).`, hint: ispSrv ? 'Verbinde das Gerät mit einem anderen Internetanbieter.' : 'Vergrößere beim Router den Adressbereich.' });
    }
    // DNS-Server: beim Internetanbieter eingestellt; ein Heimrouter gibt sonst den DNS-Server seines Anbieters weiter
    const dnsIP = ispSrv ? parseIP(r.dns || '') : firstIP(dhcpOf(r.ports[port]).dns, r.ports[WAN].dns);
    const lease = { ip: ipStr(ip), mask: ipStr(maskOf(ra.prefix)), gw: ipStr(ra.ip), dns: dnsIP === null ? '' : ipStr(dnsIP) };
    steps.push({ kind: 'response', label: 'DHCP-Offer', proto: P_RESP, text: `${r.name}: „Du kannst die Adresse ${lease.ip} haben."`, path: back, ok: true });
    steps.push({ kind: 'request', label: 'DHCP-Request', proto: P_REQ + ' · an alle', text: `${h.name} an alle: „Ich nehme die Adresse ${lease.ip} von ${r.name}!"`, paths: bcPaths, path: srv.path, ok: true });
    steps.push({ kind: 'response', label: 'DHCP-Ack', proto: P_RESP, text: `${r.name}: „Bestätigt! IP ${lease.ip}, Maske ${lease.mask}, Gateway ${lease.gw}` + (lease.dns ? `, DNS ${lease.dns}` : '') + '"', path: back, ok: true });
    return res(true, { lease, server: r.id, isp: ispSrv });
  }

  function firstIP(...list) {
    for (const x of list) { const ip = parseIP(x || ''); if (ip !== null) return ip; }
    return null;
  }

  const APIPA_NET = 0xa9fe0000; // 169.254.0.0
  function isApipa(ip) { return ip !== null && sameNet(ip, APIPA_NET, 16); }

  /** Notfall-Adresse 169.254.x.y für ein Gerät (gleichbleibend je Gerät, nicht doppelt im Netz). */
  function apipaLease(h, eps) {
    const used = new Set();
    for (const e of eps) { const a = ifaceAddr(e.dev, e.port); if (a) used.add(a.ip); }
    const own = parseIP(h.ip || '');
    let ip = isApipa(own) && !used.has(own) ? own : null;
    if (ip === null) {
      let hsh = 0;
      for (const ch of h.id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
      let n = 256 + (hsh % (254 * 256));            // 169.254.1.0 … 169.254.254.255
      for (let k = 0; ip === null && k < 65000; k++, n = n >= 65279 ? 256 : n + 1) {
        const c = APIPA_NET + n;
        if ((c & 255) !== 0 && (c & 255) !== 255 && !used.has(c)) ip = c;
      }
    }
    return { ip: ipStr(ip), mask: '255.255.0.0', gw: '', dns: '' };
  }

  /** Übernimmt eine DHCP-Zuteilung in das Gerät. */
  function applyLease(d, lease) {
    const t = TYPES[d.type].router ? d.ports[WAN] : d;
    t.ip = lease.ip; t.mask = lease.mask; t.gw = lease.gw; t.dns = lease.dns;
  }

  /**
   * Nach einer Änderung des DNS-Servers beim Internetanbieter: Router und Geräte, die ihre
   * Adresse per DHCP bekommen haben, übernehmen den neuen DNS-Server (wie bei einer Verlängerung).
   * Liefert die Zahl der geänderten Geräte.
   */
  function refreshDns(net) {
    let n = 0;
    const order = net.devices.filter(d => TYPES[d.type].router).concat(net.devices.filter(d => TYPES[d.type].host && d.dhcp));
    for (const d of order) {
      const cur = TYPES[d.type].router ? d.ports[WAN] : d;
      const own = parseIP(cur.ip || '');
      if (own === null || isApipa(own)) continue;
      const r = dhcp(net, d.id);
      if (!r.ok || r.lease.ip !== ipStr(own) || (TYPES[d.type].router && !r.isp)) continue;
      if ((cur.dns || '') !== r.lease.dns) { cur.dns = r.lease.dns; n++; }
    }
    return n;
  }

  /**
   * Vorschläge für die manuelle Einstellung eines Endgeräts, abgeleitet aus den
   * Geräten im selben Netz. Liefert {ip, mask, gw, dns} (jeweils oder null).
   */
  function suggest(net, hostId) {
    const h = dev(net, hostId);
    const out = { ip: null, mask: null, gw: null, dns: null };
    if (!h || !TYPES[h.type].host) return out;
    const eps = linksOf(net, hostId).length ? l2Endpoints(net, hostId, 0) : [];
    const own = ifaceAddr(h, 0);
    // Bezugsnetz: zuerst ein Router-Anschluss, sonst ein anderes Endgerät
    const withAddr = eps.map(e => ({ e, a: ifaceAddr(e.dev, e.port) })).filter(x => x.a && !ipProblem(ipStr(x.a.ip), ipStr(maskOf(x.a.prefix))));
    const isGw = x => TYPES[x.e.dev.type].router || TYPES[x.e.dev.type].isp;
    const ref = withAddr.find(isGw) || withAddr[0];
    if (ref) {
      const used = new Set(withAddr.map(x => x.a.ip));
      const ownOk = own && sameNet(own.ip, ref.a.ip, ref.a.prefix) && own.prefix === ref.a.prefix && !used.has(own.ip) && !ipProblem(h.ip, h.mask);
      if (!ownOk) {
        const base = (ref.a.ip & maskOf(ref.a.prefix)) >>> 0;
        const size = 2 ** (32 - ref.a.prefix);
        const start = size >= 64 ? 10 : 1;
        for (let i = start; i < size - 1; i++) if (!used.has(base + i)) { out.ip = ipStr(base + i); break; }
        if (out.ip) out.mask = ipStr(maskOf(ref.a.prefix));
      }
      const router = withAddr.find(isGw);
      if (router && parseIP(h.gw || '') !== router.a.ip) out.gw = ipStr(router.a.ip);
    }
    if (!(h.dns || '').trim()) {
      const ds = net.devices.find(d => d !== h && d.services && d.services.dns && d.services.dns.on && parseIP(d.ip) !== null);
      if (ds) out.dns = ds.ip.trim();
    }
    return out;
  }

  // ------------------------------------------------------------------ IPv6
  // Bewusst einfach gehalten: Alle Geräte bekommen ihre IPv6-Adressen automatisch.
  //  - Link-Local (fe80::…): hat jedes Gerät, gilt nur im eigenen Netz, wird nie weitergeleitet.
  //  - Global (2001:db8:…): Der Internetanbieter hat einen Adressbereich /48. Jeder Router an seiner
  //    Leitung bekommt daraus ein eigenes Netz /64 für das Heimnetz; die Geräte bilden ihre Adresse
  //    daraus selbst (SLAAC). Server direkt beim Anbieter liegen in dessen Netz (Subnetz 0).
  //  Es gibt kein NAT: Jedes Gerät ist mit seiner eigenen Adresse weltweit erreichbar.
  //  2001:db8::/32 ist der für Beispiele reservierte Bereich – keine echten Adressen.
  const B16 = 16n, B64 = 64n, M64 = (1n << 64n) - 1n;
  const LL_NET = 0xfe80n << 112n;
  const DOC_NET = (0x2001n << 112n) | (0x0db8n << 96n);

  /** IPv6-Adresse als Text → BigInt (oder null). Erlaubt die Kurzschreibweise mit „::". */
  function parseIP6(s) {
    if (typeof s !== 'string') return null;
    s = s.trim().replace(/^\[|\]$/g, '').toLowerCase();
    if (!/^[0-9a-f:]+$/.test(s) || !s.includes(':')) return null;
    const parts = s.split('::');
    if (parts.length > 2) return null;
    const grp = x => x === '' ? [] : x.split(':');
    const head = grp(parts[0]), tail = parts.length === 2 ? grp(parts[1]) : [];
    if (head.concat(tail).some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    let groups;
    if (parts.length === 2) {
      const fill = 8 - head.length - tail.length;
      if (fill < 1) return null;
      groups = head.concat(Array(fill).fill('0'), tail);
    } else groups = head;
    if (groups.length !== 8) return null;
    return groups.reduce((n, g) => (n << B16) | BigInt(parseInt(g, 16)), 0n);
  }

  /** BigInt → IPv6-Adresse in Kurzschreibweise (führende Nullen weg, längste Nullfolge als „::"). */
  function ip6Str(n) {
    const g = [];
    for (let i = 7; i >= 0; i--) g.push(Number((n >> BigInt(i * 16)) & 0xffffn));
    let bs = -1, bl = 0;
    for (let i = 0; i < 8;) {
      if (g[i] !== 0) { i++; continue; }
      let j = i; while (j < 8 && g[j] === 0) j++;
      if (j - i > bl && j - i >= 2) { bs = i; bl = j - i; }
      i = j;
    }
    const hex = a => a.map(x => x.toString(16)).join(':');
    return bs < 0 ? hex(g) : hex(g.slice(0, bs)) + '::' + hex(g.slice(bs + bl));
  }

  /** Netz /64 einer Adresse als Text, z. B. 2001:db8:1:1::/64 */
  function net6Str(n, prefix) { return ip6Str(n & ~((1n << BigInt(128 - (prefix || 64))) - 1n)) + '/' + (prefix || 64); }

  function isLinkLocal6(n) { return n !== null && (n >> 118n) === (0xfe80n >> 6n); }

  /** Schnittstellen-Kennung (hintere 64 Bit), gleichbleibend je Gerät und Anschluss. */
  function ifaceId(d, k) {
    let h1 = 2166136261, h2 = 5381;
    const s = d.id + ':' + (k || 0);
    for (const ch of s) { const c = ch.charCodeAt(0); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; }
    // jede Vierergruppe ungleich 0, damit die Adresse nicht unerwartet abgekürzt wird
    const grp = x => BigInt((x % 0xefff) + 0x1000);
    return (grp(h1 >>> 16) << 48n) | (grp(h1 & 0xffff) << 32n) | (grp(h2 >>> 16) << 16n) | grp(h2 & 0xffff);
  }

  /** Nummer des Adressbereichs je Internetanbieter (1, 2, …), möglichst passend zur IPv4-Reihenfolge. */
  function ispNumbers(net) {
    const isps = net.devices.filter(d => TYPES[d.type].isp);
    const num = new Map(), used = new Set();
    for (const d of isps) {
      const k = ISP_NETS.indexOf((d.ip || '').trim().split('.').slice(0, 3).join('.')) + 1;
      if (k > 0 && !used.has(k)) { num.set(d.id, k); used.add(k); }
    }
    let next = 1;
    for (const d of isps) if (!num.has(d.id)) { while (used.has(next)) next++; num.set(d.id, next); used.add(next); }
    return num;
  }

  /**
   * Alle IPv6-Adressen im Netzwerk. Schlüssel: "Geräte-ID:Schnittstelle" (Endgerät/Anbieter 0, Router WAN 0 / LAN 1).
   * Wert: {ll, gua, net64, isp, lanNet} – gua/net64 sind null, wenn es keine globale Adresse gibt.
   * Bei Routern steht am LAN zusätzlich das Netz für das Heimnetz (lanNet).
   */
  function ip6Map(net) {
    const map = new Map();
    const put = (d, i, extra) => {
      const key = d.id + ':' + i;
      if (!map.has(key)) map.set(key, { ll: LL_NET | ifaceId(d, i), gua: null, net64: null, isp: null });
      return Object.assign(map.get(key), extra || {});
    };
    for (const d of net.devices) {
      const t = TYPES[d.type];
      if (t.host || t.isp) put(d, 0);
      if (t.router) IFACES.forEach(i => put(d, i));
    }
    const nums = ispNumbers(net);
    for (const isp of net.devices.filter(d => TYPES[d.type].isp)) {
      const base = DOC_NET | (BigInt(nums.get(isp.id)) << 80n);
      put(isp, 0, { gua: base | 1n, net64: base, isp: isp.id, isp48: base });
      let sub = 0;
      for (const e of l2Endpoints(net, isp.id, 0)) {
        const t = TYPES[e.dev.type];
        if (t.isp) continue;
        if (t.host) { const x = put(e.dev, 0); if (x.gua === null) Object.assign(x, { gua: base | ifaceId(e.dev, 0), net64: base, isp: isp.id }); }
        if (t.router && e.port === WAN) {
          const w = put(e.dev, WAN);
          if (w.gua !== null) continue;
          sub++;
          const lan = base | (BigInt(sub) << B64);
          Object.assign(w, { gua: base | ifaceId(e.dev, WAN), net64: base, isp: isp.id });
          put(e.dev, LAN, { gua: lan | 1n, net64: lan, isp: isp.id, lanNet: lan });
        }
      }
    }
    // Endgeräte im Heimnetz bilden ihre Adresse aus dem Netz, das der Router bekanntgibt (SLAAC)
    for (const r of net.devices.filter(d => TYPES[d.type].router)) {
      const L = map.get(r.id + ':' + LAN);
      if (!L || L.lanNet == null) continue;
      for (const e of l2Endpoints(net, r.id, LAN)) {
        if (!TYPES[e.dev.type].host) continue;
        const x = put(e.dev, 0);
        if (x.gua === null) Object.assign(x, { gua: L.lanNet | ifaceId(e.dev, 0), net64: L.lanNet, isp: L.isp, router: r.id });
      }
    }
    return map;
  }

  /** IPv6-Adressen eines Geräts als Text: {ll, gua, net, lanNet, fromRouter} (gua/net leer, wenn es keine globale gibt). */
  function ip6Of(net, d, port) {
    const i = TYPES[d.type].router ? iface(port || 0) : 0;
    const x = ip6Map(net).get(d.id + ':' + i);
    if (!x) return null;
    return { ll: ip6Str(x.ll), gua: x.gua === null ? '' : ip6Str(x.gua), net: x.net64 === null ? '' : net6Str(x.net64), lanNet: x.lanNet == null ? '' : net6Str(x.lanNet), fromRouter: !!x.router };
  }

  /**
   * Weg eines IPv6-Pakets von einem Endgerät zu einer Adresse. Ohne NAT: Die Adressen bleiben unterwegs gleich.
   * Ergebnis wie route(): {ok, path, target, error, hint}
   */
  function route6(net, srcId, dst, map) {
    map = map || ip6Map(net);
    const src = dev(net, srcId);
    const fail = (path, error, hint) => ({ ok: false, path, error, hint: hint || '' });
    const done = (path, target) => ({ ok: true, path, target });
    if (!src || !(TYPES[src.type].host || TYPES[src.type].isp)) return fail([srcId], 'Nur Endgeräte können Pakete senden.');
    if (src.off) return fail([srcId], `${src.name} ist ausgefallen (ausgeschaltet) und kann nichts senden.`, 'Tippe das Gerät an und schalte es wieder ein.');
    if (!linksOf(net, srcId).length) return fail([srcId], `${src.name} ist mit nichts verbunden.`, TYPES[src.type].wlan && !TYPES[src.type].cable ? 'Verbinde es per WLAN mit einem Access Point.' : 'Verbinde es mit einem Kabel.');
    const me = map.get(srcId + ':0');
    if (me.ll === dst || me.gua === dst) return done([srcId], src);
    const at = (d, i) => map.get(d.id + ':' + i) || {};
    const owner = () => { for (const [k, v] of map) if (v.ll === dst || v.gua === dst) return dev(net, k.slice(0, k.lastIndexOf(':'))); return null; };
    const hitIn = (eps, key) => eps.filter(e => at(e.dev, e.port)[key] === dst);

    if (isLinkLocal6(dst)) {
      const hits = hitIn(l2Endpoints(net, srcId, 0), 'll');
      if (hits.length) return done(hits[0].path, hits[0].dev);
      const o = owner();
      return fail([srcId], `Im Netz von ${src.name} hat niemand die Adresse ${ip6Str(dst)}.`,
        activeFaults(net).length ? 'Im Netz ist gerade etwas ausgefallen (Gerät ausgeschaltet oder Kabelbruch). Behebe die Störung und versuche es erneut.' : o ? `Das ist die Link-Local-Adresse von ${o.name}. Link-Local-Adressen (fe80::…) gelten nur im eigenen Netz – Router leiten sie nie weiter. Nimm die globale Adresse.` : 'Link-Local-Adressen (fe80::…) gelten nur im eigenen Netz. Prüfe die Adresse.');
    }
    if (me.gua === null) return fail([srcId], `${src.name} hat nur eine Link-Local-Adresse (fe80::…) und erreicht damit nur Geräte im eigenen Netz.`, 'Eine globale IPv6-Adresse bekommt das Gerät automatisch, sobald es mit einem Router verbunden ist, der am Internetanbieter hängt.');
    if ((dst >> 96n) !== (DOC_NET >> 96n)) return fail([srcId], `Im Internet ist die Adresse ${ip6Str(dst)} nicht bekannt.`, 'Globale IPv6-Adressen in der NetzWerkstatt beginnen mit 2001:db8:.');

    const sameNet6 = (a, b) => a !== null && (a >> B64) === (b >> B64);
    // Zustellen im Netz eines Anbieters oder Routers
    const deliver = (d, i, path) => {
      const hits = hitIn(l2Endpoints(net, d.id, i), 'gua');
      if (hits.length) return done(path.concat(hits[0].path.slice(1)), hits[0].dev);
      return fail(path, `Im Netz ${net6Str(dst)} hat niemand die Adresse ${ip6Str(dst)}.`, 'Prüfe die Adresse. Jedes Gerät bildet seine globale Adresse selbst – schau beim Ziel nach, wie sie lautet.');
    };
    // Weiterleitung im Internet (ab einem Internetanbieter)
    const viaIsp = (isp, path) => {
      const queue = [{ d: isp, path }], seen = new Set([isp.id]);
      while (queue.length) {
        const cur = queue.shift();
        const a = at(cur.d, 0);
        if (a.gua === dst) return done(cur.path, cur.d);
        const eps = l2Endpoints(net, cur.d.id, 0);
        if (a.isp48 !== undefined && (dst >> 80n) === (a.isp48 >> 80n)) {
          if (sameNet6(a.net64, dst)) return deliver(cur.d, 0, cur.path);
          const r = eps.find(e => TYPES[e.dev.type].router && e.port === WAN && sameNet6(at(e.dev, LAN).lanNet ?? null, dst));
          if (!r) return fail(cur.path, `${cur.d.name} hat kein Heimnetz ${net6Str(dst)} vergeben.`, 'Prüfe die Adresse.');
          if (at(r.dev, LAN).gua === dst) return done(cur.path.concat(r.path.slice(1)), r.dev);
          return deliver(r.dev, LAN, cur.path.concat(r.path.slice(1)));
        }
        for (const e of eps) if (TYPES[e.dev.type].isp && !seen.has(e.dev.id)) { seen.add(e.dev.id); queue.push({ d: e.dev, path: cur.path.concat(e.path.slice(1)) }); }
      }
      return fail(path, `Im Internet ist die Adresse ${ip6Str(dst)} nicht bekannt.`, 'Ist das Ziel an einen Internetanbieter angeschlossen? Verschiedene Internetanbieter müssen miteinander verbunden sein.');
    };

    const eps = l2Endpoints(net, srcId, 0);
    if (me.router) {
      if (sameNet6(me.net64, dst)) return deliver(src, 0, [srcId]);
      // Gateway ist der Router, der das Heimnetz bekanntgibt
      const gwE = eps.find(e => e.dev.id === me.router && e.port === LAN);
      if (!gwE) return fail([srcId], `Der Router von ${src.name} ist nicht erreichbar.`, 'Ist ein Kabel kaputt oder der Router ausgefallen?');
      const path = gwE.path;
      if (at(gwE.dev, WAN).gua === dst) return done(path, gwE.dev);
      const ispE = l2Endpoints(net, me.router, WAN).find(e => e.dev.id === me.isp);
      if (!ispE) return fail(path, `${gwE.dev.name} ist nicht mehr mit dem Internetanbieter verbunden.`);
      return viaIsp(ispE.dev, path.concat(ispE.path.slice(1)));
    }
    const ispE = eps.find(e => e.dev.id === me.isp);
    if (ispE) return viaIsp(ispE.dev, ispE.path);
    return viaIsp(src, [srcId]);
  }

  /** Ping per IPv6 (ICMPv6). Die Antwort nimmt denselben Weg zurück – ohne Adressübersetzung. */
  function ping6(net, srcId, dstText) {
    const src = dev(net, srcId);
    const dst = parseIP6(dstText || '');
    if (dst === null) return { ok: false, steps: [], error: `„${dstText || ''}" ist keine gültige IPv6-Adresse.`, hint: 'Eine IPv6-Adresse besteht aus acht Blöcken mit je vier Hexadezimalziffern (0–9, a–f), getrennt durch Doppelpunkte. „::" steht für mehrere Blöcke nur aus Nullen.' };
    const map = ip6Map(net);
    const rt = route6(net, srcId, dst, map);
    const steps = [{ kind: 'request', label: 'Ping-Anfrage', proto: 'ICMPv6 · IPv6', text: `${src.name} → ${ip6Str(dst)}: „Bist du da?"`, path: rt.path, ok: rt.ok }];
    if (!rt.ok) return { ok: false, steps, error: rt.error, hint: rt.hint, v6: true };
    steps[0] = busSpread(net, steps[0]);
    const me = map.get(srcId + ':0');
    const from = isLinkLocal6(dst) ? me.ll : me.gua;
    steps.push({ kind: 'response', label: 'Ping-Antwort', proto: 'ICMPv6 · IPv6', text: `${rt.target.name} → ${ip6Str(from)}: „Ja, ich bin da!"`, path: rt.path.slice().reverse(), ok: true });
    const viaRouter = rt.path.some(id => { const d = dev(net, id); return d && TYPES[d.type].router; }) && !isLinkLocal6(dst);
    return { ok: true, steps, target: rt.target.id, v6: true, linkLocal: isLinkLocal6(dst), seenSrc: ip6Str(from), viaRouter };
  }

  // ------------------------------------------------------------------ Dateien teilen: Peer-to-Peer und Client-Server
  /** Eigene Dateien eines Endgeräts (fehlen bei älteren Netzen). */
  function filesOf(d) {
    if (!Array.isArray(d.files)) d.files = [];
    return d.files;
  }

  /** Dateiablage (Cloud-Speicher) eines Servers oder null. */
  function fileStore(d) {
    if (!d || !d.services) return null;
    if (!d.services.files) d.services.files = { on: false, files: [] };
    if (!Array.isArray(d.services.files.files)) d.services.files.files = [];
    return d.services.files;
  }

  /** Legt auf einem Endgerät eine neue Datei an und liefert ihren Namen. */
  function newFile(d) {
    const files = filesOf(d);
    let name = `Foto von ${d.name}.jpg`;
    for (let i = 2; files.includes(name); i++) name = `Foto ${i} von ${d.name}.jpg`;
    files.push(name);
    return name;
  }

  /** Was ein Gerät anbietet: Ein Server mit Dateiablage (Client-Server) oder ein Endgerät mit eingeschaltetem Peer-to-Peer. */
  function fileRole(d) {
    if (!d || !TYPES[d.type].host) return null;
    if (TYPES[d.type].services) return 'server';
    return 'peer';
  }

  /**
   * Gemeinsamer Ablauf für Senden und Holen: Hin- und Rückweg prüfen und den Partner bestimmen.
   * Liefert {ok, rt, target, mode, error, hint}. mode: 'server' (Client-Server) oder 'p2p'.
   */
  function fileContact(net, srcId, dstText) {
    const src = dev(net, srcId);
    const dstIP = parseIP(dstText || '');
    if (dstIP === null) return { ok: false, error: `„${dstText || ''}“ ist keine gültige IPv4-Adresse.`, hint: 'Tippe unten auf ein Gerät, um seine Adresse einzutragen.' };
    const own = ifaceAddr(src, 0);
    if (own && own.ip === dstIP) return { ok: false, error: `Das ist die eigene Adresse von ${src.name}.`, hint: 'Gib die IP-Adresse eines anderen Geräts ein.' };
    const rt = roundTrip(net, srcId, dstIP);
    const role = rt.target ? fileRole(rt.target) : null;
    return { ok: rt.ok, rt, target: rt.target || null, mode: role === 'server' ? 'server' : 'p2p', error: rt.error, hint: rt.hint };
  }

  /** Prüft, ob der Partner beim Dateitausch mitmacht. Liefert null oder {error, hint, reply}. */
  function fileRefusal(target) {
    const role = fileRole(target);
    if (!role) return { error: `${target.name} ist kein Endgerät und kann keine Dateien speichern.`, hint: 'Dateien tauschen Endgeräte (Peer-to-Peer) oder Endgeräte mit einem Server (Client-Server).' };
    if (role === 'server' && !fileStore(target).on)
      return { error: `Auf ${target.name} läuft keine Dateiablage.`, hint: `Tippe ${target.name} an und schalte bei den Diensten die Dateiablage (Cloud-Speicher) ein.`, reply: 'Hier gibt es keine Dateiablage.' };
    if (role === 'peer' && !target.share)
      return { error: `${target.name} macht beim Peer-to-Peer-Dateitausch nicht mit.`, hint: `Bei Peer-to-Peer ist jedes Gerät zugleich Client und Server. Tippe ${target.name} an und schalte „Dateien direkt tauschen (Peer-to-Peer)“ ein.`, reply: 'Ich tausche keine Dateien direkt.' };
    return null;
  }

  const FILE_PROTO = 'TCP';

  /**
   * Schickt eine Datei an ein anderes Gerät: an einen Server mit Dateiablage (Hochladen, Client-Server)
   * oder direkt an ein Endgerät (Peer-to-Peer). Bei Erfolg liegt die Datei danach beim Empfänger.
   * Ergebnis: {ok, steps, mode, target, error, hint}
   */
  function sendFile(net, srcId, dstText, file) {
    const src = dev(net, srcId);
    const steps = [];
    const res = (ok, extra) => Object.assign({ ok, steps }, extra);
    if (!src || !TYPES[src.type].host) return res(false, { error: 'Nur Endgeräte können Dateien senden.' });
    if (!file || !filesOf(src).includes(file)) return res(false, { error: `${src.name} hat diese Datei nicht.`, hint: 'Lege zuerst mit „+ Neue Datei“ eine Datei an.' });
    const c = fileContact(net, srcId, dstText);
    if (!c.rt) return res(false, { error: c.error, hint: c.hint });
    const toServer = c.mode === 'server';
    const label = toServer ? 'Hochladen' : 'Datei direkt senden';
    const note = natNote(net, c.rt, 'there');
    steps.push({ kind: 'request', label, proto: FILE_PROTO, text: `${src.name} → ${c.target ? c.target.name : dstText}: „${file}“`, note, path: c.rt.there.path, ok: c.rt.there.ok });
    if (!c.ok) {
      if (c.rt.back) steps.push({ kind: 'response', label: 'Bestätigung', proto: FILE_PROTO, text: '', path: c.rt.back.path, ok: false });
      return res(false, { error: 'Der Empfänger ist nicht erreichbar: ' + c.error, hint: c.hint + (toServer ? '' : ' Bei Peer-to-Peer muss der Empfänger gerade eingeschaltet und erreichbar sein.') });
    }
    const no = fileRefusal(c.target);
    if (no) {
      if (no.reply) steps.push({ kind: 'response', label: 'Abgelehnt', proto: FILE_PROTO, text: `${c.target.name}: „${no.reply}“`, path: c.rt.back.path, ok: true, bad: true });
      return res(false, { error: no.error, hint: no.hint, mode: c.mode, target: c.target.id });
    }
    const list = toServer ? fileStore(c.target).files : filesOf(c.target);
    if (!list.includes(file)) list.push(file);
    steps.push({ kind: 'response', label: 'Bestätigung', proto: FILE_PROTO, text: `${c.target.name}: „Datei ${file} ist angekommen.“`, note: natNote(net, c.rt, 'back'), path: c.rt.back.path, ok: true });
    return res(true, { mode: c.mode, target: c.target.id, files: [file] });
  }

  /**
   * Holt alle Dateien, die ein anderes Gerät anbietet und die man selbst noch nicht hat:
   * von einem Server mit Dateiablage (Herunterladen, Client-Server) oder direkt von einem Endgerät (Peer-to-Peer).
   * Ergebnis: {ok, steps, mode, target, files, error, hint}
   */
  function getFiles(net, srcId, dstText) {
    const src = dev(net, srcId);
    const steps = [];
    const res = (ok, extra) => Object.assign({ ok, steps }, extra);
    if (!src || !TYPES[src.type].host) return res(false, { error: 'Nur Endgeräte können Dateien holen.' });
    const c = fileContact(net, srcId, dstText);
    if (!c.rt) return res(false, { error: c.error, hint: c.hint });
    const fromServer = c.mode === 'server';
    steps.push({ kind: 'request', label: fromServer ? 'Download-Anfrage' : 'Anfrage (Peer-to-Peer)', proto: FILE_PROTO, text: `${src.name} → ${c.target ? c.target.name : dstText}: „Welche Dateien hast du für mich?“`, note: natNote(net, c.rt, 'there'), path: c.rt.there.path, ok: c.rt.there.ok });
    if (!c.ok) {
      if (c.rt.back) steps.push({ kind: 'response', label: 'Dateien', proto: FILE_PROTO, text: '', path: c.rt.back.path, ok: false });
      return res(false, { error: 'Das andere Gerät ist nicht erreichbar: ' + c.error, hint: c.hint + (fromServer ? '' : ' Bei Peer-to-Peer muss das andere Gerät gerade eingeschaltet und erreichbar sein.') });
    }
    const no = fileRefusal(c.target);
    if (no) {
      if (no.reply) steps.push({ kind: 'response', label: 'Abgelehnt', proto: FILE_PROTO, text: `${c.target.name}: „${no.reply}“`, path: c.rt.back.path, ok: true, bad: true });
      return res(false, { error: no.error, hint: no.hint, mode: c.mode, target: c.target.id });
    }
    const offer = fromServer ? fileStore(c.target).files : filesOf(c.target);
    const mine = filesOf(src);
    const got = offer.filter(f => !mine.includes(f));
    if (!got.length) {
      steps.push({ kind: 'response', label: 'Dateien', proto: FILE_PROTO, text: `${c.target.name}: „Ich habe keine neuen Dateien für dich.“`, path: c.rt.back.path, ok: true, bad: true });
      return res(false, { error: `${c.target.name} hat keine Dateien, die ${src.name} noch nicht hat.`, hint: fromServer ? 'Lade zuerst von einem anderen Gerät eine Datei auf den Server hoch.' : `Lege zuerst auf ${c.target.name} eine Datei an.`, mode: c.mode, target: c.target.id });
    }
    got.forEach(f => mine.push(f));
    steps.push({ kind: 'response', label: fromServer ? 'Herunterladen' : 'Datei (Peer-to-Peer)', proto: FILE_PROTO, text: `${c.target.name} → ${src.name}: ${got.map(f => '„' + f + '“').join(', ')}`, note: natNote(net, c.rt, 'back'), path: c.rt.back.path, ok: true });
    return res(true, { mode: c.mode, target: c.target.id, files: got });
  }

  // ------------------------------------------------------------------ Bluetooth (PAN)
  /** Bluetooth-Partner eines Geräts. */
  function btPartners(net, id) {
    return allLinksOf(net, id).filter(l => l.kind === 'bluetooth').map(l => dev(net, l.a === id ? l.b : l.a)).filter(Boolean);
  }

  /** Spielt Musik vom Gerät auf gekoppelten Bluetooth-Kopfhörern ab. Ergebnis: {ok, steps, target, error, hint} */
  function playMusic(net, srcId) {
    const src = dev(net, srcId);
    const hs = src ? btPartners(net, srcId).find(d => TYPES[d.type].btOnly) : null;
    if (!hs) return { ok: false, steps: [], error: `${src ? src.name : 'Das Gerät'} ist mit keinen Kopfhörern gekoppelt.`, hint: 'Nimm das Werkzeug „Bluetooth“ und tippe auf das Gerät und auf die Kopfhörer.' };
    const step = { kind: 'request', label: 'Musik', proto: 'Bluetooth · Funk', text: `${src.name} → ${hs.name}: Musik wird abgespielt ♪`, path: [src.id, hs.id], ok: true };
    return { ok: true, steps: [step], target: hs.id };
  }

  // ------------------------------------------------------------------ Netzarten (PAN, LAN, MAN, WAN)
  const NET_KINDS = {
    PAN: { name: 'Personal Area Network', text: 'Ein persönliches Netz: Die Geräte einer Person verbinden sich auf wenige Meter, meist per Bluetooth – z. B. Smartphone und Kopfhörer.' },
    LAN: { name: 'Local Area Network', text: 'Ein lokales Netz in einem Raum oder Gebäude, z. B. das Heimnetz oder der Computerraum. Die Geräte hängen per Kabel an einem Switch oder per WLAN an einem Access Point.' },
    MAN: { name: 'Metropolitan Area Network', text: 'Ein Stadtnetz: Es verbindet mehrere lokale Netze innerhalb einer Stadt über einige Kilometer, z. B. Schulgebäude über eine Glasfaserleitung.' },
    WAN: { name: 'Wide Area Network', text: 'Ein Weitverkehrsnetz verbindet Netze über große Entfernungen – Länder und Kontinente. Das Internet ist das größte WAN; der Zugang führt über den Internetanbieter.' },
  };

  function andList(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' und ' + list[list.length - 1]; }

  /** Teilt Geräte entlang der gegebenen Verbindungen in zusammenhängende Gruppen auf. */
  function groups(ids, edges) {
    const nb = new Map(ids.map(id => [id, []]));
    for (const [a, b] of edges) if (nb.has(a) && nb.has(b)) { nb.get(a).push(b); nb.get(b).push(a); }
    const seen = new Set(), out = [];
    for (const id of ids) {
      if (seen.has(id) || !nb.get(id).length) continue;
      const g = [], stack = [id];
      seen.add(id);
      while (stack.length) { const x = stack.pop(); g.push(x); for (const y of nb.get(x)) if (!seen.has(y)) { seen.add(y); stack.push(y); } }
      out.push(g);
    }
    return out;
  }

  /**
   * Erkennt die Netzarten in einem Aufbau.
   * Ergebnis: [{kind:'PAN'|'LAN'|'MAN'|'WAN', devices:[IDs], why}] – sortiert von klein nach groß.
   */
  function netKinds(net) {
    const out = [];
    const ids = net.devices.map(d => d.id);
    const T = id => TYPES[(dev(net, id) || {}).type] || {};
    const name = id => (dev(net, id) || {}).name;
    // PAN: Bluetooth-Kopplungen
    const bt = net.links.filter(l => l.kind === 'bluetooth');
    for (const g of groups(ids, bt.map(l => [l.a, l.b])))
      out.push({ kind: 'PAN', devices: g, why: `${andList(g.map(name))} sind per Bluetooth gekoppelt.` });
    // LAN: lokale Verbindungen (ohne Stadtleitungen, ohne Internetanbieter, ohne Internet-Anschluss eines Routers)
    const isWanEnd = (l, id) => T(id).router && l[l.a === id ? 'aPort' : 'bPort'] !== undefined && iface(l[l.a === id ? 'aPort' : 'bPort']) === WAN;
    const local = net.links.filter(l => l.kind !== 'bluetooth' && !l.stadt && !T(l.a).isp && !T(l.b).isp && !isWanEnd(l, l.a) && !isWanEnd(l, l.b));
    const lans = groups(ids, local.map(l => [l.a, l.b]));
    const lanOf = new Map();
    lans.forEach((g, i) => {
      g.forEach(id => lanOf.set(id, i));
      const named = g.filter(id => !T(id).l2);
      out.push({ kind: 'LAN', devices: g, why: `Lokales Netz aus ${andList((named.length ? named : g).map(name))}.` });
    });
    // MAN: Glasfaserleitungen quer durch die Stadt verbinden lokale Netze
    const stadt = net.links.filter(l => l.kind === 'kabel' && l.stadt && !T(l.a).isp && !T(l.b).isp);
    for (const g of groups(ids, stadt.map(l => [l.a, l.b]))) {
      const lanIdx = new Set(g.map(id => lanOf.get(id)).filter(i => i !== undefined));
      const all = new Set(g);
      lanIdx.forEach(i => lans[i].forEach(id => all.add(id)));
      out.push({ kind: 'MAN', devices: [...all], why: `Eine Glasfaserleitung durch die Stadt verbindet ${lanIdx.size >= 2 ? lanIdx.size + ' lokale Netze' : andList(g.map(name))}.` });
    }
    // WAN: Internetanbieter mit Anschlüssen
    const isps = net.devices.filter(d => TYPES[d.type].isp && linksOf(net, d.id).length);
    if (isps.length) {
      const all = new Set();
      for (const p of isps) { all.add(p.id); for (const l of linksOf(net, p.id)) all.add(l.a === p.id ? l.b : l.a); }
      const many = isps.filter(p => linksOf(net, p.id).some(l => T(l.a === p.id ? l.b : l.a).isp)).length >= 2;
      out.push({ kind: 'WAN', devices: [...all], why: many ? 'Mehrere Internetanbieter sind miteinander verbunden – zusammen bilden sie das Internet, das größte WAN.' : `Über ${isps.map(p => p.name).join(', ')} geht es ins Internet, das größte WAN.` });
    }
    return out;
  }

  // ------------------------------------------------------------------ Ereignisse
  function logEvent(net, ev) {
    if (!net.events) net.events = [];
    net.events.push(Object.assign({ t: Date.now() }, ev));
    if (net.events.length > 40) net.events.splice(0, net.events.length - 40);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  const NW = {
    TYPES, DESCRIPTIONS, parseIP, ipStr, parseMask, sameNet, netStr, ipProblem, isPrivate,
    emptyNetwork, createDevice, dev, linksOf, portOf, canLink, addLink, removeDevice, removeLink,
    allLinksOf, filesOf, fileStore, newFile, sendFile, getFiles, btPartners, playMusic, NET_KINDS, netKinds,
    ifaceAddr, l2Endpoints, route, roundTrip, ping, browse, parseURL, logEvent, topology, topologies, TOPOLOGY_INFO, ringOf, activeFaults, setFault, clone, newId,
    useService, SERVICES, ACTIONS, defaultServices, svcOn, linkBetween,
    parseIP6, ip6Str, net6Str, isLinkLocal6, ip6Map, ip6Of, route6, ping6,
    dhcpOf, dhcpRange, dhcpDefaultRange, dhcp, applyLease, refreshDns, suggest, suggestPortIP, iface, ifaceName, replug, WAN, LAN, wlanHub, setRouterWlan, isApipa, setModem, ispOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NW;
  else root.NW = NW;
})(typeof window !== 'undefined' ? window : globalThis);

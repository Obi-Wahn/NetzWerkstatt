/* NetzWerkstatt – Darstellung eines Netzwerks als SVG (für Schüler- und Lehreransicht) */
(function (root) {
  'use strict';
  const NW = root.NW;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const WORLD = { w: 900, h: 560 };
  const BOX = { w: 78, h: 62 };
  const BUS = { w: 320, h: 26 }; // Das Bus-Kabel wird als lange Leitung gezeichnet

  // Einfache Symbole, gezeichnet in einem 40×40-Feld
  const ICONS = {
    pc: '<rect x="4" y="5" width="32" height="22" rx="2"/><path d="M15 33h10M20 27v6"/><path d="M8 9h24v14H8z" class="fill"/>',
    laptop: '<rect x="8" y="7" width="24" height="17" rx="1.5"/><rect x="11" y="10" width="18" height="11" class="fill"/><path d="M3 30h34l-3-6H6z"/><path d="M17 27h6"/>',
    tablet: '<rect x="9" y="3" width="22" height="34" rx="3"/><rect x="12" y="7" width="16" height="24" class="fill"/><circle cx="20" cy="34" r="1"/>',
    smartphone: '<rect x="12" y="3" width="16" height="34" rx="3"/><rect x="14.5" y="7" width="11" height="24" class="fill"/><path d="M18 34.5h4"/>',
    server: '<rect x="7" y="3" width="26" height="10" rx="1.5"/><rect x="7" y="15" width="26" height="10" rx="1.5"/><rect x="7" y="27" width="26" height="10" rx="1.5"/><path d="M11 8h2M11 20h2M11 32h2M22 8h7M22 20h7M22 32h7"/>',
    switch: '<rect x="3" y="11" width="34" height="18" rx="2"/><path d="M8 24v-3M13 24v-3M18 24v-3M23 24v-3M28 24v-3M33 24v-3"/><path d="M8 16h8l-2-2M32 16h-8l2 2"/>',
    ap: '<rect x="8" y="25" width="24" height="9" rx="2"/><path d="M20 25v-6"/><path d="M14 15a8 8 0 0 1 12 0M10.5 11.5a13 13 0 0 1 19 0"/><circle cx="20" cy="19" r="1.5"/>',
    router: '<circle cx="20" cy="20" r="15"/><path d="M20 8v9M20 32v-9M8 20h9M32 20h-9"/><path d="M17 11l3-3 3 3M17 29l3 3 3-3M11 17l-3 3 3 3M29 17l3 3-3 3"/>',
    headset: '<path d="M7 25v-5a13 13 0 0 1 26 0v5"/><rect x="5" y="23" width="7" height="12" rx="3" class="fill"/><rect x="5" y="23" width="7" height="12" rx="3"/><rect x="28" y="23" width="7" height="12" rx="3" class="fill"/><rect x="28" y="23" width="7" height="12" rx="3"/>',
    isp: '<circle cx="20" cy="20" r="15"/><path d="M5 20h30M20 5a22 22 0 0 1 0 30M20 5a22 22 0 0 0 0 30M8 12h24M8 28h24"/>',
    rz: '<rect x="6" y="4" width="28" height="32" rx="2"/><path d="M10 9h20v6H10zM10 18h20v6H10zM10 27h20v6H10z" class="fill"/><path d="M13 12h2M13 21h2M13 30h2M20 12h7M20 21h7M20 30h7"/>',
    bus: '<path d="M3 20h34"/><path d="M3 15v10M37 15v10"/><path d="M11 20v-9M20 20v9M29 20v-9"/><circle cx="11" cy="10" r="2"/><circle cx="20" cy="30" r="2"/><circle cx="29" cy="10" r="2"/>',
    cloud: '<path d="M11 30h19a7 7 0 0 0 0-14 9 9 0 0 0-17-2 7.5 7.5 0 0 0-2 16z"/>',
  };

  function el(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function iconSVG(type, size) {
    return `<svg viewBox="0 0 40 40" width="${size || 32}" height="${size || 32}" class="icon" aria-hidden="true">${ICONS[type] || ''}</svg>`;
  }

  function hostLabel(d) {
    const t = NW.TYPES[d.type];
    if (t.host) return d.ip && d.ip.trim() ? d.ip.trim() : (d.dhcp ? 'DHCP: keine IP' : 'keine IP');
    if (t.isp) return d.ip && d.ip.trim() ? d.ip.trim() : 'keine IP';
    if (t.router) return '';
    return '';
  }

  /** Namen der eingeschalteten Dienste eines Servers (z. B. www.meineseite.de) als zweite Zeile, sonst ''. */
  function serverNames(d) {
    if (!d.services) return '';
    const names = [...new Set(NW.NAMED_SERVICES.filter(k => NW.svcOn(d, k) && NW.validHost(NW.svcHost(d, k))).map(k => NW.svcHost(d, k)))];
    return names.length ? names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '') : '';
  }

  /** Beschriftung unter einem Router: Adresse im Heimnetz (LAN) und ggf. am Internet-Anschluss (WAN). */
  function routerLabels(d) {
    const lan = d.ports[NW.LAN], wan = d.ports[NW.WAN];
    const out = [];
    const lip = lan.ip && lan.ip.trim();
    out.push(lip ? lip + (lan.dhcp && lan.dhcp.on ? ' · DHCP' : '') : 'LAN: keine IP');
    if (wan.ip && wan.ip.trim()) out.push('extern ' + wan.ip.trim());
    return out;
  }

  /** Beschriftung in der IPv6-Ansicht: globale Adresse, sonst die Link-Local-Adresse. */
  function v6Labels(d, map) {
    const t = NW.TYPES[d.type];
    const one = i => { const x = map.get(d.id + ':' + i); return x ? NW.ip6Str(x.gua !== null ? x.gua : x.ll) : ''; };
    if (t.host || t.isp) return [one(0)];
    if (t.router) { const w = map.get(d.id + ':' + NW.WAN); return [one(NW.LAN)].concat(w && w.gua !== null ? ['extern ' + NW.ip6Str(w.gua)] : []); }
    return [];
  }

  const isBus = d => d && NW.TYPES[d.type] && NW.TYPES[d.type].bus;

  /** Punkt, an dem eine Verbindung an einem Gerät ankommt (beim Bus-Kabel: senkrecht darüber oder darunter). */
  function anchor(d, toward) {
    if (!isBus(d) || !toward) return { x: d.x, y: d.y };
    const half = BUS.w / 2 - 14;
    return { x: Math.max(d.x - half, Math.min(d.x + half, toward.x)), y: d.y };
  }

  /** Kurztext für die erkannten Topologien, z. B. „Stern · Ring (unterbrochen)". */
  function topoLabel(net) {
    const list = NW.topologies(net);
    if (!list.length) return null;
    const names = { stern: 'Stern', bus: 'Bus', ring: 'Ring' };
    const parts = [];
    for (const kind of ['stern', 'bus', 'ring']) {
      const ts = list.filter(t => t.kind === kind);
      if (!ts.length) continue;
      const bad = ts.filter(t => !t.ok);
      let txt = (ts.length > 1 ? ts.length + ' × ' : '') + names[kind];
      if (bad.length) txt += ' (' + (bad[0].problem === 'nicht geschlossen' ? 'nicht geschlossen' : 'gestört') + ')';
      parts.push(txt);
    }
    return { text: 'Topologie: ' + parts.join(' · '), bad: list.some(t => !t.ok) };
  }

  /**
   * Zeichnet ein Netzwerk in ein <svg>.
   * opts: { selected, pending, highlight:Set, interactive, v6 }  (v6: IPv6-Adressen statt IPv4 anzeigen)
   */
  function render(svg, net, opts) {
    opts = opts || {};
    svg.setAttribute('viewBox', `0 0 ${WORLD.w} ${WORLD.h}`);
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: 'grid', width: 30, height: 30, patternUnits: 'userSpaceOnUse' }, defs);
    el('circle', { cx: 1, cy: 1, r: 1, class: 'grid-dot' }, pat);
    el('rect', { x: 0, y: 0, width: WORLD.w, height: WORLD.h, fill: 'url(#grid)', class: 'bg', 'data-bg': '1' }, svg);

    const gLinks = el('g', { class: 'links' }, svg);
    const gDevs = el('g', { class: 'devices' }, svg);
    el('g', { class: 'overlay' }, svg);

    for (const l of net.links) {
      const a = NW.dev(net, l.a), b = NW.dev(net, l.b);
      if (!a || !b) continue;
      const g = el('g', { class: 'link ' + l.kind + (opts.selected === l.id ? ' selected' : '') + (l.broken ? ' broken' : '') + (l.stadt ? ' stadt' : '') + (l.loss ? ' lossy' : ''), 'data-link': l.id }, gLinks);
      const pa = anchor(a, b), pb = anchor(b, a);
      el('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: 'hit' }, g);
      // Kabel steckt nicht richtig (Fehlersuche): Am losen Ende bleibt eine Lücke, der Stecker hängt davor
      let wa = pa, wb = pb;
      if (l.unplugged && l.kind === 'kabel') {
        const atA = l.unplugged === 'a', from = atA ? pa : pb, to = atA ? pb : pa;
        const k = Math.min(0.4, 36 / Math.max(1, Math.hypot(to.x - from.x, to.y - from.y)));
        const q = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        if (atA) wa = q; else wb = q;
      }
      el('line', { x1: wa.x, y1: wa.y, x2: wb.x, y2: wb.y, class: 'wire' }, g);
      if (wa !== pa || wb !== pb) el('circle', { cx: (wa !== pa ? wa : wb).x, cy: (wa !== pa ? wa : wb).y, r: 5, class: 'plug-end' }, g);
      if (l.loss && !l.broken) {
        // Gestörte Verbindung: Blitz in der Mitte
        const z = el('g', { class: 'loss-badge', transform: `translate(${(pa.x + pb.x) / 2},${(pa.y + pb.y) / 2})` }, g);
        el('circle', { r: 12 }, z);
        el('path', { d: 'M2 -8L-4 1h4l-2 7 6-9h-4z' }, z);
      }
      if (l.broken) {
        // Blitz in der Mitte: Kabelbruch
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        const bm = el('g', { class: 'break-mark', transform: `translate(${mx},${my})` }, g);
        el('circle', { r: 12 }, bm);
        el('path', { d: 'M2 -8L-4 1h5l-3 8 7-10h-5l3-7z' }, bm);
      }
            // Glasfaser quer durch die Stadt: Beschriftung in der Mitte der Leitung
      if (l.stadt) {
        const txt = 'Glasfaser · Stadt';
        const lab = el('g', { class: 'port-label stadt-label' }, g);
        const w = txt.length * 6.6 + 10, x = (pa.x + pb.x) / 2, y = (pa.y + pb.y) / 2;
        el('rect', { x: x - w / 2, y: y - 9, width: w, height: 18, rx: 9 }, lab);
        el('text', { x, y: y + 4, 'text-anchor': 'middle' }, lab).textContent = txt;
      }
      // Am Router und am Switch steht am Kabelende, in welchem Anschluss es steckt (WAN, LAN 1, Port 3 …)
      if (l.kind === 'kabel') for (const [d, other] of [[a, b], [b, a]]) {
        let txt = NW.portName(net, d, l);
        if (!txt) continue;
        const wan = txt === 'WAN';
        if (wan && d.modem) txt = 'Internet';
        const w = txt.length * 6.2 + 10;
        // Schild knapp außerhalb des Geräts (unten stehen Name und Adressen) – höchstens bis zur Kabelmitte
        const dx = other.x - d.x, dy = other.y - d.y, dist = Math.max(1, Math.hypot(dx, dy));
        const ux = Math.abs(dx) / dist, uy = Math.abs(dy) / dist;
        const subs = NW.TYPES[d.type].router ? routerLabels(d) : [];
        const below = BOX.h / 2 + 24 + 15 * subs.length;
        // Unter dem Gerät ist der Text breiter als der Kasten
        const half = dy > 0 ? Math.max(BOX.w / 2, d.name.length * 4.5, ...subs.map(x => x.length * 3.8)) : BOX.w / 2;
        const off = Math.min((half + w / 2 + 4) / (ux || 1e-6), ((dy > 0 ? below : BOX.h / 2) + 12) / (uy || 1e-6));
        const t = Math.min(NW.portName(net, other, l) ? 0.45 : 0.7, off / dist);
        const x = d.x + dx * t, y = d.y + dy * t;
        const lab = el('g', { class: 'port-label' + (wan ? ' wan' : ' lan') }, g);
        el('rect', { x: x - w / 2, y: y - 9, width: w, height: 18, rx: 9 }, lab);
        el('text', { x, y: y + 4, 'text-anchor': 'middle' }, lab).textContent = txt;
      }
    }

    const v6map = opts.v6 ? NW.ip6Map(net) : null;
    for (const d of net.devices) {
      const cls = ['device', 'type-' + d.type];
      if (opts.selected === d.id) cls.push('selected');
      if (opts.pending === d.id) cls.push('pending');
      if (opts.highlight && opts.highlight.has(d.id)) cls.push('highlight');
      if (d.locked) cls.push('locked');
      if (d.cloud) cls.push('cloud');
      if (d.off) cls.push('off');
      if (isBus(d) && d.broken) cls.push('broken');
      const g = el('g', { class: cls.join(' '), transform: `translate(${d.x},${d.y})`, 'data-dev': d.id }, gDevs);
      if (isBus(d)) {
        // Lange Leitung mit Abschlusswiderständen an den Enden; bei Kabelbruch in der Mitte getrennt
        const hw = BUS.w / 2, hh = BUS.h / 2;
        el('rect', { x: -hw, y: -hh, width: BUS.w, height: BUS.h, rx: 8, class: 'box bus-hit' }, g);
        if (d.broken) {
          el('path', { d: `M${-hw + 8} 0H-14M14 0H${hw - 8}`, class: 'bus-line' }, g);
          const bm = el('g', { class: 'break-mark' }, g);
          el('circle', { r: 12 }, bm);
          el('path', { d: 'M2 -8L-4 1h5l-3 8 7-10h-5l3-7z' }, bm);
        } else el('path', { d: `M${-hw + 8} 0H${hw - 8}`, class: 'bus-line' }, g);
        el('rect', { x: -hw + 2, y: -7, width: 6, height: 14, rx: 2, class: 'bus-end' }, g);
        el('rect', { x: hw - 8, y: -7, width: 6, height: 14, rx: 2, class: 'bus-end' }, g);
        el('text', { x: 0, y: hh + 17, 'text-anchor': 'middle', class: 'name' }, g).textContent = d.name;
        continue;
      }
      if (d.cloud) {
        el('path', { d: 'M-50 22h96a22 22 0 0 0 4-44 30 30 0 0 0-56-10 24 24 0 0 0-44 22 16 16 0 0 0 0 32z', class: 'box' }, g);
      } else {
        el('rect', { x: -BOX.w / 2, y: -BOX.h / 2, width: BOX.w, height: BOX.h, rx: 12, class: 'box' }, g);
      }
      const icon = el('g', { class: 'glyph', transform: 'translate(-20,-22)' }, g);
      icon.innerHTML = ICONS[d.cloud ? 'cloud' : d.type];
      const name = el('text', { x: 0, y: BOX.h / 2 + 17, 'text-anchor': 'middle', class: 'name' }, g);
      name.textContent = d.name;
      const subs = d.off ? ['✕ ausgefallen'] : opts.v6 ? (v6map ? v6Labels(d, v6map) : []) : NW.TYPES[d.type].router && !d.cloud ? routerLabels(d) : [hostLabel(d), serverNames(d)].filter(Boolean);
      subs.forEach((sub, k) => {
        const s = el('text', { x: 0, y: BOX.h / 2 + 33 + k * 15, 'text-anchor': 'middle', class: 'ip' + (/keine IP|ausgefallen/.test(sub) ? ' missing' : '') }, g);
        s.textContent = sub;
      });
      if ((NW.TYPES[d.type].router || d.type === 'switch') && !d.cloud) drawSockets(g, NW.portList(net, d), d);
      if (NW.TYPES[d.type].router && d.wlan) {
        // kleines Funk-Symbol: Der Router hat eingebautes WLAN
        const wf = el('g', { class: 'wlan-badge', transform: `translate(${-BOX.w / 2 + 12},${-BOX.h / 2 + 12})` }, g);
        el('path', { d: 'M-6 0a8.5 8.5 0 0 1 12 0M-3 3a4.2 4.2 0 0 1 6 0' }, wf);
        el('circle', { cx: 0, cy: 6, r: 1.4 }, wf);
      }
      if (d.locked) {
        const lk = el('g', { class: 'lock', transform: `translate(${BOX.w / 2 - 12},${-BOX.h / 2 - 2})` }, g);
        el('circle', { cx: 6, cy: 6, r: 9 }, lk);
        el('path', { d: 'M3 6h6v5H3zM4 6V4a2 2 0 0 1 4 0v2' }, lk);
      }
    }
    if (opts.topo !== false) drawTopo(svg, net);
  }

  /** Anschlüsse als kleine Buchsen unten im Gerät: WAN farbig abgesetzt, belegte Buchsen gefüllt. */
  function drawSockets(g, ports, d) {
    // Steckt ein Kabel an diesem Gerät nicht richtig (Fehlersuche), bleibt sein Anschluss leer
    const loose = l => !!(l && l.unplugged && (l.unplugged === 'a' ? l.a : l.b) === (d && d.id));
    if (!ports.length) return;
    const sw = 6, gap = 2.5, wanGap = 6;
    const hasWan = ports.some(p => p.wan);
    const total = ports.length * sw + (ports.length - 1) * gap + (hasWan ? wanGap - gap : 0);
    let x = -total / 2;
    const row = el('g', { class: 'sockets' }, g);
    ports.forEach((p, k) => {
      const r = el('rect', { x, y: BOX.h / 2 - 12, width: sw, height: 6, rx: 1.2, class: 'sock' + (p.wan ? ' wan' : '') + (p.link && !loose(p.link) ? ' used' : '') }, row);
      el('title', {}, r).textContent = p.name + (p.other ? ': ' + p.other.name : ': frei');
      x += sw + (p.wan && k < ports.length - 1 ? wanGap : gap);
    });
  }

  /** Erkannte Topologie oben links anzeigen (antippbar für eine Erklärung). */
  function drawTopo(svg, net) {
    const t = topoLabel(net);
    if (!t) return;
    const g = el('g', { class: 'topo-badge' + (t.bad ? ' bad' : ''), 'data-topo': '1', transform: 'translate(12,12)' });
    svg.insertBefore(g, svg.querySelector('g.overlay'));
    const w = t.text.length * 7.4 + 38;
    el('rect', { x: 0, y: 0, width: w, height: 28, rx: 14 }, g);
    el('text', { x: 14, y: 19 }, g).textContent = t.text;
    el('text', { x: w - 18, y: 19, class: 'topo-info' }, g).textContent = 'ⓘ';
  }

  /** Punkt in Weltkoordinaten aus einem Pointer-Ereignis. */
  function toWorld(svg, ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  function clampPos(x, y, type) {
    const hw = type && NW.TYPES[type] && NW.TYPES[type].bus ? BUS.w / 2 : BOX.w / 2;
    return {
      x: Math.max(hw + 6, Math.min(WORLD.w - hw - 6, x)),
      y: Math.max(BOX.h / 2 + 6, Math.min(WORLD.h - BOX.h / 2 - 40, y)),
    };
  }

  /** Freie Stelle für ein neues Gerät suchen (spiralförmig um die Mitte). */
  function freeSpot(net, type) {
    const cx = WORLD.w / 2, cy = WORLD.h / 2 - 20;
    const width = d => (isBus(d) ? BUS.w : BOX.w);
    const wNew = type && NW.TYPES[type] && NW.TYPES[type].bus ? BUS.w : BOX.w;
    for (let r = 0; r < 500; r += 30) {
      for (let a = 0; a < 360; a += 30) {
        const p = clampPos(cx + r * Math.cos(a * Math.PI / 180) * 1.4, cy + r * Math.sin(a * Math.PI / 180), type);
        if (net.devices.every(d => Math.abs(d.x - p.x) > (width(d) + wNew) / 2 + 70 || Math.abs(d.y - p.y) > BOX.h + 70)) return p;
      }
    }
    return { x: cx, y: cy };
  }

  /**
   * Animiert eine Folge von Paket-Schritten.
   * steps: [{label, proto, path:[ids], ok, kind}]
   * onStep(step, index) wird beim Start jedes Schritts aufgerufen.
   * Liefert ein Promise.
   */
  function animate(svg, net, steps, onStep, speed) {
    const overlay = svg.querySelector('g.overlay');
    const hop = speed || 420;
    // Ein Schritt kann mehrere Wege gleichzeitig haben (Broadcast „an alle")
    const one = (step, path, withLabel) => new Promise(resolve => {
      // Ein Wegpunkt ist eine Geräte-ID oder {mid:[a, b]} (Mitte einer Verbindung, z. B. für verlorene Pakete)
      const devs = path.map(p => {
        if (!(p && p.mid)) return NW.dev(net, p);
        const a = NW.dev(net, p.mid[0]), b = NW.dev(net, p.mid[1]);
        if (!a || !b) return null;
        const pa = anchor(a, b), pb = anchor(b, a);
        return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      }).filter(Boolean);
      const pts = [];
      devs.forEach((d, k) => {
        if (!isBus(d)) { pts.push({ x: d.x, y: d.y }); return; }
        // Am Bus-Kabel läuft das Paket an der Leitung entlang vom Abzweig des Absenders zum Abzweig des Empfängers
        if (devs[k - 1]) pts.push(anchor(d, devs[k - 1]));
        if (devs[k + 1]) pts.push(anchor(d, devs[k + 1]));
        if (!devs[k - 1] && !devs[k + 1]) pts.push({ x: d.x, y: d.y });
      });
      const g = el('g', { class: 'packet ' + (step.kind || 'request') + (step.tcp ? ' tcp' : '') }, overlay);
      el('circle', { r: 13 }, g);
      if (withLabel) {
        const label = el('g', { class: 'packet-label' }, g);
        const txt = step.label;
        const w = txt.length * 7 + 16;
        el('rect', { x: -w / 2, y: -40, width: w, height: 22, rx: 11 }, label);
        el('text', { x: 0, y: -25, 'text-anchor': 'middle' }, label).textContent = txt;
      }
      if (pts.length < 2) {
        if (pts[0]) g.setAttribute('transform', `translate(${pts[0].x},${pts[0].y})`);
        setTimeout(() => finish(), hop);
      } else {
        const t0 = performance.now();
        const total = (pts.length - 1) * hop;
        const frame = now => {
          const t = Math.max(0, Math.min(1, (now - t0) / total));
          const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
          const f = t * (pts.length - 1) - seg;
          const a = pts[seg], b = pts[seg + 1];
          g.setAttribute('transform', `translate(${a.x + (b.x - a.x) * f},${a.y + (b.y - a.y) * f})`);
          if (t < 1) requestAnimationFrame(frame); else finish();
        };
        requestAnimationFrame(frame);
      }
      function finish() {
        if (step.ok === false) {
          g.classList.add('failed');
          const x = el('g', { class: 'fail-mark' }, g);
          el('circle', { r: 15 }, x);
          el('path', { d: 'M-6 -6L6 6M6 -6L-6 6' }, x);
          setTimeout(() => { g.remove(); resolve(); }, 1400);
        } else {
          setTimeout(() => { g.remove(); resolve(); }, 120);
        }
      }
    });
    return steps.reduce((p, step, i) => p.then(() => {
      if (onStep) onStep(step, i);
      const paths = step.paths && step.paths.length ? step.paths : [step.path];
      // Beschriftung am längsten Weg, damit sie bis zum Schluss sichtbar ist
      let li = 0;
      paths.forEach((pa, k) => { if (pa.length > paths[li].length) li = k; });
      return Promise.all(paths.map((pa, k) => one(step, pa, k === li)));
    }), Promise.resolve());
  }

  root.NWView = { render, toWorld, clampPos, freeSpot, animate, iconSVG, topoLabel, WORLD, BOX };
})(window);

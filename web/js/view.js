/* NetzWerkstatt – Darstellung eines Netzwerks als SVG (für Schüler- und Lehreransicht) */
(function (root) {
  'use strict';
  const NW = root.NW;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const WORLD = { w: 900, h: 560 };
  const BOX = { w: 78, h: 62 };

  // Einfache Symbole, gezeichnet in einem 40×40-Feld
  const ICONS = {
    pc: '<rect x="4" y="5" width="32" height="22" rx="2"/><path d="M15 33h10M20 27v6"/><path d="M8 9h24v14H8z" class="fill"/>',
    tablet: '<rect x="9" y="3" width="22" height="34" rx="3"/><rect x="12" y="7" width="16" height="24" class="fill"/><circle cx="20" cy="34" r="1"/>',
    smartphone: '<rect x="12" y="3" width="16" height="34" rx="3"/><rect x="14.5" y="7" width="11" height="24" class="fill"/><path d="M18 34.5h4"/>',
    server: '<rect x="7" y="3" width="26" height="10" rx="1.5"/><rect x="7" y="15" width="26" height="10" rx="1.5"/><rect x="7" y="27" width="26" height="10" rx="1.5"/><path d="M11 8h2M11 20h2M11 32h2M22 8h7M22 20h7M22 32h7"/>',
    switch: '<rect x="3" y="11" width="34" height="18" rx="2"/><path d="M8 24v-3M13 24v-3M18 24v-3M23 24v-3M28 24v-3M33 24v-3"/><path d="M8 16h8l-2-2M32 16h-8l2 2"/>',
    ap: '<rect x="8" y="25" width="24" height="9" rx="2"/><path d="M20 25v-6"/><path d="M14 15a8 8 0 0 1 12 0M10.5 11.5a13 13 0 0 1 19 0"/><circle cx="20" cy="19" r="1.5"/>',
    router: '<circle cx="20" cy="20" r="15"/><path d="M20 8v9M20 32v-9M8 20h9M32 20h-9"/><path d="M17 11l3-3 3 3M17 29l3 3 3-3M11 17l-3 3 3 3M29 17l3 3-3 3"/>',
    isp: '<circle cx="20" cy="20" r="15"/><path d="M5 20h30M20 5a22 22 0 0 1 0 30M20 5a22 22 0 0 0 0 30M8 12h24M8 28h24"/>',
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

  /** Beschriftung unter einem Router: Adresse im Heimnetz (LAN) und ggf. am Internet-Anschluss (WAN). */
  function routerLabels(d) {
    const lan = d.ports[NW.LAN], wan = d.ports[NW.WAN];
    const out = [];
    const lip = lan.ip && lan.ip.trim();
    out.push(lip ? lip + (lan.dhcp && lan.dhcp.on ? ' · DHCP' : '') : 'LAN: keine IP');
    if (wan.ip && wan.ip.trim()) out.push('extern ' + wan.ip.trim());
    return out;
  }

  /**
   * Zeichnet ein Netzwerk in ein <svg>.
   * opts: { selected, pending, highlight:Set, interactive }
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
      const g = el('g', { class: 'link ' + l.kind + (opts.selected === l.id ? ' selected' : ''), 'data-link': l.id }, gLinks);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hit' }, g);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'wire' }, g);
      // Kabel am Internet-Anschluss (WAN) des Routers kennzeichnen; die IP-Adressen stehen unter dem Router
      for (const [d, other, port] of [[a, b, l.aPort], [b, a, l.bPort]]) {
        if (!NW.TYPES[d.type].router || port === undefined || l.kind !== 'kabel' || NW.iface(port) !== NW.WAN) continue;
        const dist = Math.max(1, Math.hypot(other.x - d.x, other.y - d.y));
        const t = Math.min(0.5, 80 / dist);
        const x = d.x + (other.x - d.x) * t, y = d.y + (other.y - d.y) * t;
        const txt = d.modem ? 'Internet' : 'WAN';
        const lab = el('g', { class: 'port-label' }, g);
        const w = txt.length * 6.6 + 10;
        el('rect', { x: x - w / 2, y: y - 9, width: w, height: 18, rx: 9 }, lab);
        el('text', { x, y: y + 4, 'text-anchor': 'middle' }, lab).textContent = txt;
      }
    }

    for (const d of net.devices) {
      const cls = ['device', 'type-' + d.type];
      if (opts.selected === d.id) cls.push('selected');
      if (opts.pending === d.id) cls.push('pending');
      if (opts.highlight && opts.highlight.has(d.id)) cls.push('highlight');
      if (d.locked) cls.push('locked');
      if (d.cloud) cls.push('cloud');
      const g = el('g', { class: cls.join(' '), transform: `translate(${d.x},${d.y})`, 'data-dev': d.id }, gDevs);
      if (d.cloud) {
        el('path', { d: 'M-50 22h96a22 22 0 0 0 4-44 30 30 0 0 0-56-10 24 24 0 0 0-44 22 16 16 0 0 0 0 32z', class: 'box' }, g);
      } else {
        el('rect', { x: -BOX.w / 2, y: -BOX.h / 2, width: BOX.w, height: BOX.h, rx: 12, class: 'box' }, g);
      }
      const icon = el('g', { class: 'glyph', transform: 'translate(-20,-22)' }, g);
      icon.innerHTML = ICONS[d.cloud ? 'cloud' : d.type];
      const name = el('text', { x: 0, y: BOX.h / 2 + 17, 'text-anchor': 'middle', class: 'name' }, g);
      name.textContent = d.name;
      const subs = NW.TYPES[d.type].router && !d.cloud ? routerLabels(d) : [hostLabel(d)].filter(Boolean);
      subs.forEach((sub, k) => {
        const s = el('text', { x: 0, y: BOX.h / 2 + 33 + k * 15, 'text-anchor': 'middle', class: 'ip' + (/keine IP/.test(sub) ? ' missing' : '') }, g);
        s.textContent = sub;
      });
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

  function clampPos(x, y) {
    return {
      x: Math.max(BOX.w / 2 + 6, Math.min(WORLD.w - BOX.w / 2 - 6, x)),
      y: Math.max(BOX.h / 2 + 6, Math.min(WORLD.h - BOX.h / 2 - 40, y)),
    };
  }

  /** Freie Stelle für ein neues Gerät suchen (spiralförmig um die Mitte). */
  function freeSpot(net) {
    const cx = WORLD.w / 2, cy = WORLD.h / 2 - 20;
    for (let r = 0; r < 500; r += 30) {
      for (let a = 0; a < 360; a += 30) {
        const p = clampPos(cx + r * Math.cos(a * Math.PI / 180) * 1.4, cy + r * Math.sin(a * Math.PI / 180));
        if (net.devices.every(d => Math.abs(d.x - p.x) > BOX.w + 70 || Math.abs(d.y - p.y) > BOX.h + 70)) return p;
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
      const pts = path.map(id => NW.dev(net, id)).filter(Boolean).map(d => ({ x: d.x, y: d.y }));
      const g = el('g', { class: 'packet ' + (step.kind || 'request') }, overlay);
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

  root.NWView = { render, toWorld, clampPos, freeSpot, animate, iconSVG, WORLD, BOX };
})(window);

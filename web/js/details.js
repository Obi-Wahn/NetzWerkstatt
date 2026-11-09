/* NetzWerkstatt – Netzwerk genau ansehen (Musterlösung, Schülerlösung)
 *
 * Großes Fenster mit dem Bild des Netzwerks und daneben Reitern:
 *   Lösungsweg   – nur bei Musterlösungen eingebauter Aufgaben
 *   Ziele        – welche Ziele erfüllt sind (und Antworten einer Zuordnungsaufgabe)
 *   Einstellungen – alle Geräte mit Adressen, Diensten und Verbindungen
 *   Tests        – alle Pings, Seitenaufrufe, Dienste usw. mit Ergebnis
 * Ein Gerät im Bild antippen zeigt seine Einstellungen.
 */
(function (root) {
  'use strict';
  const { esc, openModal, goalsHTML } = root.NWCommon;
  const T = NW.TYPES;
  const val = s => (s || '').trim();
  const show = s => val(s) ? `<code>${esc(val(s))}</code>` : '<span class="muted">leer</span>';

  // ---------------------------------------------------------------- Einstellungen
  function linkText(net, d, l) {
    const o = NW.dev(net, l.a === d.id ? l.b : l.a);
    const kind = l.kind === 'wlan' ? 'WLAN' : l.kind === 'bluetooth' ? 'Bluetooth' : l.stadt ? 'Glasfaser' : 'Kabel';
    const st = [l.broken ? '<span class="bad">Kabelbruch</span>' : '', l.loss ? '<span class="warn">gestört</span>' : ''].filter(Boolean).join(', ');
    return `${kind} zu ${esc(o ? o.name : '?')}${st ? ' (' + st + ')' : ''}`;
  }

  function rows(list) {
    return '<dl class="det-kv">' + list.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('') + '</dl>';
  }

  function services(d) {
    const out = [];
    for (const [k, s] of Object.entries(d.services || {})) {
      if (!s || !s.on) continue;
      const info = NW.SERVICES[k];
      let label = esc(info ? info.label : k === 'files' ? 'Dateiablage' : k);
      if (val(s.host)) label += ` <code>${esc(s.host)}</code>`;
      if (k === 'dns') {
        const e = (s.entries || []).filter(x => val(x.name));
        label += e.length ? '<ul class="det-list">' + e.map(x => `<li><code>${esc(x.name)}</code> → <code>${esc(x.ip)}</code></li>`).join('') + '</ul>' : ' <span class="muted">(keine Einträge)</span>';
        if (val(s.forward)) label += ` Weiterleitung an <code>${esc(s.forward)}</code>`;
      }
      if (k === 'files' && (s.files || []).length) label += ': ' + s.files.map(esc).join(', ');
      if (k === 'mail' && (s.box || []).length) label += ` (${s.box.length} E-Mail${s.box.length === 1 ? '' : 's'} im Postfach)`;
      out.push(`<li>${label}</li>`);
    }
    return out.length ? '<ul class="det-list">' + out.join('') + '</ul>' : '<span class="muted">keine</span>';
  }

  function deviceHTML(net, d, feats) {
    const t = T[d.type] || {};
    const list = [];
    if (d.off) list.push(['Zustand', '<span class="bad">ausgefallen</span>']);
    if (t.bus && d.broken) list.push(['Zustand', '<span class="bad">Kabelbruch</span>']);
    if (t.host) {
      if (d.dhcp) list.push(['Adresse', 'automatisch (DHCP)']);
      list.push(['IP-Adresse', show(d.ip)], ['Subnetzmaske', show(d.mask)]);
      if (feats.has('gateway') || val(d.gw)) list.push(['Gateway', show(d.gw)]);
      if (feats.has('web') || val(d.dns)) list.push(['DNS-Server', show(d.dns)]);
      if (feats.has('v6')) {
        const a = NW.ip6Of(net, d, 0);
        if (a) list.push(['IPv6', `<code>${esc(a.ll)}</code>${a.gua ? `<br><code>${esc(a.gua)}</code>` : ''}`]);
      }
      if (t.services) list.push(['Dienste', services(d)]);
      else {
        if (d.share) list.push(['Peer-to-Peer', 'Dateien direkt tauschen: an']);
        if ((d.files || []).length) list.push(['Dateien', d.files.map(esc).join(', ')]);
      }
    } else if (t.router) {
      const lan = d.ports[1] || {}, wan = d.ports[0] || {};
      list.push(['Heimnetz (LAN)', `${show(lan.ip)} / ${show(lan.mask)}`]);
      if (lan.dhcp) list.push(['DHCP-Server', lan.dhcp.on ? 'an' + (val(lan.dhcp.from) ? ` (${esc(lan.dhcp.from)} bis ${esc(lan.dhcp.to)})` : '') : 'aus']);
      list.push(['WLAN', d.wlan ? 'an' : 'aus']);
      if (feats.has('internet') || val(wan.ip)) {
        list.push(['Internet (WAN)', `${show(wan.ip)}${val(wan.gw) ? ', Gateway <code>' + esc(wan.gw) + '</code>' : ''}`]);
        if (val(wan.dns)) list.push(['DNS-Server', show(wan.dns)]);
        if (feats.has('web')) list.push(['DNS-Weiterleitung', d.dnsRelay ? 'an' : 'aus']);
      }
    } else if (t.isp) {
      list.push(['Öffentliches Netz', `${show(d.ip)} / ${show(d.mask)}`]);
      if (val(d.dns)) list.push(['DNS-Server', show(d.dns)]);
    } else if (!t.btOnly) {
      list.push(['', '<span class="muted">braucht keine IP-Adresse</span>']);
    }
    const links = NW.allLinksOf(net, d.id);
    list.push(['Verbindungen', links.length ? links.map(l => linkText(net, d, l)).join('<br>') : '<span class="bad">nicht verbunden</span>']);
    const label = t.label && t.label !== d.name ? ` <span class="muted">· ${esc(t.label)}</span>` : '';
    return `<div class="det-dev${d.locked ? ' fixed' : ''}" data-det-dev="${esc(d.id)}"><h4>${esc(d.name)}${label}</h4>${rows(list)}</div>`;
  }

  function settingsHTML(net, feats) {
    if (!net.devices.length) return '<p class="muted">Noch keine Geräte.</p>';
    // Selbst gebaute oder veränderbare Geräte zuerst, fest vorgegebene (gesperrte) danach
    const list = net.devices.filter(d => !d.locked).concat(net.devices.filter(d => d.locked));
    return '<p class="muted small">Tippe im Bild ein Gerät an, um direkt zu ihm zu springen. Fest vorgegebene Geräte stehen am Ende.</p>' + list.map(d => deviceHTML(net, d, feats)).join('');
  }

  // ---------------------------------------------------------------- Tests
  function faultText(net, f) {
    const [k, id] = [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)];
    if (k === 'off') { const d = NW.dev(net, id); return `${d ? d.name : 'Gerät'} ausgefallen`; }
    if (k === 'bus') { const d = NW.dev(net, id); return `Kabelbruch in ${d ? d.name : 'Bus-Kabel'}`; }
    if (k === 'link') {
      const l = net.links.find(x => x.id === id);
      const a = l && NW.dev(net, l.a), b = l && NW.dev(net, l.b);
      return a && b ? `Kabelbruch zwischen ${a.name} und ${b.name}` : 'Kabelbruch';
    }
    return f;
  }

  function eventText(net, e) {
    const n = id => { const d = id && NW.dev(net, id); return d ? esc(d.name) : '?'; };
    const lost = e.lost ? ' – bei gestörter Verbindung' : '';
    switch (e.type) {
      case 'ping': {
        const kind = e.v6 ? (e.ll ? 'Ping per IPv6 (Link-Local)' : 'Ping per IPv6') : 'Ping';
        const to = e.target ? ` an ${n(e.target)}` : e.to ? ` an <code>${esc(e.to)}</code>` : '';
        return `${kind} von ${n(e.src)}${to}`;
      }
      case 'web': return `Webseite <code>${esc(e.host)}</code> auf ${n(e.src)} aufgerufen${lost}`;
      case 'svc': return `${esc((NW.ACTIONS[e.action] || {}).label || e.action)}: ${n(e.src)} über <code>${esc(e.host)}</code>${lost}`;
      case 'dhcp': return `${n(e.src)} hat per DHCP nach einer Adresse gefragt`;
      case 'music': return `Musik von ${n(e.src)}${e.target ? ' über ' + n(e.target) : ''}`;
      case 'file': {
        const how = e.mode === 'server' ? ' (Client-Server)' : e.mode === 'p2p' ? ' (Peer-to-Peer)' : '';
        const f = (e.files || []).length ? e.files.map(x => '„' + esc(x) + '“').join(', ') : 'Datei';
        return e.dir === 'send' ? `${f} von ${n(e.src)} an ${e.target ? n(e.target) : '?'} geschickt${how}` : `${n(e.src)} hat ${f} von ${e.target ? n(e.target) : '?'} geholt${how}`;
      }
      default: return esc(e.type);
    }
  }

  function testsHTML(net, withTime) {
    const ev = (net.events || []).slice().reverse();
    if (!ev.length) return '<p class="muted">Noch keine Tests durchgeführt (kein Ping, kein Seitenaufruf …).</p>';
    return '<p class="muted small">Neueste zuerst.</p><ul class="det-tests">' + ev.map(e => {
      const faults = (e.faults || []).length ? `<div class="small warn">während: ${e.faults.map(f => esc(faultText(net, f))).join(', ')}</div>` : '';
      const err = !e.ok && e.error ? `<div class="small muted">${esc(e.error)}</div>` : '';
      const time = withTime && e.t ? `<span class="muted small det-time">${new Date(e.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>` : '';
      return `<li class="${e.ok ? 'ok' : 'bad'}"><span class="det-mark">${e.ok ? '✓' : '✕'}</span><div>${eventText(net, e)} ${time}${faults}${err}</div></li>`;
    }).join('') + '</ul>';
  }

  // ---------------------------------------------------------------- Lösungsweg
  function wayHTML(task) {
    const w = root.NWLoesungen && root.NWLoesungen.of(task);
    if (!w) return '';
    let h = '<h4>Lösungsweg</h4><ol class="det-steps">' + w.steps.map(s => `<li>${esc(s)}</li>`).join('') + '</ol>';
    h += '<p class="muted small">Es gibt oft mehrere richtige Lösungen. Die Ziele prüfen nur, worauf es ankommt.</p>';
    if (task.think && (w.answers || []).length) {
      h += `<h4>Zum Nachdenken</h4><p class="muted">${esc(task.think)}</p><ul class="det-answers">` + w.answers.map(a => `<li>${esc(a)}</li>`).join('') + '</ul>';
    }
    return h;
  }

  // ---------------------------------------------------------------- Fenster
  /**
   * Zeigt ein Netzwerk genau an.
   * opts: { solution: true (Musterlösung: Lösungsweg zeigen, keine Uhrzeiten), intro: HTML über den Reitern }
   */
  function open(title, task, net, opts) {
    opts = opts || {};
    const feats = task && NWTasks.featuresFor ? NWTasks.featuresFor(task, net) : new Set(NWTasks.FEATURES.map(f => f.id));
    const way = opts.solution ? wayHTML(task) : '';
    const goals = task ? goalsHTML(task, net) : '';
    const tabs = [
      way && ['way', 'Lösungsweg', way],
      goals && ['goals', 'Ziele', goals],
      ['set', 'Einstellungen', settingsHTML(net, feats)],
      ['tests', `Tests (${(net.events || []).length})`, testsHTML(net, !opts.solution)],
    ].filter(Boolean);
    const body = openModal(`<h2 class="modal-title">${esc(title)}</h2>${opts.intro || ''}
      <div class="det">
        <div class="view-wrap det-view"><svg class="canvas view"></svg></div>
        <div class="det-side">
          <div class="det-tabs" role="tablist">${tabs.map(([id, label], i) => `<button type="button" class="det-tab ${i ? '' : 'active'}" role="tab" data-tab="${id}" aria-selected="${i ? 'false' : 'true'}">${esc(label)}</button>`).join('')}</div>
          ${tabs.map(([id, , html], i) => `<div class="det-pane" data-pane="${id}" ${i ? 'hidden' : ''}>${html}</div>`).join('')}
        </div>
      </div>`, { wide: true, full: true });
    const svg = body.querySelector('svg');
    let selected = null;
    const draw = () => NWView.render(svg, net, { selected, fit: true });
    draw();
    const tab = id => {
      for (const b of body.querySelectorAll('.det-tab')) { const on = b.dataset.tab === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      for (const p of body.querySelectorAll('.det-pane')) p.hidden = p.dataset.pane !== id;
    };
    body.querySelector('.det-tabs').addEventListener('click', ev => { const b = ev.target.closest('[data-tab]'); if (b) tab(b.dataset.tab); });
    // Gerät im Bild antippen → seine Einstellungen zeigen
    svg.addEventListener('click', ev => {
      const g = ev.target.closest('[data-dev]');
      if (!g) return;
      selected = g.dataset.dev;
      draw();
      tab('set');
      for (const c of body.querySelectorAll('.det-dev')) c.classList.toggle('hl', c.dataset.detDev === selected);
      const card = [...body.querySelectorAll('.det-dev')].find(c => c.dataset.detDev === selected);
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return body;
  }

  root.NWDetails = { open, settingsHTML, testsHTML, wayHTML };
})(window);

/* NetzWerkstatt – Schüleransicht */
(function () {
  'use strict';
  const { store, api, esc, toast, openModal, closeModal, confirmBox, showNetwork, goalsHTML } = NWCommon;
  const T = NW.TYPES;
  const $ = id => document.getElementById(id);

  const S = {
    token: store.get('nw_token'),
    me: null,
    task: null,
    net: null,
    selected: null,
    tool: 'move',
    pending: null,
    submitted: false,
    busy: false,
    saveTimer: null,
    drag: null,
    v6: false,   // Arbeitsfläche zeigt IPv6- statt IPv4-Adressen
  };

  // ---------------------------------------------------------------- Bildschirme
  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
  }

  // Raumcode aus dem QR-Code übernehmen (…/?raum=1234)
  const roomParam = new URLSearchParams(location.search).get('raum');
  if (roomParam) {
    $('login-room').value = roomParam;
    history.replaceState(null, '', location.pathname);
  }

  async function start() {
    if (!S.token) { show('login'); if (roomParam) setTimeout(() => $('login-name').focus(), 50); return; }
    try {
      S.me = await api('GET', '/api/me', undefined, S.token);
      showTasks();
    } catch (e) {
      if (e.status === 401) { store.del('nw_token'); S.token = null; }
      show('login');
      if (e.offline) $('login-error').textContent = e.message;
    }
  }

  $('login-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    $('login-error').textContent = '';
    try {
      const r = await api('POST', '/api/login', { name: $('login-name').value, room: $('login-room').value });
      S.token = r.token;
      store.set('nw_token', r.token);
      S.me = await api('GET', '/api/me', undefined, S.token);
      if (r.returning) toast(`Willkommen zurück, ${r.name}!`);
      showTasks();
    } catch (e) {
      $('login-error').textContent = e.message;
    }
  });

  $('btn-logout').addEventListener('click', async () => {
    if (!(await confirmBox('Wirklich abmelden? Deine Arbeit bleibt gespeichert. Du kannst dich mit demselben Namen wieder anmelden.', 'Abmelden'))) return;
    store.del('nw_token');
    S.token = null; S.me = null;
    $('login-name').value = ''; $('login-room').value = '';
    show('login');
  });

  async function refreshMe() {
    try { S.me = await api('GET', '/api/me', undefined, S.token); } catch (e) { /* später erneut */ }
  }

  function showTasks() {
    show('tasks');
    $('who').textContent = S.me ? S.me.name : '';
    const list = $('task-list');
    list.innerHTML = '';
    NWTasks.TASKS.forEach((t, i) => {
      const w = S.me && S.me.works[t.id];
      const status = w ? (w.submitted ? '<span class="badge ok">abgegeben ✓</span>' : '<span class="badge">angefangen</span>') : '<span class="badge new">neu</span>';
      const sol = S.me && S.me.released[t.id] ? '<span class="badge sol">Musterlösung da</span>' : '';
      const b = document.createElement('button');
      b.className = 'task-tile' + (t.free ? ' free' : '');
      b.innerHTML = `<div class="tile-num">${t.free ? '∞' : i + 1}</div><div class="tile-body"><h3>${esc(t.title)}</h3><p>${esc(t.intro)}</p><div class="tile-meta">${status}${sol}${t.goals.length ? `<span class="muted small">${t.goals.length} Ziele</span>` : ''}</div></div>`;
      b.addEventListener('click', () => openTask(t.id));
      list.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- Aufgabe öffnen
  async function openTask(id) {
    const task = NWTasks.byId(id);
    let saved = null;
    try { saved = await api('GET', '/api/work/' + encodeURIComponent(id), undefined, S.token); } catch (e) {
      if (e.status === 401) { show('login'); return; }
      toast(e.message, 'error');
    }
    S.task = task;
    S.net = saved && saved.network ? saved.network : task.start();
    if (!S.net.events) S.net.events = [];
    S.submitted = !!(saved && saved.submitted);
    S.selected = null; S.pending = null;
    setTool('move');
    $('task-title').textContent = task.title;
    $('task-intro').textContent = task.intro;
    $('task-tip').textContent = task.tip || '';
    $('task-tip-wrap').hidden = !task.tip;
    $('task-think').textContent = task.think || '';
    $('task-think-wrap').hidden = !task.think;
    $('btn-submit').hidden = !!task.free;
    $('log').innerHTML = '<div class="log-empty">Hier erscheinen die Datenpakete, sobald du einen Ping sendest, eine Webseite aufrufst oder per DHCP eine Adresse anforderst.</div>';
    $('save-state').textContent = '';
    show('editor');
    updateSolutionButton();
    renderAll();
  }

  $('btn-back').addEventListener('click', async () => {
    await flushSave();
    await refreshMe();
    showTasks();
  });

  function updateSolutionButton() {
    $('btn-solution').hidden = !(S.task && S.task.solution && S.me && S.me.released[S.task.id]);
  }

  $('btn-solution').addEventListener('click', () => {
    const sol = S.task.solution();
    showNetwork('Musterlösung: ' + S.task.title, sol, '<p class="muted">Vergleiche mit deinem Netzwerk. Es gibt oft mehrere richtige Lösungen!</p>');
  });

  // ---------------------------------------------------------------- Speichern
  function scheduleSave() {
    if (S.task && S.task.free && !S.token) return;
    $('save-state').textContent = 'Speichert …';
    $('save-state').className = 'save-state';
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(save, 700);
  }
  async function save() {
    S.saveTimer = null;
    try {
      await api('PUT', '/api/work/' + encodeURIComponent(S.task.id), { network: S.net }, S.token);
      $('save-state').textContent = 'Gespeichert ✓';
      $('save-state').className = 'save-state ok';
    } catch (e) {
      $('save-state').textContent = e.offline ? 'Nicht gespeichert – keine Verbindung' : 'Nicht gespeichert';
      $('save-state').className = 'save-state bad';
      if (e.status === 401) toast('Du bist nicht mehr angemeldet. Bitte melde dich neu an.', 'error');
    }
  }
  async function flushSave() {
    if (S.saveTimer) { clearTimeout(S.saveTimer); await save(); }
  }
  window.addEventListener('beforeunload', () => { if (S.saveTimer) save(); });

  // ---------------------------------------------------------------- Abgeben
  $('btn-submit').addEventListener('click', async () => {
    const res = NWTasks.evaluate(S.task, S.net);
    const open = res.filter(x => !x).length;
    if (open && !(await confirmBox(`Es ${open === 1 ? 'ist noch 1 Ziel' : `sind noch ${open} Ziele`} offen. Trotzdem abgeben?`, 'Trotzdem abgeben'))) return;
    try {
      await api('PUT', '/api/work/' + encodeURIComponent(S.task.id), { network: S.net, submitted: true }, S.token);
      S.submitted = true;
      S.selected = null;
      toast('Abgegeben! Deine Lehrkraft kann dein Netzwerk jetzt sehen.', 'ok');
      renderAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  $('btn-unsubmit').addEventListener('click', async () => {
    try {
      await api('PUT', '/api/work/' + encodeURIComponent(S.task.id), { submitted: false }, S.token);
      S.submitted = false;
      renderAll();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ---------------------------------------------------------------- Palette und Werkzeuge
  const PALETTE = [
    ['pc', 'PC'], ['tablet', 'Tablet'], ['smartphone', 'Smartphone'], ['server', 'Server'],
    ['switch', 'Switch'], ['bus', 'Bus-Kabel'], ['ap', 'Access Point'], ['router', 'Router'], ['isp', 'Internet\u00adanbieter'],
  ];
  const palette = $('palette');
  palette.innerHTML = '<div class="palette-title">Geräte</div>' + PALETTE.map(([t, l]) => `<button class="pal-btn" data-type="${t}" title="${esc(l)} hinzufügen">${NWView.iconSVG(t, 34)}<span>${esc(l)}</span></button>`).join('');
  palette.addEventListener('click', ev => {
    const b = ev.target.closest('.pal-btn');
    if (!b || readOnly()) return;
    const p = NWView.freeSpot(S.net, b.dataset.type);
    const d = NW.createDevice(S.net, b.dataset.type, p.x, p.y);
    // In Aufgaben, in denen Adressen von Hand vergeben werden, ist DHCP aus
    if (S.task.manual) NWTasks.manualize({ devices: [d] });
    S.selected = d.id;
    setTool('move');
    renderAll();
    scheduleSave();
  });

  const HINTS = {
    move: '',
    kabel: 'Tippe nacheinander auf die zwei Geräte, die du mit einem Kabel verbinden willst.',
    wlan: 'Tippe auf einen Access Point oder Router und dann auf ein Tablet oder Smartphone.',
    delete: 'Tippe auf ein Gerät oder eine Verbindung, um es zu löschen.',
  };
  function setTool(t) {
    S.tool = t; S.pending = null;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    $('tool-hint').textContent = HINTS[t];
    if (S.net) renderCanvas();
  }
  document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => {
    if (readOnly() && b.dataset.tool !== 'move') return;
    setTool(b.dataset.tool);
  }));

  // Umschalter: Adressen auf der Arbeitsfläche als IPv4 oder IPv6 anzeigen
  document.querySelectorAll('[data-addr]').forEach(b => b.addEventListener('click', () => {
    S.v6 = b.dataset.addr === 'v6';
    document.querySelectorAll('[data-addr]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    if (S.net) renderCanvas();
  }));

  function readOnly() { return S.submitted && !S.task.free; }

  // ---------------------------------------------------------------- Zeichnen
  function renderCanvas() {
    NWView.render($('canvas'), S.net, { selected: S.selected, pending: S.pending, v6: S.v6 });
  }

  function renderAll() {
    renderCanvas();
    renderGoals();
    renderInspector();
    $('readonly-banner').hidden = !readOnly();
    $('btn-submit').disabled = readOnly();
    $('btn-submit').textContent = readOnly() ? 'Abgegeben ✓' : 'Abgeben';
    document.body.classList.toggle('is-readonly', readOnly());
  }

  function renderGoals() {
    const res = NWTasks.evaluate(S.task, S.net);
    $('goals').innerHTML = S.task.goals.map((g, i) => `<li class="${res[i] ? 'done' : ''}">${esc(g.text)}</li>`).join('');
    $('all-done').hidden = !(S.task.goals.length && res.every(Boolean)) || readOnly();
  }

  // ---------------------------------------------------------------- Zeiger (Maus, Finger, Stift)
  const canvas = $('canvas');
  canvas.addEventListener('pointerdown', ev => {
    if (S.busy) return;
    if (ev.target.closest('[data-topo]')) { showTopoInfo(); return; }
    const devEl = ev.target.closest('[data-dev]');
    const linkEl = ev.target.closest('[data-link]');
    const p = NWView.toWorld(canvas, ev);

    if (S.tool === 'move' || readOnly()) {
      if (devEl) {
        const d = NW.dev(S.net, devEl.dataset.dev);
        S.drag = { id: d.id, sx: p.x, sy: p.y, ox: d.x, oy: d.y, moved: false, pid: ev.pointerId };
        canvas.setPointerCapture(ev.pointerId);
      } else if (linkEl) {
        S.selected = linkEl.dataset.link; renderCanvas(); renderInspector();
      } else {
        S.selected = null; renderCanvas(); renderInspector();
      }
      return;
    }
    if (S.tool === 'kabel' || S.tool === 'wlan') {
      if (!devEl) { S.pending = null; $('tool-hint').textContent = HINTS[S.tool]; renderCanvas(); return; }
      const id = devEl.dataset.dev;
      if (!S.pending) {
        S.pending = id;
        $('tool-hint').textContent = `${NW.dev(S.net, id).name} gewählt – tippe jetzt auf das zweite Gerät.`;
      } else if (S.pending === id) {
        S.pending = null; $('tool-hint').textContent = HINTS[S.tool];
      } else {
        const r = NW.addLink(S.net, S.pending, id, S.tool);
        if (!r.ok) toast(r.reason, 'error');
        else { toast(S.tool === 'kabel' ? 'Kabel verbunden.' : 'WLAN verbunden.', 'ok'); scheduleSave(); }
        S.pending = null; $('tool-hint').textContent = HINTS[S.tool];
        renderGoals(); renderInspector();
        if (r.ok) { renderCanvas(); autoDhcp(); return; }
      }
      renderCanvas();
      return;
    }
    if (S.tool === 'delete') {
      if (devEl) {
        const d = NW.dev(S.net, devEl.dataset.dev);
        if (d.locked) { toast(`${d.name} gehört zur Aufgabe und kann nicht gelöscht werden.`, 'error'); return; }
        NW.removeDevice(S.net, d.id);
      } else if (linkEl) {
        const l = S.net.links.find(x => x.id === linkEl.dataset.link);
        if (l.locked) { toast('Diese Verbindung gehört zur Aufgabe und kann nicht gelöscht werden.', 'error'); return; }
        NW.removeLink(S.net, l.id);
      } else return;
      if (S.selected && !NW.dev(S.net, S.selected) && !S.net.links.some(l => l.id === S.selected)) S.selected = null;
      renderAll(); scheduleSave();
    }
  });
  canvas.addEventListener('pointermove', ev => {
    const dr = S.drag;
    if (!dr || dr.pid !== ev.pointerId) return;
    const p = NWView.toWorld(canvas, ev);
    if (!dr.moved && Math.hypot(p.x - dr.sx, p.y - dr.sy) < 6) return;
    if (readOnly()) return;
    dr.moved = true;
    const d = NW.dev(S.net, dr.id);
    const c = NWView.clampPos(dr.ox + p.x - dr.sx, dr.oy + p.y - dr.sy, d.type);
    d.x = Math.round(c.x); d.y = Math.round(c.y);
    renderCanvas();
  });
  function endDrag(ev) {
    const dr = S.drag;
    if (!dr || dr.pid !== ev.pointerId) return;
    S.drag = null;
    if (dr.moved) scheduleSave();
    else { S.selected = dr.id; renderCanvas(); renderInspector(); }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- Topologie erklären
  function showTopoInfo() {
    const list = NW.topologies(S.net);
    const kinds = ['stern', 'bus', 'ring'].filter(k => list.some(t => t.kind === k));
    const li = a => a.map(x => `<li>${esc(x)}</li>`).join('');
    const parts = kinds.map(k => {
      const info = NW.TOPOLOGY_INFO[k];
      const probs = list.filter(t => t.kind === k && !t.ok).map(t => t.problem);
      return `<div class="topo-card"><h3>${esc(info.name)}</h3><p>${esc(info.text)}</p>
        ${probs.length ? `<p class="fault-note">⚡ Gerade gestört: ${esc(probs.join(', '))}</p>` : ''}
        <div class="topo-pc"><div><h4>Vorteile</h4><ul>${li(info.pro)}</ul></div><div><h4>Nachteile</h4><ul>${li(info.con)}</ul></div></div>
        <p class="small"><b>Probiere aus:</b> ${esc(info.try)}</p></div>`;
    });
    openModal(`<h2 class="modal-title">Erkannte Topologie</h2>${parts.join('')}`, { wide: true });
  }

  // ---------------------------------------------------------------- Einstellungen (rechte Spalte)
  const insp = $('inspector');

  function field(label, path, value, check, opts) {
    opts = opts || {};
    return `<label class="field">${esc(label)}
      <input data-path="${path}" data-check="${check || ''}" value="${esc(value)}" placeholder="${esc(opts.placeholder || '')}" ${opts.disabled ? 'disabled' : ''}
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      <span class="fhint" data-for="${path}"></span></label>`;
  }

  function connectionsHTML(d) {
    const ls = NW.linksOf(S.net, d.id);
    if (!ls.length) return '<p class="muted small">Noch mit nichts verbunden.</p>';
    return '<ul class="conn">' + ls.map(l => {
      const o = NW.dev(S.net, l.a === d.id ? l.b : l.a);
      return `<li><span class="kind ${l.kind}">${l.kind === 'kabel' ? 'Kabel' : 'WLAN'}</span> ${esc(o.name)}</li>`;
    }).join('') + '</ul>';
  }

  function otherHostChips(d) {
    const chips = S.net.devices.filter(o => o !== d && T[o.type].host && NW.parseIP(o.ip) !== null)
      .map(o => `<button class="chip" data-fill="ping" data-val="${esc(o.ip.trim())}">${esc(o.name)}</button>`);
    return chips.length ? `<div class="chips">${chips.join('')}</div>` : '';
  }

  /** Knöpfe zum Übernehmen von IPv6-Zieladressen: im eigenen Netz die Link-Local-, sonst die globale Adresse. */
  function v6Chips(d) {
    const mine = NW.ip6Of(S.net, d, 0);
    const near = new Set(NW.linksOf(S.net, d.id).length ? NW.l2Endpoints(S.net, d.id, 0).map(e => e.dev.id) : []);
    const chips = [];
    for (const o of S.net.devices) {
      if (o === d || !T[o.type].host) continue;
      const a = NW.ip6Of(S.net, o, 0);
      if (near.has(o.id)) chips.push(`<button class="chip v6" data-fill="ping" data-val="${esc(a.ll)}">${esc(o.name)} · fe80::</button>`);
      if (a.gua && mine && mine.gua) chips.push(`<button class="chip v6" data-fill="ping" data-val="${esc(a.gua)}">${esc(o.name)} · global</button>`);
    }
    return chips.length ? `<div class="chips"><span class="chips-label">IPv6:</span>${chips.join('')}</div>` : '';
  }

  /** Vergleich IPv4 und IPv6 (aufklappbar). */
  function compareHTML() {
    return `<details class="desc"><summary>IPv4 und IPv6 im Vergleich</summary>
      <table class="cmp"><colgroup><col class="k"><col><col></colgroup><thead><tr><th></th><th>IPv4</th><th>IPv6</th></tr></thead><tbody>
        <tr><th>Länge</th><td>32 Bit</td><td>128 Bit (viermal so lang)</td></tr>
        <tr><th>Schreib&shy;weise</th><td>4 Zahlen von 0 bis 255 mit Punkten, z. B. 192.168.0.10</td><td>8 Blöcke mit je 4 Hexadezimalziffern (0–9, a–f) und Doppelpunkten. Führende Nullen dürfen weg, „::" ersetzt einmal mehrere Null-Blöcke: 2001:db8:0:0:0:0:0:1 = 2001:db8::1</td></tr>
        <tr><th>Anzahl Adres&shy;sen</th><td>rund 4,3 Milliarden – zu wenig für alle Geräte der Welt</td><td>rund 340 Sextillionen (eine Zahl mit 39 Stellen)</td></tr>
        <tr><th>Nur im eigenen Netz</th><td>lokale Adressen wie 192.168.…, Notfall-Adresse 169.254.…</td><td>Link-Local-Adresse fe80::… (hat jedes Gerät automatisch)</td></tr>
        <tr><th>Adresse bekommen</th><td>von Hand oder per DHCP</td><td>automatisch: Der Router gibt das Netz bekannt, das Gerät bildet seine Adresse selbst (SLAAC)</td></tr>
        <tr><th>NAT</th><td>nötig: Das Heimnetz teilt sich eine externe Adresse</td><td>nicht nötig: Jedes Gerät hat eine eigene weltweite Adresse</td></tr>
      </tbody></table>
      <p class="muted small">Adressen, die mit 2001:db8: beginnen, sind für Beispiele reserviert. Echte globale IPv6-Adressen beginnen meist mit 2 oder 3.</p></details>`;
  }

  /** IPv6-Adressen eines Endgeräts. */
  function v6HostHTML(d) {
    const a = NW.ip6Of(S.net, d, 0);
    if (!a) return '';
    let h = `<div class="group v6"><h4>IPv6 (automatisch)</h4>
      <p class="v6-row"><span class="v6-kind">Link-Local</span><code>${esc(a.ll)}</code></p>`;
    if (a.gua) h += `<p class="v6-row"><span class="v6-kind">Global</span><code>${esc(a.gua)}</code></p>
      <p class="muted small">Die ersten vier Blöcke (${esc(a.net)}) sind das Netz – es kommt ${a.fromRouter ? 'vom Router' : 'vom Internetanbieter'}. Die letzten vier Blöcke hat ${esc(d.name)} selbst gebildet.</p>`;
    else h += `<p class="muted small">Noch keine globale Adresse. Mit der Link-Local-Adresse erreicht ${esc(d.name)} nur Geräte im eigenen Netz. Eine globale Adresse gibt es automatisch, sobald ein Router mit Internetanbieter angeschlossen ist.</p>`;
    return h + compareHTML() + '</div>';
  }

  function urlChips() {
    const names = new Set();
    S.net.devices.forEach(o => o.services && o.services.dns && o.services.dns.on && (o.services.dns.entries || []).forEach(e => e.name && names.add(e.name.trim())));
    return names.size ? `<div class="chips">${[...names].map(n => `<button class="chip" data-fill="url" data-val="http://${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
  }

  function renderInspector() {
    document.querySelector('.side').classList.toggle('has-sel', !!S.selected);
    const ro = readOnly();
    if (!S.selected) {
      insp.innerHTML = `<h3>Einstellungen</h3><p class="muted">Tippe auf ein Gerät, um es einzustellen und zu testen.</p>`;
      return;
    }
    const link = S.net.links.find(l => l.id === S.selected);
    if (link) {
      const a = NW.dev(S.net, link.a), b = NW.dev(S.net, link.b);
      let plug = '';
      for (const [r, port] of [[a, link.aPort], [b, link.bPort]]) {
        if (!T[r.type].router || port === undefined) continue;
        const isWan = NW.iface(port) === NW.WAN;
        plug += `<p class="small">Steckt bei <b>${esc(r.name)}</b> ${link.kind === 'wlan' ? 'im WLAN des Heimnetzes' : isWan ? 'im Internet-Anschluss (WAN)' : 'in einem LAN-Anschluss (Heimnetz)'}.</p>`;
        const toIsp = T[(r === a ? b : a).type].isp;
        if (toIsp) plug += '<p class="muted small">Das ist die Leitung zum Internetanbieter (z. B. DSL oder Kabel). Sie gehört immer in den Internet-Anschluss.</p>';
        if (link.kind === 'kabel' && !ro && !link.locked && !toIsp) plug += `<button class="btn small" data-act="replug" data-dev="${esc(r.id)}">Umstecken: ${isWan ? 'in einen LAN-Anschluss' : 'in den Internet-Anschluss (WAN)'}</button>`;
      }
      const brk = link.kind !== 'kabel' ? '' : (link.broken ? '<p class="fault-note">⚡ Kabelbruch: Dieses Kabel überträgt keine Daten mehr.</p>' : '')
        + (ro ? '' : `<div class="group"><h4>Ausfall testen</h4><button class="btn small ${link.broken ? 'primary' : ''}" data-act="fault">${link.broken ? 'Kabel reparieren' : '⚡ Kabelbruch simulieren'}</button></div>`);
      insp.innerHTML = `<h3>${link.kind === 'kabel' ? 'Netzwerkkabel' : 'WLAN-Verbindung'}</h3>
        <p>zwischen <b>${esc(a.name)}</b> und <b>${esc(b.name)}</b></p>${plug}
        <p class="muted small">${link.kind === 'kabel' ? 'Ein Kabel (passive Netzwerkkomponente) überträgt die Daten als elektrische Signale.' : 'Per WLAN werden die Daten als Funkwellen übertragen.'}</p>${brk}
        ${!ro && !link.locked ? '<button class="btn danger" data-act="del-link">Verbindung löschen</button>' : ''}`;
      return;
    }
    const d = NW.dev(S.net, S.selected);
    if (!d) { S.selected = null; renderInspector(); return; }
    const t = T[d.type];
    const dis = ro || d.locked;
    let h = `<div class="insp-head">${NWView.iconSVG(d.cloud ? 'switch' : d.type, 30)}<div><div class="insp-type">${esc(d.cloud ? 'Internet (vereinfacht)' : t.label)}</div>
      <input class="insp-name" data-path="name" value="${esc(d.name)}" ${dis ? 'disabled' : ''} maxlength="24" aria-label="Name"></div></div>`;
    h += `<details class="desc"><summary>Wozu dient dieses Gerät?</summary><p>${esc(d.cloud ? 'Hier vereinfacht: Das Internet ist ein riesiger Zusammenschluss vieler Netze. Viele Router leiten die Pakete Schritt für Schritt weiter.' : NW.DESCRIPTIONS[d.type])}</p></details>`;
    if (d.locked) h += '<p class="locked-note">🔒 Dieses Gerät gehört zur Aufgabe. Du kannst es ansehen und benutzen, aber nicht ändern.</p>';
    if (d.off) h += `<p class="fault-note">✕ ${esc(d.name)} ist ausgefallen. Es sendet, empfängt und leitet nichts weiter.</p>`;
    if (t.bus && d.broken) h += '<p class="fault-note">⚡ Kabelbruch im Bus-Kabel: Das ganze Busnetz ist gestört.</p>';

    if (t.host) {
      const auto = !!d.dhcp;
      h += `<div class="group"><h4>Netzwerk-Einstellungen</h4>
        <div class="seg" role="group" aria-label="Art der Einstellung">
          <button class="${auto ? '' : 'on'}" data-act="mode-manual" ${dis ? 'disabled' : ''} aria-pressed="${!auto}">Von Hand</button>
          <button class="${auto ? 'on' : ''}" data-act="mode-dhcp" ${dis ? 'disabled' : ''} aria-pressed="${auto}">Automatisch (DHCP)</button>
        </div>`;
      if (auto) {
        h += `<p class="muted small">Diese Einstellungen bekommt ${esc(d.name)} vom DHCP-Server (meist im Router).</p>`;
        if (!dis) h += '<button class="btn primary small dhcp-btn" data-act="dhcp">Adresse per DHCP anfordern</button>';
      }
      const sg = auto || dis ? {} : NW.suggest(S.net, d.id);
      const chip = (act, txt) => `<div class="chips"><button class="chip suggest" data-act="${act}">💡 ${esc(txt)}</button></div>`;
      const fdis = dis || auto;
      h += field('IP-Adresse', 'ip', d.ip, 'ip', { disabled: fdis, placeholder: auto ? 'kommt per DHCP' : 'z. B. 192.168.1.10' });
      if (sg.ip) h += chip('suggest-ip', `Vorschlag: ${sg.ip} übernehmen`);
      h += field('Subnetzmaske', 'mask', d.mask, 'mask', { disabled: fdis, placeholder: '255.255.255.0' });
      h += field('Gateway (Router)', 'gw', d.gw, 'gw', { disabled: fdis, placeholder: auto ? 'kommt per DHCP' : 'nur nötig für andere Netze' });
      if (sg.gw) h += chip('suggest-gw', `Router ${sg.gw} als Gateway übernehmen`);
      h += field('DNS-Server', 'dns', d.dns, 'dns', { disabled: fdis, placeholder: auto ? 'kommt per DHCP' : 'nur nötig für Namen wie www…' });
      if (sg.dns) h += chip('suggest-dns', `DNS-Server ${sg.dns} übernehmen`);
      h += '</div>';
      h += v6HostHTML(d);
    }
    if (t.services) {
      const w = d.services.web, n = d.services.dns;
      h += `<div class="group"><h4>Dienste</h4>
        <label class="toggle"><input type="checkbox" data-path="services.web.on" ${w.on ? 'checked' : ''} ${dis ? 'disabled' : ''}> Webserver (HTTP)</label>`;
      if (w.on) {
        h += field('Titel der Webseite', 'services.web.title', w.title, '', { disabled: dis });
        h += field('Text der Webseite', 'services.web.text', w.text, '', { disabled: dis });
      }
      h += `<label class="toggle"><input type="checkbox" data-path="services.dns.on" ${n.on ? 'checked' : ''} ${dis ? 'disabled' : ''}> DNS-Server</label>`;
      if (n.on) {
        h += '<div class="dns-table"><div class="dns-row head"><span>Name</span><span>IP-Adresse</span><span></span></div>';
        n.entries.forEach((e, i) => {
          h += `<div class="dns-row"><input data-path="services.dns.entries.${i}.name" value="${esc(e.name)}" placeholder="www.beispiel.de" ${dis ? 'disabled' : ''} autocapitalize="off" spellcheck="false">
            <input data-path="services.dns.entries.${i}.ip" data-check="dnsip" value="${esc(e.ip)}" placeholder="IP" ${dis ? 'disabled' : ''} autocapitalize="off" spellcheck="false">
            ${dis ? '<span></span>' : `<button class="btn ghost small" data-act="dns-del" data-i="${i}" aria-label="Eintrag löschen">✕</button>`}</div>`;
        });
        h += '</div>';
        if (!dis) h += '<button class="btn small" data-act="dns-add">+ Eintrag</button>';
      }
      h += '</div>';
    }
    if (t.router) {
      const conns = which => NW.linksOf(S.net, d.id).filter(l => NW.iface(NW.portOf(l, d.id)) === which)
        .map(l => { const o = NW.dev(S.net, l.a === d.id ? l.b : l.a); return `<span class="kind ${l.kind}">${l.kind === 'kabel' ? 'Kabel' : 'WLAN'}</span> ${esc(o.name)}`; });
      const lanConns = conns(NW.LAN), wanConns = conns(NW.WAN);
      const p = d.ports[NW.LAN], i = NW.LAN;
      // Heimnetz (LAN)
      h += `<div class="group"><h4>Heimnetz (LAN)</h4>
        <p class="muted small">Drei LAN-Anschlüsse und das WLAN des Routers gehören zum selben Heimnetz – wie ein eingebauter Switch. Hier hat der Router eine feste Adresse; Endgeräte tragen sie als Gateway ein.</p>
        <p class="small">${lanConns.length ? lanConns.join(' · ') : '<span class="muted">Noch nichts angeschlossen.</span>'}</p>
        <div class="port-fields">${field('IP-Adresse des Routers', `ports.${i}.ip`, p.ip, 'portip', { disabled: dis })}${field('Subnetzmaske', `ports.${i}.mask`, p.mask, 'mask', { disabled: dis })}</div>`;
      h += `<label class="toggle"><input type="checkbox" data-path="wlan" ${d.wlan ? 'checked' : ''} ${dis ? 'disabled' : ''}> WLAN (eingebauter Access Point)</label>`;
      const dh = NW.dhcpOf(p);
      h += `<label class="toggle"><input type="checkbox" data-path="ports.${i}.dhcp.on" ${dh.on ? 'checked' : ''} ${dis ? 'disabled' : ''}> DHCP-Server (verteilt IP-Adressen)</label>`;
      if (dh.on) {
        const rg = NW.dhcpRange(d, i);
        if (!rg) h += `<p class="fhint warn">Der Router braucht im Heimnetz selbst eine feste IP-Adresse, damit er Adressen verteilen kann.</p>${dis ? '' : `<div class="chips"><button class="chip suggest" data-act="port-auto" data-i="${i}">💡 Adresse für den Router eintragen</button></div>`}`;
        else {
          h += `<p class="dhcp-info">Der Router selbst hat die feste Adresse <b>${esc(p.ip.trim())}</b>. Geräte auf „Automatisch (DHCP)" bekommen von ihm eine freie Adresse von ${esc(NW.ipStr(rg.from))} bis ${esc(NW.ipStr(rg.to))}, die Subnetzmaske und ${esc(p.ip.trim())} als Gateway.</p>`;
          h += `<details class="desc"><summary>DHCP genauer einstellen</summary>
            <div class="port-fields">${field('Adressen von', `ports.${i}.dhcp.from`, dh.from, 'range', { disabled: dis, placeholder: NW.ipStr(rg.from) })}${field('bis', `ports.${i}.dhcp.to`, dh.to, 'range', { disabled: dis, placeholder: NW.ipStr(rg.to) })}</div>
            ${field('DNS-Server für die Geräte', `ports.${i}.dhcp.dns`, dh.dns, 'dns', { disabled: dis, placeholder: 'leer = kein DNS-Server' })}</details>`;
        }
      }
      h += '</div>';
      // Internet (WAN)
      const w = d.ports[NW.WAN];
      h += `<div class="group"><h4>Internet-Anschluss (WAN)</h4>
        <label class="toggle"><input type="checkbox" data-path="modem" ${d.modem ? 'checked' : ''} ${dis ? 'disabled' : ''}> Eingebautes Internet-Modem (DSL/Kabel)</label>
        <p class="muted small">${d.modem
          ? 'Das Modem verbindet den Router über die Telefon- oder Kabelleitung mit dem Internetanbieter. Dort bekommt der Router seine externe (öffentliche) Adresse.'
          : 'Ohne eingebautes Modem wird hier ein externes Modem oder ein anderer Router per Kabel angeschlossen.'}</p>
        <p class="small">${wanConns.length ? wanConns.join(' · ') : '<span class="muted">Nichts angeschlossen.</span>'}</p>
        <div class="port-fields">${field('Externe IP-Adresse', `ports.${NW.WAN}.ip`, w.ip, 'portip', { disabled: dis, placeholder: d.modem ? 'vom Internetanbieter' : 'z. B. 192.168.100.2' })}${field('Subnetzmaske', `ports.${NW.WAN}.mask`, w.mask, 'mask', { disabled: dis })}</div>
        ${field('Gateway ins Internet', `ports.${NW.WAN}.gw`, w.gw || '', 'gw', { disabled: dis, placeholder: 'vom Internetanbieter' })}`;
      const isp = NW.ispOf(S.net, d);
      if (isp && !dis) h += `<button class="btn small" data-act="dhcp">Adresse von ${esc(isp.name)} anfordern</button>`;
      const wa = NW.ifaceAddr(d, NW.WAN);
      if (wa && wanConns.length) h += `<p class="nat-info"><b>NAT (nur bei IPv4):</b> Alle Geräte im Heimnetz gehen mit der externen Adresse <b>${esc(NW.ipStr(wa.ip))}</b> ins Internet. Ihre lokalen Adressen sieht dort niemand. Antworten verteilt der Router wieder an das richtige Gerät.</p>`;
      h += '</div>';
      // IPv6
      const v6l = NW.ip6Of(S.net, d, NW.LAN), v6w = NW.ip6Of(S.net, d, NW.WAN);
      h += `<div class="group v6"><h4>IPv6 (automatisch)</h4>`;
      if (v6l.lanNet) h += `<p class="small">Vom Internetanbieter bekommt ${esc(d.name)} ein eigenes Netz für das Heimnetz: <code>${esc(v6l.lanNet)}</code>. Das gibt der Router im Heimnetz bekannt; jedes Gerät bildet daraus selbst seine globale Adresse – ohne DHCP und ohne NAT.</p>
        <p class="v6-row"><span class="v6-kind">Heimnetz</span><code>${esc(v6l.gua)}</code></p>
        <p class="v6-row"><span class="v6-kind">Internet</span><code>${esc(v6w.gua)}</code></p>`;
      else h += '<p class="muted small">Sobald der Internet-Anschluss mit einem Internetanbieter verbunden ist, bekommt der Router von ihm ein IPv6-Netz für das Heimnetz.</p>';
      h += `<p class="v6-row"><span class="v6-kind">Link-Local</span><code>${esc(v6l.ll)}</code></p>${compareHTML()}</div>`;
    }
    if (t.isp) {
      const a = NW.ifaceAddr(d, 0);
      h += `<div class="group"><h4>Öffentliche Adressen</h4>
        <p class="muted small">Der Internetanbieter verteilt öffentliche (externe) IP-Adressen an alle Router und Server, die an seine Leitung angeschlossen werden – automatisch per DHCP.</p>
        <div class="port-fields">${field('IP-Adresse des Anbieters', 'ip', d.ip, 'ip', { disabled: dis })}${field('Subnetzmaske', 'mask', d.mask, 'mask', { disabled: dis })}</div>`;
      if (a) { const rg = NW.dhcpDefaultRange(a.ip, a.prefix); h += `<p class="small">Angeschlossene Geräte bekommen eine Adresse von ${esc(NW.ipStr(rg.from))} bis ${esc(NW.ipStr(rg.to))} und ${esc(d.ip.trim())} als Gateway.</p>`; }
      h += field('DNS-Server für die Kunden', 'dns', d.dns || '', 'dns', { disabled: dis, placeholder: 'leer = kein DNS-Server' });
      if (!dis && !(d.dns || '').trim()) {
        const ds = S.net.devices.find(o => o.services && o.services.dns && o.services.dns.on && NW.parseIP(o.ip) !== null && !NW.isPrivate(NW.parseIP(o.ip)));
        if (ds) h += `<div class="chips"><button class="chip suggest" data-act="isp-dns" data-val="${esc(ds.ip.trim())}">💡 ${esc(ds.name)} (${esc(ds.ip.trim())}) als DNS-Server übernehmen</button></div>`;
      }
      const cust = NW.l2Endpoints(S.net, d.id, 0).map(e => {
        const x = NW.ifaceAddr(e.dev, e.port);
        return `<li>${esc(e.dev.name)}${T[e.dev.type].isp ? ' <span class="muted">(anderer Internetanbieter)</span>' : ''} – ${x ? esc(NW.ipStr(x.ip)) : '<span class="muted">noch keine Adresse</span>'}</li>`;
      });
      const v6 = NW.ip6Of(S.net, d, 0);
      h += `<h4>IPv6</h4><p class="small">IPv6-Adressbereich: <code>${esc(v6.net.replace('::/64', '::/48'))}</code>. Jeder angeschlossene Router bekommt daraus ein eigenes Netz für sein Heimnetz, Server direkt beim Anbieter liegen in <code>${esc(v6.net)}</code>. Der Anbieter selbst hat <code>${esc(v6.gua)}</code>.</p>`;
      h += `<h4>Angeschlossen</h4>${cust.length ? `<ul class="conn">${cust.join('')}</ul>` : '<p class="muted small">Noch nichts. Verbinde einen Router (Internet-Anschluss) oder einen Server per Kabel.</p>'}</div>`;
    }
    if (t.bus) h += '<p class="muted small">Das Bus-Kabel braucht keine IP-Adresse. Schließe alle Geräte mit einem Kabel daran an.</p>';
    else if (t.l2) h += `<p class="muted small">Ein ${esc(t.label)} braucht keine IP-Adresse – er leitet die Pakete nur weiter.</p>`;
    if (!ro) {
      const on = t.bus ? !!d.broken : !!d.off;
      const label = t.bus ? (on ? 'Bus-Kabel reparieren' : '⚡ Kabelbruch im Bus-Kabel simulieren') : (on ? 'Wieder einschalten' : '✕ Ausfall simulieren (ausschalten)');
      h += `<div class="group"><h4>Ausfall testen</h4><button class="btn small ${on ? 'primary' : ''}" data-act="fault">${label}</button></div>`;
    }

    h += `<div class="group"><h4>Verbindungen</h4>${connectionsHTML(d)}</div>`;

    if (t.host) {
      h += `<div class="group test"><h4>Testen</h4>
        <label class="field">Ping senden an (IPv4- oder IPv6-Adresse)
          <div class="inline"><input id="ping-target" placeholder="z. B. 192.168.1.2 oder fe80::…" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary" data-act="ping">Ping</button></div></label>
        ${otherHostChips(d)}${v6Chips(d)}
        <label class="field">Browser: Adresse (URL)
          <div class="inline"><input id="url-target" placeholder="http://www.beispiel.de" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary" data-act="browse">Öffnen</button></div></label>
        ${urlChips()}</div>`;
    }
    if (!dis) h += '<button class="btn danger" data-act="del-dev">Gerät löschen</button>';
    insp.innerHTML = h;
    updateHints();
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  function hintFor(d, check, value, path) {
    const v = (value || '').trim();
    switch (check) {
      case 'range': {
        if (!v) return ['', ''];
        const x = NW.parseIP(v);
        if (x === null) return ['bad', 'Keine gültige IPv4-Adresse.'];
        const i = Number(path.split('.')[1]);
        const a = NW.ifaceAddr(d, i);
        if (a && !NW.sameNet(x, a.ip, a.prefix)) return ['bad', 'Die Adresse muss im Netz dieses Anschlusses liegen. Sonst gilt der Standardbereich.'];
        if (a && NW.ipProblem(v, d.ports[i].mask)) return ['bad', NW.ipProblem(v, d.ports[i].mask)];
        return ['', ''];
      }
      case 'ip':
      case 'portip':
        if (!v) return check === 'ip' ? ['warn', 'Noch keine IP-Adresse.'] : ['', ''];
        if (NW.parseIP(v) === null) return ['bad', 'Keine gültige IPv4-Adresse: vier Zahlen von 0 bis 255, getrennt durch Punkte.'];
        {
          const mask = check === 'ip' ? d.mask : '255.255.255.0';
          const pr = NW.ipProblem(v, mask);
          if (pr) return ['bad', pr];
          if (NW.isApipa(NW.parseIP(v))) return ['warn', 'Notfall-Adresse (APIPA): Es wurde kein DHCP-Server gefunden. Sie funktioniert nur direkt im selben Netz.'];
          return ['ok', NW.isPrivate(NW.parseIP(v)) ? 'lokale (private) Adresse' : 'öffentliche (externe) Adresse'];
        }
      case 'mask':
        if (!v) return ['bad', 'Bitte eine Subnetzmaske eintragen, meist 255.255.255.0.'];
        return NW.parseMask(v) === null ? ['bad', 'Keine gültige Subnetzmaske. Üblich ist 255.255.255.0.'] : ['', ''];
      case 'gw': {
        if (!v) return ['', ''];
        const g = NW.parseIP(v);
        if (g === null) return ['bad', 'Keine gültige IPv4-Adresse.'];
        const a = NW.ifaceAddr(d, 0);
        if (a && !NW.sameNet(g, a.ip, a.prefix)) return ['bad', 'Das Gateway muss im selben Netz liegen wie das Gerät.'];
        if (a && g === a.ip) return ['bad', 'Das ist die eigene Adresse – hier gehört die Adresse des Routers hin.'];
        return ['', ''];
      }
      case 'dns':
      case 'dnsip':
        if (!v) return ['', ''];
        return NW.parseIP(v) === null ? ['bad', 'Keine gültige IPv4-Adresse.'] : ['', ''];
      default: return ['', ''];
    }
  }

  function updateHints() {
    const d = NW.dev(S.net, S.selected);
    if (!d) return;
    insp.querySelectorAll('input[data-check]').forEach(inp => {
      const check = inp.dataset.check;
      if (!check) return;
      const [cls, txt] = hintFor(d, check, inp.value, inp.dataset.path);
      const hEl = insp.querySelector(`.fhint[data-for="${CSS.escape(inp.dataset.path)}"]`);
      inp.classList.toggle('invalid', cls === 'bad');
      if (hEl) { hEl.textContent = txt; hEl.className = 'fhint ' + cls; }
    });
  }

  insp.addEventListener('input', ev => {
    const inp = ev.target;
    if (!inp.dataset.path || readOnly()) return;
    const d = NW.dev(S.net, S.selected);
    if (!d || d.locked) return;
    const val = inp.type === 'checkbox' ? inp.checked : inp.value;
    setPath(d, inp.dataset.path, val);
    // DHCP am Router einschalten: Hat der Anschluss noch keine Adresse, bekommt er automatisch eine
    const dm = inp.dataset.path.match(/^ports\.(\d+)\.dhcp\.on$/);
    if (dm && val && !NW.ifaceAddr(d, Number(dm[1]))) setPortAuto(d, Number(dm[1]));
    if (inp.dataset.path === 'modem' && !val) {
      const n = NW.setModem(S.net, d, false);
      if (n) toast('Modem aus: Die Leitung zum Internetanbieter wurde getrennt.');
    }
    if (inp.dataset.path === 'wlan' && !val) {
      const n = NW.setRouterWlan(S.net, d, false);
      if (n) toast(`WLAN aus: ${n === 1 ? 'Ein Gerät wurde' : n + ' Geräte wurden'} getrennt.`);
    }
    if (T[d.type].isp && inp.dataset.path === 'dns' && (NW.parseIP(val) !== null || !val.trim())) NW.refreshDns(S.net);
    if (inp.type === 'checkbox') renderInspector(); else updateHints();
    renderCanvas(); renderGoals(); scheduleSave();
    if (dm && val) autoDhcp();
  });

  function setPortAuto(d, i) {
    const sg = NW.suggestPortIP(S.net, d, i);
    d.ports[i].ip = sg.ip; d.ports[i].mask = sg.mask;
    toast(`${d.name} hat im Heimnetz die feste Adresse ${sg.ip} bekommen. Du kannst sie ändern.`, 'ok');
  }

  /** Geräte auf „Automatisch (DHCP)" ohne Adresse fragen nach, sobald ein DHCP-Server erreichbar ist – wie in echt. */
  async function autoDhcp() {
    for (let k = 0; k < 20; k++) {
      if (S.busy) return;
      // ohne Adresse: fragen (notfalls APIPA); mit Notfall-Adresse: erneut fragen, sobald ein DHCP-Server da ist
      const h = S.net.devices.find(x => {
        // Router: externe Adresse holen, sobald der Internet-Anschluss angeschlossen ist
        if (T[x.type].router) return !x.off && NW.parseIP(x.ports[NW.WAN].ip || '') === null && !!NW.ispOf(S.net, x) && NW.dhcp(S.net, x.id).ok;
        if (!T[x.type].host || !x.dhcp || x.off || !NW.linksOf(S.net, x.id).length) return false;
        const ip = NW.parseIP(x.ip);
        if (ip === null) return true;
        return NW.isApipa(ip) && NW.dhcp(S.net, x.id).ok;
      });
      if (!h) return;
      await doDhcp(h);
    }
  }

  insp.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'ping-target') { ev.preventDefault(); doPing(); }
    if (ev.target.id === 'url-target') { ev.preventDefault(); doBrowse(); }
  });

  insp.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act], [data-fill]');
    if (!b) return;
    if (b.dataset.fill) {
      const target = $(b.dataset.fill === 'ping' ? 'ping-target' : 'url-target');
      target.value = b.dataset.val;
      return;
    }
    const d = NW.dev(S.net, S.selected);
    switch (b.dataset.act) {
      case 'ping': doPing(); break;
      case 'fault': {
        const id = S.selected;
        const l = S.net.links.find(x => x.id === id);
        const was = l ? !!l.broken : T[d.type].bus ? !!d.broken : !!d.off;
        NW.setFault(S.net, id, !was);
        renderAll(); scheduleSave();
        if (was) autoDhcp();
        break;
      }
      case 'browse': doBrowse(); break;
      case 'del-dev':
        NW.removeDevice(S.net, d.id); S.selected = null; renderAll(); scheduleSave(); break;
      case 'del-link':
        NW.removeLink(S.net, S.selected); S.selected = null; renderAll(); scheduleSave(); break;
      case 'mode-manual':
        if (!d.dhcp) break;
        d.dhcp = false; renderAll(); scheduleSave(); break;
      case 'mode-dhcp':
        if (d.dhcp) break;
        d.dhcp = true; d.ip = ''; d.gw = ''; d.dns = '';
        renderAll(); scheduleSave(); doDhcp(d); break;
      case 'dhcp': doDhcp(d); break;
      case 'replug': {
        const r = NW.replug(S.net, S.selected, b.dataset.dev);
        if (!r.ok) toast(r.reason, 'error');
        renderAll(); scheduleSave();
        if (r.ok) autoDhcp();
        break;
      }
      case 'port-auto':
        setPortAuto(d, Number(b.dataset.i)); renderAll(); scheduleSave(); break;
      case 'suggest-ip': {
        const sg = NW.suggest(S.net, d.id);
        if (sg.ip) { d.ip = sg.ip; d.mask = sg.mask; }
        renderAll(); scheduleSave(); break;
      }
      case 'suggest-gw': {
        const sg = NW.suggest(S.net, d.id);
        if (sg.gw) d.gw = sg.gw;
        renderAll(); scheduleSave(); break;
      }
      case 'suggest-dns': {
        const sg = NW.suggest(S.net, d.id);
        if (sg.dns) d.dns = sg.dns;
        renderAll(); scheduleSave(); break;
      }
      case 'isp-dns':
        d.dns = b.dataset.val;
        { const n = NW.refreshDns(S.net); if (n) toast(`${n === 1 ? 'Ein Gerät hat' : n + ' Geräte haben'} den neuen DNS-Server per DHCP übernommen.`, 'ok'); }
        renderAll(); scheduleSave(); break;
      case 'dns-add':
        d.services.dns.entries.push({ name: '', ip: '' }); renderInspector(); scheduleSave(); break;
      case 'dns-del':
        d.services.dns.entries.splice(Number(b.dataset.i), 1); renderInspector(); renderGoals(); scheduleSave(); break;
    }
  });

  // ---------------------------------------------------------------- Protokoll (Paket-Log)
  function logStep(step) {
    const log = $('log');
    const empty = log.querySelector('.log-empty');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'log-entry ' + (step.kind || '') + (step.ok === false ? ' failed' : '');
    div.innerHTML = `<span class="log-label">${esc(step.label)}</span>${step.proto ? `<span class="log-proto">${esc(step.proto)}</span>` : ''}<span class="log-text">${esc(step.text || '')}</span>${step.note ? `<span class="log-note">↔ ${esc(step.note)}</span>` : ''}`;
    log.prepend(div);
    while (log.children.length > 40) log.lastChild.remove();
  }
  function logResult(ok, text, hint) {
    const log = $('log');
    const div = document.createElement('div');
    div.className = 'log-entry result ' + (ok ? 'ok' : 'bad');
    div.innerHTML = `<span class="log-label">${ok ? '✓ Erfolg' : '✕ Problem'}</span><span class="log-text">${esc(text)}${hint ? `<br><span class="log-hint">Tipp: ${esc(hint)}</span>` : ''}</span>`;
    log.prepend(div);
  }

  async function runSteps(steps) {
    S.busy = true;
    document.body.classList.add('busy');
    try { await NWView.animate(canvas, S.net, steps, step => logStep(step)); }
    finally { S.busy = false; document.body.classList.remove('busy'); }
  }

  async function doPing() {
    if (S.busy) return;
    const d = NW.dev(S.net, S.selected);
    const target = $('ping-target').value.trim();
    const res = NW.ping(S.net, d.id, target);
    if (!res.steps.length) { logResult(false, res.error, res.hint); return; }
    await runSteps(res.steps);
    if (res.ok) {
      const t = NW.dev(S.net, res.target);
      if (res.v6) logResult(true, `Ping per IPv6 erfolgreich: ${t.name} (${target}) hat geantwortet.` + (res.linkLocal ? ' Link-Local-Adressen funktionieren nur im eigenen Netz.' : res.viaRouter ? ` Kein NAT: ${t.name} hat die echte Adresse ${res.seenSrc} von ${d.name} gesehen.` : ''));
      else logResult(true, `Ping erfolgreich: ${t.name} (${target}) hat geantwortet.` + natText(res.nat));
    } else logResult(false, res.error, res.hint);
    NW.logEvent(S.net, Object.assign({ type: 'ping', src: d.id, target: res.target, ok: !!res.ok, fault: res.fault || '', faults: NW.activeFaults(S.net) }, res.v6 ? { v6: true, ll: !!res.linkLocal } : {}));
    renderGoals(); scheduleSave();
  }

  async function doDhcp(d) {
    if (S.busy || !d) return;
    const res = NW.dhcp(S.net, d.id);
    if (res.steps.length) await runSteps(res.steps);
    if (res.ok) {
      NW.applyLease(d, res.lease);
      const srv = NW.dev(S.net, res.server);
      if (T[d.type].router) logResult(true, `${d.name} hat von ${srv ? srv.name : 'dem Internetanbieter'} die externe (öffentliche) Adresse ${res.lease.ip} bekommen. Damit ist das Heimnetz mit dem Internet verbunden.`);
      else logResult(true, `${d.name} hat von ${srv ? srv.name : 'dem DHCP-Server'} die Adresse ${res.lease.ip} bekommen.`);
    } else if (res.apipa) {
      NW.applyLease(d, res.apipa);
      logResult(false, `${res.error} ${d.name} gibt sich deshalb selbst die Notfall-Adresse ${res.apipa.ip} (APIPA). Damit erreicht es nur Geräte, die direkt im selben Netz auch eine 169.254-Adresse haben – ohne Gateway, also nicht das Internet.`, res.hint);
    } else logResult(false, res.error, res.hint);
    NW.logEvent(S.net, { type: 'dhcp', src: d.id, ok: !!res.ok });
    renderAll(); scheduleSave();
  }

  function natText(n) {
    return n ? ` ${n.target} hat als Absender nur ${n.outside} gesehen – die externe Adresse von ${n.router}. Die lokale Adresse ${n.inside} bleibt im Heimnetz (NAT).` : '';
  }

  async function doBrowse() {
    if (S.busy) return;
    const d = NW.dev(S.net, S.selected);
    const url = $('url-target').value.trim();
    const res = NW.browse(S.net, d.id, url);
    if (res.steps.length) await runSteps(res.steps);
    const u = NW.parseURL(url);
    NW.logEvent(S.net, { type: 'web', src: d.id, host: u ? u.host : url, ok: !!res.ok });
    if (res.ok) {
      logResult(true, `Webseite ${res.page.host} geladen (Server-IP ${res.page.ip}).` + natText(res.nat));
      openModal(`<div class="browser"><div class="browser-bar"><span class="dots"><i></i><i></i><i></i></span><span class="browser-url">http://${esc(res.page.host)}/</span></div>
        <div class="browser-page"><h1>${esc(res.page.title || '(ohne Titel)')}</h1><p>${esc(res.page.text)}</p></div>
        <p class="muted small">Geladen auf ${esc(d.name)} · Server-IP ${esc(res.page.ip)} · über HTTP-Request und HTTP-Response</p></div>`);
    } else logResult(false, res.error, res.hint);
    renderGoals(); scheduleSave();
  }

  // Musterlösungen können während der Stunde freigegeben werden
  setInterval(async () => {
    if (!S.token || document.hidden) return;
    await refreshMe();
    if (!$('screen-editor').hidden) updateSolutionButton();
  }, 15000);

  start();
})();

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
    ['switch', 'Switch'], ['ap', 'Access Point'], ['router', 'Router'],
  ];
  const palette = $('palette');
  palette.innerHTML = '<div class="palette-title">Geräte</div>' + PALETTE.map(([t, l]) => `<button class="pal-btn" data-type="${t}" title="${esc(l)} hinzufügen">${NWView.iconSVG(t, 34)}<span>${esc(l)}</span></button>`).join('');
  palette.addEventListener('click', ev => {
    const b = ev.target.closest('.pal-btn');
    if (!b || readOnly()) return;
    const p = NWView.freeSpot(S.net);
    const d = NW.createDevice(S.net, b.dataset.type, p.x, p.y);
    S.selected = d.id;
    setTool('move');
    renderAll();
    scheduleSave();
  });

  const HINTS = {
    move: '',
    kabel: 'Tippe nacheinander auf die zwei Geräte, die du mit einem Kabel verbinden willst.',
    wlan: 'Tippe auf einen Access Point und dann auf ein Tablet oder Smartphone.',
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

  function readOnly() { return S.submitted && !S.task.free; }

  // ---------------------------------------------------------------- Zeichnen
  function renderCanvas() {
    NWView.render($('canvas'), S.net, { selected: S.selected, pending: S.pending });
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
        if (r.ok) {
          // Ein Gerät auf „Automatisch (DHCP)" fragt sofort nach einer Adresse, wie in echt
          const waiting = [r.link.a, r.link.b].map(x => NW.dev(S.net, x)).find(x => T[x.type].host && x.dhcp && NW.parseIP(x.ip) === null);
          if (waiting) { renderCanvas(); doDhcp(waiting); return; }
        }
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
    const c = NWView.clampPos(dr.ox + p.x - dr.sx, dr.oy + p.y - dr.sy);
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
      insp.innerHTML = `<h3>${link.kind === 'kabel' ? 'Netzwerkkabel' : 'WLAN-Verbindung'}</h3>
        <p>zwischen <b>${esc(a.name)}</b> und <b>${esc(b.name)}</b></p>
        <p class="muted small">${link.kind === 'kabel' ? 'Ein Kabel (passive Netzwerkkomponente) überträgt die Daten als elektrische Signale.' : 'Per WLAN werden die Daten als Funkwellen übertragen.'}</p>
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
      h += '<div class="group"><h4>Anschlüsse</h4><p class="muted small">Jeder Anschluss gehört zu einem anderen Netz und hat dort eine eigene feste IP-Adresse. Wie bei echten Routern ist ab Werk schon eine eingetragen; du kannst sie ändern.</p>';
      d.ports.forEach((p, i) => {
        const l = NW.linksOf(S.net, d.id).find(x => NW.portOf(x, d.id) === i);
        const other = l ? NW.dev(S.net, l.a === d.id ? l.b : l.a) : null;
        h += `<div class="port"><div class="port-head">Anschluss ${i + 1} <span class="muted small">${other ? '→ ' + esc(other.name) : '(frei)'}</span></div>
          <div class="port-fields">${field('IP-Adresse', `ports.${i}.ip`, p.ip, 'portip', { disabled: dis })}${field('Subnetzmaske', `ports.${i}.mask`, p.mask, 'mask', { disabled: dis })}</div>`;
        const dh = NW.dhcpOf(p);
        h += `<label class="toggle"><input type="checkbox" data-path="ports.${i}.dhcp.on" ${dh.on ? 'checked' : ''} ${dis ? 'disabled' : ''}> DHCP-Server für dieses Netz</label>`;
        if (dh.on) {
          const rg = NW.dhcpRange(d, i);
          if (!rg) h += `<p class="fhint warn">Der Router braucht an diesem Anschluss selbst eine feste IP-Adresse, damit er Adressen verteilen kann.</p>${dis ? '' : `<div class="chips"><button class="chip suggest" data-act="port-auto" data-i="${i}">💡 Adresse für den Router eintragen</button></div>`}`;
          else {
            h += `<p class="dhcp-info">Der Router selbst hat die feste Adresse <b>${esc(p.ip.trim())}</b>. Die Geräte in diesem Netz bekommen ihre Adressen automatisch von ihm.</p>`;
            h += `<div class="port-fields">${field('Adressen von', `ports.${i}.dhcp.from`, dh.from, 'range', { disabled: dis, placeholder: NW.ipStr(rg.from) })}${field('bis', `ports.${i}.dhcp.to`, dh.to, 'range', { disabled: dis, placeholder: NW.ipStr(rg.to) })}</div>`;
            h += field('DNS-Server für die Geräte', `ports.${i}.dhcp.dns`, dh.dns, 'dns', { disabled: dis, placeholder: 'leer = kein DNS-Server' });
            h += `<p class="muted small">Geräte in diesem Netz, die auf „Automatisch (DHCP)" stehen, bekommen eine freie Adresse von ${esc(NW.ipStr(rg.from))} bis ${esc(NW.ipStr(rg.to))}, die Subnetzmaske und ${esc(p.ip.trim())} als Gateway.</p>`;
          }
        }
        h += '</div>';
      });
      h += '</div>';
    }
    if (t.l2) h += `<p class="muted small">Ein ${esc(t.label)} braucht keine IP-Adresse – er leitet die Pakete nur weiter.</p>`;

    h += `<div class="group"><h4>Verbindungen</h4>${connectionsHTML(d)}</div>`;

    if (t.host) {
      h += `<div class="group test"><h4>Testen</h4>
        <label class="field">Ping senden an (IP-Adresse)
          <div class="inline"><input id="ping-target" placeholder="z. B. 192.168.1.2" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary" data-act="ping">Ping</button></div></label>
        ${otherHostChips(d)}
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
    if (inp.type === 'checkbox') renderInspector(); else updateHints();
    renderCanvas(); renderGoals(); scheduleSave();
  });

  function setPortAuto(d, i) {
    const sg = NW.suggestPortIP(S.net, d, i);
    d.ports[i].ip = sg.ip; d.ports[i].mask = sg.mask;
    toast(`${d.name} hat an Anschluss ${i + 1} die feste Adresse ${sg.ip} bekommen. Du kannst sie ändern.`, 'ok');
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
    div.innerHTML = `<span class="log-label">${esc(step.label)}</span>${step.proto ? `<span class="log-proto">${esc(step.proto)}</span>` : ''}<span class="log-text">${esc(step.text || '')}</span>`;
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
      logResult(true, `Ping erfolgreich: ${t.name} (${target}) hat geantwortet.`);
    } else logResult(false, res.error, res.hint);
    NW.logEvent(S.net, { type: 'ping', src: d.id, target: res.target, ok: !!res.ok });
    renderGoals(); scheduleSave();
  }

  async function doDhcp(d) {
    if (S.busy || !d) return;
    const res = NW.dhcp(S.net, d.id);
    if (res.steps.length) await runSteps(res.steps);
    if (res.ok) {
      NW.applyLease(d, res.lease);
      const srv = NW.dev(S.net, res.server);
      logResult(true, `${d.name} hat von ${srv ? srv.name : 'dem DHCP-Server'} die Adresse ${res.lease.ip} bekommen.`);
    } else logResult(false, res.error, res.hint);
    NW.logEvent(S.net, { type: 'dhcp', src: d.id, ok: !!res.ok });
    renderAll(); scheduleSave();
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
      logResult(true, `Webseite ${res.page.host} geladen (Server-IP ${res.page.ip}).`);
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

/* NetzWerkstatt – Lehrkraft-Ansicht */
(function () {
  'use strict';
  const { store, api, esc, toast, openModal, closeModal, confirmBox, goalsHTML } = NWCommon;
  const $ = id => document.getElementById(id);
  const TASKS = NWTasks.TASKS.filter(t => !t.free);

  // Automatische Anmeldung, wenn das Programm die Ansicht selbst geöffnet hat
  const m = location.hash.match(/token=([0-9a-f]+)/);
  if (m) {
    store.set('nw_teacher', m[1]);
    history.replaceState(null, '', location.pathname);
  }

  const S = {
    token: store.get('nw_teacher'),
    data: null,
    task: TASKS[0].id,
    selected: new Set(),
    timer: null,
  };

  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
  }

  async function start() {
    if (!S.token) { show('login'); return; }
    try { await load(); show('dash'); loop(); } catch (e) { show('login'); }
  }

  $('login-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    $('login-error').textContent = '';
    try {
      const r = await api('POST', '/api/teacher/login', { password: $('login-pw').value });
      S.token = r.token; store.set('nw_teacher', r.token);
      await load(); show('dash'); loop();
    } catch (e) { $('login-error').textContent = e.message; }
  });

  $('btn-logout').addEventListener('click', () => {
    store.del('nw_teacher'); S.token = null; clearInterval(S.timer); show('login');
  });

  function loop() {
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 5000);
  }

  async function load() {
    try {
      S.data = await api('GET', '/api/teacher/overview', undefined, S.token);
    } catch (e) {
      if (e.status === 401) { store.del('nw_teacher'); S.token = null; clearInterval(S.timer); show('login'); }
      throw e;
    }
    render();
  }

  // ---------------------------------------------------------------- Darstellung
  function taskObj() { return NWTasks.byId(S.task); }

  function render() {
    const d = S.data;
    $('room-code').textContent = d.roomCode;
    // Aufgabenliste, nach Themen gruppiert
    const count = id => d.students.filter(s => s.works && s.works[id] && s.works[id].submitted).length;
    $('task-tabs').innerHTML = NWTasks.GROUPS.map(g => {
      const items = TASKS.filter(t => t.group === g.id);
      if (!items.length) return '';
      return `<div class="task-group"><h3>${esc(g.title)}</h3>${items.map(t => {
        const n = count(t.id);
        return `<button class="task-item ${t.id === S.task ? 'active' : ''}" data-task="${t.id}" ${t.id === S.task ? 'aria-current="true"' : ''}>`
          + `<span class="num">${t.num}</span><span class="ttl">${esc(t.title)}</span>`
          + `<span class="cnt ${n ? 'has' : ''}" title="${n} abgegeben">${n}</span></button>`;
      }).join('')}</div>`;
    }).join('');
    const cur = taskObj();
    $('task-heading').textContent = `${cur.num}. ${cur.title}`;
    const nCur = count(S.task);
    $('task-count').textContent = `${nCur} von ${d.students.length} abgegeben`;
    $('chk-release').checked = !!d.released[S.task];

    const task = taskObj();
    const only = $('chk-only-submitted').checked;
    const rows = d.students.filter(s => !only || (s.works && s.works[S.task] && s.works[S.task].submitted));
    $('empty').hidden = d.students.length > 0;
    $('rows').innerHTML = rows.map(s => {
      const w = s.works && s.works[S.task];
      let status = '<span class="badge">nicht begonnen</span>', prog = '', when = '';
      if (w && w.network) {
        const res = NWTasks.evaluate(task, w.network);
        const done = res.filter(Boolean).length;
        prog = `<div class="progress"><div class="bar"><i style="width:${Math.round(100 * done / res.length)}%"></i></div>${done}/${res.length}</div>`;
        status = w.submitted ? '<span class="badge ok">abgegeben ✓</span>' : '<span class="badge new">arbeitet</span>';
        when = new Date(w.updated * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      }
      const has = w && w.network;
      return `<tr>
        <td class="sel">${has ? `<input type="checkbox" data-sel="${s.id}" ${S.selected.has(s.id) ? 'checked' : ''} aria-label="Zum Vergleichen auswählen">` : ''}</td>
        <td class="name">${esc(s.name)}</td><td>${status}</td><td>${prog}</td><td class="muted">${when}</td>
        <td class="actions">${has ? `<button class="btn small" data-view="${s.id}">Zeigen</button>` : ''}
          ${w && w.submitted ? `<button class="btn small ghost" data-return="${s.id}" title="Abgabe zurückgeben, damit weitergearbeitet werden kann">Zurückgeben</button>` : ''}
          <button class="btn small ghost" data-del="${s.id}" title="Schüler/in mit allen Arbeiten löschen">✕</button></td></tr>`;
    }).join('');
    // nicht mehr vorhandene Auswahl entfernen
    for (const id of [...S.selected]) {
      const st = d.students.find(s => s.id === id);
      if (!st || !(st.works && st.works[S.task] && st.works[S.task].network)) S.selected.delete(id);
    }
    $('btn-compare').disabled = S.selected.size !== 2;
    $('btn-compare').textContent = S.selected.size === 2 ? 'Ausgewählte vergleichen' : `Zum Vergleichen 2 auswählen (${S.selected.size}/2)`;
  }

  function student(id) { return S.data.students.find(s => s.id === id); }
  function anon() { return $('chk-anon').checked; }

  // ---------------------------------------------------------------- Ereignisse
  $('task-tabs').addEventListener('click', ev => {
    const b = ev.target.closest('[data-task]');
    if (!b) return;
    S.task = b.dataset.task; S.selected.clear(); render();
  });
  $('chk-only-submitted').addEventListener('change', render);

  $('chk-release').addEventListener('change', async ev => {
    try {
      await api('POST', '/api/teacher/release', { task: S.task, released: ev.target.checked }, S.token);
      toast(ev.target.checked ? 'Musterlösung ist für die Schüler freigegeben.' : 'Musterlösung ist wieder gesperrt.', 'ok');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  });

  $('btn-show-solution').addEventListener('click', () => {
    const t = taskObj();
    const net = t.solution();
    const body = openModal(`<h2 class="modal-title">Musterlösung: ${esc(t.title)}</h2><div class="view-head">${goalsHTML(t, net)}</div><div class="view-wrap"><svg class="canvas view"></svg></div>`, { wide: true, full: true });
    NWView.render(body.querySelector('svg'), net, {});
  });

  $('rows').addEventListener('change', ev => {
    const c = ev.target.closest('[data-sel]');
    if (!c) return;
    if (c.checked) {
      if (S.selected.size >= 2) { c.checked = false; toast('Bitte höchstens zwei auswählen.', 'error'); return; }
      S.selected.add(c.dataset.sel);
    } else S.selected.delete(c.dataset.sel);
    render();
  });

  $('rows').addEventListener('click', async ev => {
    const v = ev.target.closest('[data-view]');
    const r = ev.target.closest('[data-return]');
    const del = ev.target.closest('[data-del]');
    if (v) {
      const s = student(v.dataset.view);
      const t = taskObj();
      const net = s.works[S.task].network;
      const title = anon() ? `Lösung: ${t.title}` : `${s.name}: ${t.title}`;
      const body = openModal(`<h2 class="modal-title">${esc(title)}</h2><div class="view-head">${goalsHTML(t, net)}</div><div class="view-wrap"><svg class="canvas view"></svg></div>`, { wide: true, full: true });
      NWView.render(body.querySelector('svg'), net, {});
    }
    if (r) {
      try { await api('POST', '/api/teacher/return', { student: r.dataset.return, task: S.task }, S.token); toast('Abgabe zurückgegeben.', 'ok'); await load(); }
      catch (e) { toast(e.message, 'error'); }
    }
    if (del) {
      const s = student(del.dataset.del);
      if (!(await confirmBox(`${s.name} mit allen Arbeiten löschen? Das kann nicht rückgängig gemacht werden.`, 'Löschen'))) return;
      try { await api('POST', '/api/teacher/delete-student', { student: s.id }, S.token); await load(); }
      catch (e) { toast(e.message, 'error'); }
    }
  });

  $('btn-compare').addEventListener('click', () => {
    const [a, b] = [...S.selected].map(student);
    const t = taskObj();
    const part = (s, label) => `<div><h3>${esc(anon() ? label : s.name)}</h3>${goalsHTML(t, s.works[S.task].network)}<div class="view-wrap"><svg class="canvas view"></svg></div></div>`;
    const body = openModal(`<h2 class="modal-title">Vergleich: ${esc(t.title)}</h2><div class="compare">${part(a, 'Lösung A')}${part(b, 'Lösung B')}</div>`, { wide: true, full: true });
    const svgs = body.querySelectorAll('svg');
    NWView.render(svgs[0], a.works[S.task].network, {});
    NWView.render(svgs[1], b.works[S.task].network, {});
  });

  // Zugang am Beamer: eine Adresse, Raumcode und QR-Code (wird lokal erzeugt)
  function showAccess() {
    const addrs = S.data.addresses && S.data.addresses.length ? S.data.addresses : [location.origin];
    let idx = Number(store.get('nw_addr_idx') || 0);
    if (!(idx >= 0 && idx < addrs.length)) idx = 0;
    const addr = addrs[idx];
    const qrURL = `${addr}/?raum=${encodeURIComponent(S.data.roomCode)}`;
    const body = openModal(`<div class="access">
      <div class="access-grid">
        <div class="access-text">
          <p class="muted">Öffne im Browser:</p>
          <div class="big-url">${esc(addr)}</div>
          <p class="muted">Raumcode</p>
          <div class="big-code">${esc(S.data.roomCode)}</div>
        </div>
        <div class="access-qr">${NWQR.svg(qrURL, 320)}<p class="muted">QR-Code scannen – der Raumcode ist schon eingetragen.</p></div>
      </div>
      ${addrs.length > 1 ? `<button class="btn ghost small" id="btn-other-addr">Adresse funktioniert nicht? Andere wählen (${idx + 1}/${addrs.length})</button>` : ''}
    </div>`, { wide: true, full: true });
    const other = body.querySelector('#btn-other-addr');
    if (other) other.addEventListener('click', () => { store.set('nw_addr_idx', String((idx + 1) % addrs.length)); showAccess(); });
  }
  $('btn-beamer-code').addEventListener('click', showAccess);

  start();
})();

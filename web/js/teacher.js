/* NetzWerkstatt – Lehrkraft-Ansicht */
(function () {
  'use strict';
  const { store, api, esc, toast, openModal, closeModal, confirmBox, goalsHTML } = NWCommon;
  const $ = id => document.getElementById(id);
  // Aufgaben mit Abgaben (ohne freies Bauen), eingebaute und eigene
  const graded = () => NWTasks.all().filter(t => !t.free);

  // Automatische Anmeldung, wenn das Programm die Ansicht selbst geöffnet hat
  const m = location.hash.match(/token=([0-9a-f]+)/);
  if (m) {
    store.set('nw_teacher', m[1]);
    history.replaceState(null, '', location.pathname);
  }

  const S = {
    token: store.get('nw_teacher'),
    data: null,
    task: NWTasks.TASKS[0].id,
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
    NWEigene.install(S.data.customTasks || []);
    if (!graded().some(t => t.id === S.task)) S.task = NWTasks.TASKS[0].id;
    render();
    refreshAccessTasks();
  }

  // ---------------------------------------------------------------- Darstellung
  function taskObj() { return NWTasks.byId(S.task); }
  const isUnlocked = id => !!(S.data && S.data.unlocked && S.data.unlocked[id]);

  function render() {
    const d = S.data;
    $('room-code').textContent = d.roomCode;
    // Aufgabenliste, nach Themen gruppiert, mit Schaltern zum Freischalten
    const count = id => d.students.filter(s => s.works && s.works[id] && s.works[id].submitted).length;
    $('task-tabs').innerHTML = NWTasks.GROUPS.map(g => {
      const items = NWTasks.all().filter(t => t.group === g.id);
      const on = items.filter(t => isUnlocked(t.id)).length;
      const head = items.length
        ? `<label class="unlock group-unlock" title="Ganzes Thema für Schüler freischalten oder sperren"><input type="checkbox" data-unlock-group="${g.id}" ${on === items.length ? 'checked' : ''} ${on && on < items.length ? 'data-mixed="1"' : ''}><span class="sr">Thema freischalten</span></label>`
        : '';
      const rows = items.map(t => {
        const sw = `<label class="unlock" title="Für Schüler freischalten"><input type="checkbox" data-unlock="${t.id}" ${isUnlocked(t.id) ? 'checked' : ''}><span class="sr">${esc(t.title)} freischalten</span></label>`;
        if (t.free) return `<div class="task-row ${isUnlocked(t.id) ? '' : 'locked'}">${sw}<span class="task-item static"><span class="num">∞</span><span class="ttl">${esc(t.title)}</span></span></div>`;
        const n = count(t.id);
        return `<div class="task-row ${isUnlocked(t.id) ? '' : 'locked'}">${sw}<button class="task-item ${t.id === S.task ? 'active' : ''}" data-task="${t.id}" ${t.id === S.task ? 'aria-current="true"' : ''}>`
          + `<span class="num">${t.num}</span><span class="ttl">${esc(t.title)}</span>`
          + `<span class="cnt ${n ? 'has' : ''}" title="${n} abgegeben">${n}</span></button></div>`;
      }).join('');
      const extra = g.id === 'eigene'
        ? `${items.length ? '' : '<p class="muted small nav-hint">Noch keine eigenen Aufgaben.</p>'}<div class="nav-actions"><button class="btn small" data-act="new">＋ Neue Aufgabe</button><button class="btn small" data-act="import">Importieren</button>${items.length ? '<button class="btn small" data-act="export-all">Alle exportieren</button>' : ''}</div>`
        : '';
      return `<div class="task-group"><h3>${head}<span>${esc(g.title)}</span></h3>${rows}${extra}</div>`;
    }).join('');
    for (const c of $('task-tabs').querySelectorAll('[data-mixed]')) c.indeterminate = true;

    const cur = taskObj();
    $('task-heading').textContent = `${cur.num}. ${cur.title}`;
    const nCur = count(S.task);
    $('task-count').textContent = `${nCur} von ${d.students.length} abgegeben`;
    $('task-lock').textContent = isUnlocked(S.task) ? 'für Schüler freigeschaltet' : 'für Schüler gesperrt';
    $('task-lock').className = 'lock-state ' + (isUnlocked(S.task) ? 'on' : 'off');
    $('chk-unlock').checked = isUnlocked(S.task);
    $('chk-release').checked = !!d.released[S.task];
    $('btn-show-solution').hidden = !cur.solution;
    $('chk-release').closest('label').hidden = !cur.solution;
    for (const id of ['btn-edit-task', 'btn-export-task', 'btn-delete-task']) $(id).hidden = !cur.custom;
    $('btn-copy-task').hidden = !!cur.custom;

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
        prog = res.length ? `<div class="progress"><div class="bar"><i style="width:${Math.round(100 * done / res.length)}%"></i></div>${done}/${res.length}</div>` : '';
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

  // ---------------------------------------------------------------- Freischalten
  async function setUnlocked(ids, on) {
    try {
      await api('POST', '/api/teacher/unlock', { tasks: ids, unlocked: on }, S.token);
      const n = ids.length;
      toast(on ? (n === 1 ? 'Freigeschaltet – die Schüler sehen die Aufgabe jetzt.' : `${n} Aufgaben freigeschaltet.`) : (n === 1 ? 'Gesperrt – die Schüler sehen die Aufgabe nicht mehr.' : `${n} Aufgaben gesperrt.`), 'ok');
      await load();
    } catch (e) { toast(e.message, 'error'); render(); }
  }

  // ---------------------------------------------------------------- Ereignisse
  $('task-tabs').addEventListener('click', ev => {
    const b = ev.target.closest('[data-task]');
    if (b) { S.task = b.dataset.task; S.selected.clear(); render(); return; }
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'new') openEditor(null);
    if (a.dataset.act === 'import') $('file-import').click();
    if (a.dataset.act === 'export-all') {
      const list = NWTasks.all().filter(t => t.custom);
      download('netzwerkstatt-eigene-aufgaben.json', NWEigene.fileFor(list.map(t => t.data)));
    }
  });
  $('task-tabs').addEventListener('change', ev => {
    const one = ev.target.closest('[data-unlock]');
    if (one) { setUnlocked([one.dataset.unlock], one.checked); return; }
    const grp = ev.target.closest('[data-unlock-group]');
    if (grp) setUnlocked(NWTasks.all().filter(t => t.group === grp.dataset.unlockGroup).map(t => t.id), grp.checked);
  });
  $('chk-unlock').addEventListener('change', ev => setUnlocked([S.task], ev.target.checked));
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
    if (!t.solution) return;
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

  // ---------------------------------------------------------------- Baukasten der Lehrkraft
  // Öffnet die Schüleransicht mit einem eigenen Zugang der Lehrkraft. Dort sind alle Aufgaben
  // sichtbar; Gebautes lässt sich im Aufgaben-Editor als Start oder Musterlösung übernehmen.
  $('btn-workshop').addEventListener('click', async () => {
    const win = window.open('about:blank', '_blank');
    try {
      const r = await api('POST', '/api/teacher/workshop', undefined, S.token);
      store.set('nw_token', r.token);
      if (win) win.location = '/'; else location.href = '/';
    } catch (e) { if (win) win.close(); toast(e.message, 'error'); }
  });

  // ---------------------------------------------------------------- Eigene Aufgaben: Export, Import, Löschen
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const slug = s => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'aufgabe';

  $('btn-export-task').addEventListener('click', () => {
    const t = taskObj();
    download(`aufgabe-${slug(t.title)}.json`, NWEigene.fileFor([t.data]));
  });

  $('btn-delete-task').addEventListener('click', async () => {
    const t = taskObj();
    if (!(await confirmBox(`Die eigene Aufgabe „${t.title}“ löschen? Die Arbeiten der Schüler zu dieser Aufgabe werden ebenfalls gelöscht. Exportiere sie vorher, wenn du sie behalten willst.`, 'Löschen'))) return;
    try { await api('POST', '/api/teacher/custom-delete', { id: t.id }, S.token); toast('Aufgabe gelöscht.', 'ok'); await load(); }
    catch (e) { toast(e.message, 'error'); }
  });

  $('file-import').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Die Datei ist zu groß (höchstens 5 MB).', 'error'); return; }
    let parsed;
    try { parsed = NWEigene.parseFile(await file.text()); } catch (e) { toast(e.message, 'error'); return; }
    const existing = new Set(NWTasks.all().filter(t => t.custom).map(t => t.id));
    const replace = parsed.tasks.filter(t => existing.has(t.id));
    const list = parsed.tasks.map(t => `• ${t.title}${existing.has(t.id) ? ' (ersetzt die vorhandene)' : ''}`).join('\n');
    const msg = `${parsed.tasks.length === 1 ? 'Diese Aufgabe' : `Diese ${parsed.tasks.length} Aufgaben`} importieren?\n${list}\n\nImportierte Aufgaben sind zunächst für Schüler gesperrt.`;
    if (!(await confirmBox(msg, replace.length ? 'Importieren und ersetzen' : 'Importieren'))) return;
    let ok = 0;
    for (const t of parsed.tasks) {
      try { await api('POST', '/api/teacher/custom', { task: t }, S.token); ok++; } catch (e) { toast(`${t.title}: ${e.message}`, 'error'); }
    }
    if (ok) {
      S.task = parsed.tasks[0].id;
      await load();
      toast(`${ok} ${ok === 1 ? 'Aufgabe' : 'Aufgaben'} importiert. Schalte sie frei, wenn die Klasse sie sehen soll.`, 'ok');
    }
  });

  $('btn-edit-task').addEventListener('click', () => openEditor(taskObj().data));
  $('btn-copy-task').addEventListener('click', () => {
    // Eingebaute Aufgabe als Vorlage: Texte, Start und Musterlösung übernehmen, Ziele vorschlagen
    const t = taskObj();
    const start = t.start(), sol = t.solution ? t.solution() : null;
    openEditor({
      id: NWEigene.newTaskId(), title: ('Eigene Variante: ' + t.title).slice(0, 80), intro: t.intro, tip: t.tip || '', think: t.think || '',
      manual: !!t.manual, show: t.show, start, solution: sol, goals: sol ? NWEigene.suggestGoals(start, sol) : [],
    }, true);
  });

  // ---------------------------------------------------------------- Aufgaben-Editor
  /** Quellen für Start und Musterlösung: eigene Aufbauten, Schülerarbeiten, eingebaute Aufgaben. */
  function networkSources() {
    const groups = [];
    const title = id => { const t = NWTasks.byId(id); return t ? (t.free ? t.title : `${t.num}. ${t.title}`) : id; };
    const own = Object.entries(S.data.ownWorks || {}).filter(([, w]) => w && w.network);
    if (own.length) groups.push({ label: 'Mein Baukasten', items: own.map(([tid, w]) => ({ key: 'own:' + tid, label: title(tid), net: () => w.network })) });
    const stu = [];
    for (const s of S.data.students) for (const [tid, w] of Object.entries(s.works || {})) if (w && w.network) stu.push({ key: `stu:${s.id}:${tid}`, label: `${s.name}: ${title(tid)}`, net: () => w.network });
    if (stu.length) groups.push({ label: 'Arbeiten der Schüler', items: stu });
    const built = [];
    for (const t of NWTasks.TASKS) {
      if (t.free) continue;
      built.push({ key: 'start:' + t.id, label: `${t.num}. ${t.title} – Startaufbau`, net: () => t.start() });
      if (t.solution) built.push({ key: 'sol:' + t.id, label: `${t.num}. ${t.title} – Musterlösung`, net: () => t.solution() });
    }
    groups.push({ label: 'Eingebaute Aufgaben', items: built });
    return groups;
  }

  function sourceSelect(id, first, groups) {
    return `<select id="${id}">${first.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}`
      + groups.map(g => `<optgroup label="${esc(g.label)}">${g.items.map(i => `<option value="${esc(i.key)}">${esc(i.label)}</option>`).join('')}</optgroup>`).join('') + '</select>';
  }

  function goalRowHTML(g) {
    const types = NWEigene.GOAL_TYPES;
    const def = types[g.type];
    const fields = Object.entries(def.fields).map(([k, f]) => {
      const v = g[k] !== undefined ? g[k] : f.def;
      if (f.options) return `<label class="gf">${esc(f.label)}<select data-f="${k}">${f.options.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(NWEigene.optionLabel(k, o))}</option>`).join('')}</select></label>`;
      return `<label class="gf">${esc(f.label)}<input data-f="${k}" value="${esc(v)}" ${f.num ? `type="number" min="${f.num[0]}" max="${f.num[1]}"` : 'type="text" autocomplete="off" spellcheck="false"'}></label>`;
    }).join('');
    let auto = '';
    try { auto = NWEigene.goalText(NWEigene.sanitizeGoal(Object.assign({}, g, { text: '' }), 0)); } catch (e) { /* noch unvollständig */ }
    return `<div class="goal-edit">
      <div class="goal-line"><select data-f="type" aria-label="Art des Ziels">${Object.entries(types).map(([k, t]) => `<option value="${k}" ${k === g.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      <button type="button" class="btn small ghost" data-goal-del title="Ziel entfernen">✕</button></div>
      <div class="goal-fields">${fields}</div>
      <label class="gf wide">Text für die Schüler (leer = automatisch)<input data-f="text" type="text" value="${esc(g.text || '')}" placeholder="${esc(auto)}"></label>
      <div class="goal-check small"></div>
    </div>`;
  }

  function readGoal(row) {
    const g = {};
    for (const el of row.querySelectorAll('[data-f]')) g[el.dataset.f] = el.type === 'number' ? Number(el.value) : el.value;
    return g;
  }

  /**
   * Formular für eine eigene Aufgabe. data = vorhandene Aufgabe (bearbeiten) oder null (neu).
   * isNew = true: data ist nur eine Vorlage, die als neue Aufgabe gespeichert wird.
   */
  function openEditor(data, isNew) {
    const editing = !!data && !isNew;
    const t = data || { id: NWEigene.newTaskId(), title: '', intro: '', tip: '', think: '', manual: false, goals: [], start: NW.emptyNetwork(), solution: null };
    const nets = { start: t.start, solution: t.solution };
    const groups = networkSources();
    const flat = groups.flatMap(g => g.items);
    const feats = NWTasks.FEATURES ? (Array.isArray(NWTasks.FEATURES) ? NWTasks.FEATURES : Object.keys(NWTasks.FEATURES).map(id => ({ id, label: NWTasks.FEATURES[id].label || NWTasks.FEATURES[id] }))) : null;
    const featId = f => typeof f === 'string' ? f : f.id;
    const featLabel = f => typeof f === 'string' ? f : (f.label || f.id);

    const body = openModal(`<form id="ed" class="editor-form" autocomplete="off">
      <h2 class="modal-title">${editing ? 'Eigene Aufgabe bearbeiten' : 'Neue eigene Aufgabe'}</h2>
      <p class="muted small">Tipp: Start und Musterlösung baust du am einfachsten im <b>Baukasten</b> (Knopf oben „Baukasten öffnen“). Danach wählst du sie hier aus.</p>
      <div class="ed-grid">
        <div class="ed-col">
          <label>Titel<input id="ed-title" maxlength="80" required value="${esc(t.title)}"></label>
          <label>Aufgabentext<textarea id="ed-intro" rows="5" maxlength="1500">${esc(t.intro)}</textarea></label>
          <label>Tipp (optional)<textarea id="ed-tip" rows="2" maxlength="1000">${esc(t.tip)}</textarea></label>
          <label>Denkanstoß (optional)<textarea id="ed-think" rows="2" maxlength="1000">${esc(t.think)}</textarea></label>
          <label class="toggle"><input type="checkbox" id="ed-manual" ${t.manual ? 'checked' : ''}> Adressen von Hand vergeben (neue Geräte ohne DHCP)</label>
          ${feats ? `<fieldset class="ed-feats"><legend>Funktionen auf der Arbeitsfläche</legend><p class="muted small">Ohne Auswahl ist alles sichtbar.</p>${feats.map(f => `<label class="toggle small"><input type="checkbox" data-feat="${esc(featId(f))}" ${(t.show || []).includes(featId(f)) ? 'checked' : ''}> ${esc(featLabel(f))}</label>`).join('')}</fieldset>` : ''}
        </div>
        <div class="ed-col">
          <label>Startaufbau ${sourceSelect('ed-start-src', [['keep', editing || data ? 'beibehalten' : 'leere Arbeitsfläche'], ['empty', 'leere Arbeitsfläche']], groups)}</label>
          <div class="view-wrap small-view"><svg class="canvas view" id="ed-start-view"></svg></div>
          <label>Musterlösung ${sourceSelect('ed-sol-src', [['keep', t.solution ? 'beibehalten' : 'keine Musterlösung'], ['none', 'keine Musterlösung']], groups)}</label>
          <div class="view-wrap small-view"><svg class="canvas view" id="ed-sol-view"></svg></div>
        </div>
      </div>
      <h3>Ziele <span class="muted small">(werden automatisch geprüft)</span></h3>
      <div id="ed-goals"></div>
      <div class="row">
        <button type="button" class="btn small" id="ed-add-goal">＋ Ziel hinzufügen</button>
        <button type="button" class="btn small" id="ed-suggest">Ziele aus der Musterlösung vorschlagen</button>
      </div>
      <p id="ed-error" class="error" role="alert"></p>
      <div class="row end">
        <button type="button" class="btn ghost" id="ed-cancel">Abbrechen</button>
        <button type="submit" class="btn primary">Speichern</button>
      </div>
    </form>`, { wide: true });

    const goalsBox = body.querySelector('#ed-goals');
    const addGoal = g => { goalsBox.insertAdjacentHTML('beforeend', goalRowHTML(g)); };
    t.goals.forEach(addGoal);

    function pick(sel, which) {
      const v = sel.value;
      if (v === 'keep') nets[which] = which === 'start' ? (t.start || NW.emptyNetwork()) : t.solution;
      else if (v === 'empty') nets[which] = NW.emptyNetwork();
      else if (v === 'none') nets[which] = null;
      else {
        const src = flat.find(i => i.key === v);
        nets[which] = src ? NW.clone(src.net()) : null;
      }
      draw();
    }
    function draw() {
      const sv = body.querySelector('#ed-start-view'), lv = body.querySelector('#ed-sol-view');
      NWView.render(sv, nets.start || NW.emptyNetwork(), {});
      lv.closest('.view-wrap').classList.toggle('none', !nets.solution);
      NWView.render(lv, nets.solution || NW.emptyNetwork(), {});
      checkGoals();
    }
    // Zeigt bei jedem Ziel, ob Startaufbau und Musterlösung es erfüllen
    function checkGoals() {
      for (const row of goalsBox.querySelectorAll('.goal-edit')) {
        const out = row.querySelector('.goal-check');
        let g;
        try { g = NWEigene.sanitizeGoal(readGoal(row), 0); } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message.replace(/^Ziel 1: /, ''))}</span>`; continue; }
        const task = NWEigene.compile({ goals: [g], start: NW.emptyNetwork(), solution: null });
        row.querySelector('[data-f="text"]').placeholder = NWEigene.goalText(Object.assign({}, g, { text: '' }));
        const inStart = nets.start && NWTasks.evaluate(task, nets.start)[0];
        const inSol = nets.solution && NWTasks.evaluate(task, nets.solution)[0];
        out.innerHTML = (nets.solution ? (inSol ? '<span class="ok">✓ Musterlösung erfüllt das Ziel</span>' : '<span class="bad">✕ Musterlösung erfüllt das Ziel nicht</span>') : '')
          + (inStart ? ' <span class="warn">Achtung: schon im Startaufbau erfüllt</span>' : '');
      }
    }

    body.querySelector('#ed-start-src').addEventListener('change', ev => pick(ev.target, 'start'));
    body.querySelector('#ed-sol-src').addEventListener('change', ev => pick(ev.target, 'solution'));
    body.querySelector('#ed-add-goal').addEventListener('click', () => { addGoal({ type: 'geraete' }); checkGoals(); });
    body.querySelector('#ed-suggest').addEventListener('click', () => {
      if (!nets.solution) { body.querySelector('#ed-error').textContent = 'Wähle zuerst eine Musterlösung aus.'; return; }
      const have = new Set([...goalsBox.querySelectorAll('.goal-edit')].map(r => { try { const g = NWEigene.sanitizeGoal(readGoal(r), 0); delete g.text; return JSON.stringify(g); } catch (e) { return ''; } }));
      const add = NWEigene.suggestGoals(nets.start || NW.emptyNetwork(), nets.solution).filter(g => !have.has(JSON.stringify(g)));
      add.forEach(addGoal);
      body.querySelector('#ed-error').textContent = add.length ? '' : 'Keine weiteren Vorschläge. Tipp: Führe in der Musterlösung einen Ping oder Seitenaufruf aus, dann kann daraus ein Ziel werden.';
      checkGoals();
    });
    goalsBox.addEventListener('click', ev => {
      const d = ev.target.closest('[data-goal-del]');
      if (d) { d.closest('.goal-edit').remove(); }
    });
    goalsBox.addEventListener('change', ev => {
      const row = ev.target.closest('.goal-edit');
      if (!row) return;
      if (ev.target.dataset.f === 'type') {
        row.outerHTML = goalRowHTML({ type: ev.target.value });
      }
      checkGoals();
    });
    goalsBox.addEventListener('input', () => checkGoals());
    body.querySelector('#ed-cancel').addEventListener('click', closeModal);

    body.querySelector('#ed').addEventListener('submit', async ev => {
      ev.preventDefault();
      const err = body.querySelector('#ed-error');
      err.textContent = '';
      const raw = {
        id: t.id,
        title: body.querySelector('#ed-title').value,
        intro: body.querySelector('#ed-intro').value,
        tip: body.querySelector('#ed-tip').value,
        think: body.querySelector('#ed-think').value,
        manual: body.querySelector('#ed-manual').checked,
        goals: [...goalsBox.querySelectorAll('.goal-edit')].map(readGoal),
        start: nets.start || NW.emptyNetwork(),
        solution: nets.solution,
      };
      if (feats) {
        const show = [...body.querySelectorAll('[data-feat]:checked')].map(c => c.dataset.feat);
        if (show.length) raw.show = show;
      } else if (t.show) raw.show = t.show;
      let clean;
      try {
        clean = NWEigene.sanitizeTask(raw);
        if (!clean.intro) throw new Error('Bitte einen Aufgabentext eingeben.');
        if (!clean.goals.length) throw new Error('Bitte mindestens ein Ziel angeben.');
      } catch (e) { err.textContent = e.message; return; }
      try {
        await api('POST', '/api/teacher/custom', { task: clean }, S.token);
        closeModal();
        S.task = clean.id;
        await load();
        toast(editing ? 'Aufgabe gespeichert.' : (isUnlocked(clean.id) ? 'Aufgabe gespeichert.' : 'Aufgabe gespeichert. Sie ist noch gesperrt – schalte sie frei, wenn die Klasse sie sehen soll.'), 'ok');
      } catch (e) { err.textContent = e.message; }
    });

    draw();
  }

  // Freigeschaltete Aufgaben für die Zugangsseite, nach Themen gruppiert
  function accessTasksHTML() {
    const groups = NWTasks.GROUPS.map(g => ({ g, items: NWTasks.all().filter(t => t.group === g.id && isUnlocked(t.id)) })).filter(x => x.items.length);
    if (!groups.length) return '<p class="muted">Noch keine Aufgaben freigeschaltet.</p>';
    return '<h3>Freigeschaltete Aufgaben</h3><div class="access-groups">' + groups.map(({ g, items }) =>
      `<div class="access-group"><div class="access-group-title">${esc(g.title)}</div><ul>${items.map(t => `<li><span class="num">${t.free ? '∞' : esc(t.num)}</span>${esc(t.title)}</li>`).join('')}</ul></div>`).join('') + '</div>';
  }
  // Ist die Zugangsseite offen, wird die Liste bei jeder Aktualisierung erneuert
  function refreshAccessTasks() {
    const box = document.getElementById('access-tasks');
    if (!box) return;
    const html = accessTasksHTML();
    if (box.innerHTML !== html) box.innerHTML = html;
  }

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
      <div class="access-tasks" id="access-tasks">${accessTasksHTML()}</div>
      ${addrs.length > 1 ? `<button class="btn ghost small" id="btn-other-addr">Adresse funktioniert nicht? Andere wählen (${idx + 1}/${addrs.length})</button>` : ''}
    </div>`, { wide: true, full: true });
    const other = body.querySelector('#btn-other-addr');
    if (other) other.addEventListener('click', () => { store.set('nw_addr_idx', String((idx + 1) % addrs.length)); showAccess(); });
  }
  $('btn-beamer-code').addEventListener('click', showAccess);

  start();
})();

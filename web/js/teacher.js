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
  // Rückkehr aus dem Ausprobieren: wieder dieselbe Aufgabe zeigen (…/lehrer.html?aufgabe=webseite)
  const backTask = new URLSearchParams(location.search).get('aufgabe');
  if (backTask) history.replaceState(null, '', location.pathname);

  const S = {
    token: store.get('nw_teacher'),
    data: null,
    task: backTask || NWTasks.TASKS[0].id,
    view: store.get('nw_view_class'), // angezeigte Klasse (ID, '' = ohne Klasse)
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
    // Netze kommen nur für die angezeigte Aufgabe und Klasse mit, alles andere nur als Stand
    const task = S.task, view = S.view;
    const q = '?task=' + encodeURIComponent(task) + (view === null ? '' : '&class=' + encodeURIComponent(view));
    let data;
    try {
      data = await api('GET', '/api/teacher/overview' + q, undefined, S.token);
      $('conn-lost').hidden = true;
    } catch (e) {
      $('conn-lost').hidden = !e.offline;
      if (e.status === 401) { store.del('nw_teacher'); S.token = null; clearInterval(S.timer); show('login'); }
      throw e;
    }
    // Inzwischen andere Aufgabe oder Klasse gewählt: Diese Antwort passt nicht mehr
    if (S.task !== task || S.view !== view) return load();
    S.data = data;
    NWEigene.install(S.data.customTasks || []);
    applyView();
    if (!graded().some(t => t.id === S.task)) { S.task = NWTasks.TASKS[0].id; return load(); }
    if (S.view !== view) return load(); // erste Antwort hat die Klasse festgelegt
    render();
    refreshAccessTasks();
  }

  // ---------------------------------------------------------------- Klassen
  const classes = () => (S.data && S.data.classes) || [];
  const classById = id => classes().find(c => c.id === id);
  const className = id => { const c = classById(id); return c ? c.name : 'Ohne Klasse'; };

  /** Nur die Schüler der angezeigten Klasse in S.data.students; alle stehen in S.data.allStudents. */
  function applyView() {
    const d = S.data;
    d.allStudents = d.students;
    if (!classes().length) { S.view = null; return; }
    const valid = new Set(classes().map(c => c.id));
    if (d.allStudents.some(s => !s.class)) valid.add('');
    if (S.view === null || !valid.has(S.view)) S.view = d.activeClass;
    d.students = d.allStudents.filter(s => (s.class || '') === S.view);
  }
  function setView(id) {
    S.view = id; store.set('nw_view_class', id); S.selected.clear();
    S.data.students = S.data.allStudents;
    applyView(); render();
    load().catch(() => {}); // Netze der neuen Klasse holen
  }

  function classBarHTML() {
    const d = S.data;
    if (!classes().length) {
      return `<span class="muted">Alle Schülerinnen und Schüler stehen in einer gemeinsamen Liste.</span><div class="spacer"></div>`
        + `<button class="btn small" data-cls="students" title="Anmeldungen und Arbeiten mehrerer Schüler auf einmal löschen">Schüler verwalten</button>`
        + `<button class="btn small" data-cls="manage" title="Klassen anlegen: Wer sich anmeldet, landet in der aktiven Klasse">＋ Klassen anlegen</button>`;
    }
    const n = id => d.allStudents.filter(s => (s.class || '') === id).length;
    const opts = classes().map(c => `<option value="${esc(c.id)}" ${c.id === S.view ? 'selected' : ''}>${esc(c.name)}${c.id === d.activeClass ? ' (aktiv)' : ''} – ${n(c.id)}</option>`);
    if (d.allStudents.some(s => !s.class)) opts.push(`<option value="" ${S.view === '' ? 'selected' : ''}>Ohne Klasse – ${n('')}</option>`);
    const active = S.view === d.activeClass;
    const state = active
      ? `<span class="lock-state on" title="Wer sich jetzt anmeldet, landet in dieser Klasse">aktiv – neue Anmeldungen landen hier</span>`
      : `<span class="lock-state off">nicht aktiv</span>${S.view ? `<button class="btn small primary" data-cls="activate" title="Neue Anmeldungen landen dann in dieser Klasse">Diese Klasse aktiv schalten</button>` : ''}`;
    return `<label class="class-pick">Klasse <select id="sel-class" aria-label="Angezeigte Klasse">${opts.join('')}</select></label>${state}<div class="spacer"></div>`
      + `<button class="btn small" data-cls="students" title="Anmeldungen und Arbeiten mehrerer Schüler dieser Klasse auf einmal löschen">Schüler verwalten</button>`
      + `<button class="btn small" data-cls="manage">Klassen verwalten</button>`;
  }
  function renderClassBar() {
    const html = classBarHTML();
    const bar = $('class-bar');
    if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
  }

  async function activate(id) {
    const d = S.data, c = classById(id), old = classById(d.activeClass);
    if (!c || id === d.activeClass) return false;
    const text = `Klasse ${c.name} aktiv schalten? Wer sich ab jetzt anmeldet, landet in der ${c.name}.`
      + (old ? ` Wer gerade in der ${old.name} angemeldet ist, wird abgemeldet – die Arbeiten bleiben gespeichert.` : '');
    if (!(await confirmBox(text, 'Aktiv schalten'))) return false;
    try {
      await api('POST', '/api/teacher/class-activate', { id }, S.token);
      toast(`Die ${c.name} ist jetzt aktiv.`, 'ok');
      await load();
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  // Dialog „Klassen verwalten“: anlegen, umbenennen, aktiv schalten, löschen
  function openClasses(msg) {
    const d = S.data;
    const n = id => d.allStudents.filter(s => (s.class || '') === id).length;
    const rows = classes().map(c => `<li class="class-row">
        <input data-rename="${esc(c.id)}" value="${esc(c.name)}" maxlength="20" aria-label="Name der Klasse" spellcheck="false">
        <span class="muted small cnt">${n(c.id)} ${n(c.id) === 1 ? 'Schüler/in' : 'Schüler/innen'}</span>
        ${c.id === d.activeClass ? '<span class="lock-state on">aktiv</span>' : `<button type="button" class="btn small" data-activate="${esc(c.id)}">Aktiv schalten</button>`}
        <button type="button" class="btn small ghost" data-cdel="${esc(c.id)}" title="Klasse mit allen Schülern und Arbeiten löschen">Löschen</button>
      </li>`).join('');
    const body = openModal(`<h2 class="modal-title">Klassen verwalten</h2>
      <p class="muted small">Wer sich anmeldet, landet automatisch in der <b>aktiven</b> Klasse. Namen gelten je Klasse: „Lena“ in der 10a und „Lena“ in der 10b sind zwei verschiedene Schülerinnen.${classes().length ? '' : ' Die erste Klasse wird gleich aktiv; wer schon angemeldet ist, kommt in diese Klasse.'}</p>
      ${rows ? `<ul class="class-list">${rows}</ul>` : ''}
      <form id="class-new" class="row class-new" autocomplete="off">
        <input id="class-new-name" maxlength="20" placeholder="z. B. 10a" aria-label="Name der neuen Klasse" spellcheck="false" required>
        ${classes().length ? `<label class="class-from">Freischaltungen <select id="class-new-from" aria-label="Freischaltungen der neuen Klasse">
          <option value="">wie ab Werk</option>${classes().map(c => `<option value="${esc(c.id)}">wie ${esc(c.name)}</option>`).join('')}</select></label>` : ''}
        <button type="submit" class="btn primary">＋ Klasse anlegen</button>
      </form>
      <p class="muted small">Jede Klasse hat ihre eigenen Freischaltungen für Aufgaben, Musterlösungen und Vorführungen. ${classes().length ? 'Eine neue Klasse beginnt wie ab Werk oder übernimmt die Freischaltungen einer anderen Klasse.' : 'Die erste Klasse übernimmt die Freischaltungen, die du bisher eingestellt hast.'}</p>
      <p class="error" id="class-error" role="alert">${esc(msg || '')}</p>`);
    const err = body.querySelector('#class-error');
    body.querySelector('#class-new').addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        const from = body.querySelector('#class-new-from');
        const r = await api('POST', '/api/teacher/class-add', { name: body.querySelector('#class-new-name').value, from: from ? from.value : '' }, S.token);
        if (r.active) { S.view = r.id; store.set('nw_view_class', r.id); }
        await load();
        openClasses();
        const f = document.getElementById('class-new-name');
        if (f) f.focus();
      } catch (e) { err.textContent = e.message; }
    });
    for (const inp of body.querySelectorAll('[data-rename]')) {
      inp.addEventListener('change', async () => {
        try { await api('POST', '/api/teacher/class-rename', { id: inp.dataset.rename, name: inp.value }, S.token); await load(); toast('Klasse umbenannt.', 'ok'); }
        catch (e) { err.textContent = e.message; inp.value = className(inp.dataset.rename); }
      });
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
    }
    body.addEventListener('click', async ev => {
      const a = ev.target.closest('[data-activate]');
      const del = ev.target.closest('[data-cdel]');
      if (a) { await activate(a.dataset.activate); openClasses(); }
      if (del) {
        const c = classById(del.dataset.cdel), k = n(c.id);
        const text = k
          ? `Klasse ${c.name} löschen? Dabei werden auch ${k === 1 ? 'die Schülerin bzw. der Schüler' : `alle ${k} Schülerinnen und Schüler`} der Klasse mit allen Arbeiten gelöscht. Das kann nicht rückgängig gemacht werden.`
          : `Klasse ${c.name} löschen?`;
        if (!(await confirmBox(text, 'Löschen', true))) { openClasses(); return; }
        try { await api('POST', '/api/teacher/class-delete', { id: c.id }, S.token); toast(`Klasse ${c.name} gelöscht.`, 'ok'); await load(); openClasses(); }
        catch (e) { openClasses(e.message); }
      }
    });
  }

  // Dialog „Schüler verwalten“: Für ausgewählte Schüler (oder die ganze angezeigte Klasse)
  // alle Arbeiten über alle Aufgaben löschen oder die Anmeldungen samt Arbeiten löschen.
  function openStudents(keep) {
    const d = S.data;
    const list = d.students;
    const sel = new Set((keep || []).filter(id => list.some(s => s.id === id)));
    const where = classes().length ? `der Klasse ${className(S.view)}` : '';
    const worksOf = s => Object.values(s.works || {}).filter(Boolean);
    const last = s => Math.max(0, ...worksOf(s).map(w => w.updated || 0));
    const body = openModal(`<h2 class="modal-title">Schüler verwalten${classes().length ? ': ' + esc(className(S.view)) : ''}</h2>
      <p class="muted small">Wähle Schülerinnen und Schüler aus${where ? ' ' + where : ''}. Du kannst alle ihre Arbeiten zu allen Aufgaben löschen, dann bleibt die Anmeldung bestehen. Oder du löschst die Anmeldungen, dann sind auch alle Arbeiten weg.${classes().length ? ' Eine andere Klasse wählst du oben in der Lehreransicht.' : ''}</p>
      ${list.length ? `<div class="stu-tools">
        <label class="toggle"><input type="checkbox" id="stu-all"> Alle auswählen (${list.length})</label>
        <div class="spacer"></div>
        <button class="btn danger" id="stu-del-works" disabled>Arbeiten löschen</button>
        <button class="btn danger-fill" id="stu-del" disabled>Anmeldungen löschen</button>
      </div>
      <div class="table-wrap stu-wrap"><table class="students stu-table"><thead><tr><th class="sel"></th><th>Name</th><th>Arbeiten</th><th>Zuletzt</th></tr></thead><tbody>${list.map(s => {
        const ws = worksOf(s), sub = ws.filter(w => w.submitted).length, t = last(s);
        return `<tr><td class="sel"><input type="checkbox" data-stu="${esc(s.id)}" aria-label="${esc(s.name)} auswählen"></td><td class="name">${esc(s.name)}</td>
          <td>${ws.length ? `${ws.length} ${ws.length === 1 ? 'Aufgabe' : 'Aufgaben'}${sub ? `, ${sub} abgegeben` : ''}` : '<span class="muted">keine</span>'}</td>
          <td class="muted">${t ? new Date(t * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="muted">Hier hat sich noch niemand angemeldet.</p>`}`, { wide: true });
    if (!list.length) return;
    const upd = () => {
      for (const c of body.querySelectorAll('[data-stu]')) c.checked = sel.has(c.dataset.stu);
      const all = body.querySelector('#stu-all');
      all.checked = sel.size === list.length; all.indeterminate = sel.size > 0 && sel.size < list.length;
      const nw = list.filter(s => sel.has(s.id)).reduce((a, s) => a + worksOf(s).length, 0);
      const bw = body.querySelector('#stu-del-works'), bd = body.querySelector('#stu-del');
      bw.disabled = !nw; bd.disabled = !sel.size;
      bw.textContent = nw ? `Arbeiten löschen (${nw})` : 'Arbeiten löschen';
      bd.textContent = sel.size ? `Anmeldungen löschen (${sel.size})` : 'Anmeldungen löschen';
    };
    body.addEventListener('change', ev => {
      if (ev.target.id === 'stu-all') { sel.clear(); if (ev.target.checked) for (const s of list) sel.add(s.id); }
      const c = ev.target.closest('[data-stu]');
      if (c) { if (c.checked) sel.add(c.dataset.stu); else sel.delete(c.dataset.stu); }
      upd();
    });
    const run = async worksOnly => {
      const chosen = list.filter(s => sel.has(s.id));
      const n = chosen.length, nw = chosen.reduce((a, s) => a + worksOf(s).length, 0);
      const all = n === list.length && list.length > 1;
      const who = all ? (classes().length ? `allen ${n} Schülerinnen und Schülern der Klasse ${className(S.view)}` : `allen ${n} Schülerinnen und Schülern`)
        : n === 1 ? chosen[0].name : `${n} Schülerinnen und Schülern`;
      const names = n > 1 ? '\n' + chosen.slice(0, 12).map(s => '• ' + s.name).join('\n') + (n > 12 ? `\n… und ${n - 12} weitere` : '') + '\n' : ' ';
      const msg = worksOnly
        ? `Wirklich alle Arbeiten von ${who} löschen (${nw} ${nw === 1 ? 'Arbeit' : 'Arbeiten'} in allen Aufgaben)?${names}Die Anmeldungen bleiben bestehen, die Schüler fangen jede Aufgabe neu an. Das kann nicht rückgängig gemacht werden.`
        : `Wirklich die ${n === 1 ? 'Anmeldung' : 'Anmeldungen'} von ${who} löschen?${names}Dabei werden auch alle Arbeiten gelöscht${nw ? ` (${nw})` : ''}. Wer sich danach mit demselben Namen anmeldet, beginnt ganz neu. Das kann nicht rückgängig gemacht werden.`;
      const ok = await confirmBox(msg, worksOnly ? 'Arbeiten löschen' : (n === 1 ? 'Anmeldung löschen' : `${n} Anmeldungen löschen`), true);
      if (!ok) { openStudents([...sel]); return; }
      try {
        const r = await api('POST', '/api/teacher/delete-students', { students: chosen.map(s => s.id), worksOnly }, S.token);
        for (const s of chosen) S.selected.delete(s.id);
        toast(worksOnly ? `${r.works} ${r.works === 1 ? 'Arbeit' : 'Arbeiten'} gelöscht.` : `${r.students} ${r.students === 1 ? 'Anmeldung' : 'Anmeldungen'} gelöscht.`, 'ok');
        await load();
        openStudents(worksOnly ? [...sel] : []);
      } catch (e) { toast(e.message, 'error'); openStudents([...sel]); }
    };
    body.querySelector('#stu-del-works').addEventListener('click', () => run(true));
    body.querySelector('#stu-del').addEventListener('click', () => run(false));
    upd();
  }

  // Schüler in eine andere Klasse verschieben
  function openMove(s) {
    const others = classes().filter(c => c.id !== (s.class || ''));
    const body = openModal(`<h2 class="modal-title">${esc(s.name)} in andere Klasse verschieben</h2>
      <p class="muted small">Jetzt in: <b>${esc(className(s.class))}</b>. Die Arbeiten werden mitgenommen.</p>
      <div class="row">${others.map(c => `<button class="btn" data-to="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
      <p class="error" id="move-error" role="alert"></p>`);
    body.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-to]');
      if (!b) return;
      try {
        await api('POST', '/api/teacher/move-student', { student: s.id, class: b.dataset.to }, S.token);
        closeModal(); toast(`${s.name} ist jetzt in der ${className(b.dataset.to)}.`, 'ok'); await load();
      } catch (e) { body.querySelector('#move-error').textContent = e.message; }
    });
  }

  $('class-bar').addEventListener('change', ev => { if (ev.target.id === 'sel-class') setView(ev.target.value); });
  $('class-bar').addEventListener('click', ev => {
    const b = ev.target.closest('[data-cls]');
    if (!b) return;
    if (b.dataset.cls === 'manage') openClasses();
    if (b.dataset.cls === 'students') openStudents();
    if (b.dataset.cls === 'activate') activate(S.view);
  });

  // ---------------------------------------------------------------- Darstellung
  function taskObj() { return NWTasks.byId(S.task); }
  const isUnlocked = id => !!(S.data && S.data.unlocked && S.data.unlocked[id]);
  // Freischaltungen gelten je Klasse: für die angezeigte (bei „Ohne Klasse“ für die aktive)
  const fClass = () => (S.data && S.data.freigabenClass) || undefined;
  const fFor = () => fClass() ? ' für die ' + className(fClass()) : '';

  function render() {
    const d = S.data;
    $('room-code').textContent = d.roomCode;
    renderClassBar();
    // Aufgabenliste, nach Themen gruppiert, mit Schaltern zum Freischalten
    const count = id => d.students.filter(s => s.works && s.works[id] && s.works[id].submitted).length;
    const fHint = fClass() ? `<p class="muted small nav-hint f-hint">Häkchen = für die <b>${esc(className(fClass()))}</b> freigeschaltet. Jede Klasse hat ihre eigenen Freischaltungen.</p>` : '';
    $('task-tabs').innerHTML = fHint + NWTasks.GROUPS.map(g => {
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
          + (t.solution && d.released[t.id] ? '<span class="sol-mark" title="Musterlösung für Schüler freigegeben" aria-label="Musterlösung freigegeben">Lösung</span>' : '')
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
    $('task-lock').textContent = (isUnlocked(S.task) ? 'freigeschaltet' : 'gesperrt') + (fClass() ? fFor() : ' für Schüler');
    $('task-lock').className = 'lock-state ' + (isUnlocked(S.task) ? 'on' : 'off');
    $('chk-unlock').checked = isUnlocked(S.task);
    const fw = fClass() ? 'die ' + className(fClass()) : 'Schüler';
    $('lbl-unlock').textContent = `Für ${fw} freischalten`;
    $('lbl-release').textContent = `Musterlösung für ${fw} freigeben`;
    $('chk-release').checked = !!d.released[S.task];
    $('btn-show-solution').hidden = !cur.solution;
    $('chk-release').closest('label').hidden = !cur.solution;
    for (const id of ['btn-edit-task', 'btn-export-task', 'btn-delete-task']) $(id).hidden = !cur.custom;
    $('btn-copy-task').hidden = !!cur.custom;

    const task = taskObj();
    const only = $('chk-only-submitted').checked;
    const rows = d.students.filter(s => !only || (s.works && s.works[S.task] && s.works[S.task].submitted));
    $('empty').hidden = d.students.length > 0;
    $('empty').textContent = S.view
      ? `In der Klasse ${className(S.view)} hat sich noch niemand angemeldet.` + (S.view === d.activeClass ? ' Zeige den Zugang am Beamer, damit sich alle anmelden können.' : ' Schalte sie aktiv, damit sich die Klasse anmelden kann.')
      : 'Noch keine Schülerinnen und Schüler angemeldet. Zeige den Zugang am Beamer, damit sich alle anmelden können.';
    const canMove = s => classes().some(c => c.id !== (s.class || ''));
    $('rows').innerHTML = rows.map(s => {
      const w = s.works && s.works[S.task];
      let status = '<span class="badge">nicht begonnen</span>', prog = '', when = '';
      if (w && w.network) {
        const res = NWTasks.evaluate(task, w.network);
        const done = res.filter(Boolean).length;
        prog = res.length ? `<div class="progress"><div class="bar"><i style="width:${Math.round(100 * done / res.length)}%"></i></div>${done}/${res.length}</div>` : '';
        status = w.submitted ? '<span class="badge ok">abgegeben ✓</span>' : '<span class="badge new">arbeitet</span>';
        if (!task.free && w.network.level) status += ` <span class="badge" title="Wie viel Hilfe sich die Schülerin oder der Schüler bei dieser Aufgabe anzeigen lässt">${esc(NWStufen.badge(NWStufen.of(w.network)))}</span>`;
        when = new Date(w.updated * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      }
      const has = w && w.network;
      return `<tr>
        <td class="sel">${has ? `<input type="checkbox" data-sel="${s.id}" ${S.selected.has(s.id) ? 'checked' : ''} aria-label="${esc(s.name)} auswählen">` : ''}</td>
        <td class="name">${esc(s.name)}</td><td>${status}</td><td>${prog}</td><td class="muted">${when}</td>
        <td class="actions">${has ? `<button class="btn small" data-view="${s.id}">Zeigen</button>` : ''}
          ${w && w.submitted ? `<button class="btn small ghost" data-return="${s.id}" title="Abgabe zurückgeben, damit weitergearbeitet werden kann">Zurückgeben</button>` : ''}
          ${has ? `<button class="btn small ghost" data-delwork="${s.id}" title="Nur die Arbeit zu dieser Aufgabe löschen – die Anmeldung und andere Aufgaben bleiben">Arbeit löschen</button>` : ''}
          <span class="keep">${s.hasCode ? `<button class="btn small ghost" data-code="${s.id}" title="Vergessenen Code zurücksetzen">Code zurücksetzen</button>` : '<span class="badge" title="Beim nächsten Anmelden gilt der neu eingegebene Code">Code frei</span>'}
          ${canMove(s) ? `<button class="btn small ghost" data-move="${s.id}" title="In eine andere Klasse verschieben">⇄ Klasse</button>` : ''}
          <button class="btn small ghost" data-del="${s.id}" title="Anmeldung mit allen Arbeiten löschen" aria-label="Anmeldung löschen">✕</button></span></td></tr>`;
    }).join('');
    // nicht mehr vorhandene Auswahl entfernen
    for (const id of [...S.selected]) {
      const st = d.students.find(s => s.id === id);
      if (!st || !(st.works && st.works[S.task] && st.works[S.task].network)) S.selected.delete(id);
    }
    $('btn-compare').disabled = S.selected.size !== 2;
    $('btn-compare').textContent = S.selected.size === 2 ? 'Ausgewählte vergleichen' : S.selected.size > 2 ? 'Zum Vergleichen genau 2 auswählen' : `Zum Vergleichen 2 auswählen (${S.selected.size}/2)`;
    $('btn-delete-sel').disabled = S.selected.size === 0;
    $('btn-delete-sel').textContent = S.selected.size ? `Ausgewählte löschen (${S.selected.size})` : 'Ausgewählte löschen';
    // „Alle auswählen“ bezieht sich auf die angezeigten Zeilen mit Arbeit
    const selectable = selectableIds();
    const on = selectable.filter(id => S.selected.has(id)).length;
    $('chk-sel-all').disabled = !selectable.length;
    $('chk-sel-all').checked = selectable.length > 0 && on === selectable.length;
    $('chk-sel-all').indeterminate = on > 0 && on < selectable.length;
  }

  // Angezeigte Zeilen, die zur aktuellen Aufgabe eine Arbeit haben (beachtet „nur Abgaben“)
  function selectableIds() {
    const only = $('chk-only-submitted').checked;
    return S.data.students.filter(s => {
      const w = s.works && s.works[S.task];
      return w && w.network && (!only || w.submitted);
    }).map(s => s.id);
  }

  function student(id) { return S.data.students.find(s => s.id === id); }
  function anon() { return $('chk-anon').checked; }

  // ---------------------------------------------------------------- Freischalten
  async function setUnlocked(ids, on) {
    try {
      await api('POST', '/api/teacher/unlock', { tasks: ids, unlocked: on, class: fClass() }, S.token);
      const n = ids.length, f = fFor();
      toast(on ? (n === 1 ? `Freigeschaltet${f} – die Schüler sehen die Aufgabe jetzt.` : `${n} Aufgaben${f} freigeschaltet.`) : (n === 1 ? `Gesperrt${f} – die Schüler sehen die Aufgabe nicht mehr.` : `${n} Aufgaben${f} gesperrt.`), 'ok');
      await load();
    } catch (e) { toast(e.message, 'error'); render(); }
  }

  // ---------------------------------------------------------------- Ereignisse
  $('task-tabs').addEventListener('click', ev => {
    const b = ev.target.closest('[data-task]');
    if (b) { S.task = b.dataset.task; S.selected.clear(); load().catch(() => render()); return; }
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

  // Musterlösungen freigeben oder sperren: eine, ein ganzes Thema oder alle
  async function setReleased(ids, on) {
    await api('POST', '/api/teacher/release', { tasks: ids, released: on, class: fClass() }, S.token);
    const n = ids.length, f = fFor();
    toast(on ? (n === 1 ? `Musterlösung ist${f || ' für die Schüler'} freigegeben.` : `${n} Musterlösungen${f} freigegeben.`)
      : (n === 1 ? `Musterlösung ist${f} wieder gesperrt.` : `${n} Musterlösungen${f} gesperrt.`), 'ok');
    await load();
  }

  $('chk-release').addEventListener('change', async ev => {
    try { await setReleased([S.task], ev.target.checked); }
    catch (e) { toast(e.message, 'error'); render(); }
  });

  // Dialog „Musterlösungen freigeben“: nach Themen geordnet, mit Häkchen je Aufgabe und je Thema
  function openSolutions() {
    const rel = id => !!S.data.released[id];
    const groups = NWTasks.GROUPS.map(g => ({ g, items: NWTasks.all().filter(t => t.group === g.id && t.solution) })).filter(x => x.items.length);
    const all = groups.flatMap(x => x.items);
    const on = all.filter(t => rel(t.id)).length;
    const body = openModal(`<h2 class="modal-title">Musterlösungen freigeben${fClass() ? ': ' + esc(className(fClass())) : ''}</h2>
      <p class="muted small">${fClass() ? `Die Häkchen gelten nur für die <b>${esc(className(fClass()))}</b>. Eine andere Klasse wählst du oben in der Lehreransicht. ` : ''}Freigegebene Musterlösungen können die Schüler in der Aufgabe über den Knopf „Musterlösung“ ansehen. Mit dem Häkchen vor einem Thema gibst du alle Musterlösungen dieses Themas auf einmal frei oder sperrst sie wieder. Ist eine Aufgabe noch gesperrt (Hinweis „gesperrt“), sehen die Schüler sie und ihre Musterlösung erst, wenn du die Aufgabe freischaltest.</p>
      <div class="stu-tools">
        <span class="muted small">${on} von ${all.length} freigegeben</span>
        <div class="spacer"></div>
        <button class="btn small" data-relall="1" ${on === all.length ? 'disabled' : ''}>Alle freigeben</button>
        <button class="btn small ghost" data-relall="0" ${on ? '' : 'disabled'}>Alle sperren</button>
      </div>
      <div class="sol-groups">${groups.map(({ g, items }) => {
        const k = items.filter(t => rel(t.id)).length;
        return `<div class="sol-group"><label class="sol-head"><input type="checkbox" data-relgroup="${esc(g.id)}" ${k === items.length ? 'checked' : ''} ${k && k < items.length ? 'data-mixed="1"' : ''}><span>${esc(g.title)}</span><span class="muted small">${k} von ${items.length}</span></label>`
          + `<ul>${items.map(t => `<li><label class="sol-row"><input type="checkbox" data-rel="${esc(t.id)}" ${rel(t.id) ? 'checked' : ''}><span class="num">${esc(t.num)}</span><span class="ttl">${esc(t.title)}</span>${isUnlocked(t.id) ? '' : '<span class="lock-state off" title="Die Aufgabe selbst ist für Schüler noch gesperrt – sie sehen sie erst, wenn du sie freischaltest">gesperrt</span>'}</label></li>`).join('')}</ul></div>`;
      }).join('')}</div>`, { wide: true });
    for (const c of body.querySelectorAll('[data-mixed]')) c.indeterminate = true;
    const run = async (ids, val) => {
      try { await setReleased(ids, val); } catch (e) { toast(e.message, 'error'); }
      if (!$('modal').hidden) openSolutions();
    };
    body.addEventListener('change', ev => {
      const one = ev.target.closest('[data-rel]');
      if (one) { run([one.dataset.rel], one.checked); return; }
      const grp = ev.target.closest('[data-relgroup]');
      if (grp) run(groups.find(x => x.g.id === grp.dataset.relgroup).items.map(t => t.id), grp.checked);
    });
    body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-relall]');
      if (b) run(all.map(t => t.id), b.dataset.relall === '1');
    });
  }
  $('btn-solutions').addEventListener('click', openSolutions);

  $('btn-show-solution').addEventListener('click', () => {
    const t = taskObj();
    if (!t.solution) return;
    NWDetails.open('Musterlösung: ' + t.title, t, t.solution(), { solution: true });
  });

  $('rows').addEventListener('change', ev => {
    const c = ev.target.closest('[data-sel]');
    if (!c) return;
    if (c.checked) S.selected.add(c.dataset.sel);
    else S.selected.delete(c.dataset.sel);
    render();
  });
  $('chk-sel-all').addEventListener('change', ev => {
    const ids = selectableIds();
    for (const id of ids) { if (ev.target.checked) S.selected.add(id); else S.selected.delete(id); }
    render();
  });
  $('chk-only-submitted').addEventListener('change', () => {
    // Beim Umschalten auf „nur Abgaben“ keine unsichtbaren Zeilen ausgewählt lassen
    if ($('chk-only-submitted').checked) { const vis = new Set(selectableIds()); for (const id of [...S.selected]) if (!vis.has(id)) S.selected.delete(id); }
    render();
  });

  // ---------------------------------------------------------------- Arbeiten löschen
  // Ein Aufruf für einen, viele oder (später) alle Einträge: jeweils Schüler/in + Aufgabe.
  async function deleteWorks(ids) {
    const t = taskObj();
    const list = ids.map(student).filter(Boolean);
    if (!list.length) return;
    const n = list.length;
    const sub = list.filter(s => s.works[S.task] && s.works[S.task].submitted).length;
    const who = n === 1 ? `die Arbeit von ${list[0].name}` : `die Arbeiten von ${n} Schülerinnen und Schülern`;
    const names = n > 1 ? '\n' + list.slice(0, 12).map(s => '• ' + s.name).join('\n') + (n > 12 ? `\n… und ${n - 12} weitere` : '') + '\n' : ' ';
    const extra = sub ? (n === 1 ? 'Sie ist schon abgegeben. ' : (sub === 1 ? 'Davon ist 1 schon abgegeben. ' : `Davon sind ${sub} schon abgegeben. `)) : '';
    const msg = `Wirklich ${who} zur Aufgabe „${t.title}“ löschen?${names}${extra}Die Anmeldung und die Arbeiten zu anderen Aufgaben bleiben erhalten. Das Löschen kann nicht rückgängig gemacht werden.`;
    if (!(await confirmBox(msg, n === 1 ? 'Arbeit löschen' : `${n} Arbeiten löschen`, true))) return;
    try {
      const r = await api('POST', '/api/teacher/delete-works', { items: list.map(s => ({ student: s.id, task: S.task })) }, S.token);
      for (const s of list) S.selected.delete(s.id);
      toast(r.deleted === 1 ? 'Arbeit gelöscht.' : `${r.deleted} Arbeiten gelöscht.`, 'ok');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  }
  $('btn-delete-sel').addEventListener('click', () => deleteWorks([...S.selected]));

  $('rows').addEventListener('click', async ev => {
    const v = ev.target.closest('[data-view]');
    const r = ev.target.closest('[data-return]');
    const del = ev.target.closest('[data-del]');
    const code = ev.target.closest('[data-code]');
    const dw = ev.target.closest('[data-delwork]');
    if (dw) { await deleteWorks([dw.dataset.delwork]); return; }
    const mv = ev.target.closest('[data-move]');
    if (mv) openMove(student(mv.dataset.move));
    if (code) {
      const s = student(code.dataset.code);
      if (!(await confirmBox(`Code von ${s.name} zurücksetzen? Beim nächsten Anmelden gilt der Code, den ${s.name} dann eingibt. Die Arbeiten bleiben erhalten.`, 'Zurücksetzen'))) return;
      try { await api('POST', '/api/teacher/reset-code', { student: s.id }, S.token); toast(`Code von ${s.name} zurückgesetzt. Jetzt neu anmelden lassen.`, 'ok'); await load(); }
      catch (e) { toast(e.message, 'error'); }
    }
    if (v) {
      const s = student(v.dataset.view);
      const t = taskObj();
      const net = s.works[S.task].network;
      const title = anon() ? `Lösung: ${t.title}` : `${s.name}: ${t.title}`;
      NWDetails.open(title, t, net);
    }
    if (r) {
      try { await api('POST', '/api/teacher/return', { student: r.dataset.return, task: S.task }, S.token); toast('Abgabe zurückgegeben.', 'ok'); await load(); }
      catch (e) { toast(e.message, 'error'); }
    }
    if (del) {
      const s = student(del.dataset.del);
      if (!(await confirmBox(`${s.name} mit allen Arbeiten löschen? Das kann nicht rückgängig gemacht werden.`, 'Löschen', true))) return;
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
  // Freies Bauen: im selben Fenster in den Baukasten wechseln und gleich das freie Bauen öffnen.
  // Oben links führt „← Lehreransicht“ wieder hierher zurück (die Anmeldung bleibt bestehen).
  $('btn-free').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/teacher/workshop', undefined, S.token);
      store.set('nw_token', r.token);
      location.href = '/?frei=1';
    } catch (e) { toast(e.message, 'error'); }
  });

  // Selbst ausprobieren: die gewählte Aufgabe im Baukasten öffnen – genau wie die Schüler sie sehen.
  // Der Baukasten-Zugang taucht nicht in der Schülerliste und nicht bei den Abgaben auf.
  $('btn-try-task').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/teacher/workshop', undefined, S.token);
      store.set('nw_token', r.token);
      location.href = '/?aufgabe=' + encodeURIComponent(S.task);
    } catch (e) { toast(e.message, 'error'); }
  });

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
    if (!(await confirmBox(`Die eigene Aufgabe „${t.title}“ löschen? Die Arbeiten der Schüler zu dieser Aufgabe werden ebenfalls gelöscht. Exportiere sie vorher, wenn du sie behalten willst.`, 'Löschen', true))) return;
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
    const who = s => classes().length ? `${s.name} (${className(s.class)})` : s.name;
    // Die Netze der Schüler holt erst die Auswahl vom Server (die Übersicht enthält sie nicht alle)
    const fetchNet = (sid, tid) => async () => (await api('GET', `/api/teacher/work?student=${encodeURIComponent(sid)}&task=${encodeURIComponent(tid)}`, undefined, S.token)).network;
    for (const s of S.data.allStudents) for (const tid of Object.keys(s.works || {})) if (s.works[tid]) stu.push({ key: `stu:${s.id}:${tid}`, label: `${who(s)}: ${title(tid)}`, net: fetchNet(s.id, tid) });
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
      let v = g[k] !== undefined ? g[k] : f.def;
      if (f.net) v = String(v).replace(/\.0\/24$/, '.x'); // Netz in Schülerschreibweise: 192.168.1.x
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
      <p class="muted small">Tipp: Start und Musterlösung baust du am einfachsten im <b>Baukasten</b> (Knopf oben „Baukasten“). Danach wählst du sie hier aus.</p>
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

    async function pick(sel, which) {
      const v = sel.value;
      if (v === 'keep') nets[which] = which === 'start' ? (t.start || NW.emptyNetwork()) : t.solution;
      else if (v === 'empty') nets[which] = NW.emptyNetwork();
      else if (v === 'none') nets[which] = null;
      else {
        const src = flat.find(i => i.key === v);
        let net = null;
        try { net = src ? await src.net() : null; } catch (e) { toast(e.message, 'error'); }
        if (sel.value !== v) return; // inzwischen etwas anderes gewählt
        nets[which] = net ? NW.clone(net) : null;
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
          ${classById(S.data.activeClass) ? `<p class="muted">Klasse</p><div class="big-class">${esc(className(S.data.activeClass))}</div>` : ''}
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

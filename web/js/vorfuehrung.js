/* NetzWerkstatt – Vorführungen abspielen. Schüler sehen nur, was die Lehrkraft freigegeben hat. */
(function () {
  'use strict';
  const { store, api, esc, toast } = NWCommon;
  const $ = id => document.getElementById(id);
  // access: null = noch unbekannt; sonst { teacher, all, open, token }
  const S = { demo: null, k: 0, run: 0, access: null };

  /** Wer schaut zu? Lehrkraft (sieht alles und gibt frei) oder angemeldete Schüler (nur Freigegebenes). */
  async function loadAccess() {
    const tries = [store.get('nw_teacher'), store.get('nw_token')].filter(Boolean);
    let lastErr = null;
    // Die Lehrkraft gibt für eine Klasse frei: zuerst die in der Lehreransicht gewählte
    const cls = store.get('nw_view_class');
    for (const tok of tries) {
      try {
        const r = await api('GET', '/api/demos' + (cls ? '?class=' + encodeURIComponent(cls) : ''), undefined, tok);
        return { teacher: !!r.teacher, all: !!r.all, open: r.open || {}, token: tok, cls: r.class || '', classes: r.classes || [], active: r.activeClass || '' };
      } catch (e) {
        lastErr = e;
        if (e.status !== 401) break;
      }
    }
    if (lastErr && lastErr.offline) throw lastErr;
    return null; // nicht angemeldet
  }
  const seesAll = () => !!(S.access && (S.access.teacher || S.access.all));
  const allowed = d => !!(S.access && (seesAll() || S.access.open[d.id]));

  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
  }

  function showList() {
    show('list');
    S.demo = null; S.run++;
    const a = S.access;
    const teacher = !!(a && a.teacher);
    $('intro-teacher').hidden = !teacher;
    $('intro-student').hidden = teacher || !a;
    // Zurück dorthin, woher man kam (Lehreransicht oder Aufgaben)
    document.querySelector('.back-link').href = teacher ? 'lehrer.html' : 'index.html';
    const msg = $('demo-msg');
    msg.hidden = true;
    if (!a) {
      msg.innerHTML = 'Bitte melde dich zuerst an. Dann siehst du hier die Vorführungen, die deine Lehrkraft freigegeben hat. <a href="index.html">Zur Anmeldung</a>';
      msg.hidden = false;
      $('demo-list').innerHTML = '';
      return;
    }
    const list = NWDemos.DEMOS.filter(allowed);
    if (!list.length) {
      msg.textContent = 'Deine Lehrkraft hat noch keine Vorführung freigegeben. Schau später noch einmal vorbei.';
      msg.hidden = false;
    }
    const tile = d => `<button class="task-tile" data-demo="${d.id}"><div class="tile-num">▶</div><div class="tile-body"><h4>${esc(d.title)}</h4><p>${esc(d.short)}</p><div class="tile-meta"><span class="muted small">${d.steps.length} Schritte</span></div></div></button>`;
    if (teacher) {
      const n = NWDemos.DEMOS.filter(d => a.open[d.id]).length;
      const cname = (a.classes.find(c => c.id === a.cls) || {}).name;
      const who = cname ? `die ${cname}` : 'Schüler';
      $('demo-class').hidden = !a.classes.length;
      $('sel-demo-class').innerHTML = a.classes.map(c => `<option value="${esc(c.id)}"${c.id === a.cls ? ' selected' : ''}>${esc(c.name)}${c.id === a.active ? ' (aktiv)' : ''}</option>`).join('');
      $('demo-open-count').textContent = n === 0 ? `Für ${who} ist noch keine Vorführung freigegeben.`
        : n === NWDemos.DEMOS.length ? `Alle Vorführungen sind für ${who} freigegeben.`
        : `${n} von ${NWDemos.DEMOS.length} Vorführungen sind für ${who} freigegeben.`;
      $('btn-open-all').disabled = n === NWDemos.DEMOS.length;
      $('btn-close-all').disabled = n === 0;
      $('demo-list').innerHTML = list.map(d => `<div class="demo-item${a.open[d.id] ? '' : ' closed'}">${tile(d)}<label class="toggle"><input type="checkbox" data-open="${d.id}"${a.open[d.id] ? ' checked' : ''}> Für ${cname ? esc(cname) : 'Schüler'} freigeben</label></div>`).join('');
    } else {
      $('demo-list').innerHTML = list.map(tile).join('');
    }
  }
  async function setOpen(ids, open) {
    try {
      const a = S.access, cname = (a.classes.find(c => c.id === a.cls) || {}).name, f = cname ? ' für die ' + cname : '';
      await api('POST', '/api/teacher/demos', { demos: ids, open, class: a.cls || undefined }, a.token);
      for (const id of ids) { if (open) a.open[id] = true; else delete a.open[id]; }
      toast(open ? (ids.length > 1 ? `Alle Vorführungen${f} freigegeben.` : `Vorführung${f} freigegeben.`) : (ids.length > 1 ? `Alle Vorführungen${f} gesperrt.` : `Vorführung${f} gesperrt.`), 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    showList();
  }
  $('demo-list').addEventListener('change', ev => {
    const c = ev.target.closest('[data-open]');
    if (c) setOpen([c.dataset.open], c.checked);
  });
  // Andere Klasse wählen: gilt auch für die Lehreransicht
  $('sel-demo-class').addEventListener('change', async ev => {
    store.set('nw_view_class', ev.target.value);
    try { S.access = await loadAccess(); } catch (e) { toast(e.message, 'error'); }
    showList();
  });
  $('btn-open-all').addEventListener('click', () => setOpen(NWDemos.DEMOS.map(d => d.id), true));
  $('btn-close-all').addEventListener('click', () => setOpen(NWDemos.DEMOS.map(d => d.id), false));
  $('demo-list').addEventListener('click', ev => {
    const b = ev.target.closest('[data-demo]');
    if (b) openDemo(b.dataset.demo, 0);
  });
  $('btn-list').addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); showList(); });

  function openDemo(id, k) {
    const demo = NWDemos.byId(id);
    if (!demo || !allowed(demo)) { showList(); return; }
    if (!S.demo || S.demo.id !== id) NWView.resetZoom($('canvas'));
    S.demo = demo;
    $('demo-title').textContent = demo.title;
    show('demo');
    history.replaceState(null, '', location.pathname + location.search + '#' + demo.id);
    goTo(k);
  }

  function logStep(step) {
    const log = $('log');
    const div = document.createElement('div');
    div.className = 'log-entry ' + (step.kind || '') + (step.ok === false ? ' failed' : '') + (step.tcp ? ' tcp' : '');
    const pc = /^TCP/.test(step.proto || '') ? ' tcp' : /^UDP/.test(step.proto || '') ? ' udp' : '';
    div.innerHTML = `<span class="log-label">${esc(step.label)}</span>${step.proto ? `<span class="log-proto${pc}">${esc(step.proto)}</span>` : ''}<span class="log-text">${esc(step.text || '')}</span>${step.note ? `<span class="log-note">↔ ${esc(step.note)}</span>` : ''}`;
    log.prepend(div);
  }
  function logResult(res) {
    if (!res) return;
    const ok = !!res.ok;
    const text = ok ? (res.message || 'Die Antwort ist angekommen.') : res.error;
    if (!text) return;
    const div = document.createElement('div');
    div.className = 'log-entry result ' + (ok ? 'ok' : 'bad');
    div.innerHTML = `<span class="log-label">${ok ? '✓ Erfolg' : '✕ Problem'}</span><span class="log-text">${esc(text)}</span>`;
    $('log').prepend(div);
  }

  function render(net) {
    const st = S.demo.steps[S.k];
    NWView.render($('canvas'), net, { highlight: new Set(st.focus || []), fit: true });
  }

  async function goTo(k) {
    const demo = S.demo;
    S.k = Math.max(0, Math.min(demo.steps.length - 1, k));
    const st = demo.steps[S.k];
    $('demo-count').textContent = `Schritt ${S.k + 1} von ${demo.steps.length}`;
    $('demo-dots').innerHTML = demo.steps.map((s, i) => `<li><button class="${i === S.k ? 'on' : i < S.k ? 'seen' : ''}" data-k="${i}" title="${esc(s.title)}" aria-label="Schritt ${i + 1}: ${esc(s.title)}">${i + 1}</button></li>`).join('');
    $('step-title').textContent = st.title;
    $('step-text').textContent = st.text;
    $('btn-prev').disabled = S.k === 0;
    $('btn-next').hidden = S.k === demo.steps.length - 1;
    $('btn-replay').hidden = !st.run;
    const last = S.k === demo.steps.length - 1;
    $('demo-end').hidden = !last;
    $('btn-try').href = 'index.html?aufgabe=' + encodeURIComponent(demo.task);
    $('log').innerHTML = st.run ? '' : '<div class="log-empty">In diesem Schritt sind keine Pakete unterwegs. Schau dir das Netz in Ruhe an.</div>';
    await play();
  }

  async function play() {
    const run = ++S.run;
    const { net, res, steps } = NWDemos.runStep(S.demo, S.k);
    // Vor der Animation: Netz so zeigen, wie es zu Beginn des Schritts ist
    render(NWDemos.stateAt(S.demo, S.k));
    if (!res) { render(net); return; }
    $('log').innerHTML = '';
    document.body.classList.add('busy');
    try {
      await NWView.animate($('canvas'), net, steps, step => { if (run === S.run) logStep(step); }, $('chk-slow').checked ? 800 : 420);
    } finally { if (run === S.run) document.body.classList.remove('busy'); }
    if (run !== S.run) return;
    logResult(res);
    render(net); // danach mit dem Ergebnis (z. B. neuer Adresse)
  }

  $('btn-prev').addEventListener('click', () => goTo(S.k - 1));
  $('btn-next').addEventListener('click', () => goTo(S.k + 1));
  $('btn-replay').addEventListener('click', () => play());
  $('demo-dots').addEventListener('click', ev => { const b = ev.target.closest('[data-k]'); if (b) goTo(Number(b.dataset.k)); });
  document.addEventListener('keydown', ev => {
    if (!S.demo || ev.target.closest('input, textarea')) return;
    if (ev.key === 'ArrowRight' && S.k < S.demo.steps.length - 1) goTo(S.k + 1);
    if (ev.key === 'ArrowLeft' && S.k > 0) goTo(S.k - 1);
  });

  // Vergrößern mit Knöpfen oder zwei Fingern; vergrößert verschiebt ein Finger die Fläche
  NWView.enableZoom($('canvas'), { buttons: document.querySelector('#screen-demo .canvas-wrap'), anywhere: true });

  // Schüler: neu freigegebene Vorführungen erscheinen ohne Neuladen
  setInterval(async () => {
    if (document.hidden || $('screen-list').hidden || !S.access || S.access.teacher) return;
    try {
      const a = await loadAccess();
      if (JSON.stringify(a) !== JSON.stringify(S.access)) { S.access = a; showList(); }
    } catch (e) { /* später erneut */ }
  }, 6000);

  (async () => {
    try { S.access = await loadAccess(); } catch (e) {
      show('list');
      $('demo-msg').textContent = e.message;
      $('demo-msg').hidden = false;
      return;
    }
    const start = location.hash.slice(1);
    if (start && NWDemos.byId(start)) openDemo(start, 0); else showList();
  })();
})();

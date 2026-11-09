/* NetzWerkstatt – Vorführungen abspielen (ohne Anmeldung, nichts wird gespeichert) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { demo: null, k: 0, run: 0 };

  // Zurück dorthin, woher man kam (Lehreransicht oder Aufgaben)
  const from = new URLSearchParams(location.search).get('von');
  if (from === 'lehrer') document.querySelector('.back-link').href = 'lehrer.html';

  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
  }

  function showList() {
    show('list');
    S.demo = null; S.run++;
    $('demo-list').innerHTML = NWDemos.DEMOS.map((d, i) => `<button class="task-tile" data-demo="${d.id}"><div class="tile-num">▶</div><div class="tile-body"><h4>${esc(d.title)}</h4><p>${esc(d.short)}</p><div class="tile-meta"><span class="muted small">${d.steps.length} Schritte</span></div></div></button>`).join('');
  }
  $('demo-list').addEventListener('click', ev => {
    const b = ev.target.closest('[data-demo]');
    if (b) openDemo(b.dataset.demo, 0);
  });
  $('btn-list').addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); showList(); });

  function openDemo(id, k) {
    const demo = NWDemos.byId(id);
    if (!demo) { showList(); return; }
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
    NWView.render($('canvas'), net, { highlight: new Set(st.focus || []) });
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

  const start = location.hash.slice(1);
  if (start && NWDemos.byId(start)) openDemo(start, 0); else showList();
})();

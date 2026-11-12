/* NetzWerkstatt – gemeinsame Hilfen für Schüler- und Lehreransicht */
(function (root) {
  'use strict';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* egal */ } },
  };

  /** extra: weitere Fetch-Optionen, z. B. { keepalive: true } beim Verlassen der Seite. */
  async function api(method, url, body, token, extra) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(url, Object.assign({ method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, extra));
    } catch (e) {
      const err = new Error('Keine Verbindung zum NetzWerkstatt-Server.');
      err.offline = true;
      throw err;
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* leer */ }
    if (!res.ok) {
      const err = new Error(data.error || ('Fehler ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer;
  /** Kurze Meldung unten. action = {label, run} zeigt zusätzlich einen Knopf (z. B. „Rückgängig“). */
  function toast(msg, kind, action) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (kind || '') + (action ? ' has-act' : '');
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-act';
      b.textContent = action.label;
      b.addEventListener('click', () => { t.hidden = true; clearTimeout(toastTimer); action.run(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : kind === 'error' ? 5000 : 2800);
  }

  function openModal(html, opts) {
    const m = document.getElementById('modal');
    document.getElementById('modal-body').innerHTML = html;
    m.querySelector('.modal-box').className = 'modal-box' + (opts && opts.wide ? ' wide' : '') + (opts && opts.full ? ' full' : '');
    m.hidden = false;
    return document.getElementById('modal-body');
  }
  function closeModal() { document.getElementById('modal').hidden = true; document.getElementById('modal-body').innerHTML = ''; }
  document.addEventListener('DOMContentLoaded', () => {
    const m = document.getElementById('modal');
    if (!m) return;
    document.getElementById('modal-close').addEventListener('click', closeModal);
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden) closeModal(); });
  });

  /** Rückfrage mit Abbrechen und OK. danger = true färbt den OK-Knopf rot (für Löschen). */
  function confirmBox(text, okLabel, danger) {
    return new Promise(resolve => {
      const body = openModal(`<p class="confirm-text">${esc(text)}</p><div class="row end"><button class="btn ghost" data-r="0">Abbrechen</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-r="1">${esc(okLabel || 'OK')}</button></div>`);
      body.querySelectorAll('button[data-r]').forEach(b => b.addEventListener('click', () => { closeModal(); resolve(b.dataset.r === '1'); }));
    });
  }

  /** Netzwerk schreibgeschützt in einem großen Dialog zeigen (Musterlösung, Abgaben). */
  function showNetwork(title, net, extraHTML, opts) {
    const body = openModal(`<h2 class="modal-title">${esc(title)}</h2>${extraHTML || ''}<div class="view-wrap"><svg class="canvas view"></svg></div>`, { wide: true, full: opts && opts.full });
    const svg = body.querySelector('svg');
    NWView.render(svg, net, { fit: true });
    return body;
  }

  function goalsHTML(task, net) {
    if (!task || !task.goals.length) return '';
    const res = NWTasks.evaluate(task, net);
    return '<ul class="goals compact">' + task.goals.map((g, i) => `<li class="${res[i] ? 'done' : ''}">${esc(g.text)}</li>`).join('') + '</ul>' + quizHTML(task, net);
  }

  /** Antworten einer Zuordnungsaufgabe (für Lehrkraft und Musterlösung). */
  function quizHTML(task, net) {
    const q = task && task.quiz;
    if (!q) return '';
    const ans = (net && net.quiz) || {};
    return `<div><b>${esc(q.title)}</b><ul class="quiz-answers">` + q.items.map(it => {
      const a = ans[it.id];
      const cls = !a ? 'muted' : a === it.answer ? 'ok' : 'bad';
      return `<li class="${cls}">${a ? (a === it.answer ? '✓' : '✕') : '–'} ${esc(it.text)}: <b>${esc(a || 'offen')}</b></li>`;
    }).join('') + '</ul></div>';
  }

  // Am PC mit Maus heißt es „Klicke“ statt „Tippe“. Die Texte stehen einmal (für das iPad)
  // in den Aufgaben und Hinweisen; hier werden sie beim Anzeigen passend umgeschrieben.
  const WORDS = { Tippe: 'Klicke', tippe: 'klicke', Antippen: 'Anklicken', antippen: 'anklicken', tippst: 'klickst', Tippen: 'Klicken', tippen: 'klicken', antippst: 'anklickst' };
  const WORD_RE = /\b(Tippe|tippe|Antippen|antippen|antippst|tippst|Tippen|tippen)\b/g;
  const mouse = !!(root.matchMedia && root.matchMedia('(hover: hover) and (pointer: fine)').matches);
  function mouseWords(s) { return mouse ? String(s).replace(WORD_RE, w => WORDS[w]) : String(s); }
  function fixNode(n) {
    if (n.nodeType === 3) { const t = mouseWords(n.data); if (t !== n.data) n.data = t; return; }
    if (n.nodeType !== 1 || n.closest('input, textarea, [contenteditable]')) return;
    for (const el of [n, ...n.querySelectorAll('[title]')]) if (el.title) el.title = mouseWords(el.title);
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) fixNode(t);
  }
  if (mouse && root.MutationObserver && root.document) {
    document.addEventListener('DOMContentLoaded', () => {
      fixNode(document.body);
      new MutationObserver(list => {
        for (const m of list) {
          if (m.type === 'characterData') fixNode(m.target);
          else m.addedNodes.forEach(fixNode);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }

  root.NWCommon = { store, api, esc, toast, mouseWords, openModal, closeModal, confirmBox, showNetwork, goalsHTML, quizHTML };
})(window);

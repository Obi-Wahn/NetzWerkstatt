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
    tcp: store.get('nw_tcp') === '1', // TCP genau zeigen (Verbindungsaufbau, Bestätigungen)
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

  // Lehrkraft springt aus ihrer Ansicht direkt ins freie Bauen (…/?frei=1)
  const freeParam = new URLSearchParams(location.search).has('frei');
  if (freeParam) history.replaceState(null, '', location.pathname);

  async function start() {
    if (!S.token) { show('login'); if (roomParam) setTimeout(() => $('login-name').focus(), 50); return; }
    try {
      setMe(await api('GET', '/api/me', undefined, S.token));
      const free = NWTasks.all().find(t => t.free);
      if (freeParam && free && visible(free)) openTask(free.id); else showTasks();
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
      setMe(await api('GET', '/api/me', undefined, S.token));
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
    try { setMe(await api('GET', '/api/me', undefined, S.token)); } catch (e) { /* später erneut */ }
  }

  /** Eigenen Stand übernehmen: freigeschaltete und eigene Aufgaben der Lehrkraft. */
  function setMe(me) {
    S.me = me;
    // Im Baukasten der Lehrkraft führt ein Knopf zurück zur Lehreransicht
    $('btn-teacher').hidden = $('btn-teacher-tasks').hidden = !(me && me.preview);
    NWEigene.install(me.customTasks || []);
  }
  // Nur Aufgaben, die die Lehrkraft freigeschaltet hat (im Baukasten der Lehrkraft alle)
  const visible = t => !!(S.me && (S.me.preview || (S.me.unlocked && S.me.unlocked[t.id])));

  // Die Übersicht fragt regelmäßig nach, damit neu freigeschaltete Aufgaben ohne Neuladen erscheinen.
  let listSig = '';
  setInterval(async () => {
    if (document.hidden || $('screen-tasks').hidden || !S.token) return;
    await refreshMe();
    const sig = JSON.stringify(S.me);
    if (sig !== listSig) showTasks();
  }, 6000);

  function showTasks() {
    show('tasks');
    listSig = JSON.stringify(S.me);
    $('who').textContent = S.me ? S.me.name : '';
    $('preview-note').hidden = !(S.me && S.me.preview);
    const list = $('task-list');
    list.innerHTML = '';
    let shown = 0;
    for (const g of NWTasks.GROUPS) {
      const items = NWTasks.all().filter(t => t.group === g.id && visible(t));
      shown += items.length;
      if (!items.length) continue;
      const sec = document.createElement('section');
      sec.className = 'task-group';
      const graded = items.filter(t => !t.free);
      const done = graded.filter(t => S.me && S.me.works[t.id] && S.me.works[t.id].submitted).length;
      sec.innerHTML = `<h3 class="group-title">${esc(g.title)}${graded.length ? `<span class="group-count ${done === graded.length ? 'all' : ''}">${done} von ${graded.length} abgegeben</span>` : ''}</h3><div class="task-grid"></div>`;
      const grid = sec.querySelector('.task-grid');
      for (const t of items) {
        const w = S.me && S.me.works[t.id];
        const status = w ? (w.submitted ? '<span class="badge ok">abgegeben ✓</span>' : '<span class="badge">angefangen</span>') : '<span class="badge new">neu</span>';
        const sol = S.me && S.me.released[t.id] ? '<span class="badge sol">Musterlösung da</span>' : '';
        const b = document.createElement('button');
        b.className = 'task-tile' + (t.free ? ' free' : '') + (t.custom ? ' custom' : '') + (w && w.submitted ? ' done' : '');
        b.innerHTML = `<div class="tile-num">${t.free ? '∞' : t.num}</div><div class="tile-body"><h4>${esc(t.title)}</h4><p>${esc(t.intro)}</p><div class="tile-meta">${t.free ? '' : status}${sol}${t.goals.length ? `<span class="muted small">${t.goals.length} Ziele</span>` : ''}</div></div>`;
        b.addEventListener('click', () => openTask(t.id));
        grid.appendChild(b);
      }
      list.appendChild(sec);
    }
    $('no-tasks').hidden = shown > 0;
  }

  // ---------------------------------------------------------------- Aufgabe öffnen
  async function openTask(id) {
    const task = NWTasks.byId(id);
    if (!task) { toast('Diese Aufgabe gibt es nicht mehr.', 'error'); showTasks(); return; }
    let saved = null;
    try { saved = await api('GET', '/api/work/' + encodeURIComponent(id), undefined, S.token); } catch (e) {
      if (e.status === 401) { show('login'); return; }
      toast(e.message, 'error');
    }
    S.task = task;
    S.net = saved && saved.network ? saved.network : task.start();
    if (!S.net.events) S.net.events = [];
    S.submitted = !!(saved && saved.submitted);
    S.selected = null; S.pending = null; S.netKind = null;
    setTool('move');
    $('task-title').textContent = task.title;
    $('task-intro').textContent = task.intro;
    $('task-tip').textContent = task.tip || '';
    $('task-tip-wrap').hidden = !task.tip;
    $('task-think').textContent = task.think || '';
    $('task-think-wrap').hidden = !task.think;
    $('btn-submit').hidden = !!task.free;
    $('log').innerHTML = '<div class="log-empty">Hier erscheinen die Datenpakete, sobald du einen Ping sendest, eine Webseite aufrufst, einen Internetdienst nutzt oder per DHCP eine Adresse anforderst.</div>';
    $('save-state').textContent = '';
    show('editor');
    updateSolutionButton();
    renderAll();
  }

  $('btn-teacher').addEventListener('click', async ev => {
    // Erst speichern, dann zur Lehreransicht wechseln
    ev.preventDefault();
    await flushSave();
    location.href = 'lehrer.html';
  });

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
    showNetwork('Musterlösung: ' + S.task.title, sol, '<p class="muted">Vergleiche mit deinem Netzwerk. Es gibt oft mehrere richtige Lösungen!</p>' + NWCommon.quizHTML(S.task, sol));
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
  // Geräteleiste nach Art sortiert; [Typ, Name, Funktion, ohne die der Eintrag ausgeblendet ist]
  // Einträge mit „tool:“ sind Verbindungswerkzeuge, alle anderen legen ein Gerät an.
  const PALETTE = [
    ['endgeraete', 'Endgeräte', [['pc', 'PC'], ['laptop', 'Laptop', 'wlan'], ['tablet', 'Tablet'], ['smartphone', 'Smart\u00adphone'], ['headset', 'Kopf\u00adhörer', 'pan']]],
    ['aktiv', 'Aktive Komponenten', [['switch', 'Switch'], ['ap', 'Access Point', 'wlan'], ['router', 'Router']]],
    ['verbindungen', 'Verbindungen (passiv)', [['tool:kabel', 'Netzwerk\u00adkabel'], ['tool:glasfaser', 'Glas\u00adfaser', 'netzarten'], ['tool:wlan', 'WLAN', 'wlan'], ['tool:bluetooth', 'Blue\u00adtooth', 'pan'], ['bus', 'Bus-Kabel', 'topologie']]],
    ['server', 'Server', [['server', 'Server'], ['server:web', 'Web\u00adserver', 'web'], ['server:dns', 'DNS-Server', 'web'], ['server:mail', 'Mail\u00adserver', 'dienste'], ['server:video', 'Video\u00adserver', 'dienste'], ['server:call', 'Telefonie-Server', 'dienste'], ['server:game', 'Spiele-Server', 'dienste']]],
    ['internet', 'Internet', [['isp', 'Internet\u00adanbieter', 'internet'], ['rz', 'Rechen\u00adzentrum', 'internet']]],
  ];
  // Server mit eingeschaltetem Dienst (Name und Dienst ab Werk)
  const SERVER_PRESETS = {
    web: { name: 'Webserver', title: 'Willkommen!' },
    dns: { name: 'DNS-Server' },
    mail: { name: 'Mailserver' },
    video: { name: 'Videoserver' },
    call: { name: 'Telefonie-Server' },
    game: { name: 'Spiele-Server' },
  };
  // Symbole der Verbindungswerkzeuge (24×24)
  const TOOL_ICONS = {
    kabel: '<path d="M4 20c4 0 4-8 8-8s4-8 8-8"/><rect x="2" y="17" width="5" height="5" rx="1"/><rect x="17" y="2" width="5" height="5" rx="1"/>',
    glasfaser: '<path d="M3 18c5 0 5-6 9-6s4-6 9-6"/><circle cx="3" cy="18" r="1.6"/><circle cx="21" cy="6" r="1.6"/><path d="M12 3v2M7.5 5l1 1.6M16.5 5l-1 1.6"/>',
    wlan: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1.2"/>',
    bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  };
  const TOOL_TITLES = {
    kabel: 'Zwei Geräte mit einem Netzwerkkabel verbinden',
    glasfaser: 'Zwei Gebäude mit einer Glasfaserleitung quer durch die Stadt verbinden',
    wlan: 'Gerät per WLAN mit einem Access Point oder Router verbinden',
    bluetooth: 'Gerät per Bluetooth mit Kopfhörern koppeln',
  };
  // Eingeklappte Kategorien merkt sich der Browser (nur Bequemlichkeit, darf fehlen)
  const palClosed = new Set();
  try { (JSON.parse(store.get('nw_palette_zu') || '[]') || []).forEach(k => palClosed.add(k)); } catch (e) { /* ohne Speicher */ }
  const palette = $('palette');
  function renderPalette() {
    const groups = PALETTE.map(([id, title, items]) => [id, title, items.filter(([, , f]) => !f || has(f))]).filter(g => g[2].length);
    const btn = ([t, l]) => {
      const plain = esc(l.replace(/\u00ad/g, ''));
      if (t.startsWith('tool:')) {
        const tool = t.slice(5);
        return `<button class="pal-btn pal-tool${S.tool === tool ? ' active' : ''}" data-tool="${tool}" aria-pressed="${S.tool === tool}" title="${esc(TOOL_TITLES[tool])}"><svg viewBox="0 0 24 24" class="ti" aria-hidden="true">${TOOL_ICONS[tool]}</svg><span>${esc(l)}</span></button>`;
      }
      return `<button class="pal-btn" data-type="${t}" title="${plain} hinzufügen">${NWView.iconSVG(t.split(':')[0], 30)}<span>${esc(l)}</span></button>`;
    };
    const html = groups.map(([id, title, items]) => {
      const zu = palClosed.has(id);
      return `<section class="pal-group${zu ? ' zu' : ''}" data-group="${id}"><button class="palette-title" data-group="${id}" aria-expanded="${!zu}" title="${zu ? 'Aufklappen' : 'Einklappen'}"><span>${esc(title)}</span><svg viewBox="0 0 24 24" class="chev" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>` +
        `<div class="pal-items">${items.map(btn).join('')}</div></section>`;
    }).join('');
    if (palette.dataset.sig !== html) { palette.innerHTML = html; palette.dataset.sig = html; }
  }
  /** Werkzeuge, Geräte und Anzeigen passend zur Aufgabe ein- und ausblenden. */
  function applyFeatures() {
    S.feat = NWTasks.featuresFor(S.task, S.net);
    renderPalette();
    document.querySelector('.addr-switch').hidden = !has('v6');
    if (!has('v6') && S.v6) document.querySelector('[data-addr="v4"]').click();
    if ((S.tool === 'glasfaser' && !has('netzarten')) || (S.tool === 'wlan' && !has('wlan')) || (S.tool === 'bluetooth' && !has('pan'))) setTool('move');
    $('netkinds').hidden = !has('netzarten');
  }
  palette.addEventListener('click', ev => {
    const head = ev.target.closest('.palette-title');
    if (head) {
      const id = head.dataset.group;
      if (palClosed.has(id)) palClosed.delete(id); else palClosed.add(id);
      store.set('nw_palette_zu', JSON.stringify([...palClosed]));
      renderPalette();
      return;
    }
    const b = ev.target.closest('.pal-btn');
    if (!b || readOnly()) return;
    // Verbindungswerkzeug: noch einmal antippen schaltet zurück auf „Auswählen“
    if (b.dataset.tool) { setTool(S.tool === b.dataset.tool ? 'move' : b.dataset.tool); return; }
    const [type, preset] = b.dataset.type.split(':');
    const p = NWView.freeSpot(S.net, type);
    const d = NW.createDevice(S.net, type, p.x, p.y);
    if (preset && SERVER_PRESETS[preset]) {
      const names = new Set(S.net.devices.map(o => o.name));
      let k = 1;
      while (names.has(SERVER_PRESETS[preset].name + ' ' + k)) k++;
      d.name = SERVER_PRESETS[preset].name + ' ' + k;
      d.services[preset].on = true;
    }
    // In Aufgaben, in denen Adressen von Hand vergeben werden, ist DHCP aus
    if (S.task.manual) NWTasks.manualize({ devices: [d] });
    S.selected = d.id;
    setTool('move');
    renderAll();
    scheduleSave();
  });

  const HINTS = {
    move: 'Tippe ein Gerät oder eine Verbindung an, um es einzustellen und zu testen. Geräte kannst du auch verschieben. Zum Verbinden tippe in der Geräteleiste z. B. auf „Netzwerkkabel“.',
    kabel: 'Tippe nacheinander auf die zwei Geräte, die du mit einem Kabel verbinden willst.',
    glasfaser: 'Tippe nacheinander auf die zwei Geräte (z. B. Switches in verschiedenen Gebäuden), die eine Glasfaserleitung quer durch die Stadt verbinden soll.',
    wlan: 'Tippe auf einen Access Point oder Router und dann auf ein Tablet, Smartphone oder einen Laptop.',
    bluetooth: 'Tippe auf ein Smartphone, Tablet, einen Laptop oder PC und dann auf die Kopfhörer.',
    delete: 'Tippe auf ein Gerät oder eine Verbindung, um es zu löschen.',
  };
  function setTool(t) {
    S.tool = t; S.pending = null;
    // Beim Verbinden oder Löschen stört das Einstellungsfenster nur
    if (t !== 'move' && S.selected && S.net) { S.selected = null; renderInspector(); }
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    renderPalette();
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
    const kinds = NW.netKinds(S.net);
    if (S.netKind && !kinds.some(k => k.kind === S.netKind)) S.netKind = null;
    const highlight = new Set();
    kinds.filter(k => k.kind === S.netKind).forEach(k => k.devices.forEach(id => highlight.add(id)));
    NWView.render($('canvas'), S.net, { selected: S.selected, pending: S.pending, highlight, v6: S.v6 });
    renderNetKinds(kinds);
    positionInspector();
  }

  /** Anzeige unten auf der Arbeitsfläche: Welche Netzarten (PAN, LAN, MAN, WAN) stecken im Aufbau? */
  function renderNetKinds(kinds) {
    const box = $('netkinds');
    const order = ['PAN', 'LAN', 'MAN', 'WAN'].filter(k => kinds.some(x => x.kind === k));
    let h = '<span class="nk-title">Netzarten:</span>';
    if (!order.length) h += '<span class="nk-none">noch keine – verbinde Geräte miteinander</span>';
    h += order.map(k => {
      const n = kinds.filter(x => x.kind === k).length;
      return `<button class="nk-chip nk-${k}${S.netKind === k ? ' on' : ''}" data-kind="${k}" aria-pressed="${S.netKind === k}">${k}${n > 1 ? ' ×' + n : ''}</button>`;
    }).join('');
    if (S.netKind) {
      const info = NW.NET_KINDS[S.netKind];
      const why = kinds.filter(x => x.kind === S.netKind).map(x => esc(x.why)).join('<br>');
      h += `<div class="nk-info"><b>${S.netKind} – ${esc(info.name)}</b><br>${esc(info.text)}<br><span class="nk-why">${why}</span></div>`;
    }
    const sig = h;
    if (box.dataset.sig !== sig) { box.innerHTML = h; box.dataset.sig = sig; }
  }
  $('netkinds').addEventListener('click', ev => {
    const b = ev.target.closest('[data-kind]');
    if (!b) return;
    S.netKind = S.netKind === b.dataset.kind ? null : b.dataset.kind;
    renderCanvas();
  });

  function renderAll() {
    applyFeatures();
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
    renderQuiz();
  }

  // ---------------------------------------------------------------- Zuordnungsaufgabe (z. B. TCP oder UDP?)
  function renderQuiz() {
    const q = S.task.quiz, box = $('quiz');
    box.hidden = !q;
    if (!q) return;
    const ans = S.net.quiz || {};
    const ro = readOnly();
    let h = `<h4>${esc(q.title)}</h4>`;
    for (const it of q.items) {
      h += `<div class="quiz-row"><span>${esc(it.text)}</span><div class="seg" role="group" aria-label="${esc(it.text)}">` +
        q.options.map(o => `<button class="${ans[it.id] === o ? 'on' : ''}" data-quiz="${esc(it.id)}" data-opt="${esc(o)}" aria-pressed="${ans[it.id] === o}" ${ro ? 'disabled' : ''}>${esc(o)}</button>`).join('') +
        '</div></div>';
    }
    const done = q.items.filter(it => ans[it.id]).length;
    const right = q.items.filter(it => ans[it.id] === it.answer).length;
    if (done === q.items.length) h += right === done
      ? '<div class="quiz-result ok">Alles richtig zugeordnet!</div>'
      : `<div class="quiz-result">${right} von ${done} richtig. Überlege noch einmal: Was ist hier wichtiger – dass alles vollständig ankommt oder dass es schnell geht?</div>`;
    else h += `<p class="muted small">${done} von ${q.items.length} zugeordnet.</p>`;
    box.innerHTML = h;
  }

  $('quiz').addEventListener('click', ev => {
    const b = ev.target.closest('[data-quiz]');
    if (!b || readOnly()) return;
    if (!S.net.quiz) S.net.quiz = {};
    S.net.quiz[b.dataset.quiz] = b.dataset.opt;
    renderGoals(); scheduleSave();
  });

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
    if (S.tool === 'kabel' || S.tool === 'glasfaser' || S.tool === 'wlan' || S.tool === 'bluetooth') {
      // Eine vorhandene Verbindung antippen: direkt einstellen, ohne erst „Auswählen“ zu wählen
      if (!devEl && linkEl && !S.pending) {
        setTool('move');
        S.selected = linkEl.dataset.link; renderCanvas(); renderInspector();
        return;
      }
      if (!devEl) { S.pending = null; $('tool-hint').textContent = HINTS[S.tool]; renderCanvas(); return; }
      const id = devEl.dataset.dev;
      if (!S.pending) {
        S.pending = id;
        $('tool-hint').textContent = `${NW.dev(S.net, id).name} gewählt – tippe jetzt auf das zweite Gerät. Noch einmal antippen öffnet die Einstellungen.`;
      } else if (S.pending === id) {
        // Zweimal dasselbe Gerät: Schüler will es einstellen, nicht verbinden
        setTool('move');
        S.selected = id; renderCanvas(); renderInspector();
        return;
      } else {
        const r = NW.addLink(S.net, S.pending, id, S.tool === 'glasfaser' ? 'kabel' : S.tool);
        if (r.ok && S.tool === 'glasfaser') r.link.stadt = true;
        if (!r.ok) toast(r.reason, 'error');
        else {
          const fiberHint = S.tool === 'kabel' && has('netzarten') ? ' Für eine Glasfaserleitung tippe das Kabel an – oder nimm gleich das Werkzeug „Glasfaser“.' : '';
          toast({ kabel: 'Kabel verbunden.', glasfaser: 'Glasfaserleitung quer durch die Stadt verlegt.', wlan: 'WLAN verbunden.', bluetooth: 'Per Bluetooth gekoppelt.' }[S.tool] + fiberHint, 'ok'); scheduleSave();
        }
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

  const KIND_LABEL = { kabel: 'Kabel', wlan: 'WLAN', bluetooth: 'Bluetooth' };
  function kindLabel(l) { return l.kind === 'kabel' && l.stadt ? 'Glasfaser' : KIND_LABEL[l.kind] || l.kind; }

  function connectionsHTML(d) {
    const ls = NW.allLinksOf(S.net, d.id);
    if (!ls.length) return '<p class="muted small">Noch mit nichts verbunden.</p>';
    return '<ul class="conn">' + ls.map(l => {
      const o = NW.dev(S.net, l.a === d.id ? l.b : l.a);
      return `<li><span class="kind ${l.kind}${l.stadt ? ' stadt' : ''}">${kindLabel(l)}</span> ${esc(o.name)}</li>`;
    }).join('') + '</ul>';
  }

  /** Knöpfe, die die IP-Adresse eines Partners für den Dateitausch eintragen. */
  function fileChips(d) {
    const chips = S.net.devices.filter(o => o !== d && T[o.type].host && NW.parseIP(o.ip) !== null)
      .map(o => `<button class="chip" data-fill="file" data-val="${esc(o.ip.trim())}">${esc(o.name)}${T[o.type].services ? ' (Server)' : ''}</button>`);
    return chips.length ? `<div class="chips">${chips.join('')}</div>` : '';
  }

  function fileListHTML(list) {
    return list.length ? `<ul class="files">${list.map(f => `<li>📄 ${esc(f)}</li>`).join('')}</ul>` : '<p class="muted small">Noch keine Dateien.</p>';
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
    let h = `<p class="v6-row"><span class="v6-kind">Link-Local</span><code>${esc(a.ll)}</code></p>`;
    if (a.gua) h += `<p class="v6-row"><span class="v6-kind">Global</span><code>${esc(a.gua)}</code></p>
      <p class="muted small">Die ersten vier Blöcke (${esc(a.net)}) sind das Netz – es kommt ${a.fromRouter ? 'vom Router' : 'vom Internetanbieter'}. Die letzten vier Blöcke hat ${esc(d.name)} selbst gebildet.</p>`;
    else h += `<p class="muted small">Noch keine globale Adresse. Mit der Link-Local-Adresse erreicht ${esc(d.name)} nur Geräte im eigenen Netz. Eine globale Adresse gibt es automatisch, sobald ein Router mit Internetanbieter angeschlossen ist.</p>`;
    return h + compareHTML();
  }

  function urlChips() {
    const names = new Set();
    S.net.devices.forEach(o => o.services && o.services.dns && o.services.dns.on && (o.services.dns.entries || []).forEach(e => e.name && names.add(e.name.trim())));
    return names.size ? `<div class="chips">${[...names].map(n => `<button class="chip" data-fill="url" data-val="http://${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
  }

  /** Namen aus DNS-Einträgen und Server mit Diensten als Vorschläge für das Dienst-Ziel. */
  function serverChips() {
    const vals = new Set();
    S.net.devices.forEach(o => o.services && o.services.dns && o.services.dns.on && (o.services.dns.entries || []).forEach(e => e.name && vals.add(e.name.trim())));
    S.net.devices.forEach(o => { if (o.services && ['mail', 'video', 'call', 'game'].some(k => NW.svcOn(o, k)) && NW.parseIP(o.ip) !== null) vals.add(o.ip.trim()); });
    return vals.size ? `<div class="chips">${[...vals].map(n => `<button class="chip" data-fill="svc" data-val="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
  }

  // ---------------------------------------------------------------- Sichtbare Funktionen und Abschnitte
  /** Ist diese Funktion in der aktuellen Aufgabe eingeblendet? */
  const has = k => !!(S.feat && S.feat.has(k));
  /** Geöffnete und geschlossene Abschnitte im Einstellungsbereich (bleiben beim Gerätewechsel erhalten). */
  let openSecs = {};
  try { openSecs = JSON.parse(store.get('nw-open') || '{}') || {}; } catch (e) { openSecs = {}; }
  /**
   * Einklappbarer Abschnitt. Grundfunktionen (feat leer) sind anfangs offen, ebenso
   * Abschnitte zum Thema der Aufgabe. Im freien Bauen sind Zusatzthemen anfangs zu.
   */
  /** Vorschläge für die Weiterleitung eines DNS-Servers: DNS-Server des Anbieters und andere DNS-Server. */
  function dnsForwardChips(d) {
    const own = NW.parseIP(d.ip || '');
    const vals = new Map();
    for (const o of S.net.devices) {
      if (o === d) continue;
      if (T[o.type].isp && NW.parseIP(o.dns || '') !== null) vals.set(o.dns.trim(), `DNS-Server von ${o.name}`);
      else if (NW.svcOn(o, 'dns') && NW.parseIP(o.ip || '') !== null) vals.set(o.ip.trim(), o.name);
    }
    const list = [...vals].filter(([ip]) => NW.parseIP(ip) !== own).slice(0, 3);
    return list.length ? `<div class="chips">${list.map(([ip, who]) => `<button class="chip suggest" data-act="dns-forward" data-val="${esc(ip)}">💡 ${esc(who)} (${esc(ip)}) fragen</button>`).join('')}</div>` : '';
  }

  function sec(key, title, body, feat, cls) {
    if (!body) return '';
    let open = feat ? !S.task.free && NWTasks.showOf(S.task).includes(feat) : true;
    if (key === 'conn') open = false;
    const k = (S.task.free ? 'frei:' : 'aufgabe:') + key;
    if (k in openSecs) open = openSecs[k];
    return `<details class="group sec${cls ? ' ' + cls : ''}" data-sec="${k}" ${open ? 'open' : ''}><summary><h4>${title}</h4></summary>${body}</details>`;
  }
  insp.addEventListener('toggle', ev => {
    const d = ev.target;
    if (!d.dataset || !d.dataset.sec) return;
    openSecs[d.dataset.sec] = d.open;
    store.set('nw-open', JSON.stringify(openSecs));
  }, true);

  // ---------------------------------------------------------------- Einstellungsfenster am Gerät
  // Auf großen Bildschirmen schwebt das Fenster direkt neben dem angetippten Gerät
  // auf der Arbeitsfläche. Auf schmalen Bildschirmen (Tablet hochkant) steht es unter der Arbeitsfläche.
  const wide = window.matchMedia('(min-width: 861px)');
  function placeInspectorBox() {
    const target = wide.matches ? document.querySelector('.canvas-wrap') : document.querySelector('.side');
    if (insp.parentElement !== target) target.appendChild(insp);
    insp.classList.toggle('floating', wide.matches);
  }
  /** Schiebt das Fenster neben das gewählte Gerät (bzw. neben die Mitte der gewählten Verbindung). */
  function positionInspector() {
    if (!wide.matches || insp.hidden || !S.selected) return;
    const link = S.net.links.find(l => l.id === S.selected);
    const d = NW.dev(S.net, S.selected);
    let x, y;
    if (link) { const a = NW.dev(S.net, link.a), b = NW.dev(S.net, link.b); x = (a.x + b.x) / 2; y = (a.y + b.y) / 2; }
    else if (d) { x = d.x; y = d.y; }
    else return;
    const m = canvas.getScreenCTM();
    const wrap = insp.parentElement.getBoundingClientRect();
    if (!m) return;
    const pt = canvas.createSVGPoint(); pt.x = x; pt.y = y;
    const c = pt.matrixTransform(m);
    const cx = c.x - wrap.left, cy = c.y - wrap.top;
    const half = (link ? 14 : NWView.BOX.w / 2 + 6) * m.a;
    const w = insp.offsetWidth, h = insp.offsetHeight, gap = 12;
    const top = Math.min(Math.max(8, cy - 60), Math.max(8, wrap.height - h - 8));
    // Rechts oder links vom Gerät – dort, wo das Fenster weniger andere Geräte verdeckt
    const clampL = l => Math.min(Math.max(8, l), Math.max(8, wrap.width - w - 8));
    const covered = l => S.net.devices.filter(o => {
      const q = canvas.createSVGPoint(); q.x = o.x; q.y = o.y;
      const r = q.matrixTransform(m), ox = r.x - wrap.left, oy = r.y - wrap.top;
      return ox > l - 30 && ox < l + w + 30 && oy > top - 30 && oy < top + h + 30;
    }).length;
    // Kandidaten: direkt rechts, direkt links, ganz rechts, ganz links (das Fenster darf das gewählte Gerät nie verdecken)
    const self = l => cx + half > l && cx - half < l + w;
    const cands = [cx + half + gap, cx - half - gap - w, wrap.width - w - 8, 8].map(clampL).filter(l => !self(l));
    let left = cands.length ? cands[0] : clampL(cx + half + gap), best = Infinity;
    for (const l of cands) { const n = covered(l) * 1000 + Math.abs(l + w / 2 - cx); if (n < best) { best = n; left = l; } }
    insp.style.left = Math.round(left) + 'px';
    insp.style.top = Math.round(top) + 'px';
  }
  wide.addEventListener('change', () => { placeInspectorBox(); renderInspector(); });
  window.addEventListener('resize', () => positionInspector());
  placeInspectorBox();

  function renderInspector() {
    renderInspectorBody();
    if (!S.selected) return;
    insp.insertAdjacentHTML('afterbegin', '<button class="insp-close btn ghost" data-act="close-insp" aria-label="Einstellungen schließen" title="Schließen">✕</button>');
    positionInspector();
  }

  function renderInspectorBody() {
    document.querySelector('.side').classList.toggle('has-sel', !!S.selected);
    insp.hidden = !S.selected && wide.matches;
    insp.classList.toggle('sheet', !!S.selected && !wide.matches);
    document.body.classList.toggle('has-sheet', !!S.selected && !wide.matches);
    const ro = readOnly();
    if (!S.selected) {
      insp.innerHTML = `<h3>Einstellungen</h3><p class="muted">Tippe auf ein Gerät, um es einzustellen und zu testen.</p>`;
      insp.style.left = insp.style.top = '';
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
        + (ro || !has('ausfall') ? '' : `<div class="group"><h4>Ausfall testen</h4><button class="btn small ${link.broken ? 'primary' : ''}" data-act="fault">${link.broken ? 'Kabel reparieren' : '⚡ Kabelbruch simulieren'}</button></div>`);
      const title = { kabel: link.stadt ? 'Glasfaserleitung' : 'Netzwerkkabel', wlan: 'WLAN-Verbindung', bluetooth: 'Bluetooth-Kopplung' }[link.kind];
      const about = {
        kabel: link.stadt
          ? 'Eine Glasfaserleitung (passive Netzwerkkomponente) überträgt die Daten als Lichtsignale – auch über viele Kilometer, z. B. quer durch die Stadt.'
          : 'Ein Kabel (passive Netzwerkkomponente) überträgt die Daten als elektrische Signale.',
        wlan: 'Per WLAN werden die Daten als Funkwellen übertragen.',
        bluetooth: 'Bluetooth ist Funk für kurze Strecken (etwa 10 Meter). Damit verbinden sich die Geräte einer Person, z. B. Smartphone und Kopfhörer, zu einem persönlichen Netz (PAN). Über Bluetooth laufen hier keine IP-Pakete.',
      }[link.kind];
      const fiber = link.kind === 'kabel' && has('netzarten')
        ? `<div class="group"><h4>Art der Leitung</h4><div class="seg" role="group" aria-label="Art der Leitung">
            <button class="${link.stadt ? '' : 'on'}" data-act="stadt" data-val="0" ${ro || link.locked ? 'disabled' : ''} aria-pressed="${!link.stadt}">Netzwerkkabel<br><span class="seg-sub">im Gebäude</span></button>
            <button class="${link.stadt ? 'on' : ''}" data-act="stadt" data-val="1" ${ro || link.locked ? 'disabled' : ''} aria-pressed="${!!link.stadt}">Glasfaser<br><span class="seg-sub">quer durch die Stadt</span></button>
          </div></div>`
        : '';
      insp.innerHTML = `<h3>${title}</h3>
        <p>zwischen <b>${esc(a.name)}</b> und <b>${esc(b.name)}</b></p>${plug}${fiber}
        <p class="muted small">${about}</p>
        ${has('dienste') && link.kind !== 'bluetooth' ? `<label class="toggle"><input type="checkbox" data-act="loss" ${link.loss ? 'checked' : ''} ${ro ? 'disabled' : ''}> Gestörte Verbindung</label>
        <p class="${link.loss ? 'loss-note' : 'muted small'}">${link.loss
          ? 'Hier gehen Pakete verloren – wie bei schwachem WLAN oder einem Wackelkontakt. Vergleiche: Was machen TCP und UDP mit einem verlorenen Paket?'
          : 'Schalte die Störung ein, um zu sehen, was mit verlorenen Paketen passiert.'}</p>` : ''}${brk}
        ${!ro && !link.locked ? '<button class="btn danger" data-act="del-link">Verbindung löschen</button>' : ''}`;
      return;
    }
    const d = NW.dev(S.net, S.selected);
    if (!d) { S.selected = null; renderInspectorBody(); return; }
    const t = T[d.type];
    const dis = ro || d.locked;
    let h = `<div class="insp-head">${NWView.iconSVG(d.cloud ? 'switch' : d.type, 30)}<div><div class="insp-type">${esc(d.cloud ? 'Internet (vereinfacht)' : t.label)}</div>
      <input class="insp-name" data-path="name" value="${esc(d.name)}" ${dis ? 'disabled' : ''} maxlength="24" aria-label="Name"></div></div>`;
    h += `<details class="desc"><summary>Wozu dient dieses Gerät?</summary><p>${esc(d.cloud ? 'Hier vereinfacht: Das Internet ist ein riesiger Zusammenschluss vieler Netze. Viele Router leiten die Pakete Schritt für Schritt weiter.' : NW.DESCRIPTIONS[d.type])}</p></details>`;
    if (d.locked) h += '<p class="locked-note">🔒 Dieses Gerät gehört zur Aufgabe. Du kannst es ansehen und benutzen, aber nicht ändern.</p>';
    if (d.off) h += `<p class="fault-note">✕ ${esc(d.name)} ist ausgefallen. Es sendet, empfängt und leitet nichts weiter.</p>`;
    if (t.bus && d.broken) h += '<p class="fault-note">⚡ Kabelbruch im Bus-Kabel: Das ganze Busnetz ist gestört.</p>';

    // ---- Endgeräte und Server: Adressen
    if (t.host) {
      const auto = !!d.dhcp;
      let b = '';
      if (has('dhcp') || auto) {
        b += `<div class="seg" role="group" aria-label="Art der Einstellung">
          <button class="${auto ? '' : 'on'}" data-act="mode-manual" ${dis ? 'disabled' : ''} aria-pressed="${!auto}">Von Hand</button>
          <button class="${auto ? 'on' : ''}" data-act="mode-dhcp" ${dis ? 'disabled' : ''} aria-pressed="${auto}">Automatisch (DHCP)</button>
        </div>`;
        if (auto) {
          b += `<p class="muted small">Diese Einstellungen bekommt ${esc(d.name)} vom DHCP-Server (meist im Router).</p>`;
          if (!dis) b += '<button class="btn primary small dhcp-btn" data-act="dhcp">Adresse per DHCP anfordern</button>';
        }
      }
      const sg = auto || dis ? {} : NW.suggest(S.net, d.id);
      const chip = (act, txt) => `<div class="chips"><button class="chip suggest" data-act="${act}">💡 ${esc(txt)}</button></div>`;
      const fdis = dis || auto;
      b += field('IP-Adresse', 'ip', d.ip, 'ip', { disabled: fdis, placeholder: auto ? 'kommt per DHCP' : 'z. B. 192.168.1.10' });
      if (sg.ip) b += chip('suggest-ip', `Vorschlag: ${sg.ip} übernehmen`);
      b += field('Subnetzmaske', 'mask', d.mask, 'mask', { disabled: fdis, placeholder: '255.255.255.0' });
      if (has('gateway') || (d.gw || '').trim()) {
        b += field('Gateway (Router)', 'gw', d.gw, 'gw', { disabled: fdis, placeholder: auto ? 'kommt per DHCP' : 'nur nötig für andere Netze' });
        if (sg.gw) b += chip('suggest-gw', `Router ${sg.gw} als Gateway übernehmen`);
      }
      if (has('web') || (d.dns || '').trim()) {
        b += field('DNS-Server', 'dns', d.dns, 'dns', { disabled: fdis, placeholder: auto ? 'kommt per DHCP' : 'nur nötig für Namen wie www…' });
        if (sg.dns) b += chip('suggest-dns', `DNS-Server ${sg.dns} übernehmen`);
      }
      h += sec('net', 'Netzwerk-Einstellungen', b);
    }

    // ---- Server: Dienste
    if (t.services) {
      // Ältere Netzwerke kennen noch nicht alle Dienste
      const def = NW.defaultServices();
      for (const k in def) if (!d.services[k]) d.services[k] = def[k];
      const w = d.services.web, n = d.services.dns;
      const info = k => { const sv = NW.SERVICES[k]; return `<p class="svc-info"><span class="proto-tag ${sv.proto.toLowerCase()}">${sv.proto} · Port ${sv.port}</span> ${esc(sv.why)}</p>`; };
      const toggle = (k, label) => `<label class="toggle"><input type="checkbox" data-path="services.${k}.on" ${d.services[k].on ? 'checked' : ''} ${dis ? 'disabled' : ''}> ${esc(label)}</label>` + (d.services[k].on && has('dienste') ? info(k) : '');
      let b = '<p class="muted small">Ein Server kann mehrere Dienste gleichzeitig anbieten. Die Endgeräte sind die Clients, die sie nutzen (Client-Server-Modell).</p>';
      if (has('web')) {
        b += toggle('web', 'Webserver (HTTP)');
        if (w.on) {
          b += field('Titel der Webseite', 'services.web.title', w.title, '', { disabled: dis });
          b += field('Text der Webseite', 'services.web.text', w.text, '', { disabled: dis });
        }
      }
      if (has('dateien')) {
        const fs = NW.fileStore(d);
        b += `<label class="toggle"><input type="checkbox" data-path="services.files.on" ${fs.on ? 'checked' : ''} ${dis ? 'disabled' : ''}> Dateiablage (Cloud-Speicher)</label>`;
        if (fs.on) b += `<p class="muted small">Endgeräte laden hier Dateien hoch und holen sie später wieder ab (Client-Server).</p>${fileListHTML(fs.files)}`;
      }
      if (has('web')) {
        b += toggle('dns', 'DNS-Server');
        if (n.on) {
          b += '<div class="dns-table"><div class="dns-row head"><span>Name</span><span>IP-Adresse</span><span></span></div>';
          n.entries.forEach((e, i) => {
            b += `<div class="dns-row"><input data-path="services.dns.entries.${i}.name" value="${esc(e.name)}" placeholder="www.beispiel.de" ${dis ? 'disabled' : ''} autocapitalize="off" spellcheck="false">
              <input data-path="services.dns.entries.${i}.ip" data-check="dnsip" value="${esc(e.ip)}" placeholder="IP" ${dis ? 'disabled' : ''} autocapitalize="off" spellcheck="false">
              ${dis ? '<span></span>' : `<button class="btn ghost small" data-act="dns-del" data-i="${i}" aria-label="Eintrag löschen">✕</button>`}</div>`;
          });
          b += '</div>';
          if (!dis) b += '<button class="btn small" data-act="dns-add">+ Eintrag</button>';
          b += field('Unbekannte Namen weiterfragen bei (DNS-Server)', 'services.dns.forward', n.forward || '', 'dnsfwd', { disabled: dis, placeholder: 'leer = nicht weiterfragen' });
          b += `<p class="muted small">${(n.forward || '').trim()
            ? `Kennt ${esc(d.name)} einen Namen nicht selbst, fragt er beim DNS-Server ${esc(n.forward.trim())} nach und reicht die Antwort weiter – wie die DNS-Server im echten Internet.`
            : 'Kennt dieser DNS-Server einen Namen nicht, antwortet er „kenne ich nicht“. Mit einer Weiterleitung fragt er stattdessen bei einem anderen DNS-Server nach.'}</p>`;
          if (!dis && !(n.forward || '').trim()) b += dnsForwardChips(d);
        }
      }
      if (has('dienste')) {
        b += toggle('mail', 'E-Mail-Server (SMTP, IMAP)');
        if (d.services.mail.on) {
          const nb = (d.services.mail.box || []).length;
          b += `<p class="svc-info">Postfach: <b>${nb === 1 ? '1 E-Mail' : nb + ' E-Mails'}</b></p>`;
        }
        b += toggle('video', 'Video-Streaming');
        b += toggle('call', 'Video- und Audio-Telefonie');
        b += toggle('game', 'Spiele-Server (Online-Spiel)');
      }
      if (has('web') || has('dateien') || has('dienste')) {
        const feat = ['dienste', 'web', 'dateien'].find(k => NWTasks.showOf(S.task).includes(k)) || 'dienste';
        h += sec('services', 'Dienste des Servers', b, feat);
      }
    }

    // ---- Endgeräte und Server: Testen
    if (t.host) {
      h += sec('ping', 'Ping', `<label class="field">Ping senden an (${has('v6') ? 'IPv4- oder IPv6-Adresse' : 'IP-Adresse'})
          <div class="inline"><input id="ping-target" placeholder="${has('v6') ? 'z. B. 192.168.1.2 oder fe80::…' : 'z. B. 192.168.1.2'}" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary" data-act="ping">Ping</button></div></label>
        ${otherHostChips(d)}${has('v6') ? v6Chips(d) : ''}`, null, 'test');
      if (has('web')) h += sec('browser', 'Browser', `<label class="field">Adresse (URL)
          <div class="inline"><input id="url-target" placeholder="http://www.beispiel.de" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary" data-act="browse">Öffnen</button></div></label>
        ${urlChips()}`, 'web', 'test');
      if (has('dienste')) h += sec('svc-use', 'Internetdienste nutzen', `<label class="field">Server (Name oder IP-Adresse)
          <input id="svc-target" placeholder="z. B. mail.beispiel.de" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        ${serverChips()}
        <div class="svc-btns">${['mail', 'mailget', 'video', 'call', 'game'].map(a => `<button class="btn" data-act="svc" data-svc="${a}">${esc(NW.ACTIONS[a].label)}</button>`).join('')}</div>
        <label class="toggle"><input type="checkbox" data-act="tcp-details" ${S.tcp ? 'checked' : ''}> TCP genau zeigen (Verbindungsaufbau und Bestätigungen)</label>`, 'dienste', 'test');
      const bt = NW.btPartners(S.net, d.id);
      if (bt.length) {
        let b = `<p class="small">Gekoppelt mit ${bt.map(o => '<b>' + esc(o.name) + '</b>').join(', ')}</p>`;
        if (bt.some(o => T[o.type].btOnly)) b += '<button class="btn primary small" data-act="music">♪ Musik abspielen</button>';
        h += sec('bt', 'Bluetooth (PAN)', b, 'pan');
      }
      if (!t.services && has('dateien')) {
        const files = NW.filesOf(d);
        let b = fileListHTML(files);
        if (!ro) b += '<button class="btn small" data-act="new-file">+ Neue Datei</button>';
        b += `<label class="toggle"><input type="checkbox" data-path="share" ${d.share ? 'checked' : ''} ${dis ? 'disabled' : ''}> Dateien direkt tauschen (Peer-to-Peer)</label>
          <p class="muted small">${d.share ? `Andere Endgeräte können ${esc(d.name)} direkt Dateien schicken und seine Dateien holen. ${esc(d.name)} ist damit Client und Server zugleich.` : 'Aus: Andere Endgeräte können mit diesem Gerät keine Dateien direkt tauschen.'}</p>`;
        if (!ro) {
          b += `<label class="field">Partner (IP-Adresse eines Endgeräts oder Servers)
            <input id="file-target" placeholder="z. B. 192.168.1.12" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
            ${fileChips(d)}`;
          if (files.length) b += `<label class="field">Datei<select id="file-pick">${files.map(f => `<option>${esc(f)}</option>`).join('')}</select></label>`;
          b += `<div class="row">${files.length ? '<button class="btn primary small" data-act="send-file">Datei senden</button>' : ''}<button class="btn small" data-act="get-files">Dateien holen</button></div>`;
        }
        h += sec('files', 'Dateien', b, 'dateien');
      }
    }

    // ---- Router
    if (t.router) {
      const conns = which => NW.linksOf(S.net, d.id).filter(l => NW.iface(NW.portOf(l, d.id)) === which)
        .map(l => { const o = NW.dev(S.net, l.a === d.id ? l.b : l.a); return `<span class="kind ${l.kind}">${l.kind === 'kabel' ? 'Kabel' : 'WLAN'}</span> ${esc(o.name)}`; });
      const lanConns = conns(NW.LAN), wanConns = conns(NW.WAN);
      const p = d.ports[NW.LAN], i = NW.LAN;
      // Heimnetz (LAN)
      let b = `<p class="muted small">Drei LAN-Anschlüsse${has('wlan') ? ' und das WLAN des Routers' : ''} gehören zum selben Heimnetz – wie ein eingebauter Switch. Hier hat der Router eine feste Adresse; Endgeräte tragen sie als Gateway ein.</p>
        <p class="small">${lanConns.length ? lanConns.join(' · ') : '<span class="muted">Noch nichts angeschlossen.</span>'}</p>
        <div class="port-fields">${field('IP-Adresse des Routers', `ports.${i}.ip`, p.ip, 'portip', { disabled: dis })}${field('Subnetzmaske', `ports.${i}.mask`, p.mask, 'mask', { disabled: dis })}</div>`;
      if (has('wlan')) b += `<label class="toggle"><input type="checkbox" data-path="wlan" ${d.wlan ? 'checked' : ''} ${dis ? 'disabled' : ''}> WLAN (eingebauter Access Point)</label>`;
      const dh = NW.dhcpOf(p);
      if (has('dhcp')) b += `<label class="toggle"><input type="checkbox" data-path="ports.${i}.dhcp.on" ${dh.on ? 'checked' : ''} ${dis ? 'disabled' : ''}> DHCP-Server (verteilt IP-Adressen)</label>`;
      if (dh.on && has('dhcp')) {
        const rg = NW.dhcpRange(d, i);
        if (!rg) b += `<p class="fhint warn">Der Router braucht im Heimnetz selbst eine feste IP-Adresse, damit er Adressen verteilen kann.</p>${dis ? '' : `<div class="chips"><button class="chip suggest" data-act="port-auto" data-i="${i}">💡 Adresse für den Router eintragen</button></div>`}`;
        else {
          b += `<p class="dhcp-info">Der Router selbst hat die feste Adresse <b>${esc(p.ip.trim())}</b>. Geräte auf „Automatisch (DHCP)" bekommen von ihm eine freie Adresse von ${esc(NW.ipStr(rg.from))} bis ${esc(NW.ipStr(rg.to))}, die Subnetzmaske und ${esc(p.ip.trim())} als Gateway.</p>`;
          b += `<details class="desc"><summary>DHCP genauer einstellen</summary>
            <div class="port-fields">${field('Adressen von', `ports.${i}.dhcp.from`, dh.from, 'range', { disabled: dis, placeholder: NW.ipStr(rg.from) })}${field('bis', `ports.${i}.dhcp.to`, dh.to, 'range', { disabled: dis, placeholder: NW.ipStr(rg.to) })}</div>
            ${has('web') ? '' : field('DNS-Server für die Geräte', `ports.${i}.dhcp.dns`, dh.dns, 'dns', { disabled: dis, placeholder: 'leer = kein DNS-Server' })}</details>`;
        }
      }
      h += sec('lan', 'Heimnetz (LAN)', b);
      // Namensauflösung (DNS)
      if (has('web')) {
        const lanIP = (p.ip || '').trim(), up = (d.ports[NW.WAN].dns || '').trim();
        b = `<label class="toggle"><input type="checkbox" data-path="dnsRelay" ${d.dnsRelay ? 'checked' : ''} ${dis ? 'disabled' : ''}> DNS-Anfragen weiterleiten (Router als DNS-Server)</label>
          <p class="muted small">${d.dnsRelay
            ? `Geräte im Heimnetz fragen den Router${lanIP ? ` (${esc(lanIP)})` : ''} nach Namen. Er fragt beim DNS-Server ${up ? esc(up) : 'des Anbieters'} nach und reicht die Antwort weiter – so machen es die meisten Heimrouter.`
            : 'Aus: Die Geräte im Heimnetz fragen selbst direkt einen DNS-Server, z. B. den des Internetanbieters oder einen eigenen Server.'}</p>`;
        if (d.dnsRelay && !up) b += '<p class="fhint warn">Der Router kennt noch keinen DNS-Server, bei dem er nachfragen kann. Er bekommt ihn mit seiner Adresse vom Internetanbieter, oder du trägst ihn unten ein.</p>';
        b += field('DNS-Server, den der Router fragt', `ports.${NW.WAN}.dns`, d.ports[NW.WAN].dns || '', 'dns', { disabled: dis, placeholder: 'kommt vom Internetanbieter' });
        if (dh.on && has('dhcp')) b += field('DNS-Server, den der DHCP-Server verteilt', `ports.${i}.dhcp.dns`, dh.dns, 'dns', { disabled: dis,
          placeholder: d.dnsRelay && lanIP ? 'leer = der Router selbst' : up ? `leer = ${up}` : 'leer = kein DNS-Server' });
        h += sec('dns', 'Namensauflösung (DNS)', b, 'web');
      }
      // Internet (WAN)
      if (has('internet') || wanConns.length) {
        const w = d.ports[NW.WAN];
        b = `<label class="toggle"><input type="checkbox" data-path="modem" ${d.modem ? 'checked' : ''} ${dis ? 'disabled' : ''}> Eingebautes Internet-Modem (DSL/Kabel)</label>
        <p class="muted small">${d.modem
          ? 'Das Modem verbindet den Router über die Telefon- oder Kabelleitung mit dem Internetanbieter. Dort bekommt der Router seine externe (öffentliche) Adresse.'
          : 'Ohne eingebautes Modem wird hier ein externes Modem oder ein anderer Router per Kabel angeschlossen.'}</p>
        <p class="small">${wanConns.length ? wanConns.join(' · ') : '<span class="muted">Nichts angeschlossen.</span>'}</p>
        <div class="port-fields">${field('Externe IP-Adresse', `ports.${NW.WAN}.ip`, w.ip, 'portip', { disabled: dis, placeholder: d.modem ? 'vom Internetanbieter' : 'z. B. 192.168.100.2' })}${field('Subnetzmaske', `ports.${NW.WAN}.mask`, w.mask, 'mask', { disabled: dis })}</div>
        ${field('Gateway ins Internet', `ports.${NW.WAN}.gw`, w.gw || '', 'gw', { disabled: dis, placeholder: 'vom Internetanbieter' })}`;
        const isp = NW.ispOf(S.net, d);
        if (isp && !dis) b += `<button class="btn small" data-act="dhcp">Adresse von ${esc(isp.name)} anfordern</button>`;
        const wa = NW.ifaceAddr(d, NW.WAN);
        if (wa && wanConns.length) b += `<p class="nat-info"><b>NAT${has('v6') ? ' (nur bei IPv4)' : ''}:</b> Alle Geräte im Heimnetz gehen mit der externen Adresse <b>${esc(NW.ipStr(wa.ip))}</b> ins Internet. Ihre lokalen Adressen sieht dort niemand. Antworten verteilt der Router wieder an das richtige Gerät.</p>`;
        h += sec('wan', 'Internet-Anschluss (WAN)', b, 'internet');
      }
    }

    // ---- Internetanbieter
    if (t.isp) {
      const a = NW.ifaceAddr(d, 0);
      let b = `<p class="muted small">${t.rz
        ? 'Das Rechenzentrum hat ein eigenes öffentliches Netz. Server, die hier angeschlossen werden, bekommen automatisch per DHCP eine Adresse daraus. Verbinde das Rechenzentrum per Kabel mit einem Internetanbieter, damit seine Server im Internet erreichbar sind.'
        : 'Der Internetanbieter verteilt öffentliche (externe) IP-Adressen an alle Router und Server, die an seine Leitung angeschlossen werden – automatisch per DHCP.'}</p>
        <div class="port-fields">${field(t.rz ? 'IP-Adresse des Rechenzentrums' : 'IP-Adresse des Anbieters', 'ip', d.ip, 'ip', { disabled: dis })}${field('Subnetzmaske', 'mask', d.mask, 'mask', { disabled: dis })}</div>`;
      if (a) { const rg = NW.dhcpDefaultRange(a.ip, a.prefix); b += `<p class="small">Angeschlossene Geräte bekommen eine Adresse von ${esc(NW.ipStr(rg.from))} bis ${esc(NW.ipStr(rg.to))} und ${esc(d.ip.trim())} als Gateway.</p>`; }
      if (has('web') || (d.dns || '').trim()) {
        b += field(t.rz ? 'DNS-Server für die Server' : 'DNS-Server für die Kunden', 'dns', d.dns || '', 'dns', { disabled: dis, placeholder: 'leer = kein DNS-Server' });
        if (!dis && !(d.dns || '').trim()) {
          const ds = S.net.devices.find(o => o.services && o.services.dns && o.services.dns.on && NW.parseIP(o.ip) !== null && !NW.isPrivate(NW.parseIP(o.ip)));
          if (ds) b += `<div class="chips"><button class="chip suggest" data-act="isp-dns" data-val="${esc(ds.ip.trim())}">💡 ${esc(ds.name)} (${esc(ds.ip.trim())}) als DNS-Server übernehmen</button></div>`;
        }
      }
      const cust = NW.l2Endpoints(S.net, d.id, 0).map(e => {
        const x = NW.ifaceAddr(e.dev, e.port);
        return `<li>${esc(e.dev.name)}${T[e.dev.type].isp ? ` <span class="muted">(${T[e.dev.type].rz ? 'Rechenzentrum' : 'anderer Internetanbieter'})</span>` : ''} – ${x ? esc(NW.ipStr(x.ip)) : '<span class="muted">noch keine Adresse</span>'}</li>`;
      });
      b += `<h4>Angeschlossen</h4>${cust.length ? `<ul class="conn">${cust.join('')}</ul>` : `<p class="muted small">${t.rz ? 'Noch nichts. Verbinde Server und einen Internetanbieter per Kabel.' : 'Noch nichts. Verbinde einen Router (Internet-Anschluss), ein Rechenzentrum oder einen Server per Kabel.'}</p>`}`;
      h += sec('isp', 'Öffentliche Adressen', b);
    }

    // ---- IPv6 (für alle Geräte mit Adressen)
    if (has('v6')) {
      let b = '';
      if (t.host) b = v6HostHTML(d);
      else if (t.router) {
        const v6l = NW.ip6Of(S.net, d, NW.LAN), v6w = NW.ip6Of(S.net, d, NW.WAN);
        if (v6l.lanNet) b += `<p class="small">Vom Internetanbieter bekommt ${esc(d.name)} ein eigenes Netz für das Heimnetz: <code>${esc(v6l.lanNet)}</code>. Das gibt der Router im Heimnetz bekannt; jedes Gerät bildet daraus selbst seine globale Adresse – ohne DHCP und ohne NAT.</p>
          <p class="v6-row"><span class="v6-kind">Heimnetz</span><code>${esc(v6l.gua)}</code></p>
          <p class="v6-row"><span class="v6-kind">Internet</span><code>${esc(v6w.gua)}</code></p>`;
        else b += '<p class="muted small">Sobald der Internet-Anschluss mit einem Internetanbieter verbunden ist, bekommt der Router von ihm ein IPv6-Netz für das Heimnetz.</p>';
        b += `<p class="v6-row"><span class="v6-kind">Link-Local</span><code>${esc(v6l.ll)}</code></p>${compareHTML()}`;
      } else if (t.isp) {
        const v6 = NW.ip6Of(S.net, d, 0);
        b = `<p class="small">IPv6-Adressbereich: <code>${esc(v6.net.replace('::/64', '::/48'))}</code>. Jeder angeschlossene Router bekommt daraus ein eigenes Netz für sein Heimnetz, Server direkt beim Anbieter liegen in <code>${esc(v6.net)}</code>. Der Anbieter selbst hat <code>${esc(v6.gua)}</code>.</p>`;
      }
      h += sec('v6', 'IPv6 (automatisch)', b, 'v6', 'v6');
    }

    if (t.bus) h += '<p class="muted small">Das Bus-Kabel braucht keine IP-Adresse. Schließe alle Geräte mit einem Kabel daran an.</p>';
    else if (t.l2) h += `<p class="muted small">Ein ${esc(t.label)} braucht keine IP-Adresse – er leitet die Pakete nur weiter.</p>`;
    if (t.btOnly) h += '<p class="muted small">Kopfhörer brauchen keine IP-Adresse. Sie werden per Bluetooth mit einem Gerät in der Nähe gekoppelt (Werkzeug „Bluetooth“).</p>';

    if (!ro && has('ausfall')) {
      const on = t.bus ? !!d.broken : !!d.off;
      const label = t.bus ? (on ? 'Bus-Kabel reparieren' : '⚡ Kabelbruch im Bus-Kabel simulieren') : (on ? 'Wieder einschalten' : '✕ Ausfall simulieren (ausschalten)');
      h += sec('fault', 'Ausfall testen', `<button class="btn small ${on ? 'primary' : ''}" data-act="fault">${label}</button>`, 'ausfall');
    }

    h += sec('conn', 'Verbindungen', connectionsHTML(d));

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
      case 'dnsfwd':
        if (v && NW.parseIP(v) !== null && NW.parseIP(v) === NW.parseIP(d.ip || '')) return ['bad', 'Das ist die eigene Adresse. Trage einen anderen DNS-Server ein.'];
        // weiter wie bei 'dns'
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
    // Router: geänderter DNS-Server im Heimnetz → Geräte mit DHCP übernehmen ihn (wie bei einer Verlängerung)
    if (T[d.type].router && (inp.dataset.path === 'dnsRelay' || /^ports\.\d+\.(dhcp\.)?dns$/.test(inp.dataset.path)) && (typeof val === 'boolean' || NW.parseIP(val) !== null || !val.trim())) {
      const n = NW.refreshDns(S.net, true);
      if (n) toast(`${n === 1 ? 'Ein Gerät hat' : n + ' Geräte haben'} den neuen DNS-Server per DHCP übernommen.`, 'ok');
    }
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
    if (ev.target.id === 'svc-target') { ev.preventDefault(); doService('mail'); }
  });

  insp.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act], [data-fill]');
    if (!b) return;
    if (b.dataset.fill) {
      const target = $({ ping: 'ping-target', url: 'url-target', file: 'file-target', svc: 'svc-target' }[b.dataset.fill]);
      target.value = b.dataset.val;
      return;
    }
    if (b.dataset.act === 'stadt') {
      const l = S.net.links.find(x => x.id === S.selected);
      if (!l || l.locked || readOnly()) return;
      const want = b.dataset.val === '1';
      if (!!l.stadt === want) return;
      if (want) l.stadt = true; else delete l.stadt;
      toast(want ? 'Aus dem Kabel ist eine Glasfaserleitung quer durch die Stadt geworden.' : 'Die Leitung ist wieder ein normales Netzwerkkabel.', 'ok');
      renderAll(); scheduleSave();
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
      case 'music': doMusic(d); break;
      case 'new-file': {
        const f = NW.newFile(d);
        toast(`Neue Datei „${f}“ angelegt.`, 'ok');
        renderInspector(); scheduleSave(); break;
      }
      case 'send-file': doFile(d, 'send'); break;
      case 'get-files': doFile(d, 'get'); break;
      case 'browse': doBrowse(); break;
      case 'svc': doService(b.dataset.svc); break;
      case 'tcp-details':
        S.tcp = b.checked; store.set('nw_tcp', S.tcp ? '1' : '0');
        toast(S.tcp ? 'Bei TCP siehst du jetzt auch Verbindungsaufbau, Bestätigungen und Verbindungsabbau.' : 'TCP wird wieder kurz gezeigt.');
        break;
      case 'loss': {
        const l = S.net.links.find(x => x.id === S.selected);
        if (!l || readOnly()) break;
        l.loss = b.checked;
        if (!l.loss) delete l.loss;
        renderAll(); scheduleSave(); break;
      }
      case 'close-insp':
        S.selected = null; renderCanvas(); renderInspector(); break;
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
      case 'dns-forward':
        d.services.dns.forward = b.dataset.val; renderInspector(); renderGoals(); scheduleSave(); break;
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
    div.className = 'log-entry ' + (step.kind || '') + (step.ok === false ? ' failed' : '') + (step.tcp ? ' tcp' : '');
    const pc = /^TCP/.test(step.proto || '') ? ' tcp' : /^UDP/.test(step.proto || '') ? ' udp' : '';
    div.innerHTML = `<span class="log-label">${esc(step.label)}</span>${step.proto ? `<span class="log-proto${pc}">${esc(step.proto)}</span>` : ''}<span class="log-text">${esc(step.text || '')}</span>${step.note ? `<span class="log-note">↔ ${esc(step.note)}</span>` : ''}`;
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
      if (T[d.type].router) {
        logResult(true, `${d.name} hat von ${srv ? srv.name : 'dem Internetanbieter'} die externe (öffentliche) Adresse ${res.lease.ip} bekommen. Damit ist das Heimnetz mit dem Internet verbunden.`);
        NW.refreshDns(S.net); // Geräte im Heimnetz erfahren beim Verlängern den DNS-Server des Anbieters
      }
      else logResult(true, `${d.name} hat von ${srv ? srv.name : 'dem DHCP-Server'} die Adresse ${res.lease.ip} bekommen.`);
    } else if (res.apipa) {
      NW.applyLease(d, res.apipa);
      logResult(false, `${res.error} ${d.name} gibt sich deshalb selbst die Notfall-Adresse ${res.apipa.ip} (APIPA). Damit erreicht es nur Geräte, die direkt im selben Netz auch eine 169.254-Adresse haben – ohne Gateway, also nicht das Internet.`, res.hint);
    } else logResult(false, res.error, res.hint);
    NW.logEvent(S.net, { type: 'dhcp', src: d.id, ok: !!res.ok });
    renderAll(); scheduleSave();
  }

  async function doMusic(d) {
    if (S.busy || !d) return;
    const res = NW.playMusic(S.net, d.id);
    if (res.steps.length) await runSteps(res.steps);
    if (res.ok) logResult(true, `${NW.dev(S.net, res.target).name} spielen die Musik von ${d.name}. Die Töne kommen per Bluetooth – ohne IP-Adresse, ohne Router, nur über wenige Meter (PAN).`);
    else logResult(false, res.error, res.hint);
    NW.logEvent(S.net, { type: 'music', src: d.id, target: res.target || null, ok: !!res.ok });
    renderGoals(); scheduleSave();
  }

  async function doFile(d, dir) {
    if (S.busy || !d) return;
    const target = ($('file-target') || {}).value || '';
    const file = ($('file-pick') || {}).value || '';
    const res = dir === 'send' ? NW.sendFile(S.net, d.id, target.trim(), file) : NW.getFiles(S.net, d.id, target.trim());
    if (res.steps.length) await runSteps(res.steps);
    const t = res.target ? NW.dev(S.net, res.target) : null;
    if (res.ok) {
      const how = res.mode === 'server'
        ? `Client-Server: ${d.name} ist der Client, ${t.name} der Server. Die Datei liegt zentral auf dem Server und kann dort jederzeit abgeholt werden – auch wenn der Absender nicht mehr da ist.`
        : `Peer-to-Peer: ${d.name} und ${t.name} tauschen direkt, ohne Server. Beide sind gleichberechtigt – jedes Gerät kann Dateien anbieten und holen. Dafür müssen beide gleichzeitig erreichbar sein.`;
      logResult(true, (dir === 'send' ? `„${res.files[0]}“ ist bei ${t.name} angekommen. ` : `${d.name} hat ${res.files.map(f => '„' + f + '“').join(', ')} von ${t.name} bekommen. `) + how);
    } else logResult(false, res.error, res.hint);
    NW.logEvent(S.net, { type: 'file', src: d.id, target: res.target || null, mode: res.mode || null, dir, files: res.files || [], ok: !!res.ok });
    renderAll(); scheduleSave();
  }

  function natText(n) {
    return n ? ` ${n.target} hat als Absender nur ${n.outside} gesehen – die externe Adresse von ${n.router}. Die lokale Adresse ${n.inside} bleibt im Heimnetz (NAT).` : '';
  }

  async function doBrowse() {
    if (S.busy) return;
    const d = NW.dev(S.net, S.selected);
    const url = $('url-target').value.trim();
    const res = NW.browse(S.net, d.id, url, { tcp: S.tcp && has('dienste') });
    if (res.steps.length) await runSteps(res.steps);
    const u = NW.parseURL(url);
    NW.logEvent(S.net, { type: 'web', src: d.id, host: u ? u.host : url, ok: !!res.ok, lost: !!res.lost, tcp: !!res.tcp });
    if (res.ok) {
      logResult(true, res.message + natText(res.nat));
      openModal(`<div class="browser"><div class="browser-bar"><span class="dots"><i></i><i></i><i></i></span><span class="browser-url">http://${esc(res.page.host)}/</span></div>
        <div class="browser-page"><h1>${esc(res.page.title || '(ohne Titel)')}</h1><p>${esc(res.page.text)}</p></div>
        <p class="muted small">Geladen auf ${esc(d.name)} · Server-IP ${esc(res.page.ip)} · über HTTP-Request und HTTP-Response</p></div>`);
    } else logResult(false, res.error, res.hint);
    renderGoals(); scheduleSave();
  }

  /** Internetdienst nutzen: E-Mail senden/abrufen, Video, Videoanruf, Online-Spiel. */
  async function doService(action) {
    if (S.busy) return;
    const d = NW.dev(S.net, S.selected);
    const target = $('svc-target').value.trim();
    const res = NW.useService(S.net, d.id, action, target, { tcp: S.tcp && has('dienste') });
    if (res.steps.length) await runSteps(res.steps);
    const u = NW.parseURL(target);
    NW.logEvent(S.net, { type: 'svc', action, src: d.id, host: u ? u.host : target, ok: !!res.ok, lost: !!res.lost, tcp: !!res.tcp });
    if (res.ok) {
      const srv = NW.dev(S.net, res.target);
      if (action === 'mail') {
        const box = srv.services.mail.box || (srv.services.mail.box = []);
        box.push(res.mail);
        if (box.length > 20) box.splice(0, box.length - 20);
      }
      logResult(true, res.message + natText(res.nat));
      if (action === 'mailget') {
        openModal(`<h2 class="modal-title">Postfach auf ${esc(srv.name)}</h2>
          ${res.mails.length ? `<ul class="mail-list">${res.mails.map(m => `<li><b>Von: ${esc(m.from)}</b><br>${esc(m.text)}</li>`).join('')}</ul>` : '<p>Das Postfach ist leer. Schicke zuerst von einem Gerät eine E-Mail an diesen Server.</p>'}
          <p class="muted small">Abgerufen auf ${esc(d.name)} über IMAP (TCP · Port 143). Die E-Mails lagen auf dem Server, bis sie abgerufen wurden.</p>`);
      }
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

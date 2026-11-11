/* NetzWerkstatt – eigene Aufgaben der Lehrkraft
 *
 * Eigene Aufgaben werden als JSON gespeichert und können als Datei weitergegeben
 * werden. Ziele sind keine Programmzeilen, sondern Bausteine mit Einstellungen
 * (z. B. „Ping von PC zu Tablet“). So kann eine fremde Datei keinen Code ausführen.
 *
 * Dateiformat:
 *   { "format": "netzwerkstatt-aufgaben", "version": 1, "tasks": [ Aufgabe, … ] }
 * Aufgabe:
 *   { id, title, intro, tip, think, manual, show, goals: [Ziel, …], start: Netzwerk, solution: Netzwerk|null }
 * Ziel:
 *   { type: 'geraete' | 'verbindung' | 'ip-netz' | 'dhcp' | 'ping' | 'webseite' | 'dns-eintrag' | 'dns-weg' | 'dienst' | 'topologie' | 'netzart',
 *     …Einstellungen, text?: eigener Text }
 */
(function (root) {
  'use strict';
  const NW = root.NW || (typeof require !== 'undefined' ? require('./sim.js') : null);
  const NWTasks = root.NWTasks || (typeof require !== 'undefined' ? require('./tasks.js') : null);
  const T = NW.TYPES;

  const FORMAT = 'netzwerkstatt-aufgaben';
  const VERSION = 1;
  // Netz für den Schülertext: 192.168.1.0/24 → 192.168.1.x
  const netName = n => { const [a, p] = String(n).split('/'); const ip = NW.parseIP(a); return ip === null || !p ? n : NW.netName(ip, Number(p)); };
  const LIMITS = { tasks: 60, goals: 15, devices: 80, links: 160, events: 40, title: 80, intro: 1500, tip: 1000, goalText: 300 };

  // ---------------------------------------------------------------- Geräte-Auswahl in Zielen
  const PLURAL = { pc: 'PCs', laptop: 'Laptops', tablet: 'Tablets', smartphone: 'Smartphones', headset: 'Kopfhörer', server: 'Server', switch: 'Switches', ap: 'Access Points', router: 'Router', isp: 'Internetanbieter', rz: 'Rechenzentren', bus: 'Bus-Kabel' };
  const ARTICLE = { pc: 'einem PC', laptop: 'einem Laptop', tablet: 'einem Tablet', smartphone: 'einem Smartphone', headset: 'Kopfhörern', server: 'einem Server', switch: 'einem Switch', ap: 'einem Access Point', router: 'einem Router', isp: 'einem Internetanbieter', rz: 'einem Rechenzentrum', bus: 'einem Bus-Kabel' };
  const AKK = { pc: 'einen PC', laptop: 'einen Laptop', tablet: 'ein Tablet', smartphone: 'ein Smartphone', headset: 'Kopfhörer', server: 'einen Server', switch: 'einen Switch', ap: 'einen Access Point', router: 'einen Router', isp: 'einen Internetanbieter', rz: 'ein Rechenzentrum', bus: 'ein Bus-Kabel' };
  // Sammelbegriffe zusätzlich zu den Gerätetypen
  const ENDGERAETE = ['pc', 'laptop', 'tablet', 'smartphone'];
  const GROUP_LABEL = { endgeraet: ['Endgerät', 'Endgeräte', 'einem Endgerät', 'ein Endgerät'], geraet: ['Gerät', 'Geräte', 'einem Gerät', 'ein Gerät'] };
  function matcher(sel) {
    if (sel === 'endgeraet') return d => ENDGERAETE.includes(d.type);
    if (sel === 'geraet') return d => !!T[d.type].host;
    return d => d.type === sel;
  }
  const label = sel => GROUP_LABEL[sel] ? GROUP_LABEL[sel][0] : T[sel].label;
  const plural = sel => GROUP_LABEL[sel] ? GROUP_LABEL[sel][1] : PLURAL[sel];
  const dat = sel => GROUP_LABEL[sel] ? GROUP_LABEL[sel][2] : ARTICLE[sel];
  const akk = sel => GROUP_LABEL[sel] ? GROUP_LABEL[sel][3] : AKK[sel];
  const DEVICE_SEL = Object.keys(T);
  const HOST_SEL = ['endgeraet', 'geraet', ...Object.keys(T).filter(t => T[t].host)];
  const KIND_LABEL = { egal: 'beliebig', kabel: 'Kabel', wlan: 'WLAN', bluetooth: 'Bluetooth' };
  const SVC_ACTIONS = ['mail', 'mailget', 'video', 'call', 'game'];
  const SVC_TEXT = { mail: 'Schicke{w} eine E-Mail{h}.', mailget: 'Rufe{w} E-Mails{h} ab.', video: 'Sieh dir{w} ein Video{h} an.', call: 'Starte{w} einen Videoanruf{h}.', game: 'Spiele{w} online{h}.' };
  const TOPO_LABEL = { stern: 'Sterntopologie', bus: 'Bustopologie', ring: 'Ringtopologie' };

  // Wie der Name aufgelöst werden soll (Liste der befragten DNS-Server → erfüllt?)
  const DNS_VIA = {
    eigener: { label: 'über einen selbst eingerichteten DNS-Server', text: 'Den Namen soll ein DNS-Server übersetzen, den du selbst eingerichtet hast.', check: list => list.some(d => !d.locked && NW.svcOn(d, 'dns')) },
    router: { label: 'der Router leitet die DNS-Anfrage weiter', text: 'Der Router soll dabei die DNS-Anfrage weiterleiten.', check: list => list.some(d => T[d.type].router) && list.length > 1 },
    weiter: { label: 'mit Weiterleitung zu einem zweiten DNS-Server', text: 'Der erste DNS-Server soll den Namen nicht selbst kennen, sondern bei einem anderen DNS-Server nachfragen.', check: list => list.length > 1 },
  };

  // ---------------------------------------------------------------- Ziel-Bausteine
  // fields: Einstellungen mit Art und erlaubten Werten (für Prüfung und Formular)
  const GOAL_TYPES = {
    geraete: {
      label: 'Geräte aufstellen',
      fields: { device: { label: 'Gerät', options: DEVICE_SEL, def: 'pc' }, min: { label: 'Anzahl mindestens', num: [1, 30], def: 2 } },
      text: g => `Setze mindestens ${g.min} ${g.min === 1 ? label(g.device) : plural(g.device)} auf die Arbeitsfläche.`,
      check: g => c => c.byType(g.device).length >= g.min,
    },
    verbindung: {
      label: 'Geräte verbinden',
      fields: { device: { label: 'Gerät', options: DEVICE_SEL, def: 'pc' }, to: { label: 'mit', options: DEVICE_SEL, def: 'switch' }, kind: { label: 'Verbindung', options: Object.keys(KIND_LABEL), def: 'kabel' } },
      text: g => `Verbinde ${akk(g.device)} ${g.kind === 'egal' ? '' : 'per ' + KIND_LABEL[g.kind] + ' '}mit ${dat(g.to)}.`,
      check: g => c => c.byType(g.device).some(a => c.byType(g.to).some(b => a !== b && c.linked(a, b, g.kind === 'egal' ? null : g.kind))),
    },
    'ip-netz': {
      label: 'IP-Adressen vergeben',
      fields: { device: { label: 'Geräte', options: HOST_SEL, def: 'endgeraet' }, net: { label: 'Netz (z. B. 192.168.1.x)', net: true, def: '192.168.1.0/24' }, gw: { label: 'Gateway (leer = egal)', ip: true, def: '' } },
      text: g => `Gib jedem ${label(g.device)} eine eigene IP-Adresse im Netz ${netName(g.net)}${g.gw ? ` und trage ${g.gw} als Gateway ein` : ''}.`,
      check: g => c => {
        const [addr, prefix] = g.net.split('/');
        const list = c.net.devices.filter(matcher(g.device));
        return list.length > 0 && list.every(d => c.inNet(d, addr, Number(prefix)) && (!g.gw || (d.gw || '').trim() === g.gw)) && c.distinctIPs(list);
      },
    },
    dhcp: {
      label: 'Adresse per DHCP',
      fields: { device: { label: 'Geräte', options: HOST_SEL, def: 'endgeraet' } },
      text: g => `Lass alle ${plural(g.device)} ihre IP-Adresse automatisch per DHCP beziehen.`,
      check: g => c => {
        const list = c.net.devices.filter(matcher(g.device));
        return list.length > 0 && list.every(d => d.dhcp && NW.parseIP(d.ip) !== null && !NW.isApipa(NW.parseIP(d.ip)));
      },
    },
    ping: {
      label: 'Ping senden',
      fields: { from: { label: 'von', options: HOST_SEL, def: 'pc' }, to: { label: 'zu', options: HOST_SEL, def: 'pc' } },
      text: g => g.from === g.to ? `Teste mit einem Ping, ob sich zwei ${plural(g.to)} erreichen.` : `Teste die Verbindung mit einem Ping von ${dat(g.from)} zu ${dat(g.to)}.`,
      check: g => c => c.pingOk(matcher(g.from), matcher(g.to)),
    },
    webseite: {
      label: 'Webseite aufrufen',
      fields: { host: { label: 'Adresse (z. B. www.schule.de)', host: true, def: 'www.netzwerkstatt.de' } },
      text: g => `Rufe im Browser die Seite http://${g.host} auf.`,
      check: g => c => c.webOk(g.host),
    },
    'dns-eintrag': {
      label: 'DNS-Eintrag anlegen',
      fields: { host: { label: 'Name (z. B. www.schule.de)', host: true, def: 'www.schule.de' }, ip: { label: 'IP-Adresse (leer = egal)', ip: true, def: '' } },
      text: g => `Richte einen DNS-Server ein, der den Namen ${g.host} ${g.ip ? `in die IP-Adresse ${g.ip}` : 'in eine IP-Adresse'} übersetzt.`,
      check: g => c => c.byType('server').some(d => NW.svcOn(d, 'dns') && (d.services.dns.entries || []).some(e => (e.name || '').trim().toLowerCase() === g.host && NW.parseIP(e.ip) !== null && (!g.ip || NW.parseIP(e.ip) === NW.parseIP(g.ip)))),
    },
    'dns-weg': {
      label: 'Webseite über eigenen DNS',
      fields: { host: { label: 'Adresse (z. B. www.schule.de)', host: true, def: 'www.netzwerkstatt.de' }, via: { label: 'Namensauflösung', options: Object.keys(DNS_VIA), def: 'eigener' } },
      text: g => `Rufe im Browser die Seite http://${g.host} auf. ${DNS_VIA[g.via].text}`,
      check: g => c => c.webDnsOk(g.host, DNS_VIA[g.via].check),
    },
    dienst: {
      label: 'Internetdienst nutzen',
      fields: { action: { label: 'Dienst', options: SVC_ACTIONS, def: 'mail' }, from: { label: 'auf', options: HOST_SEL, def: 'geraet' }, host: { label: 'Server-Name (leer = egal)', host: true, optional: true, def: '' } },
      text: g => SVC_TEXT[g.action].replace('{w}', g.from === 'geraet' ? '' : ` mit ${dat(g.from)}`).replace('{h}', g.host ? ` über ${g.host}` : ''),
      check: g => c => c.svcOk(g.action, matcher(g.from), g.host ? { host: g.host } : {}),
    },
    topologie: {
      label: 'Topologie bauen',
      fields: { kind: { label: 'Topologie', options: Object.keys(TOPO_LABEL), def: 'stern' } },
      text: g => `Baue ein Netz in ${TOPO_LABEL[g.kind]}.`,
      check: g => c => c.topos(g.kind).some(t => g.kind !== 'ring' || t.closed),
    },
    netzart: {
      label: 'Netzart bilden',
      fields: { kind: { label: 'Netzart', options: Object.keys(NW.NET_KINDS), def: 'LAN' } },
      text: g => `Baue ein ${g.kind} (${NW.NET_KINDS[g.kind].name}).`,
      check: g => c => c.hasKind(g.kind),
    },
  };

  function optionLabel(field, v) {
    if (field === 'kind' && KIND_LABEL[v]) return KIND_LABEL[v];
    if (field === 'kind' && TOPO_LABEL[v]) return TOPO_LABEL[v];
    if (field === 'kind' && NW.NET_KINDS[v]) return v + ' – ' + NW.NET_KINDS[v].name;
    if (field === 'action') return NW.ACTIONS[v].label;
    if (field === 'via' && DNS_VIA[v]) return DNS_VIA[v].label;
    if (GROUP_LABEL[v]) return v === 'endgeraet' ? 'alle Endgeräte (PC, Tablet, Smartphone)' : 'beliebiges Gerät';
    if (T[v]) return T[v].label;
    return v;
  }

  function goalText(g) { return g.text || GOAL_TYPES[g.type].text(g); }

  // ---------------------------------------------------------------- Prüfen und Bereinigen
  const str = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max).trim() : '';
  const normHost = h => str(h, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  /** Beliebige JSON-Daten kürzen und begrenzen (für Felder ohne festen Aufbau). */
  function cleanAny(v, depth) {
    if (depth > 6) return null;
    if (typeof v === 'string') return v.slice(0, 2000);
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'boolean' || v === null) return v;
    if (Array.isArray(v)) return v.slice(0, 100).map(x => cleanAny(x, depth + 1));
    if (typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).slice(0, 60)) if (!BAD_KEYS.has(k) && k.length <= 40) o[k] = cleanAny(v[k], depth + 1);
      return o;
    }
    return null;
  }

  /** Wert so übernehmen, dass er zur Vorlage passt (gleiche Art), sonst die Vorlage behalten. */
  function mergeLike(def, v, depth) {
    if (def === undefined) return cleanAny(v, depth);
    if (Array.isArray(def)) {
      if (!Array.isArray(v)) return def;
      return v.slice(0, 100).map((x, i) => def.length ? mergeLike(def[Math.min(i, def.length - 1)], x, depth + 1) : cleanAny(x, depth + 1));
    }
    if (def && typeof def === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return def;
      const o = Object.assign({}, def);
      for (const k of Object.keys(v).slice(0, 60)) if (!BAD_KEYS.has(k) && k.length <= 40) o[k] = mergeLike(def[k], v[k], depth + 1);
      return o;
    }
    if (def === null) return cleanAny(v, depth);
    if (typeof v !== typeof def || (typeof v === 'number' && !Number.isFinite(v))) return def;
    return typeof v === 'string' ? v.slice(0, 2000) : v;
  }

  /** Ein Netzwerk aus einer Datei prüfen und bereinigen. Wirft einen Fehler mit verständlichem Text. */
  function sanitizeNetwork(n, what) {
    if (!n || typeof n !== 'object' || !Array.isArray(n.devices) || !Array.isArray(n.links)) throw new Error(`${what}: kein gültiges Netzwerk.`);
    if (n.devices.length > LIMITS.devices) throw new Error(`${what}: zu viele Geräte (höchstens ${LIMITS.devices}).`);
    if (n.links.length > LIMITS.links) throw new Error(`${what}: zu viele Verbindungen (höchstens ${LIMITS.links}).`);
    const out = NW.emptyNetwork();
    const ids = new Set();
    for (const d of n.devices) {
      if (!d || typeof d !== 'object' || !T[d.type]) throw new Error(`${what}: unbekanntes Gerät „${str(d && d.type, 30)}“.`);
      const id = str(d.id, 40);
      if (!/^[\w-]+$/.test(id) || ids.has(id)) throw new Error(`${what}: ungültige oder doppelte Geräte-ID.`);
      ids.add(id);
      const tmp = NW.emptyNetwork();
      const def = NW.createDevice(tmp, d.type, 0, 0, { id });
      const clean = mergeLike(def, d, 0);
      clean.id = id; clean.type = d.type;
      clean.name = str(d.name, 40) || def.name;
      clean.x = Math.max(0, Math.min(4000, Number(d.x) || 0));
      clean.y = Math.max(0, Math.min(4000, Number(d.y) || 0));
      if (T[d.type].router) clean.ports = def.ports.map((p, i) => mergeLike(p, (Array.isArray(d.ports) && d.ports[i]) || {}, 1));
      out.devices.push(clean);
    }
    const lids = new Set();
    for (const l of n.links) {
      if (!l || typeof l !== 'object') throw new Error(`${what}: ungültige Verbindung.`);
      const a = str(l.a, 40), b = str(l.b, 40);
      let id = str(l.id, 40);
      if (!ids.has(a) || !ids.has(b) || a === b) throw new Error(`${what}: Verbindung zu einem Gerät, das es nicht gibt.`);
      if (!['kabel', 'wlan', 'bluetooth'].includes(l.kind)) throw new Error(`${what}: unbekannte Verbindungsart.`);
      if (!/^[\w-]+$/.test(id) || lids.has(id)) id = NW.newId('l');
      lids.add(id);
      const clean = cleanAny(l, 0);
      Object.assign(clean, { id, a, b, kind: l.kind });
      for (const p of ['aPort', 'bPort']) {
        if (p in clean && !(Number.isInteger(clean[p]) && clean[p] >= 0 && clean[p] <= 9)) delete clean[p];
      }
      out.links.push(clean);
    }
    if (Array.isArray(n.events)) out.events = n.events.slice(-LIMITS.events).filter(e => e && typeof e === 'object').map(e => cleanAny(e, 0));
    if (n.quiz && typeof n.quiz === 'object' && !Array.isArray(n.quiz)) {
      out.quiz = {};
      for (const k of Object.keys(n.quiz).slice(0, 30)) if (!BAD_KEYS.has(k)) out.quiz[str(k, 40)] = str(n.quiz[k], 40);
    }
    return out;
  }

  function sanitizeGoal(g, i) {
    const where = `Ziel ${i + 1}`;
    if (!g || typeof g !== 'object' || !GOAL_TYPES[g.type]) throw new Error(`${where}: unbekannte Art „${str(g && g.type, 30)}“.`);
    const def = GOAL_TYPES[g.type];
    const out = { type: g.type };
    for (const [k, f] of Object.entries(def.fields)) {
      const v = g[k];
      if (f.options) {
        if (!f.options.includes(v)) throw new Error(`${where}: ungültige Einstellung „${f.label}“.`);
        out[k] = v;
      } else if (f.num) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < f.num[0] || n > f.num[1]) throw new Error(`${where}: „${f.label}“ muss zwischen ${f.num[0]} und ${f.num[1]} liegen.`);
        out[k] = n;
      } else if (f.net) {
        // Die Subnetzmaske ist im Spiel fest (/24). Erlaubt: 192.168.1.x, 192.168.1.0 oder 192.168.1.0/24
        const s = str(v, 40).replace(/\.x$/i, '.0').replace(/\/\d+$/, '');
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(s) || NW.parseIP(s) === null) throw new Error(`${where}: Netz bitte so angeben: 192.168.1.x.`);
        out[k] = NW.netStr(NW.parseIP(s), 24);
      } else if (f.ip) {
        const s = str(v, 40);
        if (s && NW.parseIP(s) === null) throw new Error(`${where}: „${s}“ ist keine IPv4-Adresse.`);
        out[k] = s;
      } else if (f.host) {
        const h = normHost(v);
        if (!h && !f.optional) throw new Error(`${where}: Bitte eine Adresse angeben.`);
        if (h && !/^[a-z0-9.-]+$/.test(h)) throw new Error(`${where}: „${h}“ ist keine gültige Adresse.`);
        out[k] = h;
      }
    }
    const text = str(g.text, LIMITS.goalText);
    if (text) out.text = text;
    return out;
  }

  /** Eine Aufgabe aus einer Datei prüfen und bereinigen. Wirft einen Fehler mit verständlichem Text. */
  function sanitizeTask(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Keine gültige Aufgabe.');
    const title = str(t.title, LIMITS.title);
    if (!title) throw new Error('Eine Aufgabe hat keinen Titel.');
    const where = `Aufgabe „${title}“`;
    let id = str(t.id, 40);
    if (!/^eigen-[a-z0-9-]{1,30}$/.test(id)) id = newTaskId();
    const intro = str(t.intro, LIMITS.intro);
    if (!Array.isArray(t.goals)) throw new Error(`${where}: Ziele fehlen.`);
    if (t.goals.length > LIMITS.goals) throw new Error(`${where}: höchstens ${LIMITS.goals} Ziele.`);
    let goals;
    try { goals = t.goals.map(sanitizeGoal); } catch (e) { throw new Error(`${where}: ${e.message}`); }
    const out = {
      id, title, intro,
      tip: str(t.tip, LIMITS.tip),
      think: str(t.think, LIMITS.tip),
      manual: t.manual === true,
      goals,
      start: t.start ? sanitizeNetwork(t.start, `${where}, Startaufbau`) : NW.emptyNetwork(),
      solution: t.solution ? sanitizeNetwork(t.solution, `${where}, Musterlösung`) : null,
    };
    // Freigegebene Funktionen der Arbeitsfläche: unbekannte Werte werden verworfen.
    if (Array.isArray(t.show)) {
      const known = featureIds();
      out.show = [...new Set(t.show.filter(f => typeof f === 'string' && (!known || known.includes(f))))].slice(0, 30);
    }
    return out;
  }

  function featureIds() {
    const F = NWTasks && NWTasks.FEATURES;
    if (!F) return null;
    if (Array.isArray(F)) return F.map(f => typeof f === 'string' ? f : f.id);
    return Object.keys(F);
  }

  /** Inhalt einer Datei prüfen. Liefert { tasks } oder wirft einen Fehler. */
  function parseFile(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Die Datei ist keine Aufgaben-Datei der NetzWerkstatt (kein gültiges JSON).'); }
    if (!data || data.format !== FORMAT || !Array.isArray(data.tasks)) throw new Error('Die Datei ist keine Aufgaben-Datei der NetzWerkstatt.');
    if (typeof data.version === 'number' && data.version > VERSION) throw new Error('Die Datei stammt aus einer neueren NetzWerkstatt. Bitte das Programm aktualisieren.');
    if (!data.tasks.length) throw new Error('Die Datei enthält keine Aufgaben.');
    if (data.tasks.length > LIMITS.tasks) throw new Error(`Die Datei enthält zu viele Aufgaben (höchstens ${LIMITS.tasks}).`);
    return { tasks: data.tasks.map(sanitizeTask) };
  }

  function fileFor(tasks) {
    return JSON.stringify({ format: FORMAT, version: VERSION, tasks }, null, 1);
  }

  function newTaskId() { return 'eigen-' + Math.random().toString(36).slice(2, 10); }

  // ---------------------------------------------------------------- Aufgabe spielbar machen
  /** Aus den gespeicherten Daten eine Aufgabe wie die eingebauten machen. */
  function compile(t) {
    return {
      id: t.id, title: t.title, intro: t.intro, tip: t.tip, think: t.think, manual: t.manual, show: t.show,
      custom: true, data: t,
      goals: t.goals.map(g => ({ text: goalText(g), check: GOAL_TYPES[g.type].check(g) })),
      start: () => NW.clone(t.start),
      solution: t.solution ? () => NW.clone(t.solution) : null,
    };
  }

  /** Eigene Aufgaben vom Server übernehmen. Fehlerhafte werden übersprungen. */
  function install(list) {
    const ok = [];
    for (const raw of list || []) {
      try { ok.push(compile(sanitizeTask(raw))); } catch (e) { /* überspringen */ }
    }
    NWTasks.setCustom(ok);
    return ok;
  }

  // ---------------------------------------------------------------- Ziele vorschlagen
  /** Schlägt Ziele vor, die die Musterlösung erfüllt und der Startaufbau noch nicht. */
  function suggestGoals(start, solution) {
    const out = [];
    const count = (net, type) => net.devices.filter(d => d.type === type).length;
    for (const type of Object.keys(T)) {
      const n = count(solution, type);
      if (n > count(start, type)) out.push({ type: 'geraete', device: type, min: n });
    }
    const typeOf = id => { const d = NW.dev(solution, id); return d ? d.type : null; };
    const seen = new Set();
    const add = g => { const k = JSON.stringify(g); if (!seen.has(k)) { seen.add(k); out.push(g); } };
    for (const tp of NW.topologies(solution)) {
      if (tp.ok && (tp.kind !== 'ring' || tp.closed) && !NW.topologies(start).some(s => s.kind === tp.kind)) add({ type: 'topologie', kind: tp.kind });
    }
    const known = (net, name) => net.devices.some(d => NW.svcOn(d, 'dns') && (d.services.dns.entries || []).some(e => (e.name || '').trim().toLowerCase() === name));
    for (const d of solution.devices) {
      if (!NW.svcOn(d, 'dns')) continue;
      for (const e of d.services.dns.entries || []) {
        const name = normHost(e.name);
        if (name && NW.parseIP(e.ip) !== null && !known(start, name)) add({ type: 'dns-eintrag', host: name, ip: e.ip.trim() });
      }
    }
    for (const e of solution.events || []) {
      if (!e.ok) continue;
      if (e.type === 'web' && e.host && NW.parseIP(e.host) === null) {
        const s = NW.dev(solution, e.src);
        const r = s ? NW.browse(solution, s.id, 'http://' + e.host) : null;
        const list = r && r.ok ? (r.dns || []).map(id => NW.dev(solution, id)).filter(Boolean) : [];
        const via = ['router', 'weiter', 'eigener'].find(k => list.length && DNS_VIA[k].check(list));
        if (via) add({ type: 'dns-weg', host: normHost(e.host), via });
      }
      if (e.type === 'ping' && !e.v6 && typeOf(e.src) && typeOf(e.target)) add({ type: 'ping', from: typeOf(e.src), to: typeOf(e.target) });
      if (e.type === 'web' && e.host) add({ type: 'webseite', host: normHost(e.host) });
      if (e.type === 'svc' && SVC_ACTIONS.includes(e.action)) add({ type: 'dienst', action: e.action, from: typeOf(e.src) || 'geraet', host: e.host ? normHost(e.host) : '' });
    }
    const keep = [];
    for (const g of out) {
      try {
        const clean = sanitizeGoal(g, 0);
        const task = compile({ goals: [clean], start: start, solution: null });
        if (NWTasks.evaluate(task, solution)[0]) keep.push(clean);
      } catch (e) { /* nicht vorschlagen */ }
    }
    return keep.slice(0, LIMITS.goals);
  }

  const api = { FORMAT, VERSION, LIMITS, GOAL_TYPES, HOST_SEL, DEVICE_SEL, optionLabel, goalText, sanitizeNetwork, sanitizeGoal, sanitizeTask, parseFile, fileFor, newTaskId, compile, install, suggestGoals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NWEigene = api;
})(typeof window !== 'undefined' ? window : globalThis);

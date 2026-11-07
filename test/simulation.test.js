// Automatische Tests für Simulation und Aufgaben: node test/simulation.test.js
const assert = require('assert');
const NW = require('../web/js/sim.js');
const { TASKS, GROUPS, evaluate, featuresFor, FEATURES } = require('../web/js/tasks.js');

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok  ' + name); }

// Musterlösungen erfüllen alle Ziele, Startnetze keine "Endziele"
for (const t of TASKS) {
  if (!t.solution) continue;
  test(`Musterlösung „${t.title}" erfüllt alle Ziele`, () => {
    const res = evaluate(t, t.solution());
    assert.deepStrictEqual(res, t.goals.map(() => true), JSON.stringify(res));
  });
  test(`Start „${t.title}" ist nicht schon gelöst`, () => {
    const res = evaluate(t, t.start());
    assert.ok(res.some(x => !x));
  });
}

test('Jede Aufgabe gehört zu genau einem Thema, Nummern 1–5 unverändert', () => {
  const ids = GROUPS.flatMap(g => g.tasks);
  assert.deepStrictEqual([...ids].sort(), TASKS.map(t => t.id).sort());
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.deepStrictEqual(TASKS.slice(0, 5).map(t => t.id), ['zwei-pcs', 'stern', 'heimnetz', 'webseite', 'dhcp']);
});

test('Ping ohne Gateway in fremdes Netz scheitert mit Hinweis', () => {
  const net = TASKS.find(t => t.id === 'webseite').solution();
  NW.dev(net, 'pc').gw = '';
  const r = NW.ping(net, 'pc', '203.0.113.80');
  assert.ok(!r.ok);
  assert.match(r.error, /Gateway/);
});

test('Webseite über DNS: vier Schritte', () => {
  const net = TASKS.find(t => t.id === 'webseite').solution();
  const r = NW.browse(net, 'pc', 'www.netzwerkstatt.de');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.steps.map(s => s.label), ['DNS-Anfrage', 'DNS-Antwort', 'HTTP-Request', 'HTTP-Response']);
  assert.deepStrictEqual(r.steps[0].path, ['pc', 'r', 'inet', 'dns']);
});

test('Webseite: Der Router übersetzt die Absenderadresse (NAT)', () => {
  const net = TASKS.find(t => t.id === 'webseite').solution();
  const r = NW.browse(net, 'pc', 'www.netzwerkstatt.de');
  assert.match(r.steps[2].note, /Absender 192\.168\.178\.20 wird zu 203\.0\.113\.10/);
  assert.match(r.steps[3].note, /wieder zu 192\.168\.178\.20/);
  assert.deepStrictEqual(r.steps[3].path, ['web', 'inet', 'r', 'pc']);
  assert.strictEqual(r.nat.outside, '203.0.113.10');
});

test('Rückweg ohne Gateway am Ziel scheitert', () => {
  // Server bei einem anderen Internetanbieter: Ohne Gateway findet die Antwort nicht zurück
  const net = internetNet();
  NW.dev(net, 'srv').gw = '';
  const r = NW.ping(net, 'pc', NW.dev(net, 'srv').ip);
  assert.ok(!r.ok);
  assert.match(r.error, /Antwort findet nicht zurück/);
});

test('Doppelte IP wird erkannt', () => {
  const net = TASKS.find(t => t.id === 'stern').solution();
  NW.dev(net, 's3').ip = '192.168.10.4';
  const r = NW.ping(net, 's1', '192.168.10.4');
  assert.ok(!r.ok);
  assert.match(r.error, /mehrfach/);
});

test('Smartphone kann nicht per Kabel verbunden werden', () => {
  const net = NW.emptyNetwork();
  const a = NW.createDevice(net, 'smartphone', 0, 0), b = NW.createDevice(net, 'switch', 0, 0);
  assert.ok(!NW.canLink(net, a.id, b.id, 'kabel').ok);
});

test('Subnetzmaske und Sonderadressen', () => {
  assert.strictEqual(NW.parseMask('255.255.255.0'), 24);
  assert.strictEqual(NW.parseMask('255.0.255.0'), null);
  assert.ok(NW.ipProblem('192.168.1.0', '255.255.255.0'));
  assert.ok(NW.ipProblem('192.168.1.255', '255.255.255.0'));
  assert.strictEqual(NW.ipProblem('192.168.1.5', '255.255.255.0'), null);
});

// ---------------------------------------------------------------- DHCP
function dhcpNet() {
  const net = NW.emptyNetwork();
  const r = NW.createDevice(net, 'router', 0, 0, { id: 'r' });
  r.ports[1].ip = '192.168.0.1';
  r.ports[1].dhcp.on = false;
  NW.createDevice(net, 'switch', 0, 0, { id: 'sw' });
  NW.createDevice(net, 'pc', 0, 0, { id: 'a' });
  NW.createDevice(net, 'pc', 0, 0, { id: 'b' });
  NW.addLink(net, 'r', 'sw', 'kabel'); NW.addLink(net, 'a', 'sw', 'kabel'); NW.addLink(net, 'b', 'sw', 'kabel');
  return net;
}

test('DHCP: ohne eingeschalteten Server antwortet niemand', () => {
  const net = dhcpNet();
  const r = NW.dhcp(net, 'a');
  assert.ok(!r.ok);
  assert.strictEqual(r.steps.length, 1);
  assert.strictEqual(r.steps[0].label, 'DHCP-Discover');
  assert.strictEqual(r.steps[0].paths.length, 2, 'Discover geht an alle');
  assert.match(r.hint, /DHCP-Server ein/);
});

test('DHCP: Discover, Offer, Request, Ack und freie Adressen', () => {
  const net = dhcpNet();
  NW.dev(net, 'r').ports[1].dhcp.on = true;
  NW.dev(net, 'r').ports[1].dhcp.dns = '192.168.0.53';
  const ra = NW.dhcp(net, 'a');
  assert.ok(ra.ok, ra.error);
  assert.deepStrictEqual(ra.steps.map(s => s.label), ['DHCP-Discover', 'DHCP-Offer', 'DHCP-Request', 'DHCP-Ack']);
  assert.deepStrictEqual(ra.lease, { ip: '192.168.0.100', mask: '255.255.255.0', gw: '192.168.0.1', dns: '192.168.0.53' });
  NW.applyLease(NW.dev(net, 'a'), ra.lease);
  const rb = NW.dhcp(net, 'b');
  assert.strictEqual(rb.lease.ip, '192.168.0.101', 'vergebene Adresse wird nicht doppelt verteilt');
  NW.applyLease(NW.dev(net, 'b'), rb.lease);
  assert.strictEqual(NW.dhcp(net, 'a').lease.ip, '192.168.0.100', 'eigene Adresse bleibt erhalten');
  assert.ok(NW.ping(net, 'a', '192.168.0.101').ok);
});

test('DHCP: voller Adressbereich wird gemeldet', () => {
  const net = dhcpNet();
  Object.assign(NW.dev(net, 'r').ports[1].dhcp, { on: true, from: '192.168.0.100', to: '192.168.0.100' });
  NW.applyLease(NW.dev(net, 'a'), NW.dhcp(net, 'a').lease);
  const rb = NW.dhcp(net, 'b');
  assert.ok(!rb.ok);
  assert.match(rb.error, /keine freie Adresse/);
});

test('Vorschläge für IP-Adresse, Gateway und DNS', () => {
  const net = dhcpNet();
  NW.dev(net, 'b').ip = '192.168.0.10';
  const s = NW.suggest(net, 'a');
  assert.strictEqual(s.ip, '192.168.0.11');
  assert.strictEqual(s.mask, '255.255.255.0');
  assert.strictEqual(s.gw, '192.168.0.1');
  assert.strictEqual(s.dns, null);
  NW.dev(net, 'a').ip = '192.168.0.11';
  NW.dev(net, 'a').gw = '192.168.0.1';
  assert.deepStrictEqual(NW.suggest(net, 'a'), { ip: null, mask: null, gw: null, dns: null });
  const lone = NW.createDevice(net, 'pc', 0, 0);
  assert.strictEqual(NW.suggest(net, lone.id).ip, null, 'ohne Verbindung kein Vorschlag');
});

test('Router-LAN bekommt beim Einschalten von DHCP eine passende Adresse', () => {
  const net = dhcpNet();
  const r = NW.dev(net, 'r');
  r.ports[1].ip = '';
  assert.deepStrictEqual(NW.suggestPortIP(net, r, 1), { ip: '192.168.0.1', mask: '255.255.255.0' }, 'freies Netz');
  r.ports[0].ip = '192.168.0.1';
  assert.strictEqual(NW.suggestPortIP(net, r, 1).ip, '192.168.1.1', 'Netz des WAN-Anschlusses wird nicht doppelt benutzt');
  r.ports[0].ip = '';
  NW.dev(net, 'a').ip = '10.1.2.1';
  NW.dev(net, 'a').mask = '255.255.0.0';
  assert.deepStrictEqual(NW.suggestPortIP(net, r, 1), { ip: '10.1.0.1', mask: '255.255.0.0' }, 'passt sich vorhandenen Geräten an');
});

test('Neuer Router: Heimnetz 192.168.0.1 mit DHCP, WLAN und Modem an; zweiter Router anderes Netz', () => {
  const net = NW.emptyNetwork();
  const r1 = NW.createDevice(net, 'router', 0, 0);
  assert.strictEqual(r1.ports[1].ip, '192.168.0.1');
  assert.strictEqual(r1.ports[0].ip, '', 'WAN bekommt die Adresse vom Internetanbieter');
  assert.ok(r1.ports[1].dhcp.on && r1.wlan && r1.modem);
  const r2 = NW.createDevice(net, 'router', 0, 0);
  assert.strictEqual(r2.ports[1].ip, '192.168.1.1');
});

test('Heimrouter: PCs an verschiedenen LAN-Anschlüssen und im WLAN sind im selben Netz', () => {
  const net = NW.emptyNetwork();
  const r = NW.createDevice(net, 'router', 0, 0, { id: 'r' });
  const pcs = ['p1', 'p2', 'p3'].map(id => NW.createDevice(net, 'pc', 0, 0, { id }));
  const sp = NW.createDevice(net, 'smartphone', 0, 0, { id: 'sp' });
  pcs.forEach(p => assert.ok(NW.addLink(net, p.id, 'r', 'kabel').ok));
  assert.ok(NW.addLink(net, 'sp', 'r', 'wlan').ok, 'Router hat WLAN');
  for (const d of [...pcs, sp]) NW.applyLease(d, NW.dhcp(net, d.id).lease);
  assert.deepStrictEqual([...pcs, sp].map(d => d.ip), ['192.168.0.100', '192.168.0.101', '192.168.0.102', '192.168.0.103']);
  const res = NW.ping(net, 'sp', '192.168.0.102');
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(res.steps[0].path, ['sp', 'r', 'p3']);
});

test('Heimrouter: Kabel zu anderem Router steckt im WAN, Umstecken möglich', () => {
  const net = NW.emptyNetwork();
  NW.createDevice(net, 'router', 0, 0, { id: 'r1' });
  NW.createDevice(net, 'router', 0, 0, { id: 'r2' });
  const l = NW.addLink(net, 'r1', 'r2', 'kabel').link;
  assert.strictEqual(NW.iface(l.aPort), NW.WAN);
  assert.ok(NW.replug(net, l.id, 'r1').ok);
  assert.strictEqual(NW.iface(l.aPort), NW.LAN);
});

test('Router-WLAN ausschalten trennt WLAN-Geräte', () => {
  const net = NW.emptyNetwork();
  const r = NW.createDevice(net, 'router', 0, 0, { id: 'r' });
  NW.createDevice(net, 'tablet', 0, 0, { id: 't' });
  NW.addLink(net, 't', 'r', 'wlan');
  assert.strictEqual(NW.setRouterWlan(net, r, false), 1);
  assert.match(NW.canLink(net, 't', 'r', 'wlan').reason, /ausgeschaltet/);
});

test('APIPA: zwei PCs direkt verbunden, ohne DHCP-Server, erreichen sich über 169.254.x.x', () => {
  const net = NW.emptyNetwork();
  NW.createDevice(net, 'pc', 0, 0, { id: 'a' });
  NW.createDevice(net, 'pc', 0, 0, { id: 'b' });
  NW.addLink(net, 'a', 'b', 'kabel');
  const ra = NW.dhcp(net, 'a');
  assert.ok(!ra.ok && ra.apipa);
  NW.applyLease(NW.dev(net, 'a'), ra.apipa);
  NW.applyLease(NW.dev(net, 'b'), NW.dhcp(net, 'b').apipa);
  const a = NW.dev(net, 'a'), b = NW.dev(net, 'b');
  assert.match(a.ip, /^169\.254\./);
  assert.notStrictEqual(a.ip, b.ip);
  assert.strictEqual(a.mask, '255.255.0.0');
  assert.ok(NW.ping(net, 'a', b.ip).ok);
  // Aufgabe 1 verlangt das Netz 192.168.1.0/24 – APIPA erfüllt das nicht
  const t1 = TASKS.find(t => t.id === 'zwei-pcs');
  assert.ok(!evaluate(t1, net)[2]);
});

// ---------------------------------------------------------------- Internetanbieter
/** Heimnetz (Router + PC) an Anbieter A, Server an Anbieter B, A und B verbunden. Adressen per DHCP. */
function internetNet() {
  const net = NW.emptyNetwork();
  const a = NW.createDevice(net, 'isp', 0, 0, { id: 'ispA' });
  const b = NW.createDevice(net, 'isp', 0, 0, { id: 'ispB' });
  NW.createDevice(net, 'router', 0, 0, { id: 'r' });
  NW.createDevice(net, 'pc', 0, 0, { id: 'pc' });
  const srv = NW.createDevice(net, 'server', 0, 0, { id: 'srv' });
  srv.services.web.on = true; srv.services.dns.on = true;
  NW.addLink(net, 'ispA', 'ispB', 'kabel');
  assert.ok(NW.addLink(net, 'r', 'ispA', 'kabel').ok);
  NW.addLink(net, 'pc', 'r', 'kabel');
  NW.addLink(net, 'srv', 'ispB', 'kabel');
  for (const id of ['r', 'srv', 'pc']) { const res = NW.dhcp(net, id); assert.ok(res.ok, res.error); NW.applyLease(NW.dev(net, id), res.lease); }
  return net;
}

test('Internetanbieter: eigenes öffentliches Netz, Router bekommt externe Adresse per DHCP', () => {
  const net = internetNet();
  assert.strictEqual(NW.dev(net, 'ispA').ip, '85.17.4.1');
  assert.strictEqual(NW.dev(net, 'ispB').ip, '91.64.12.1');
  const r = NW.dev(net, 'r');
  assert.strictEqual(NW.iface(net.links.find(l => l.a === 'r' && l.b === 'ispA').aPort), NW.WAN, 'Leitung steckt im WAN');
  assert.deepStrictEqual([r.ports[0].ip, r.ports[0].gw], ['85.17.4.100', '85.17.4.1']);
  assert.strictEqual(NW.dev(net, 'srv').ip, '91.64.12.100');
  assert.strictEqual(NW.dev(net, 'pc').ip, '192.168.0.100');
});

test('Internetanbieter: zwei Kunden bekommen verschiedene Adressen', () => {
  const net = internetNet();
  const s2 = NW.createDevice(net, 'server', 0, 0, { id: 's2' });
  NW.addLink(net, 's2', 'ispA', 'kabel');
  assert.strictEqual(NW.dhcp(net, 's2').lease.ip, '85.17.4.101');
});

test('Internetanbieter: PC im Heimnetz erreicht Server bei anderem Anbieter, Server sieht externe Adresse', () => {
  const net = internetNet();
  const res = NW.ping(net, 'pc', '91.64.12.100');
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(res.steps[0].path, ['pc', 'r', 'ispA', 'ispB', 'srv']);
  assert.deepStrictEqual(res.steps[1].path, ['srv', 'ispB', 'ispA', 'r', 'pc']);
  assert.match(res.steps[1].text, /85\.17\.4\.100/);
  assert.deepStrictEqual(res.nat, { router: 'Router 1', inside: '192.168.0.100', outside: '85.17.4.100', target: 'Server 1' });
});

test('Internetanbieter: lokale Adressen werden im Internet nicht weitergeleitet', () => {
  const net = internetNet();
  const res = NW.ping(net, 'srv', '192.168.0.100');
  assert.ok(!res.ok);
  assert.match(res.error, /lokale \(private\) Adresse/);
  // Die externe Adresse des Routers antwortet
  assert.ok(NW.ping(net, 'srv', '85.17.4.100').ok);
});

test('Internetanbieter: Anfragen aus dem Internet kommen nicht ins Heimnetz', () => {
  // Router mit öffentlicher WAN-Adresse, direkt mit einem anderen Gerät verbunden (ohne Anbieter)
  const net = NW.emptyNetwork();
  const r = NW.createDevice(net, 'router', 0, 0, { id: 'r' });
  Object.assign(r.ports[0], { ip: '203.0.113.10' });
  NW.createDevice(net, 'pc', 0, 0, { id: 'pc', dhcp: false, ip: '192.168.0.20', gw: '192.168.0.1' });
  NW.createDevice(net, 'server', 0, 0, { id: 'srv', dhcp: false, ip: '203.0.113.80', gw: '203.0.113.10' });
  NW.addLink(net, 'pc', 'r', 'kabel');
  assert.ok(NW.replug(net, NW.addLink(net, 'r', 'srv', 'kabel').link.id, 'r').ok, 'Server an den WAN-Anschluss');
  const res = NW.ping(net, 'srv', '192.168.0.20');
  assert.ok(!res.ok);
  assert.match(res.error, /nicht ins Heimnetz/);
  assert.ok(NW.ping(net, 'pc', '203.0.113.80').ok, 'umgekehrt klappt es dank NAT');
});

test('Internetanbieter: DNS des Anbieters kommt per DHCP bis zum PC im Heimnetz', () => {
  const net = internetNet();
  NW.dev(net, 'srv').services.dns.entries.push({ name: 'www.schule.de', ip: '91.64.12.100' });
  NW.dev(net, 'ispA').dns = '91.64.12.100';
  assert.strictEqual(NW.refreshDns(net), 2, 'Router und PC übernehmen den DNS-Server');
  assert.strictEqual(NW.dev(net, 'pc').dns, '91.64.12.100');
  const res = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(res.ok, res.error);
});

test('Internetanbieter: ohne Modem keine Leitung, Leitung nicht ins LAN umstecken', () => {
  const net = NW.emptyNetwork();
  NW.createDevice(net, 'isp', 0, 0, { id: 'i' });
  const r = NW.createDevice(net, 'router', 0, 0, { id: 'r' });
  r.modem = false;
  assert.match(NW.canLink(net, 'r', 'i', 'kabel').reason, /Modem/);
  r.modem = true;
  const l = NW.addLink(net, 'r', 'i', 'kabel').link;
  assert.ok(!NW.replug(net, l.id, 'r').ok);
  assert.strictEqual(NW.setModem(net, r, false), 1);
  assert.strictEqual(net.links.length, 0);
});

test('Router ohne Weg ins Internet meldet das verständlich', () => {
  const net = internetNet();
  NW.dev(net, 'r').ports[0].gw = '';
  const res = NW.ping(net, 'pc', '91.64.12.100');
  assert.ok(!res.ok);
  assert.match(res.error, /kennt kein Netz/);
});

// ---------------------------------------------------------------- IPv6
test('IPv6: Schreibweise lesen und kürzen', () => {
  assert.strictEqual(NW.ip6Str(NW.parseIP6('2001:0db8:0000:0000:0000:0000:0000:0001')), '2001:db8::1');
  assert.strictEqual(NW.ip6Str(NW.parseIP6('fe80:0:0:0:1:0:0:1')), 'fe80::1:0:0:1');
  assert.strictEqual(NW.parseIP6('2001:db8:::1'), null);
  assert.strictEqual(NW.parseIP6('1:2:3:4:5:6:7:8:9'), null);
  assert.strictEqual(NW.parseIP6('2001:db8::xyz'), null);
  assert.strictEqual(NW.parseIP6('192.168.0.1'), null);
});

function v6Net() {
  const net = TASKS.find(t => t.id === 'ipv6').solution();
  const a = (id, p) => NW.ip6Of(net, NW.dev(net, id), p || 0);
  return { net, a };
}

test('IPv6: Geräte im Heimnetz bekommen Link-Local und eine globale Adresse aus dem Netz des Routers', () => {
  const { net, a } = v6Net();
  assert.match(a('pc').ll, /^fe80::/);
  assert.strictEqual(a('r', NW.LAN).lanNet, '2001:db8:1:1::/64');
  assert.ok(a('pc').gua.startsWith('2001:db8:1:1:'));
  assert.ok(a('tb').gua.startsWith('2001:db8:1:1:'));
  assert.ok(a('game').gua.startsWith('2001:db8:1:0:'));
  assert.notStrictEqual(a('pc').gua, a('tb').gua);
  // ohne Router nur Link-Local
  const n2 = TASKS.find(t => t.id === 'zwei-pcs').solution();
  assert.strictEqual(NW.ip6Of(n2, NW.dev(n2, 'p1'), 0).gua, '');
});

test('IPv6: Ping aus dem Internet ins Heimnetz klappt (kein NAT), per IPv4 nicht', () => {
  const { net, a } = v6Net();
  const r6 = NW.ping(net, 'game', a('pc').gua);
  assert.ok(r6.ok, r6.error);
  assert.deepStrictEqual(r6.steps[0].path, ['game', 'inet', 'r', 'pc']);
  assert.strictEqual(r6.steps[0].proto, 'ICMPv6 · IPv6');
  const r4 = NW.ping(net, 'game', NW.dev(net, 'pc').ip);
  assert.ok(!r4.ok);
});

test('IPv6: Absender bleibt sichtbar, kein NAT', () => {
  const { net, a } = v6Net();
  const r = NW.ping(net, 'pc', a('game').gua);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.seenSrc, a('pc').gua);
  assert.ok(r.viaRouter);
});

test('IPv6: Link-Local nur im eigenen Netz', () => {
  const { net, a } = v6Net();
  assert.ok(NW.ping(net, 'pc', a('tb').ll).ok);
  const r = NW.ping(net, 'pc', a('game').ll);
  assert.ok(!r.ok);
  assert.match(r.hint, /nie weiter/);
});

test('IPv6: ohne Router nur Link-Local; globale Ziele scheitern mit Hinweis', () => {
  const net = TASKS.find(t => t.id === 'zwei-pcs').solution();
  const p2 = NW.ip6Of(net, NW.dev(net, 'p2'), 0);
  assert.ok(NW.ping(net, 'p1', p2.ll).ok);
  const r = NW.ping(net, 'p1', '2001:db8:1::1');
  assert.ok(!r.ok);
  assert.match(r.error, /nur eine Link-Local-Adresse/);
});

test('IPv6: Zwei Anbieter – Heimnetz erreicht Server beim anderen Anbieter', () => {
  const net = internetNet();
  const srv = NW.ip6Of(net, NW.dev(net, 'srv'), 0);
  const r = NW.ping(net, 'pc', srv.gua);
  assert.ok(r.ok, r.error);
  const back = NW.ping(net, 'srv', NW.ip6Of(net, NW.dev(net, 'pc'), 0).gua);
  assert.ok(back.ok, back.error);
});

test('IPv6-Ping zählt nicht als IPv4-Ping in Aufgaben', () => {
  const net = TASKS.find(t => t.id === 'zwei-pcs').solution();
  net.events = [];
  NW.logEvent(net, { type: 'ping', v6: true, ll: true, src: 'p1', target: 'p2', ok: true });
  const t = TASKS.find(x => x.id === 'zwei-pcs');
  assert.strictEqual(evaluate(t, net)[3], false);
});

// ---------------------------------------------------------------- Bus, Ring und Ausfälle
function ringNet() { return TASKS.find(t => t.id === 'ring').solution(); }
function busNet() { return TASKS.find(t => t.id === 'bus').solution(); }

test('Ring: wird erkannt, Daten laufen in einer Richtung im Kreis', () => {
  const net = ringNet();
  const topo = NW.topologies(net);
  assert.strictEqual(topo.length, 1);
  assert.strictEqual(topo[0].kind, 'ring');
  assert.ok(topo[0].closed && topo[0].ok);
  const r = NW.ping(net, 'r1', '192.168.30.2');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.steps[0].path, ['r1', 'r2']);
  assert.deepStrictEqual(r.steps[1].path, ['r2', 'r3', 'r4', 'r1']);
});

test('Ring: Ein ausgefallener PC unterbricht den ganzen Ring', () => {
  const net = ringNet();
  NW.setFault(net, 'r3', true);
  const r = NW.ping(net, 'r1', '192.168.30.2');
  assert.ok(!r.ok);
  assert.strictEqual(r.fault, 'ring');
  assert.match(r.error, /Ring ist unterbrochen: PC 3 ist ausgefallen/);
  assert.strictEqual(NW.topologies(net)[0].ok, false);
});

test('Ring: Kabelbruch und offener Ring', () => {
  const net = ringNet();
  const l = net.links.find(x => (x.a === 'r2' && x.b === 'r3') || (x.a === 'r3' && x.b === 'r2'));
  NW.setFault(net, l.id, true);
  let r = NW.ping(net, 'r4', '192.168.30.1');
  assert.ok(!r.ok);
  assert.match(r.error, /Kabelbruch/);
  NW.setFault(net, l.id, false);
  NW.removeLink(net, l.id);
  r = NW.ping(net, 'r1', '192.168.30.2');
  assert.ok(!r.ok);
  assert.strictEqual(NW.topologies(net)[0].closed, false);
});

test('Ring: höchstens zwei Nachbarn, PC mit Switch nicht zusätzlich im Ring', () => {
  const net = ringNet();
  assert.match(NW.addLink(net, 'r1', 'r3', 'kabel').reason, /zwei Nachbarn/);
  NW.createDevice(net, 'switch', 0, 0, { id: 'sw' });
  assert.ok(!NW.canLink(net, 'r1', 'sw', 'kabel').ok);
  NW.createDevice(net, 'pc', 0, 0, { id: 'x' });
  assert.ok(NW.addLink(net, 'x', 'sw', 'kabel').ok);
  assert.match(NW.canLink(net, 'x', 'r1', 'kabel').reason, /belegt/);
});

test('Bus: wird erkannt, alle Geräte am Bus empfangen das Signal', () => {
  const net = busNet();
  assert.deepStrictEqual(NW.topologies(net).map(t => t.kind), ['bus']);
  const r = NW.ping(net, 'b1', '192.168.20.4');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.steps[0].paths.length, 3);
  assert.match(r.steps[0].note, /alle[n]? Geräte/);
});

test('Bus: Ausfall eines PCs stört die anderen nicht, Kabelbruch im Bus legt alles lahm', () => {
  const net = busNet();
  NW.setFault(net, 'b2', true);
  assert.ok(NW.ping(net, 'b1', '192.168.20.4').ok);
  const off = NW.ping(net, 'b1', '192.168.20.2');
  assert.strictEqual(off.fault, 'off');
  NW.setFault(net, 'b2', false);
  NW.setFault(net, 'bus', true);
  const r = NW.ping(net, 'b1', '192.168.20.4');
  assert.ok(!r.ok);
  assert.strictEqual(r.fault, 'bus');
  assert.deepStrictEqual(NW.activeFaults(net), ['bus:bus']);
});

test('Stern: Kabelbruch trifft nur einen PC, Switch-Ausfall alle', () => {
  const net = TASKS.find(t => t.id === 'stern').solution();
  assert.deepStrictEqual(NW.topologies(net).map(t => t.kind), ['stern']);
  const l = net.links.find(x => x.a === 's4' || x.b === 's4');
  NW.setFault(net, l.id, true);
  assert.ok(NW.ping(net, 's1', '192.168.10.2').ok);
  const r = NW.ping(net, 's1', '192.168.10.4');
  assert.strictEqual(r.fault, 'link');
  assert.deepStrictEqual(r.steps[0].path, ['s1', 'sw']);
  NW.setFault(net, l.id, false);
  NW.setFault(net, 'sw', true);
  const r2 = NW.ping(net, 's1', '192.168.10.2');
  assert.strictEqual(r2.fault, 'off');
  assert.match(r2.error, /Switch 1 ist ausgefallen/);
});

test('Ausgefallener Router: kein DHCP, Gateway nicht erreichbar', () => {
  const net = TASKS.find(t => t.id === 'webseite').solution();
  NW.setFault(net, 'r', true);
  const r = NW.ping(net, 'pc', '203.0.113.80');
  assert.ok(!r.ok);
  assert.match(r.error, /Heimrouter ist ausgefallen/);
  NW.setFault(net, 'pc', true);
  assert.match(NW.ping(net, 'pc', '192.168.178.1').error, /ausgefallen/);
  assert.ok(!NW.dhcp(net, 'pc').ok);
});

// ---------------------------------------------------------------- Peer-to-Peer, Client-Server, Bluetooth, Netzarten
test('Peer-to-Peer klappt nur, wenn der Empfänger mitmacht', () => {
  const net = TASKS.find(t => t.id === 'dateien').start();
  let r = NW.sendFile(net, 'lena', '192.168.20.12', 'Klassenfoto.jpg');
  assert.ok(!r.ok);
  assert.match(r.hint, /zugleich Client und Server/);
  NW.dev(net, 'tom').share = true;
  r = NW.sendFile(net, 'lena', '192.168.20.12', 'Klassenfoto.jpg');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.mode, 'p2p');
  assert.ok(NW.dev(net, 'tom').files.includes('Klassenfoto.jpg'));
});

test('Client-Server: Datei bleibt auf dem Server, auch wenn der Absender weg ist', () => {
  const net = TASKS.find(t => t.id === 'dateien').start();
  NW.fileStore(NW.dev(net, 'srv')).on = true;
  assert.ok(NW.sendFile(net, 'lena', '192.168.20.2', 'Klassenfoto.jpg').ok);
  NW.removeDevice(net, 'lena');
  const r = NW.getFiles(net, 'mia', '192.168.20.2');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.mode, 'server');
  assert.deepStrictEqual(r.files, ['Klassenfoto.jpg']);
});

test('Bluetooth-Kopfhörer: kein Kabel, kein IP-Netz, nur ein Partner', () => {
  const net = NW.emptyNetwork();
  const sp = NW.createDevice(net, 'smartphone', 0, 0), hs = NW.createDevice(net, 'headset', 0, 0), sw = NW.createDevice(net, 'switch', 0, 0);
  const pc = NW.createDevice(net, 'pc', 0, 0);
  assert.ok(!NW.canLink(net, hs.id, sw.id, 'kabel').ok);
  assert.ok(!NW.canLink(net, sw.id, sp.id, 'bluetooth').ok);
  assert.ok(NW.addLink(net, sp.id, hs.id, 'bluetooth').ok);
  assert.ok(!NW.canLink(net, pc.id, hs.id, 'bluetooth').ok);
  assert.strictEqual(NW.linksOf(net, sp.id).length, 0);
  assert.ok(NW.playMusic(net, sp.id).ok);
  assert.ok(!NW.playMusic(net, pc.id).ok);
});

test('Netzarten werden erkannt', () => {
  const kinds = id => NW.netKinds(TASKS.find(t => t.id === id).solution()).map(k => k.kind);
  assert.deepStrictEqual(kinds('stern'), ['LAN']);
  assert.deepStrictEqual(kinds('man'), ['LAN', 'LAN', 'MAN']);
  assert.deepStrictEqual(kinds('netzarten'), ['PAN', 'LAN', 'WAN']);
  assert.deepStrictEqual(NW.netKinds(TASKS.find(t => t.id === 'man').start()).map(k => k.kind), ['LAN', 'LAN']);
});

// ---------------------------------------------------------------- TCP, UDP und Internetdienste
test('Video (TCP) und Videoanruf (UDP) ohne Störung', () => {
  const net = TASKS.find(t => t.id === 'tcp-udp').solution();
  net.links.forEach(l => delete l.loss);
  const v = NW.useService(net, 'tb', 'video', 'video.netzwerkstatt.de');
  assert.ok(v.ok, v.error);
  assert.deepStrictEqual(v.steps.map(s => s.label), ['DNS-Anfrage', 'DNS-Antwort', 'Video-Anfrage', 'Videodaten 1/3', 'Videodaten 2/3', 'Videodaten 3/3']);
  assert.match(v.steps[2].proto, /^TCP/);
  const c = NW.useService(net, 'tb', 'call', 'konferenz.netzwerkstatt.de');
  assert.ok(c.ok && !c.lost);
  assert.ok(c.steps.slice(2).every(s => /^UDP/.test(s.proto)));
});

test('Gestörte Verbindung: TCP sendet neu, UDP nicht', () => {
  const net = TASKS.find(t => t.id === 'tcp-udp').solution();
  const v = NW.useService(net, 'tb', 'video', 'video.netzwerkstatt.de');
  assert.ok(v.ok && v.lost && v.resent);
  const labels = v.steps.map(s => s.label);
  assert.ok(labels.includes('Keine Bestätigung'));
  assert.ok(labels.includes('Videodaten 1/3 (neu gesendet)'));
  const lostStep = v.steps.find(s => s.lost);
  assert.deepStrictEqual(lostStep.path[lostStep.path.length - 1], { mid: ['r', 'tb'] });
  const c = NW.useService(net, 'tb', 'call', 'konferenz.netzwerkstatt.de');
  assert.ok(c.ok && c.lost && !c.resent);
  assert.ok(!c.steps.some(s => /neu gesendet|Bestätigung/.test(s.label)));
  assert.match(c.message, /nicht neu gesendet/);
  assert.strictEqual(c.steps.filter(s => s.lost).length, 1, 'genau ein Paket geht verloren');
});

test('TCP genau zeigen: Verbindungsaufbau, Bestätigungen, Verbindungsabbau', () => {
  const net = TASKS.find(t => t.id === 'webseite').solution();
  const r = NW.browse(net, 'pc', 'www.netzwerkstatt.de', { tcp: true });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.steps.map(s => s.label), ['DNS-Anfrage', 'DNS-Antwort', 'TCP: SYN', 'TCP: SYN-ACK', 'TCP: ACK',
    'HTTP-Request', 'TCP: ACK', 'HTTP-Response', 'TCP: ACK', 'TCP: FIN', 'TCP: FIN-ACK']);
  assert.match(r.steps[2].note, /NAT/, 'NAT-Hinweis beim ersten Paket');
});

test('Dienst nicht eingeschaltet: verständliche Meldung, mit TCP-Details ein RST', () => {
  const net = TASKS.find(t => t.id === 'dienste-sortieren').solution();
  const r = NW.useService(net, 'pc', 'game', 'mail.netzwerkstatt.de');
  assert.ok(!r.ok);
  assert.match(r.error, /läuft kein Spiele-Server/);
  const m = NW.useService(net, 'pc', 'mail', 'www.netzwerkstatt.de', { tcp: true });
  assert.strictEqual(m.steps[m.steps.length - 1].label, 'TCP: RST');
});

test('E-Mail: senden über SMTP, abrufen über IMAP', () => {
  const net = TASKS.find(t => t.id === 'dienste').solution();
  const s = NW.useService(net, 'pc', 'mail', 'mail.schule.de');
  assert.ok(s.ok, s.error);
  assert.match(s.steps[2].proto, /TCP · Port 25/);
  const g = NW.useService(net, 'sp', 'mailget', 'mail.schule.de');
  assert.ok(g.ok, g.error);
  assert.match(g.steps[2].proto, /TCP · Port 143/);
  assert.strictEqual(g.mails.length, 1);
});

test('Sortieraufgabe: falsche Zuordnung erfüllt das Ziel nicht', () => {
  const t = TASKS.find(x => x.id === 'dienste-sortieren');
  const net = t.solution();
  net.quiz.call = 'TCP';
  assert.deepStrictEqual(evaluate(t, net), [true, false]);
});


// ---------------------------------------------------------------- Eigene Aufgaben
const E = require('../web/js/eigene.js');
const NWTasks = require('../web/js/tasks.js');

for (const t of TASKS) {
  if (!t.solution) continue;
  test(`Eigene Aufgaben: Netzwerk „${t.title}" übersteht Export und Import`, () => {
    const net = E.sanitizeNetwork(JSON.parse(JSON.stringify(t.solution())), 'Test');
    assert.deepStrictEqual(evaluate(t, net), t.goals.map(() => true));
  });
}

test('Eigene Aufgaben: vorgeschlagene Ziele passen zu Start und Musterlösung', () => {
  for (const id of ['stern', 'webseite', 'ring', 'dienste', 'zwei-pcs']) {
    const b = TASKS.find(t => t.id === id);
    const start = b.start(), sol = b.solution();
    const goals = E.suggestGoals(start, sol);
    assert.ok(goals.length > 0, id);
    const file = E.fileFor([{ id: 'eigen-test' + id.replace(/[^a-z]/g, ''), title: 'Test ' + id, intro: 'x', goals, start, solution: sol }]);
    const [task] = E.parseFile(file).tasks.map(E.compile);
    assert.ok(evaluate(task, task.solution()).every(Boolean), id);
    assert.ok(evaluate(task, task.start()).some(x => !x), id);
  }
});

test('Eigene Aufgaben: jedes Ziel hat einen Text, auch bei allen Einstellungen', () => {
  for (const [type, def] of Object.entries(E.GOAL_TYPES)) {
    const base = { type };
    for (const [k, f] of Object.entries(def.fields)) base[k] = f.def;
    for (const [k, f] of Object.entries(def.fields)) {
      for (const o of f.options || [f.def]) {
        const g = E.sanitizeGoal(Object.assign({}, base, { [k]: o }), 0);
        const text = E.goalText(g);
        assert.ok(text.length > 10 && !/undefined/.test(text), text);
      }
    }
  }
});

test('Eigene Aufgaben: ungültige Dateien werden abgelehnt', () => {
  const ok = { id: 'eigen-abc', title: 'A', intro: 'B', goals: [{ type: 'geraete', device: 'pc', min: 2 }], start: NW.emptyNetwork() };
  const file = tasks => JSON.stringify({ format: E.FORMAT, version: 1, tasks });
  assert.throws(() => E.parseFile('kein json'), /kein gültiges JSON/);
  assert.throws(() => E.parseFile('{"tasks":[]}'), /keine Aufgaben-Datei/);
  assert.throws(() => E.parseFile(file([Object.assign({}, ok, { goals: [{ type: 'code', check: 'alert(1)' }] })])), /unbekannte Art/);
  assert.throws(() => E.parseFile(file([Object.assign({}, ok, { goals: [{ type: 'geraete', device: 'rakete', min: 2 }] })])), /ungültige Einstellung/);
  assert.throws(() => E.parseFile(file([Object.assign({}, ok, { goals: [{ type: 'ip-netz', device: 'pc', net: '300.1.1.0/24', gw: '' }] })])), /Netz bitte/);
  assert.throws(() => E.parseFile(file([Object.assign({}, ok, { start: { devices: [{ id: 'a', type: 'ufo' }], links: [] } })])), /unbekanntes Gerät/);
  assert.throws(() => E.parseFile(file([Object.assign({}, ok, { start: { devices: [{ id: 'a', type: 'pc' }], links: [{ id: 'l', a: 'a', b: 'x', kind: 'kabel' }] } })])), /gibt/);
  assert.throws(() => E.parseFile(JSON.stringify({ format: E.FORMAT, version: 99, tasks: [ok] })), /neueren/);
  // Unbekannte Felder werden bereinigt, Prototyp-Tricks verworfen
  const evil = JSON.parse('{"id":"a","type":"pc","name":"<b>x</b>","x":1e9,"__proto__":{"polluted":1},"ip":5}');
  const [t] = E.parseFile(file([Object.assign({}, ok, { id: 'falsch!', start: { devices: [evil], links: [] } })])).tasks;
  assert.match(t.id, /^eigen-[a-z0-9]+$/);
  const d = t.start.devices[0];
  assert.strictEqual(d.x, 4000);
  assert.strictEqual(d.ip, '');
  assert.strictEqual({}.polluted, undefined);
});

test('Eigene Aufgaben: werden mit Nummer E1 … unter „Eigene Aufgaben" eingereiht', () => {
  const raw = { id: 'eigen-neu', title: 'Neu', intro: 'x', goals: [{ type: 'ping', from: 'pc', to: 'pc' }], start: NW.emptyNetwork() };
  const list = E.install([raw, { id: 'eigen-kaputt', title: '' }]);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(NWTasks.byId('eigen-neu').num, 'E1');
  assert.strictEqual(NWTasks.byId('eigen-neu').group, 'eigene');
  assert.ok(NWTasks.all().length === TASKS.length + 1);
  assert.strictEqual(NWTasks.byId('eigen-neu').solution, null);
  E.install([]);
  assert.strictEqual(NWTasks.byId('eigen-neu'), null);
});

test('Sichtbare Funktionen: einfache Aufgaben zeigen wenig, freies Bauen alles', () => {
  const t1 = TASKS.find(t => t.id === 'zwei-pcs');
  assert.deepStrictEqual([...featuresFor(t1, t1.start())], []);
  const frei = TASKS.find(t => t.free);
  assert.strictEqual(featuresFor(frei, frei.start()).size, FEATURES.length);
  // Was im Netzwerk schon benutzt wird, bleibt sichtbar (z. B. Musterlösungen)
  for (const t of TASKS) if (t.solution) {
    const f = featuresFor(t, t.solution());
    assert.ok(t.show.every(k => f.has(k)));
  }
  const net = t1.start();
  NW.createDevice(net, 'headset', 100, 100);
  assert.ok(featuresFor(t1, net).has('pan'));
});


// ---------------------------------------------------------------- Eigener DNS-Server und Weiterleitung
/** Heimnetz mit eigenem DNS-Server, der unbekannte Namen beim DNS-Server im Internet (srv) erfragt. */
function ownDnsNet() {
  const net = internetNet();
  NW.dev(net, 'srv').services.dns.entries.push({ name: 'www.schule.de', ip: '91.64.12.100' });
  NW.dev(net, 'ispA').dns = '91.64.12.100';
  NW.refreshDns(net);
  const home = NW.createDevice(net, 'server', 0, 0, { id: 'home', name: 'Heim-DNS', dhcp: false, ip: '192.168.0.53', gw: '192.168.0.1' });
  home.services.dns.on = true;
  home.services.dns.entries.push({ name: 'drucker.zuhause', ip: '192.168.0.100' });
  NW.addLink(net, 'home', 'r', 'kabel');
  return net;
}

test('Eigener DNS-Server: beantwortet eigene Namen selbst', () => {
  const net = ownDnsNet();
  const home = NW.dev(net, 'home');
  home.services.web.on = true;
  home.services.dns.entries.push({ name: 'www.zuhause', ip: '192.168.0.53' });
  NW.dev(net, 'pc').dns = '192.168.0.53';
  const r = NW.browse(net, 'pc', 'www.zuhause');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.dns, ['home']);
  assert.deepStrictEqual(r.steps.slice(0, 2).map(s => s.label), ['DNS-Anfrage', 'DNS-Antwort']);
});

test('Eigener DNS-Server: ohne Weiterleitung unbekannter Name, mit Weiterleitung fragt er im Internet nach', () => {
  const net = ownDnsNet();
  NW.dev(net, 'pc').dns = '192.168.0.53';
  let r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(!r.ok);
  assert.match(r.error, /kennt den Namen www\.schule\.de nicht/);
  NW.dev(net, 'home').services.dns.forward = '91.64.12.100';
  r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.dns, ['home', 'srv']);
  assert.deepStrictEqual(r.steps.slice(0, 4).map(s => s.label), ['DNS-Anfrage', 'DNS-Anfrage (weitergeleitet)', 'DNS-Antwort', 'DNS-Antwort']);
  assert.deepStrictEqual(r.steps[0].path, ['pc', 'r', 'home']);
  assert.deepStrictEqual(r.steps[1].path, ['home', 'r', 'ispA', 'ispB', 'srv'], 'Weiterleitung geht vom Heim-DNS über den Router ins Internet');
  assert.match(r.steps[1].note, /NAT/);
  assert.match(r.steps[3].text, /reicht die Antwort von Server 1 weiter/);
  // Auch der Server im Internet kennt den Namen nicht: Die Absage kommt bis zum PC zurück
  r = NW.browse(net, 'pc', 'www.gibtsnicht.de');
  assert.ok(!r.ok);
  assert.match(r.error, /Auch Server 1 kennt den Namen/);
  assert.ok(r.steps.filter(s => s.label === 'DNS-Antwort').every(s => s.bad));
});

test('Eigener DNS-Server: Weiterleitung im Kreis wird erkannt', () => {
  const net = ownDnsNet();
  const home = NW.dev(net, 'home');
  const h2 = NW.createDevice(net, 'server', 0, 0, { id: 'h2', dhcp: false, ip: '192.168.0.54', gw: '192.168.0.1' });
  NW.addLink(net, 'h2', 'r', 'kabel');
  h2.services.dns.on = true; h2.services.dns.forward = '192.168.0.53';
  home.services.dns.forward = '192.168.0.54';
  NW.dev(net, 'pc').dns = '192.168.0.53';
  const r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(!r.ok);
  assert.match(r.error, /im Kreis/);
});

test('Router als DNS-Server: verteilt sich per DHCP und leitet an den DNS-Server des Anbieters weiter', () => {
  const net = ownDnsNet();
  const rt = NW.dev(net, 'r');
  let r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.dns, ['srv'], 'ohne Weiterleitung fragt der PC den Anbieter-DNS direkt');
  rt.dnsRelay = true;
  assert.strictEqual(NW.refreshDns(net), 1, 'der PC übernimmt den neuen DNS-Server');
  assert.strictEqual(NW.dev(net, 'pc').dns, '192.168.0.1');
  r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.dns, ['r', 'srv']);
  assert.deepStrictEqual(r.steps[0].path, ['pc', 'r']);
  assert.deepStrictEqual(r.steps[1].path, ['r', 'ispA', 'ispB', 'srv']);
  assert.deepStrictEqual(r.steps[2].path, ['srv', 'ispB', 'ispA', 'r']);
  // Router leitet an einen eigenen DNS-Server im Heimnetz weiter (über den LAN-Anschluss)
  rt.ports[0].dns = '192.168.0.53';
  NW.dev(net, 'home').services.dns.forward = '91.64.12.100';
  r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.dns, ['r', 'home', 'srv']);
  assert.deepStrictEqual(r.steps[1].path, ['r', 'home']);
  // Ohne DNS-Server zum Nachfragen: verständlicher Fehler
  rt.ports[0].dns = '';
  r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(!r.ok);
  assert.match(r.error, /kennt aber selbst keinen DNS-Server/);
  // Router ohne Weiterleitung ist kein DNS-Server
  rt.dnsRelay = false;
  r = NW.browse(net, 'pc', 'www.schule.de');
  assert.match(r.error, /läuft kein DNS-Server/);
});

test('Router als DNS-Server: Vorschlag und sichtbare Funktion', () => {
  const net = ownDnsNet();
  const pc = NW.dev(net, 'pc');
  pc.dhcp = false; pc.dns = '';
  NW.dev(net, 'r').dnsRelay = true;
  assert.strictEqual(NW.suggest(net, 'pc').dns, '192.168.0.1');
  assert.ok(NWTasks.usedFeatures(net).has('web'));
});

test('Eigene Aufgaben: Ziele DNS-Eintrag und Webseite über eigenen DNS', () => {
  const start = ownDnsNet();
  NW.dev(start, 'srv').locked = true; // DNS-Server im Internet gehört zur Aufgabe
  const sol = NW.clone(start);
  NW.dev(sol, 'r').dnsRelay = true;
  NW.refreshDns(sol);
  NW.dev(sol, 'home').services.dns.entries.push({ name: 'www.zuhause', ip: '192.168.0.53' });
  NW.dev(sol, 'home').services.web.on = true;
  NW.logEvent(sol, { type: 'web', src: 'pc', host: 'www.schule.de', ok: true });
  const goals = [
    { type: 'dns-eintrag', host: 'www.zuhause', ip: '192.168.0.53' },
    { type: 'dns-weg', host: 'www.schule.de', via: 'router' },
    { type: 'dns-weg', host: 'www.schule.de', via: 'weiter' },
    { type: 'dns-weg', host: 'www.schule.de', via: 'eigener' },
  ].map((g, i) => E.sanitizeGoal(g, i));
  const task = E.compile({ id: 'x', title: 'x', goals, start, solution: sol });
  assert.deepStrictEqual(NWTasks.evaluate(task, sol), [true, true, true, false], 'nur der vorgegebene DNS-Server im Internet war beteiligt');
  assert.deepStrictEqual(NWTasks.evaluate(task, start), [false, false, false, false]);
  assert.match(E.goalText(goals[1]), /Router soll dabei die DNS-Anfrage weiterleiten/);
  const sg = E.suggestGoals(start, sol);
  assert.ok(sg.some(g => g.type === 'dns-eintrag' && g.host === 'www.zuhause'));
  assert.ok(sg.some(g => g.type === 'dns-weg' && g.via === 'router'));
  assert.throws(() => E.sanitizeGoal({ type: 'dns-weg', host: 'x.de', via: 'quatsch' }, 0));
});

test('Rechenzentrum: Internetserver mit eigenem öffentlichem Netz, erreichbar über den Internetanbieter', () => {
  const net = NW.emptyNetwork();
  NW.createDevice(net, 'isp', 0, 0, { id: 'isp' });
  const rz1 = NW.createDevice(net, 'rz', 0, 0, { id: 'rz1' });
  const rz2 = NW.createDevice(net, 'rz', 0, 0, { id: 'rz2' });
  assert.strictEqual(rz1.ip, '198.51.100.1');
  assert.strictEqual(rz2.ip, '192.0.2.1');
  NW.createDevice(net, 'router', 0, 0, { id: 'r' });
  NW.createDevice(net, 'pc', 0, 0, { id: 'pc' });
  const web = NW.createDevice(net, 'server', 0, 0, { id: 'web' });
  const dns = NW.createDevice(net, 'server', 0, 0, { id: 'dns' });
  web.services.web.on = true; dns.services.dns.on = true;
  NW.addLink(net, 'rz1', 'isp', 'kabel'); NW.addLink(net, 'rz2', 'isp', 'kabel');
  assert.ok(NW.addLink(net, 'r', 'isp', 'kabel').ok);
  NW.addLink(net, 'pc', 'r', 'kabel'); NW.addLink(net, 'web', 'rz1', 'kabel'); NW.addLink(net, 'dns', 'rz2', 'kabel');
  for (const id of ['r', 'web', 'dns', 'pc']) { const res = NW.dhcp(net, id); assert.ok(res.ok, res.error); NW.applyLease(NW.dev(net, id), res.lease); }
  assert.strictEqual(web.ip, '198.51.100.100');
  assert.strictEqual(dns.ip, '192.0.2.100');
  assert.strictEqual(web.gw, '198.51.100.1');
  dns.services.dns.entries.push({ name: 'www.schule.de', ip: web.ip });
  NW.dev(net, 'isp').dns = dns.ip;
  NW.refreshDns(net);
  const r = NW.browse(net, 'pc', 'www.schule.de');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.steps[0].path, ['pc', 'r', 'isp', 'rz2', 'dns']);
  assert.ok(r.steps.some(s => s.path.join() === 'pc,r,isp,rz1,web'), 'HTTP geht ins andere Rechenzentrum');
});

console.log(`\n${n} Tests bestanden.`);

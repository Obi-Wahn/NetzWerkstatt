// Automatische Tests für Simulation und Aufgaben: node test/simulation.test.js
const assert = require('assert');
const NW = require('../web/js/sim.js');
const { TASKS, GROUPS, evaluate } = require('../web/js/tasks.js');

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

console.log(`\n${n} Tests bestanden.`);

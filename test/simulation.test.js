// Automatische Tests für Simulation und Aufgaben: node test/simulation.test.js
const assert = require('assert');
const NW = require('../web/js/sim.js');
const { TASKS, evaluate } = require('../web/js/tasks.js');

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

test('Rückweg ohne Gateway am Ziel scheitert', () => {
  const net = TASKS.find(t => t.id === 'webseite').solution();
  NW.dev(net, 'web').gw = '';
  const r = NW.browse(net, 'pc', 'www.netzwerkstatt.de');
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

console.log(`\n${n} Tests bestanden.`);

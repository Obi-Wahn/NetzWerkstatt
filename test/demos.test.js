// Automatische Tests für Vorführungen und Schwierigkeitsgrade: node test/demos.test.js
const assert = require('assert');
const { TASKS } = require('../web/js/tasks.js');
const { DEMOS, runStep } = require('../web/js/demos.js');
const NWStufen = require('../web/js/stufen.js');

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok  ' + name); }

for (const demo of DEMOS) {
  test(`Vorführung „${demo.title}“ läuft wie erklärt`, () => {
    assert.ok(TASKS.some(t => t.id === demo.task), 'passende Aufgabe fehlt: ' + demo.task);
    demo.steps.forEach((st, k) => {
      const { net, res, steps } = runStep(demo, k);
      for (const id of st.focus || []) assert.ok(net.devices.some(d => d.id === id), `Schritt ${k + 1}: Gerät ${id} fehlt`);
      if (!st.run) return;
      assert.strictEqual(!!res.ok, st.expect, `Schritt ${k + 1} „${st.title}“: ${res.error || ''}`);
      assert.ok(steps.length > 0, `Schritt ${k + 1} „${st.title}“ zeigt keine Pakete`);
    });
  });
}

test('Hinweise für „Leicht“ passen zu den Zielen der Aufgaben', () => {
  for (const [id, list] of Object.entries(NWStufen.HELP)) {
    const t = TASKS.find(x => x.id === id);
    assert.ok(t, 'Aufgabe fehlt: ' + id);
    assert.strictEqual(list.length, t.goals.length, 'Anzahl der Hinweise passt nicht zu den Zielen: ' + id);
  }
  for (const t of TASKS) if (!t.free) assert.ok(NWStufen.HELP[t.id], 'Keine Hinweise für „Leicht“: ' + t.id);
});

test('Schwierigkeitsgrad: Standard ist „Mittel“, Sterne nach Anspruch', () => {
  assert.strictEqual(NWStufen.of({}), 'mittel');
  assert.strictEqual(NWStufen.of({ level: 'schwer' }), 'schwer');
  assert.strictEqual(NWStufen.of({ level: 'quatsch' }), 'mittel');
  assert.strictEqual(NWStufen.stars({ level: 2 }), '★★☆');
  assert.strictEqual(NWStufen.stars({ level: 0, free: true }), '');
});

console.log(`\n${n} Tests bestanden.`);

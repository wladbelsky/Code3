// The dispatcher: calls come in, the right units go, the radio and the terminal follow, every call closes
const { test, expect } = require('./support/harness');

test('a structure fire gets the full assignment; every line is filled in; the call closes and everyone comes home', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('structure'); });
  const c0 = await wp.run(() => { const c = DISPATCH.calls[0]; return { types: c.units.map(u => u.type).sort(), site: c.site.kind, status: c.status }; });
  expect(c0.types).toEqual(['chief', 'engine', 'ladder', 'medic', 'patrol', 'rescue']);
  expect(c0.site).toBe('house');
  const on = await wp.until(() => DISPATCH.calls[0].status === 'onscene', 200);
  expect(on.done).toBe(true);
  const done = await wp.until(() => DISPATCH.calls[0].status === 'closed' && UNITS.every(u => u.state === 'quarters'), 900);
  expect(done.violations).toEqual([]);
  expect(done.done).toBe(true);
  const log = await wp.run(() => RADIO.log.map(l => l.text));
  for (const l of log) expect(l, 'unfilled placeholder').not.toMatch(/\{\w\}/);
  expect(log.some(l => l.includes('ONSC'))).toBe(true);
  expect(log.some(l => l.includes('CLOSED'))).toBe(true);
  expect(await wp.stuck()).toEqual([]);
});

test('every call type can be dispatched and run to the end', async ({ wp }) => {
  test.setTimeout(6 * 60 * 1000);
  await wp.boot();
  const keys = await wp.run(() => Object.keys(INCIDENT_TYPES));
  for (const k of keys) {
    await wp.run(k => { CFG.calls = 0; DISPATCH.newCall(k); }, k);
    const r = await wp.until(() => DISPATCH.calls.every(c => c.status === 'closed') && UNITS.every(u => u.state === 'quarters'), 900);
    expect(r.violations, k).toEqual([]);
    expect(r.done, k).toBe(true);
  }
});

test('a call with no free units holds, then gets them as they come back', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('medical'); DISPATCH.newCall('medical'); DISPATCH.newCall('medical'); });
  const r = await wp.run(() => DISPATCH.calls.map(c => c.status));
  expect(r.filter(s => s === 'holding').length, 'two medics, three calls').toBe(1);
  const done = await wp.until(() => DISPATCH.calls.every(c => c.status === 'closed'), 900);
  expect(done.done).toBe(true);
  expect(done.violations).toEqual([]);
});

test('music brings the calls faster than silence', async ({ wp }) => {
  test.setTimeout(6 * 60 * 1000);
  await wp.boot();
  const count = () => wp.run(() => DISPATCH.seq);
  const a = await count(); await wp.sim(900, { audio: false }); const quiet = (await count()) - a;
  await wp.sim(60, { audio: true });
  const b = await count(); await wp.sim(900, { audio: true }); const loud = (await count()) - b;
  expect(loud).toBeGreaterThan(quiet);
});

test('the terminal shows the calls, their units and the radio log, and follows its settings', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('alarm'); });
  await wp.sim(40);
  const r = await wp.run(() => ({ cards: document.querySelectorAll('#cad .card').length, chips: [...document.querySelectorAll('#cad .card .us span')].map(s => s.textContent), log: document.querySelectorAll('#cad .l').length, title: document.querySelector('#cad .cad-title').textContent }));
  expect(r.cards).toBe(1);
  expect(r.chips.sort()).toEqual(['E12', 'L12']);
  expect(r.log).toBeGreaterThan(3);
  expect(r.title).toContain('FAIRHAVEN 911');
  await wp.run(() => __t.props({ terminal: false }));
  expect(await wp.run(() => getComputedStyle(document.getElementById('cad')).display)).toBe('none');
  await wp.run(() => __t.props({ terminal: true, terminalposition: 'br' }));
  expect(await wp.run(() => document.getElementById('cad').className)).toBe('pos-br');
});

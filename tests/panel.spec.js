// The dispatch board (panel) and the CAD remembered between sessions
const { test, expect } = require('./support/harness');

const board = () => ({
  tiles: [...document.querySelectorAll('#units .tile')].map(t => ({ name: t.children[0].textContent, st: t.children[1].textContent, cls: t.className })),
  cards: [...document.querySelectorAll('#callcards .cc')].map(c => ({ type: c.querySelector('b').textContent, text: c.textContent })),
  none: !!document.querySelector('#callcards .none'),
  calls: document.getElementById('calls').textContent, load: document.getElementById('load').textContent,
  cells: document.querySelectorAll('#loadbar i.on').length
});

test('the board: a tile per unit and helicopter, coloured by service and status; the open calls as cards', async ({ wp }) => {
  await wp.boot();
  await wp.sim(1);
  const r0 = await wp.run(board);
  expect(r0.tiles.length).toBe(await wp.run(() => UNITS.length + HELIS.length));
  expect(r0.tiles.find(t => t.name === 'E12').cls).toBe('tile fire avl');
  expect(r0.tiles.find(t => t.name === 'AIR1').st).toBe('On pad');
  expect(r0.none).toBe(true);
  expect(r0.calls).toBe('Calls today 0');
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('structure'); });
  await wp.sim(1);
  const r1 = await wp.run(board);
  expect(r1.tiles.find(t => t.name === 'E12').cls).toMatch(/fire (dsp|enr)/);
  expect(r1.tiles.find(t => t.name === 'M12').cls).toContain(' ems ');
  expect(r1.cards.length).toBe(1);
  expect(r1.cards[0].type).toBe('STRUCTURE FIRE');
  expect(r1.cards[0].text).toContain('E12');
  expect(r1.calls).toBe('Calls today 1');
  await wp.until(() => UNITS[0].state === 'on_scene', 200);
  await wp.sim(1);
  expect((await wp.run(board)).tiles.find(t => t.name === 'E12').cls).toContain('osc');
  for (let i = 0; i < 4; i++) await wp.run(() => DISPATCH.newCall('medical'));
  await wp.sim(1);
  expect((await wp.run(board)).cards.length, 'at most three cards: no scrolling').toBe(3);
});

test('the load on the board follows the music; collapse hides the body', async ({ wp }) => {
  await wp.boot();
  await wp.sim(120, { audio: true });
  const r = await wp.run(board);
  expect(r.cells).toBeGreaterThan(2);
  expect(r.load).not.toBe('ROUTINE');
  await wp.run(() => document.getElementById('collapse').click());
  expect(await wp.run(() => getComputedStyle(document.querySelector('#panel .body')).display)).toBe('none');
});

test('the CAD is remembered: the call numbers run on, today\'s calls and the log come back; not with the setting off', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('fall'); DISPATCH.newCall('alarm'); LOAD.level = 0.6; });
  await wp.sim(20);
  const before = await wp.run(() => { PERSIST.save(); return { seq: DISPATCH.seq, log: RADIO.log.slice(-3).map(l => l.text), calls: PERSIST.today().calls, load: LOAD.level }; });
  expect(before.calls).toBe(2);
  await wp.reload();
  const after = await wp.run(() => ({ seq: DISPATCH.seq, log: RADIO.log.map(l => l.text), calls: PERSIST.today().calls, load: LOAD.level, lines: document.querySelectorAll('#cad .l').length }));
  expect(after.seq).toBe(before.seq);
  expect(after.calls).toBe(2);
  expect(after.load).toBeCloseTo(before.load, 1);
  expect(after.load).toBeGreaterThan(0.3);
  for (const l of before.log) expect(after.log).toContain(l);
  expect(after.log[after.log.length - 1]).toBe('CAD RECONNECTED');
  expect(after.lines).toBeGreaterThan(3);
  expect(await wp.run(() => { CFG.calls = 0; return DISPATCH.newCall('fall').id; })).toBe(`26-${110341 + before.seq}`);
  // off: what was kept is forgotten (init() restores before the properties come in), nothing written, nothing restored
  expect(await wp.run(() => { PERSIST.save(); return !!localStorage.getItem(PERSIST.KEY); })).toBe(true);
  await wp.run(() => { __t.props({ savestate: false }); PERSIST.save(); });
  expect(await wp.run(() => localStorage.getItem(PERSIST.KEY))).toBe(null);
  await wp.reload();
  expect(await wp.run(() => ({ restored: PERSIST.restored, seq: DISPATCH.seq }))).toEqual({ restored: false, seq: 0 });
});

test('restarts in a row keep one CAD RECONNECTED; a bad saved line does not stop the start', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => (CFG.saveState = false, localStorage.setItem(PERSIST.KEY, JSON.stringify({ v: 1, seq: 7, load: 0, stats: {}, log: [null, 5,
    { who: 'CAD', text: 'CAD RECONNECTED', kind: 'sys', at: 0 }, { who: 'CAD', text: '#26-110347  CLOSED', kind: 'sys', at: 0 }] }))));   // (off for the way out: the reload's save would overwrite it)
  await wp.reload();
  const r = await wp.run(() => ({ ready, seq: DISPATCH.seq, log: RADIO.log.map(l => l.text) }));
  expect(r.ready).toBe(true);
  expect(r.seq).toBe(7);
  expect(r.log).toEqual(['#26-110347  CLOSED', 'CAD RECONNECTED']);
});

test('the call cards escape the town name (the school\'s address carries it)', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.props({ townname: 'A<B & C' }); CFG.calls = 0;
    const c = DISPATCH.newCall('medical'); c.site = Object.assign({}, c.site, { name: `${CFG.townName} HIGH SCHOOL, 300 OAK ST` });
    __t.sim(1);
    return { card: document.querySelector('#callcards .c2').textContent, term: document.querySelector('#cad .card .a').textContent };
  });
  expect(r.card).toContain('A<B & C HIGH SCHOOL');
  expect(r.term).toContain('A<B & C HIGH SCHOOL');
});

// Civilian traffic: cars come and go by the rules, and get out of the way of lights and sirens
const { test, expect } = require('./support/harness');

test('cars come in, cross the town by the lights and the stops, and leave; nobody runs into anybody', async ({ wp }) => {
  test.setTimeout(4 * 60 * 1000);
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; CFG.traffic = 14; });
  expect((await wp.sim(400)).violations).toEqual([]);
  const on = await wp.run(() => { const n = []; for (let i = 0; i < 40; i++) { const r = __t.sim(5); if (r.violations.length) return r.violations; n.push(CIVS.filter(c => c.on).length); } return n.reduce((a, b) => a + b) / n.length; });
  expect(on, 'cars on the streets (the last 200 s on average)').toBeGreaterThanOrEqual(11);
  const s = await wp.run(() => ({ spawned: TRAFFIC.spawned, gone: TRAFFIC.spawned - CIVS.filter(c => c.on).length, intruded: TRAFFIC.intruded }));
  expect(s.gone, 'cars leave at the far side').toBeGreaterThan(15);
  expect(s.intruded, 'into a crossing without being let in').toBe(0);
  expect(await wp.stuck()).toEqual([]);
});

test('a code-3 run: a car ahead pulls over and stops, the unit passes it on the centre line, then the car goes on', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; CFG.traffic = 0; CFG.visitors = false; UNITS[0].dispatch({ far: { ax: 'ew', at: 50, a: 520, dir: 'E' } }); });
  const out = await wp.until(() => UNITS[0].state === 'responding' && UNITS[0].pos.z > 47 && UNITS[0].pos.x > -10, 120);
  expect(out.done).toBe(true);
  const r = await wp.run(() => {   // a slow car 50 m ahead in its lane
    const u = UNITS[0], c = CIVS[0];
    c.start(ROADS.way({ ax: 'ew', at: 50, a: u.pos.x + 50, dirs: ['E'] }, { ax: 'ew', at: 50, a: 480, dir: 'E' }, null, null, { vmax: 7, alat: 2.2, vEnd: 7 }));
    let stopped = 0, centre = 0, minGap = 99; const v = [];
    for (let i = 0; i < 1200 && u.pos.x < c.pos.x + 20; i++) {
      v.push(...__t.sim(0.05).violations);
      if (c.pulled && c.v < 0.3 && c.lat > 1) stopped++;
      if (u.latOff < -2) centre++;
      minGap = Math.min(minGap, Math.hypot(u.pos.x - c.pos.x, u.pos.z - c.pos.z));
    }
    const passed = u.pos.x > c.pos.x + 20;
    v.push(...__t.sim(8).violations);
    return { v, stopped, centre, minGap, passed, after: [c.v, c.lat, c.pulled] };
  });
  expect(r.v).toEqual([]);
  expect(r.passed, 'the unit got by').toBe(true);
  expect(r.stopped, 'the car stood at the curb').toBeGreaterThan(10);
  expect(r.centre, 'the unit on the centre line').toBeGreaterThan(10);
  expect(r.minGap).toBeGreaterThan(2.2);
  expect(r.after[0], 'the car goes on').toBeGreaterThan(3);
  expect(Math.abs(r.after[1]), 'back in its lane').toBeLessThan(0.3);
  expect(r.after[2]).toBe(false);
});

test('the traffic property: none at 0; fewer cars at night', async ({ wp }) => {
  await wp.boot({ query: '?hour=3' });
  await wp.run(() => __t.props({ traffic: 0 }));
  await wp.sim(60);
  expect(await wp.run(() => CIVS.filter(c => c.on).length)).toBe(0);
  await wp.run(() => __t.props({ traffic: 14 }));
  await wp.sim(120);
  const n = await wp.run(() => [CIVS.filter(c => c.on).length, trafficWanted()]);
  expect(n[1]).toBeLessThan(6);
  expect(n[0]).toBeLessThanOrEqual(n[1]);
});

test('units of the neighbouring districts pass through with lights, off the board; none with the property off', async ({ wp }) => {
  test.setTimeout(4 * 60 * 1000);
  await wp.boot();
  const r = await wp.run(() => {
    CFG.calls = 0; LOAD.level = 0.9;
    const seen = new Set(); let dark = 0;
    for (let i = 0; i < 8000; i++) {
      const x = __t.sim(0.05, { audio: true }); if (x.violations.length) return { v: x.violations };
      for (const v of VISITORS) if (v.model.group.visible) { seen.add(v.cs); if (!v.lights) dark++; }
    }
    return { seen: seen.size, passed: VISITS.passed, dark, tiles: document.querySelectorAll('#units .tile').length, board: UNITS.length + HELIS.length, cad: RADIO.log.filter(l => VISITORS.some(v => l.text.includes(v.short))).length };
  });
  expect(r.v).toBeUndefined();
  expect(r.passed, 'a stream of them under a heavy load').toBeGreaterThanOrEqual(3);
  expect(r.seen).toBeGreaterThanOrEqual(2);
  expect(r.dark, 'lights on all the way').toBe(0);
  expect(r.tiles, 'not on the board').toBe(r.board);
  expect(r.cad, 'not on the CAD').toBe(0);
  const off = await wp.run(() => { __t.props({ visitors: false }); const p = VISITS.passed; const x = __t.sim(300, { audio: true }); return { v: x.violations, more: VISITS.passed - p, out: VISITORS.filter(v => v.model.group.visible).length }; });
  expect(off).toEqual({ v: [], more: 0, out: 0 });
  expect(await wp.stuck()).toEqual([]);
});

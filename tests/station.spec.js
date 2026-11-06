// Station life in a quiet town: drills on the apron
const { test, expect } = require('./support/harness');

test('a quiet town: a unit rolls out onto the apron for a drill, then backs into its bay and the door comes down', async ({ wp }) => {
  test.setTimeout(4 * 60 * 1000);
  await wp.boot();
  await wp.run(() => { DISPATCH.timer = 1e9; DRILLS.timer = 0; });   // (no calls; a drill right away)
  const work = await wp.until(() => DRILLS.ph === 'work', 120);
  expect(work.violations).toEqual([]);
  expect(work.done).toBe(true);
  const r = await wp.run(() => { const u = DRILLS.unit, b = u.home.bay; return { kind: DRILL_KINDS[u.type], z: u.pos.z, front: b.zFront, apron: CITY_LAYOUT.fire.apron, len: u.len, x: u.pos.x - b.x, door: b.door.k, tile: u.tile.st.textContent, crew: DRILLS.crew.length }; });
  expect(r.z - r.len / 2).toBeGreaterThan(r.front);          // out of the bay
  expect(r.z + r.len / 2).toBeLessThan(r.apron);             // on the apron, off the street
  expect(Math.abs(r.x)).toBeLessThan(0.05);
  expect(r.door).toBeGreaterThan(0.97);
  expect(r.tile).toBe('Training');
  expect(r.crew).toBeGreaterThan(1);
  await wp.sim(3);
  if (r.kind === 'aerial') expect(await wp.run(() => DRILLS.unit.aerialK)).toBeGreaterThan(0.3);
  else expect(await wp.run(() => FX.water.live.length)).toBeGreaterThan(5);
  const back = await wp.until(() => DRILLS.done === 1, 300);
  expect(back.violations).toEqual([]);
  expect(back.done).toBe(true);
  await wp.sim(8);
  const h = await wp.run(() => ({ home: UNITS.every(u => u.state === 'quarters' && Math.hypot(u.pos.x - u.home.x, u.pos.z - u.home.z) < 0.05), doors: CITY.bays.map(b => b.door.k), aerial: UNITS.find(u => u.type === 'ladder').aerialK, crew: CREW.used.filter(Boolean).length }));
  expect(h).toEqual({ home: true, doors: [0, 0, 0, 0, 0, 0], aerial: 0, crew: 0 });
});

test('a call that needs the drilling unit ends the drill: it backs in and rolls out to the call', async ({ wp }) => {
  test.setTimeout(4 * 60 * 1000);
  await wp.boot();
  await wp.run(() => { DISPATCH.timer = 1e9; DRILLS.start(UNITS.find(u => u.type === 'engine')); });
  expect((await wp.until(() => DRILLS.ph === 'work', 120)).done).toBe(true);
  await wp.run(() => { DISPATCH.newCall('alarm'); });   // (engine + ladder)
  const r = await wp.until(() => UNITS.find(u => u.type === 'engine').state === 'responding', 150);
  expect(r.violations).toEqual([]);
  expect(r.done, 'the engine on its way').toBe(true);
  expect(await wp.run(() => ({ unit: DRILLS.unit, crew: DRILLS.crew.length }))).toEqual({ unit: null, crew: 0 });
});

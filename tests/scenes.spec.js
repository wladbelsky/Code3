// Scenes on site: the house fire, the car fire, the crash, crews, transports to the ER — and nothing left behind
const { test, expect } = require('./support/harness');

test('a house fire grows until water is on it, the ladder goes up and is bedded before it leaves, then it is out', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('structure'); });
  const g0 = await wp.run(() => __t.geometries());
  const before = await wp.until(() => DISPATCH.calls[0].status === 'onscene', 200);
  expect(before.done).toBe(true);
  expect(await wp.run(() => DISPATCH.calls[0].scene.heat)).toBeGreaterThan(0.4);
  expect(await wp.run(() => FX.fire.live.length)).toBeGreaterThan(5);
  const up = await wp.until(() => UNITS.find(u => u.type === 'ladder').aerialK > 0.98, 200);
  expect(up.done, 'the aerial is raised').toBe(true);
  await wp.sim(3);   // (its stream on the roof)
  expect(await wp.run(() => FX.water.live.length)).toBeGreaterThan(5);
  const out = await wp.until(() => DISPATCH.calls[0].scene.out, 300);
  expect(out.done, 'knocked down').toBe(true);
  // the ladder never drives with its aerial up
  const r = await wp.run(() => {
    const L = UNITS.find(u => u.type === 'ladder'); let bad = 0;
    for (let i = 0; i < 12000 && !(DISPATCH.calls[0].status === 'closed' && UNITS.every(u => u.state === 'quarters')); i++) { __t.sim(0.05); if (L.moving && L.aerialK > 0.01) bad++; }
    return { bad, closed: DISPATCH.calls[0].status, home: UNITS.every(u => u.state === 'quarters') };
  });
  expect(r).toEqual({ bad: 0, closed: 'closed', home: true });
  const g1 = await wp.run(() => __t.geometries());
  expect(g1.leaked).toBe(0);
  expect(g1.reach).toBeLessThanOrEqual(g0.reach);
  expect(await wp.run(() => CREW.used.filter(Boolean).length), 'every crew figure back in the pool').toBe(0);
});

test('a car fire: the engine puts it out, the car is left charred; the props go back when the call closes', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('vehicle'); });
  expect(await wp.run(() => PROPS.cars.filter(c => c.used).length)).toBe(1);
  const out = await wp.until(() => DISPATCH.calls[0].scene.out, 300);
  expect(out.done).toBe(true);
  expect(await wp.run(() => [PROPS.cars.filter(c => c.used).length, PROPS.burnt.filter(c => c.used).length])).toEqual([0, 1]);
  const done = await wp.until(() => DISPATCH.calls[0].status === 'closed', 400);
  expect(done.done).toBe(true);
  expect(await wp.run(() => [...PROPS.cars, ...PROPS.burnt].filter(c => c.used || c.g.visible).length)).toBe(0);
});

test('a crash: two wrecks and cones near the crossing, clear of the units; all gone after', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('mva'); });
  expect(await wp.run(() => [PROPS.cars.filter(c => c.used).length, PROPS.cones.count])).toEqual([2, 3]);
  const on = await wp.until(() => DISPATCH.calls[0].units.every(u => u.state === 'on_scene' || u.state !== 'responding' && u.callRef !== DISPATCH.calls[0]), 200);
  expect(on.done).toBe(true);
  const gap = await wp.run(() => {   // the wrecks don't stand where a unit pulled over
    let min = 99; for (const c of PROPS.cars.filter(c => c.used)) for (const u of DISPATCH.calls[0].units) if (u.state === 'on_scene') min = Math.min(min, Math.hypot(c.g.position.x - u.pos.x, c.g.position.z - u.pos.z) - u.len / 2 - 2.4);
    return min;
  });
  expect(gap).toBeGreaterThan(0);
  const done = await wp.until(() => DISPATCH.calls[0].status === 'closed', 500);
  expect(done.done).toBe(true);
  expect(await wp.run(() => [PROPS.cars.filter(c => c.used).length, PROPS.cones.count])).toEqual([0, 0]);
});

test('a medic takes a patient to the ER, waits under the canopy and comes home; the ER places are freed', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; Math.random = () => 0.5; });   // (a transport, not code 3: random < 0.7, ≥ 0.25)
  await wp.run(() => DISPATCH.newCall('medical'));
  const at = await wp.until(() => UNITS.some(u => u.state === 'at_hospital'), 600);
  expect(at.violations).toEqual([]);
  expect(at.done, 'at the ER').toBe(true);
  const m = await wp.run(() => { const u = UNITS.find(u => u.state === 'at_hospital'); return { x: u.pos.x, z: u.pos.z, slot: u.hosp.x }; });
  expect(m.z).toBeCloseTo(31, 0);
  expect(m.x).toBeCloseTo(m.slot, 0);
  const home = await wp.until(() => UNITS.every(u => u.state === 'quarters'), 600);
  expect(home.violations).toEqual([]);
  expect(home.done).toBe(true);
  expect(await wp.run(() => HOSP.slots.every(s => !s.unit))).toBe(true);
  const log = await wp.run(() => RADIO.log.map(l => l.text).join('|'));
  expect(log).toContain('TRAN');
  expect(log).toContain('AT HOSP');
});

test('crews stand by their units on scene and are gone when the units leave', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('disturbance'); });
  const on = await wp.until(() => CREW.used.filter(Boolean).length >= 2, 300);
  expect(on.done).toBe(true);
  const done = await wp.until(() => DISPATCH.calls[0].status === 'closed' && CREW.used.every(u => !u), 500);
  expect(done.done).toBe(true);
});

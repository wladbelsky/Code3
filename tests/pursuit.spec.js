// A police pursuit: the car, the neighbours' cruisers on its tail, Air 1, the town's patrols at the end
const { test, expect } = require('./support/harness');

test('a pursuit: the car runs through town with cruisers behind it and Air 1 after it, stops at the curb, the units gather, all is cleared', async ({ wp }) => {
  test.setTimeout(5 * 60 * 1000);
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('pursuit'); });
  const off = await wp.until(() => SUSPECT.state === 'responding', 30);
  expect(off.done, 'the car is off').toBe(true);
  const r0 = await wp.run(() => ({ len: SUSPECT.way.len, hidden: !SUSPECT.model.group.visible, need: DISPATCH.calls[0].need.slice(), onScreen: VIEW.onScreen(new V3(SUSPECT.pos.x, 0, SUSPECT.pos.z), 0) }));
  expect(r0.len).toBeGreaterThan(300);
  expect(r0).toMatchObject({ hidden: false, onScreen: false, need: ['air1'] });
  const chase = await wp.until(() => DISPATCH.calls[0].units.some(u => u.aid && u.state === 'responding'), 30);
  expect(chase.done, 'a cruiser behind it').toBe(true);
  const stop = await wp.until(() => DISPATCH.calls[0].scene.halted, 240);
  expect(stop.violations).toEqual([]);
  expect(stop.done, 'it stops').toBe(true);
  const at = await wp.run(() => { const c = DISPATCH.calls[0], d = SUSPECT.call; return { curb: Math.hypot(SUSPECT.pos.x - d.curb[0], SUSPECT.pos.z - d.curb[1]), patrols: c.need.filter(t => t === 'patrol').length, air: c.units.filter(u => u.air).length }; });
  expect(at.curb).toBeLessThan(1);
  expect(at.patrols).toBe(2);
  expect(at.air).toBe(1);
  const air = await wp.until(() => DISPATCH.calls[0].units.find(u => u.air).state === 'on_scene' && Math.hypot(HELIS.find(h => h.type === 'air1').pos.x - SUSPECT.pos.x, HELIS.find(h => h.type === 'air1').pos.z - SUSPECT.pos.z) < 60, 120);
  expect(air.done, 'Air 1 over it').toBe(true);
  const end = await wp.until(() => DISPATCH.calls[0].status === 'closed' && [...UNITS, ...HELIS, SUSPECT].every(u => u.state === 'quarters') && VISITORS.every(v => !v.aid), 500);   // (one may be just passing through)
  expect(end.violations).toEqual([]);
  expect(end.done, 'closed, everyone home').toBe(true);
  expect(await wp.run(() => ({ state: SUSPECT.state, shown: SUSPECT.model.group.visible, reserved: VISITORS.filter(v => v.aidFor || v.callRef).length }))).toEqual({ state: 'quarters', shown: false, reserved: 0 });
});

test('no pursuit with the neighbours switched off, or one already running', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => { CFG.calls = 0; CFG.visitors = false; const off = pursuitReady(); CFG.visitors = true; const on = pursuitReady(); DISPATCH.newCall('pursuit'); __t.sim(3); return { off, on, busy: pursuitReady() }; });
  expect(r).toEqual({ off: false, on: true, busy: false });
});

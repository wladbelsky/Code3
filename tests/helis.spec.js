// Helicopters: Air 1 over a search, Medevac 1 to a landing zone and the patient to the roof, out of town and back
const { test, expect } = require('./support/harness');

test('Air 1: spins up, orbits over the search with its light on the ground at night, then lands back on its pad', async ({ wp }) => {
  await wp.boot({ query: '?hour=23' });
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('search'); });
  const c = await wp.run(() => DISPATCH.calls[0].units.map(u => u.short));
  expect(c).toContain('AIR1');
  const up = await wp.until(() => HELIS[0].state === 'on_scene', 200);
  expect(up.violations).toEqual([]);
  expect(up.done, 'overhead').toBe(true);
  await wp.sim(20);
  const o = await wp.run(() => {
    const h = HELIS[0], g = h.goal, sl = h.model.sl, p = new THREE.Vector3(), d = new THREE.Vector3();
    h.model.group.updateMatrixWorld(); sl.holder.getWorldPosition(p); d.set(0, 0, 1).transformDirection(sl.holder.matrixWorld);
    const hit = p.clone().addScaledVector(d, -p.y / d.y);   // where the beam meets the ground
    return { r: Math.hypot(h.pos.x - g.x, h.pos.z - g.z), y: h.pos.y, light: sl.enabled, cone: sl.cone.material.uniforms.uOpacity.value, off: Math.hypot(hit.x - g.x, hit.z - g.z) };
  });
  expect(o.r).toBeGreaterThan(28); expect(o.r).toBeLessThan(50);
  expect(o.y).toBeGreaterThan(38);
  expect(o.light).toBeGreaterThan(0.9); expect(o.cone).toBeGreaterThan(0.1);
  expect(o.off, 'the beam on the ground near the call').toBeLessThan(16);
  const home = await wp.until(() => DISPATCH.calls[0].status === 'closed' && HELIS[0].state === 'quarters' && HELIS[0].rpm === 0, 600);
  expect(home.violations).toEqual([]);
  expect(home.done).toBe(true);
  const log = await wp.run(() => RADIO.log.map(l => l.who + ': ' + l.text).join('\n'));
  expect(log).toContain('AIR1  ONSC');
  expect(log).toMatch(/Air 1: .*(overhead|orbit|on scene)/);
  expect(await wp.stuck()).toEqual([]);
});

test('Medevac 1: asked for on an entrapment, lands at the nearest LZ, flies the patient to the roof and stays there', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('entrapment'); });
  const req = await wp.until(() => DISPATCH.calls[0].units.some(u => u.type === 'medevac'), 300);
  expect(req.done, 'requested by the first unit in').toBe(true);
  const lz = await wp.until(() => HELIS[1].state === 'on_scene', 300);
  expect(lz.violations).toEqual([]);
  expect(lz.done, 'on the ground at the LZ').toBe(true);
  const at = await wp.run(() => { const h = HELIS[1], l = lzFor(DISPATCH.calls[0].site); return { d: Math.hypot(h.pos.x - l.x, h.pos.z - l.z), y: h.pos.y, ph: h.ph }; });
  expect(at.d).toBeLessThan(0.5); expect(at.y).toBeCloseTo(0, 2); expect(at.ph).toBe('ground');
  const roof = await wp.until(() => HELIS[1].state === 'at_hospital', 500);
  expect(roof.violations).toEqual([]);
  expect(roof.done, 'on the roof with the patient').toBe(true);
  const done = await wp.until(() => DISPATCH.calls[0].status === 'closed' && HELIS[1].state === 'quarters' && UNITS.every(u => u.state === 'quarters'), 900);
  expect(done.violations).toEqual([]);
  expect(done.done).toBe(true);
  const log = await wp.run(() => RADIO.log.map(l => l.text).join('\n'));
  expect(log).toContain('MDV1  TRAN');
  expect(log).toMatch(/High School Field|Park Lawn/);
  for (const l of log.split('\n')) expect(l, 'unfilled placeholder').not.toMatch(/\{\w\}/);
});

test('Medevac 1 out of town: off the screen and hidden, back with the patient, on the roof', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('medevac'); });
  const gone = await wp.until(() => HELIS[1].state === 'away', 300);
  expect(gone.done).toBe(true);
  expect(await wp.run(() => HELIS[1].model.group.visible)).toBe(false);
  const back = await wp.until(() => DISPATCH.calls[0].status === 'closed' && HELIS[1].state === 'quarters', 600);
  expect(back.violations).toEqual([]);
  expect(back.done).toBe(true);
  expect(await wp.run(() => [HELIS[1].model.group.visible, HELIS[1].pos.distanceTo(HELIS[1].pad)])).toEqual([true, 0]);
});

test('no medevac call while Medevac 1 is out', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; DISPATCH.newCall('medevac'); });
  expect(await wp.run(() => DISPATCH.free('medevac').length)).toBe(0);
  const types = await wp.run(() => { const r = new Set(); for (let i = 0; i < 300; i++) r.add(DISPATCH.pickType()); return [...r]; });
  expect(types).not.toContain('medevac');
});

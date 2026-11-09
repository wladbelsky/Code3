// A second alarm: the neighbours' companies called in to a working fire
const { test, expect } = require('./support/harness');

test('a second alarm: the fire flares up, the neighbours come in off the screen, work the fire on the card with the town, and leave off the screen', async ({ wp }) => {
  test.setTimeout(5 * 60 * 1000);
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; const c = DISPATCH.newCall('structure'); c.strike = true; });
  const g0 = await wp.run(() => __t.geometries());
  const st = await wp.until(() => DISPATCH.calls[0].second, 250);
  expect(st.violations).toEqual([]);
  expect(st.done, 'struck').toBe(true);
  expect(await wp.run(() => DISPATCH.calls[0].aid.length + DISPATCH.calls[0].units.filter(u => u.aid).length), 'all but one passing through').toBeGreaterThanOrEqual(3);
  await wp.sim(1);
  expect(await wp.run(() => TERM.cardsHtml.includes('2ND ALARM'))).toBe(true);
  const on = await wp.until(() => DISPATCH.calls[0].units.filter(u => u.aid && u.state === 'on_scene').length >= 2, 200);
  expect(on.violations).toEqual([]);
  expect(on.done, 'the neighbours on scene').toBe(true);
  const r = await wp.run(() => {
    const c = DISPATCH.calls[0], aid = c.units.filter(u => u.aid);
    return { curb: aid.filter(u => u.state === 'on_scene').every(u => Math.hypot(u.pos.x - u.call.curb[0], u.pos.z - u.call.curb[1]) < 1), hidden: aid.some(u => !u.model.group.visible), chips: aid.every(u => TERM.cardsHtml.includes(u.short) || c.units.length > 8), big: c.scene.big };
  });
  expect(r).toMatchObject({ curb: true, hidden: false, big: true });
  const two = await wp.until(() => DISPATCH.calls[0].units.filter(u => u.type === 'engine' && u.state === 'on_scene' && u.t > 7).length >= 2, 150);   // (the second alarm's own engine at work)
  expect(two.done, 'two engines working').toBe(true);
  expect(await wp.run(() => DISPATCH.calls[0].scene.out || DISPATCH.calls[0].scene.crews.filter(i => i != null).length > 1)).toBe(true);
  const out = await wp.until(() => DISPATCH.calls[0].scene.out, 300);
  expect(out.violations).toEqual([]);
  expect(out.done, 'knocked down').toBe(true);
  const end = await wp.until(() => DISPATCH.calls[0].status === 'closed' && UNITS.every(u => u.state === 'quarters') && VISITORS.every(v => !v.aid), 500);   // (one may be just passing through)
  expect(end.violations).toEqual([]);
  expect(end.done, 'closed, everyone gone').toBe(true);
  const h = await wp.run(() => ({ ref: VISITORS.filter(v => v.callRef || v.aid || v.aidFor).length, crew: CREW.used.filter(Boolean).length }));
  expect(h).toEqual({ ref: 0, crew: 0 });
  const g1 = await wp.run(() => __t.geometries());
  expect(g1.leaked).toBe(0);
  expect(g1.reach).toBeLessThanOrEqual(g0.reach);
});

test('no second alarm with the neighbours switched off', async ({ wp }) => {
  test.setTimeout(3 * 60 * 1000);
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; CFG.visitors = false; const c = DISPATCH.newCall('structure'); c.strike = true; });
  const r = await wp.until(() => DISPATCH.calls[0].status === 'onscene' && DISPATCH.calls[0].strikeAt == null && T - DISPATCH.calls[0].arrived > 35, 250);
  expect(r.done).toBe(true);
  expect(await wp.run(() => !!DISPATCH.calls[0].second)).toBe(false);
});

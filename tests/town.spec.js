// The town: layout consistency (nothing on the streets, no tree in a building), signals, doors, seasons, the name, the load
const { test, expect } = require('./support/harness');

test('no building, lot or tree stands on a street, and every house faces its own street', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const out = [], onStreet = (x, z) => CITY_LAYOUT.streets.some(s => Math.abs(z - s.z) < ROAD_W / 2) || CITY_LAYOUT.avenues.some(a => Math.abs(x - a.x) < ROAD_W / 2);
    for (const k of CITY.keep) for (const [x, z] of [[k[0], k[1]], [k[2], k[3]], [(k[0] + k[2]) / 2, (k[1] + k[3]) / 2]]) if (onStreet(x, z)) out.push(`keep-out ${k} on a street`);
    for (const h of CITY.houses) {
      const st = CITY_LAYOUT.streets.find(s => s.name === h.street);
      if (Math.sign(st.z - h.z) !== h.face) out.push(`${h.addr} faces away from its street`);
      if (Math.abs(st.z - h.z) > 30) out.push(`${h.addr} too far from its street`);
    }
    // trees: none on a street, a lot or a building (the vegetation instances)
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); let trees = 0;
    for (const v of TERRAIN.veg) for (let i = 0; i < v.count; i++) {
      v.getMatrixAt(i, m); p.setFromMatrixPosition(m); trees++;
      if (CITY.vegAt(p.x, p.z) <= 0) out.push(`a tree at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
    return { out: out.slice(0, 10), trees };
  });
  expect(r.out).toEqual([]);
  expect(r.trees).toBeGreaterThan(500);
});

test('signals: one direction green at a time, all red between; every head shows its phase', async ({ wp }) => {
  await wp.boot();
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const r = await wp.run(() => {
      __t.sim(1);
      const ns = CITY.signal('ns'), ew = CITY.signal('ew');
      const m = new THREE.Matrix4(), p = new V3(), lit = (h) => (CITY.sigLamps.getMatrixAt(h.i, m), p.setFromMatrixPosition(m).distanceTo(h.head.localToWorld(new V3(0, SIG_LAMP_Y[h.shown], 0.19))) < 0.01);
      const bad = CITY.signals.filter(h => h.shown !== (h.axis === 'ns' ? ns : ew) || !lit(h)).length;   // (the lit lamp over the right one)
      return { ns, ew, bad };
    });
    expect(r.ns === 'r' || r.ew === 'r', `both directions open: ${r.ns} / ${r.ew}`).toBe(true);
    expect(r.bad).toBe(0);
    seen.add(r.ns + r.ew);
  }
  for (const s of ['gr', 'yr', 'rr', 'rg', 'ry']) expect([...seen]).toContain(s);
});

test('a bay door rolls up for the unit rolling out and shuts behind it', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => { CFG.calls = 0; UNITS[2].dispatch(houseDest(CITY.houses[5], 0)); });
  const up = await wp.until(() => UNITS[2].state === 'responding', 60);
  expect(up.done).toBe(true);
  expect(await wp.run(() => [CITY.bays[2].door.k, CITY.bays[2].door.g.scale.y])).toEqual([1, expect.closeTo(0.04, 3)]);
  await wp.sim(30);
  expect(await wp.run(() => [CITY.bays[2].door.k, CITY.bays[2].door.want, Math.hypot(UNITS[2].pos.x - UNITS[2].home.x, UNITS[2].pos.z - UNITS[2].home.z) > 40])).toEqual([0, 0, true]);
});

test('seasons rebuild the vegetation without leaking geometry; snow on the roofs in winter', async ({ wp }) => {
  await wp.boot();
  const base = await wp.run(() => __t.geometries());
  for (const s of ['winter', 'spring', 'summer', 'autumn', 'winter']) {
    await wp.run(s => { __t.props({ season: s }); }, s);
    await wp.sim(2.1);
    expect(await wp.run(() => TERRAIN.season)).toBe(s);
  }
  const r = await wp.run(() => ({ g: __t.geometries(), roof: HOUSE_ROOFS[0].color.getHex(), flat: ROOF_MAT.color.getHex() }));
  expect(r.g.leaked).toBe(0);
  expect(r.roof).toBe(0xe6ecf2);
  expect(r.flat).toBe(SEASONS_WINTER_ROOF);
  // back to the first season: as many geometries as at the start (the vegetation sectors differ by season)
  await wp.run(() => __t.props({ season: 'summer' }));
  await wp.sim(2.1);
  const back = await wp.run(() => __t.geometries());
  expect(back.leaked).toBe(0);
  expect(back.reach).toBeLessThanOrEqual(base.reach + 2);
});
const SEASONS_WINTER_ROOF = 0xe8eef4;

test('renaming the town redraws its signs and the panel title', async ({ wp }) => {
  await wp.boot();
  await wp.run(() => __t.props({ townname: 'cedar falls' }));
  const r = await wp.run(() => ({ title: document.querySelector('#panel .title').textContent, signs: CITY.signs.filter(s => s.town).map(s => s.text(CFG.townName)) }));
  expect(r.title).toContain('CEDAR FALLS');
  expect(r.signs.every(t => t.includes('CEDAR FALLS'))).toBe(true);
});

test('music raises the load, silence lets it drain', async ({ wp }) => {
  await wp.boot();
  await wp.sim(60, { audio: true });
  expect(await wp.run(() => LOAD.level), 'a minute in: still building').toBeLessThan(0.45);
  await wp.sim(180, { audio: true });
  const up = await wp.run(() => LOAD.level);
  expect(up).toBeGreaterThan(0.5);
  await wp.sim(300, { audio: false });
  const down = await wp.run(() => LOAD.level);
  expect(down).toBeLessThan(up * 0.5);
});

test('night: the windows, bay lights and street light pools are lit; by day they are not', async ({ wp }) => {
  await wp.boot({ query: '?hour=23' });
  await wp.sim(2.1);
  const night = await wp.run(() => ({ win: CITY.winMat.emissive.r, pool: CITY.poolMat.opacity, sign: CITY.signs[0].mat.color.r }));
  expect(night.win).toBeGreaterThan(0.5);
  expect(night.pool).toBeGreaterThan(0.3);
  expect(night.sign).toBeLessThan(0.5);
  await wp.boot({ query: '?hour=13' });
  await wp.sim(2.1);
  const day = await wp.run(() => ({ win: CITY.winMat.emissive.r, pool: CITY.poolMat.opacity }));
  expect(day.win).toBe(0);
  expect(day.pool).toBe(0);
});

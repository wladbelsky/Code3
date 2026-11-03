// Units: homes, runs out and back (bays: backed in; patrol cars: out of and into their stalls), light bars, drills
const { test, expect } = require('./support/harness');

test('every unit starts at its own home, fire / EMS / the chief in the bays, patrol cars in the lot', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => ({
    n: UNITS.length, quarters: UNITS.filter(u => u.state === 'quarters').length,
    bays: CITY.bays.map(b => b.unit && b.unit.cs), stalls: UNITS.filter(u => u.home.kind === 'stall').map(u => u.home.stall.unit === u),
    homes: new Set(UNITS.map(u => u.home.x + ',' + u.home.z)).size
  }));
  expect(r.quarters).toBe(r.n);
  expect(r.homes).toBe(r.n);
  expect(r.bays).toEqual(['ENGINE 12', 'LADDER 12', 'RESCUE 12', 'MEDIC 12', 'MEDIC 14', 'BATTALION 1']);
  expect(r.stalls.every(Boolean)).toBe(true);
});

/* send every unit to a house (or out of town), let it work, bring it home: clean all the way, everyone back home */
for (const far of [false, true]) test(`every unit runs to ${far ? 'beyond the edge of town' : 'a house'} and back into quarters`, async ({ wp }) => {
  await wp.boot();
  await wp.run((far) => {
    CFG.calls = 0;
    UNITS.forEach((u, i) => { u.dispatch(far ? farDest() : houseDest(CITY.houses[(i * 7) % CITY.houses.length], 0)); });
  }, far);
  const out = await wp.until(() => UNITS.every(u => u.state === 'on_scene' || u.state === 'away'), 400);
  expect(out.violations).toEqual([]);
  expect(out.done, JSON.stringify(await wp.run(() => UNITS.map(u => u.cs + ' ' + u.state)))).toBe(true);
  const at = await wp.run(() => UNITS.map(u => u.call.far ? 'far' : Math.hypot(u.pos.x - u.call.curb[0], u.pos.z - u.call.curb[1])));
  for (const d of at) if (d !== 'far') expect(d).toBeLessThan(0.1);
  await wp.run(() => UNITS.forEach(u => u.release()));
  const back = await wp.until(() => UNITS.every(u => u.state === 'quarters'), 500);
  expect(back.violations).toEqual([]);
  expect(back.done, JSON.stringify(await wp.run(() => UNITS.map(u => u.cs + ' ' + u.state)))).toBe(true);
  expect(await wp.stuck()).toEqual([]);
  await wp.sim(6);   // the last door rolling down
  expect(await wp.run(() => CITY.bays.flatMap(b => [b.door.k, b.rear.k]))).toEqual(new Array(12).fill(0));
});

test('light bars: dark in quarters, flashing on a run (both phases), off on the way back', async ({ wp }) => {
  await wp.boot();
  const lit = () => wp.run(() => { const u = UNITS[0]; return u.model.bars.filter(b => b.mesh.material === LB_MATS[b.col][1]).length; });
  expect(await lit()).toBe(0);
  await wp.run(() => { CFG.calls = 0; UNITS[0].dispatch(houseDest(CITY.houses[10], 0)); });
  const seen = new Set();
  for (let i = 0; i < 20; i++) { await wp.sim(0.1); seen.add(await wp.run(() => UNITS[0].lastFlash)); }
  expect([...seen].sort()).toEqual([0, 1]);
  await wp.until(() => UNITS[0].state === 'on_scene', 300);
  await wp.run(() => UNITS[0].release());
  await wp.sim(1);
  expect(await lit()).toBe(0);
});

test('with music the bars flash on the beat', async ({ wp }) => {
  await wp.boot();
  await wp.sim(40, { audio: true });
  await wp.run(() => { CFG.calls = 0; UNITS[6].dispatch(houseDest(CITY.houses[3], 0)); });
  // the phase follows the beats: it changes only right after one
  const r = await wp.run(() => {
    __t.sim(0.5, { audio: true });   // (the bar coming on is not a beat)
    let changes = 0, onBeat = 0, last = UNITS[6].lastFlash;
    for (let i = 0; i < 200; i++) { __t.sim(0.05, { audio: true }); const f = UNITS[6].lastFlash; if (f !== last) { changes++; if (T - AUD.beat < 0.2) onBeat++; } last = f; }
    return { changes, onBeat };
  });
  expect(r.changes).toBeGreaterThan(10);
  expect(r.onBeat).toBe(r.changes);
});

test('the dispatcher keeps units moving for 40 minutes without anyone getting stuck, overlapping or driving through a shut door', async ({ wp }) => {
  test.setTimeout(8 * 60 * 1000);
  await wp.boot();
  const runs = new Set();
  for (let i = 0; i < 8; i++) {
    const r = await wp.sim(300, { audio: i % 2 === 1 });
    expect(r.violations).toEqual([]);
    for (const u of await wp.run(() => UNITS.filter(u => u.state !== 'quarters').map(u => u.cs))) runs.add(u);
  }
  expect(await wp.stuck()).toEqual([]);
  expect(runs.size).toBeGreaterThan(5);
});

test('code 1 stops for a red light; code 3 slows through it', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    CFG.calls = 0;
    const u = UNITS[6];   // a patrol car eastbound on Main St through 1st Ave (x −50)
    const out = {};
    for (const st of ['returning', 'responding']) {
      u.state = st; u.lights = st === 'responding'; u.legs = []; u.way = new Way([[-160, 52.25], [60, 52.25]], { vmax: 15 }); u.way.s = 0; u.v = 0; u.leg = null;
      CITY.sigT = 46;                                    // yellow → red as it comes up to the crossing
      let minV = 99, stoppedAt = null;
      for (let i = 0; i < 600 && u.way; i++) {
        step(0.05);
        if (u.pos.x > -75 && u.pos.x < -50) { minV = Math.min(minV, u.v); if (u.v < 0.05 && stoppedAt == null) stoppedAt = u.pos.x; }
        if (u.pos.x > -40) break;
      }
      out[st] = { minV, stoppedAt };
    }
    return out;
  });
  expect(r.returning.stoppedAt).not.toBeNull();
  expect(r.returning.stoppedAt + 2.35).toBeLessThan(-57);              // its front short of the crosswalk
  expect(r.responding.stoppedAt).toBeNull();
  expect(r.responding.minV).toBeLessThan(8);
});

// The weather: rain, fog, the automatic changes
const { test, expect } = require('./support/harness');

test('rain comes on over a minute: streaks fall, the light dims, the street lights come on, the roads shine; and it clears', async ({ wp }) => {
  test.setTimeout(3 * 60 * 1000);
  await wp.boot({ query: '?hour=13&season=summer&sky=clear' });
  await wp.sim(2);
  const clear = await wp.run(() => ({ si: sunLight.intensity, lights: ENV.lightsOn, wet: ENV.wet, visible: WEATHER.mesh.visible }));
  expect(clear).toMatchObject({ lights: 0, wet: 0, visible: false });
  await wp.run(() => { CFG.sky = 'rain'; });
  const r = await wp.sim(70);
  expect(r.violations).toEqual([]);
  const rain = await wp.run(() => {
    const M = WEATHER.mesh, P = M.geometry.attributes.position.array, n = M.geometry.drawRange.count / 2; let bad = 0, near = 0;
    for (let i = 0; i < n; i++) {
      const y = P[i * 6 + 1];
      if (!Number.isFinite(P[i * 6]) || !Number.isFinite(y) || y < -3 || y > 62) bad++;
      if (Math.abs(P[i * 6] - CAM_TGT.x) < 200 && Math.abs(P[i * 6 + 2] - CAM_TGT.z) < 200) near++;
    }
    return { k: WEATHER.rain, si: sunLight.intensity, lights: ENV.lightsOn, wet: ENV.wet, visible: M.visible, n, bad, near, max: RAIN_N };
  });
  expect(rain.k).toBe(1);
  expect(rain.wet).toBe(1);
  expect(rain.visible).toBe(true);
  expect(rain.n).toBe(rain.max);
  expect(rain.bad).toBe(0);
  expect(rain.near).toBeGreaterThan(rain.n * 0.2);
  expect(rain.si).toBeLessThan(clear.si * 0.5);
  expect(rain.lights).toBeGreaterThan(0.4);
  await wp.run(() => { CFG.sky = 'clear'; });
  await wp.sim(70);
  expect(await wp.run(() => ({ k: WEATHER.rain, visible: WEATHER.mesh.visible, wet: ENV.wet }))).toEqual({ k: 0, visible: false, wet: 0 });
});

test('fog closes in; winter "rain" is a thicker snowfall, not streaks', async ({ wp }) => {
  test.setTimeout(3 * 60 * 1000);
  await wp.boot({ query: '?hour=9&season=winter&sky=clear' });
  await wp.sim(2);
  const far0 = await wp.run(() => scene.fog.far);
  await wp.run(() => { CFG.sky = 'fog'; WEATHER.fog = 1; });
  await wp.sim(2);
  expect(await wp.run(() => scene.fog.far)).toBeLessThan(far0 - 300);
  await wp.run(() => { CFG.sky = 'rain'; WEATHER.fog = 0; WEATHER.rain = 1; });
  await wp.sim(5);
  expect(await wp.run(() => WEATHER.mesh.visible)).toBe(false);
});

test('auto: the weather rolls on its timer; crashes are likelier in the rain', async ({ wp }) => {
  test.setTimeout(60 * 1000);
  await wp.boot({ query: '?hour=9&season=summer&sky=auto' });
  const r = await wp.run(() => {
    const seen = {};
    for (let i = 0; i < 400; i++) { WEATHER.timer = 0; WEATHER.update(0.01); seen[WEATHER.kind] = (seen[WEATHER.kind] || 0) + 1; }
    const count = () => { let m = 0; for (let i = 0; i < 3000; i++) { const k = DISPATCH.pickType(); if (k && INCIDENT_TYPES[k].kind === 'mva') m++; } return m; };
    WEATHER.rain = 0; const dry = count();
    WEATHER.rain = 1; const wet = count();
    WEATHER.rain = 0;
    return { seen, dry, wet };
  });
  expect(r.seen.clear).toBeGreaterThan(150);
  expect(r.seen.rain).toBeGreaterThan(30);
  expect(r.seen.fog).toBeGreaterThan(10);
  expect(r.wet).toBeGreaterThan(r.dry * 1.3);
});

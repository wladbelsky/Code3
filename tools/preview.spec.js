// Renders the README screenshots (screenshots/<scene>.jpg, 1280x720, see SCENES) into test-results/<scene>-<seed>.jpg;
// copy the best over screenshots/. Run in Docker:
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js            (everything)
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js -g "night," (one scene)
// The Workshop GIF (preview.gif) comes with the units (stage 9); preview.gif is still a placeholder.
const { test } = require('../tests/support/harness');

test.setTimeout(4 * 60 * 1000);
const SEEDS = 1;
/* hour, season, zoom, camera target; the page functions are serialised: no closures */
const SCENES = {
  day: { hour: 14, season: 'autumn', zoom: 100, at: [0, 0] },
  night: { hour: 22.5, season: 'winter', zoom: 100, at: [0, 0] },
  station: { hour: 16.5, season: 'summer', zoom: 260, at: [-6, 18] },
  // an autumn evening: a structure fire called in, the terminal busy, units arriving
  cad: { hour: 18.2, season: 'autumn', zoom: 100, at: [10, 30], prep: () => { CFG.calls = 0; DISPATCH.newCall('medical'); __t.sim(30); DISPATCH.newCall('structure'); },
    until: () => DISPATCH.calls.some(c => c.key === 'structure' && c.status === 'onscene') && T - DISPATCH.calls.find(c => c.key === 'structure').arrived > 12 },
  // a dusk structure fire: the ladder's aerial up over the roof, both streams on it (the camera on the house)
  fire: { hour: 19.4, season: 'spring', zoom: 210, at: [0, 0], prep: () => { CFG.calls = 0; const c = DISPATCH.newCall('structure'); const h = c.site.house; CAM_TGT.set(h.x, 0, h.z + h.face * 6); updateCamera(); },
    until: () => { const c = DISPATCH.calls[0], L = UNITS.find(u => u.type === 'ladder'); return c.scene && L.aerialK > 0.98 && c.scene.heat < 0.75 && c.scene.heat > 0.4; } },
  // a crash at a crossing on a summer afternoon
  crash: { hour: 15, season: 'summer', zoom: 220, at: [0, 0], prep: () => { CFG.calls = 0; const c = DISPATCH.newCall('mva'); const [x, z] = siteXZ(c.site, c.site.a, 4); CAM_TGT.set(x, 0, z); updateCamera(); },
    until: () => { const c = DISPATCH.calls[0]; return c.status === 'onscene' && T - c.arrived > 15; } },
  // a winter night run: the engine and a medic pulling out onto Main St, lights going
  run: { hour: 21.5, season: 'winter', zoom: 190, at: [-12, 38], prep: () => { CFG.calls = 0; UNITS[0].dispatch(houseDest(CITY.houses[22], 0)); UNITS[3].dispatch(houseDest(CITY.houses[22], 1)); },
    until: () => UNITS[0].state === 'responding' && UNITS[0].pos.z > 49 && UNITS[0].pos.x > -24 }
};
for (const [name, S] of Object.entries(SCENES)) for (let seed = 1; seed <= SEEDS; seed++) {
  test(`${name}, seed ${seed}`, async ({ wp }) => {
    await wp.boot({ seed, query: `?hour=${S.hour}&season=${S.season}` });
    await wp.run(([zoom, at]) => { CFG.zoom = zoom; CAM_TGT.set(at[0], 0, at[1]); updateCamera(); }, [S.zoom, S.at]);
    await wp.sim(2.5);
    if (S.prep) await wp.run(`(${S.prep})()`);
    if (S.until) await wp.until(S.until, 200);
    await wp.run(() => __t.render());
    await wp.page.screenshot({ path: `test-results/${name}-${seed}.jpg`, quality: 88 });
  });
}

// Renders the Workshop preview (preview.gif, animated 256x256 вЂ” Wallpaper Engine's limits: в‰¤ 256 px, < 1 MB, ideally
// < 500 KB) and the README screenshots (screenshots/<scene>.jpg, 1280x720, see SCENES). Run in Docker:
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js            (everything)
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js -g gif     (only the GIFs)
//   powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js -g "night," (one scene)
// Candidates go to test-results/gif-<seed>.gif (+ gif-<seed>-sheet.png, four frames to look at) and
// test-results/<scene>-<seed>.jpg; copy the best ones over preview.gif / screenshots/<scene>.jpg.
const fs = require('fs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { test, expect } = require('../tests/support/harness');

test.setTimeout(6 * 60 * 1000);
const SEEDS = 1, GIF_SEEDS = Number(process.env.GIF_SEEDS || 3);
const GIF = { size: 256, render: 1024, frames: 36, fps: 10, colors: 64 };
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
  // a summer night search: Air 1 orbiting over the houses, its searchlight on the yards (the camera halfway up to it)
  heli: { hour: 23, season: 'summer', zoom: 150, at: [0, 0], prep: () => { CFG.calls = 0; const c = DISPATCH.newCall('search'), g = HELIS[0]; g.update(0.05); CAM_TGT.set(g.goal.x, 24, g.goal.z); updateCamera(); },
    until: () => { const h = HELIS[0], g = h.goal; return h.state === 'on_scene' && h.t > 14 && g.x - h.pos.x + h.pos.z - g.z > 40; } },   // (on the camera's side of the circle)
  // Medevac 1 settling onto the landing zone for an entrapment, the dust blowing out from under it
  medevac: { hour: 11, season: 'spring', zoom: 230, at: [0, 0], prep: () => { CFG.calls = 0; const c = DISPATCH.newCall('entrapment'), l = lzFor(c.site); CAM_TGT.set(l.x, 3, l.z); updateCamera(); },
    until: () => HELIS[1].ph === 'descend' && HELIS[1].pos.y < 3.5 },
  // traffic on Main St pulled over to the curb, the engine going by on the centre line (the camera rides along)
  traffic: { hour: 16, season: 'summer', zoom: 220, at: [0, 0], prep: () => { CFG.calls = 0; CFG.traffic = 12; __t.sim(90); UNITS[0].dispatch({ far: { ax: 'ew', at: 50, a: 520, dir: 'E' } }); },
    until: () => {   // (a slow car put 45 m ahead of it once it is out on Main St)
      const u = UNITS[0]; let c = window.__pc;
      if (!c && u.state === 'responding' && u.pos.z > 47 && u.pos.x > -10) {
        for (const o of CIVS) if (o.on && Math.abs(o.pos.z - 50) < 8 && o.pos.x > u.pos.x - 5 && o.pos.x < u.pos.x + 160) o.despawn();   // (the stretch clear: no one in the way of the pass)
        c = window.__pc = CIVS.find(c => !c.on && c.kind === 'car'); c.start(ROADS.way({ ax: 'ew', at: 50, a: u.pos.x + 45, dirs: ['E'] }, { ax: 'ew', at: 50, a: 480, dir: 'E' }, null, null, { vmax: 7, alat: 2.2, vEnd: 7 }));
      }
      CAM_TGT.set(u.pos.x + 6, 0, u.pos.z); updateCamera();
      return c && u.latOff < -2 && c.pulled && Math.abs(c.pos.x - u.pos.x) < 6;
    } },
  // a second alarm: the neighbours' lime engines at the curb, three streams, the roof going
  alarm2: { hour: 21, season: 'autumn', zoom: 170, at: [0, 0], prep: () => { CFG.calls = 0; const c = DISPATCH.newCall('structure'); c.strike = true; CAM_TGT.set(c.site.house.x, 0, c.site.house.z - 8); updateCamera(); },
    until: () => { const c = DISPATCH.calls[0]; return c.second && c.units.some(u => u.aid && u.type === 'engine' && u.state === 'on_scene' && u.t > 9); } },
  // the weather
  rain: { hour: 20.8, season: 'summer', zoom: 170, at: [0, 0], prep: () => { CFG.sky = 'rain'; WEATHER.rain = 1; CFG.calls = 0; UNITS[0].dispatch(houseDest(CITY.houses[22], 0)); UNITS[3].dispatch(houseDest(CITY.houses[22], 1)); }, until: () => UNITS[0].state === 'responding' && UNITS[0].pos.z > 49 && UNITS[0].pos.x > -24 },
  rainday: { hour: 13, season: 'autumn', zoom: 170, at: [0, 0], prep: () => { CFG.sky = 'rain'; WEATHER.rain = 1; __t.sim(40); } },
  fog: { hour: 7.5, season: 'spring', zoom: 130, at: [0, 0], prep: () => { CFG.sky = 'fog'; WEATHER.fog = 1; __t.sim(40); } },
  // a winter night run: the engine and a medic pulling out onto Main St, lights going
  run: { hour: 21.5, season: 'winter', zoom: 190, at: [-12, 38], prep: () => { CFG.calls = 0; UNITS[0].dispatch(houseDest(CITY.houses[22], 0)); UNITS[3].dispatch(houseDest(CITY.houses[22], 1)); },
    until: () => UNITS[0].state === 'responding' && UNITS[0].pos.z > 49 && UNITS[0].pos.x > -24 }
};
for (const [name, S] of Object.entries(SCENES)) for (let seed = 1; seed <= SEEDS; seed++) {
  test.describe(name, () => test(`${name}, seed ${seed}`, async ({ wp }) => {
    await wp.boot({ seed, query: `?hour=${S.hour}&season=${S.season}` });
    await wp.run(([zoom, at]) => { CFG.zoom = zoom; CAM_TGT.set(at[0], 0, at[1]); updateCamera(); }, [S.zoom, S.at]);
    await wp.sim(2.5);
    if (S.prep) await wp.run(`(${S.prep})()`);
    if (S.until) expect((await wp.until(S.until, 200)).done, `the ${name} moment`).toBe(true);
    await wp.run(() => __t.render());
    await wp.page.screenshot({ path: `test-results/${name}-${seed}.jpg`, quality: 88 });
  }));
}

/* the Workshop GIF: only the scene (the panel and the terminal are unreadable at 256 px) вЂ” a dusk house fire, the
   ladder's aerial up over the roof, the streams on it, the light bars going; the camera on the house */
test.describe('gif', () => {
  test.use({ viewport: { width: GIF.render, height: GIF.render } });
  for (let seed = 1; seed <= GIF_SEEDS; seed++) test(`gif, seed ${seed}`, async ({ wp }) => {
    await wp.boot({ seed, query: '?hour=18.7&season=autumn' });
    await wp.run(() => { CFG.showPanel = false; CFG.terminal = false; applySettings(); CFG.zoom = 290; updateCamera(); });
    await wp.sim(2.5);
    await wp.run(() => { CFG.calls = 0; const c = DISPATCH.newCall('structure'), h = c.site.house; CAM_TGT.set(h.x, 1, h.z + h.face * 5); updateCamera(); });
    const r = await wp.until(() => { const c = DISPATCH.calls[0], L = UNITS.find(u => u.type === 'ladder'); return c.scene && L.aerialK > 0.98 && c.scene.heat < 0.8 && c.scene.heat > 0.45; }, 300);
    expect(r.done, 'the fire with the aerial up').toBe(true);
    const frames = [];
    for (let i = 0; i < GIF.frames; i++) {
      await wp.sim(1 / GIF.fps, { check: false });
      const b64 = await wp.run(([size, i, n]) => {
        __t.render();
        // downscale in halving steps (smooth, no aliasing) вЂ” in the same task as the render, so the WebGL buffer is still there
        const C = window.__gifC || (window.__gifC = {});
        let src = renderer.domElement, w = src.width;
        while (w > size) {
          w = Math.max(size, w >> 1);
          const c = C[w] || (C[w] = Object.assign(document.createElement('canvas'), { width: w, height: w }));
          const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, w); src = c;
        }
        // a contact sheet of four frames, to look at the candidates without a GIF viewer
        const sheet = C.sheet || (C.sheet = Object.assign(document.createElement('canvas'), { width: size * 2, height: size * 2 }));
        const k = [0, n / 3, 2 * n / 3, n - 1].map(Math.floor).indexOf(i);
        if (k >= 0) sheet.getContext('2d').drawImage(src, (k % 2) * size, (k >> 1) * size);
        const d = src.getContext('2d').getImageData(0, 0, size, size).data;
        let s = ''; for (let j = 0; j < d.length; j += 0x8000) s += String.fromCharCode.apply(null, d.subarray(j, j + 0x8000));
        return btoa(s);
      }, [GIF.size, i, GIF.frames]);
      frames.push(new Uint8Array(Buffer.from(b64, 'base64')));
    }
    const sheet = await wp.run(() => __gifC.sheet.toDataURL('image/png').split(',')[1]);
    fs.writeFileSync(`test-results/gif-${seed}-sheet.png`, Buffer.from(sheet, 'base64'));
    // one palette for all frames (no flicker between frames), from every other frame
    const all = new Uint8Array(frames[0].length * Math.ceil(frames.length / 2));
    frames.filter((f, i) => i % 2 === 0).forEach((f, i) => all.set(f, i * f.length));
    const palette = quantize(all, GIF.colors), gif = GIFEncoder();
    frames.forEach((f, i) => gif.writeFrame(applyPalette(f, palette), GIF.size, GIF.size,
      i ? { delay: 1000 / GIF.fps } : { palette, delay: 1000 / GIF.fps, repeat: 0 }));
    gif.finish();
    const bytes = gif.bytes();
    fs.writeFileSync(`test-results/gif-${seed}.gif`, bytes);
    console.log(`gif-${seed}.gif: ${(bytes.length / 1024).toFixed(0)} KB`);
    expect(bytes.length, 'Wallpaper Engine takes previews under 1 MB').toBeLessThan(1024 * 1024);
  });
});

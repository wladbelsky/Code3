// Start-up: the page boots cleanly in Wallpaper Engine mode and in a plain browser, the town is built
const { test, expect } = require('./support/harness');

test('boots in Wallpaper Engine mode with WebGL and the whole town', async ({ wp }) => {
  await wp.boot();
  const info = await wp.run(() => ({
    webgl: !!renderer.getContext(),
    houses: CITY.houses.length, addrs: new Set(CITY.houses.map(h => h.addr)).size,
    bays: CITY.bays.length, stalls: CITY.stalls.length, signals: CITY.signals.length,
    signs: CITY.signs.map(s => s.text(CFG.townName))
  }));
  expect(info.webgl).toBe(true);
  expect(info.houses).toBe(24);
  expect(info.addrs, 'every house has its own address').toBe(info.houses);
  expect(info.bays).toBe(CITY_BAYS);
  expect(info.stalls).toBeGreaterThan(20);
  expect(info.signals, 'two heads on each corner of the four signal crossings').toBe(4 * 4 * 2);
  expect(info.signs.join('|')).toContain('FAIRHAVEN FIRE DEPT · STATION 12');
});
const CITY_BAYS = 6;

test('the splash screen hides after the start-up window', async ({ wp }) => {
  await wp.boot({ splash: true });
  expect(await wp.run(() => document.getElementById('splash').classList.contains('off'))).toBe(false);
  await wp.sim(3.5);
  expect(await wp.run(() => { const s = document.getElementById('splash'); return !s || s.classList.contains('off'); })).toBe(true);
});

test('boots in a normal browser with the settings drawer and stays clean for a minute', async ({ wp }) => {
  await wp.boot({ we: false });
  const r = await wp.run(() => ({ demo: AUD.demo, buttons: document.querySelectorAll('button').length }));
  expect(r.demo).toBe(true);
  expect(r.buttons, 'the settings drawer adds its controls').toBeGreaterThan(5);
  const res = await wp.sim(60);
  expect(res.violations).toEqual([]);
});

test('the settings button is clear of the panel and the terminal, wherever they are', async ({ wp }) => {
  await wp.boot({ we: false });
  const hits = await wp.run(() => {
    const box = id => document.getElementById(id).getBoundingClientRect(), out = [], panel = document.getElementById('panel'), cad = document.getElementById('cad');
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const p of ['tl', 'tr', 'bl', 'br']) for (const t of ['tl', 'tr', 'bl', 'br']) {
      panel.className = 'pos-' + p; cad.className = 'pos-' + t;
      const g = box('cfgGear');
      if (hit(g, box('panel')) || hit(g, box('cad'))) out.push(p + '/' + t);
    }
    return out;
  });
  expect(hits).toEqual([]);
});

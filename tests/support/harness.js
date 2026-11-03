/* Test harness: a `wp` fixture that boots the wallpaper deterministically and drives it.
   - Math.random is a seeded PRNG (SEED env, default 1) — installed before the wallpaper's scripts run;
   - Date is fixed (21 June 2026, 12:00 UTC; the browser runs in UTC — see playwright.config.js);
   - requestAnimationFrame never fires: the simulation only advances through __t.sim() (step(0.05) per tick);
   - Wallpaper Engine mode by default (wallpaperRegisterAudioListener is defined: no settings drawer, no demo beat;
     audio is fed by __t.sim({ audio })); { we: false } boots it like a normal browser;
   - localStorage is cleared on the first load of a page (a reload keeps it — persistence tests).
   Every test using `wp` fails if the page logged an error or threw. */
const base = require('@playwright/test');
const path = require('path');

const SEED = Number(process.env.SEED || 1);
if (!Number.isInteger(SEED)) throw new Error(`SEED must be an integer, got '${process.env.SEED}'`);
const INPAGE = path.join(__dirname, 'inpage.js');

function initScript({ seed, we }) {
  let s = seed >>> 0;                                            // mulberry32
  Math.random = () => {
    s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { if (!sessionStorage.getItem('__t_boot')) { localStorage.clear(); sessionStorage.setItem('__t_boot', '1'); } } catch (e) { /* no storage */ }
  window.requestAnimationFrame = () => 0;                        // no frame loop: tests step the simulation themselves
  if (we) window.wallpaperRegisterAudioListener = cb => { window.__audio = cb; };
}

class Wallpaper {
  constructor(page, errors) { this.page = page; this.errors = errors; this.installed = false; }
  /* load the wallpaper; query e.g. '?hour=0' */
  /* splash: keep the start-up splash (it covers the page until T > 3.2 — or 8 s of real time — and blocks clicks) */
  async boot({ seed = SEED, we = true, query = '', time = '2026-06-21T12:00:00Z', splash = false } = {}) {
    if (!this.installed) {
      await this.page.clock.setFixedTime(new Date(time));
      await this.page.addInitScript(initScript, { seed, we });
      await this.page.addInitScript({ path: INPAGE });
      this.installed = true;
    }
    await this.page.goto('/index.html' + query);
    const ok = await this.page.evaluate(() => typeof ready !== 'undefined' && ready && CITY.houses.length > 0);
    if (!ok) throw new Error('wallpaper did not initialise');
    await this.page.evaluate((splash) => { __t.setup(); if (!splash) document.getElementById('splash').style.display = 'none'; }, splash);
    return this;
  }
  async reload() {
    await this.page.reload();
    await this.page.evaluate(() => __t.setup());
  }
  /* run fn(arg) in the page */
  run(fn, arg) { return this.page.evaluate(fn, arg); }
  /* simulate sec seconds; returns { violations, steps, t } */
  sim(sec, opts = {}) { return this.page.evaluate(([s, o]) => __t.sim(s, o), [sec, opts]); }
  /* simulate (no audio by default) until pred() is true or the time limit hits; returns the simulated time used */
  async until(pred, limit, opts = {}) {
    const src = `(${pred})()`;
    return this.page.evaluate(([src, limit, o]) => {
      const t0 = T, f = () => (0, eval)(src);
      const r = __t.sim(limit, Object.assign({}, o, { until: f }));
      return Object.assign(r, { done: f(), took: T - t0 });
    }, [src, limit, opts]);
  }
  states() { return this.page.evaluate(() => __t.states()); }
  stuck() { return this.page.evaluate(() => __t.stuck()); }
}

const test = base.test.extend({
  errors: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await use(errors);
  },
  wp: async ({ page, errors }, use) => {
    await use(new Wallpaper(page, errors));
    base.expect(errors, 'the page logged errors').toEqual([]);
  }
});

module.exports = { test, expect: base.expect, SEED };

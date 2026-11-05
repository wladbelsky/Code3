'use strict';
/* ===== The dispatch centre between sessions (browser reloads, Wallpaper Engine restarts) =====
   Remembers the CAD's call counter (the numbers run on), the day's call count by service (the panel), the last lines
   of the radio log (back on the terminal, with their times) and the load (LOAD) — not the units: they start in
   quarters and the calls that were open are gone (the terminal says it reconnected). localStorage (WE keeps it per
   wallpaper), written every 10 s only when something changed, and on the way out; off with CFG.saveState. */
const PERSIST = {
  KEY: 'code3.cad.v1', timer: 10, last: null, restored: false,
  stats: { day: '', calls: 0, fire: 0, ems: 0, pd: 0 },
  dayKey() { const d = getNow(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; },
  /* the day's counters (a new day starts them again) */
  today() { const k = this.dayKey(); if (this.stats.day !== k) this.stats = { day: k, calls: 0, fire: 0, ems: 0, pd: 0 }; return this.stats; },
  count(c) { const s = this.today(); s.calls++; s[c.type.svc] = (s[c.type.svc] || 0) + 1; },
  save() {
    if (!CFG.saveState || !ready) return;
    const log = RADIO.log.slice(-9).map(l => ({ who: l.who, text: l.text, kind: l.kind, at: l.at.getTime() }));
    const json = JSON.stringify({ v: 1, seq: DISPATCH.seq, load: Math.round(LOAD.level * 20) / 20, stats: this.today(), log });
    if (json === this.last) return;
    try { localStorage.setItem(this.KEY, json); this.last = json; } catch (e) { /* storage unavailable */ }
  },
  clear() { this.last = null; try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ } },
  load() {
    try { const d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); return d && d.v === 1 && Array.isArray(d.log) ? d : null; } catch (e) { return null; }
  },
  /* once per page load, after the terminal is built: the counter, today's numbers, the log, the load */
  restore() {
    const d = CFG.saveState && !this.restored && this.load(); if (!d) return false;
    this.restored = true;
    DISPATCH.seq = Math.max(DISPATCH.seq, d.seq | 0);
    if (typeof d.load === 'number') LOAD.level = clamp(d.load, 0, 1);
    if (d.stats && d.stats.day === this.dayKey()) this.stats = Object.assign(this.today(), d.stats);
    for (const e of d.log) { const l = { who: String(e.who), text: String(e.text), kind: String(e.kind), at: new Date(e.at) }; RADIO.log.push(l); if (RADIO.onLine) RADIO.onLine(l); }
    RADIO.say('CAD', 'CAD RECONNECTED', 'sys');
    return true;
  },
  update(dt) { if ((this.timer -= dt) <= 0) { this.timer = 10; this.save(); } }
};
// save on the way out too (closing / reloading the tab, WE unloading or hiding the wallpaper)
addEventListener('pagehide', () => PERSIST.save());
document.addEventListener('visibilitychange', () => { if (document.hidden) PERSIST.save(); });

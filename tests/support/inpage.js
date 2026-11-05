/* In-page test helpers (injected with addInitScript before the wallpaper's scripts; everything here is resolved at
   call time, so the wallpaper's globals — CITY, step, … — are available by then). Exposed as window.__t. */
(() => {
  'use strict';
  const H = window.__t = {};
  let rt = 1000;                       // simulated real time (RT): audio timing and beat gaps run on it
  const DT = 0.05;

  H.rt = () => rt;
  /* after boot: real time and the clock run on simulated time */
  H.setup = () => {
    window.RT = () => rt;
    if (!THREE.BufferGeometry.prototype.__patched) {           // mark disposed geometries (leak detection, below)
      const d = THREE.BufferGeometry.prototype.dispose;
      THREE.BufferGeometry.prototype.dispose = function () { this.__disposed = true; return d.call(this); };
      THREE.BufferGeometry.prototype.__patched = true;
    }
    CFG.lon = 0;                          // the browser runs in UTC; no timezone dependence
  };

  /* ---- audio: a synthetic 120 bpm track (kick on the beat, snare on 2 and 4) or silence ---- */
  const arr = new Array(128).fill(0);
  H.audioFrame = (on) => {
    arr.fill(0);
    if (on) {
      const ph = rt % 0.5, beat = Math.floor(rt / 0.5);
      for (let i = 0; i < 128; i++) arr[i] = 0.12 + 0.03 * Math.sin(i + rt * 7);
      if (ph < 0.06) for (let i = 0; i < 5; i++) { arr[i] = 0.95; arr[64 + i] = 0.95; }
      if (beat % 2 && ph < 0.05) for (let i = 6; i < 23; i++) { arr[i] = 0.8; arr[64 + i] = 0.8; }
      if (ph > 0.25 && ph < 0.29) for (let i = 26; i < 57; i++) { arr[i] = 0.6; arr[64 + i] = 0.6; }
    }
    return arr;
  };
  const feed = (on) => { const a = H.audioFrame(on); (window.__audio || onAudio)(a); };

  /* ---- invariants checked after every step ---- */
  // per-state limits for the stuck detector (s); EXEMPT states are held by the dispatcher (drills / calls)
  H.yaws = new Map();
  H.STATE_LIMITS = { turnout: 90, pullout: 30, responding: 300, returning: 400, parking: 60, transporting: 400, at_hospital: 120, civStill: 100 };   // (a car: two red lights and a unit going by)
  H.EXEMPT = new Set(['quarters', 'on_scene', 'away']);
  H.checkInvariants = () => {
    const v = [], who = u => `${u.cs}[${u.state}]`;
    for (const u of UNITS) {
      if (!UNIT_STATES[u.state] || !TILE_STATES[u.state]) v.push(`unknown state ${who(u)}`);   // (a label and a tile on the board)
      if (!Number.isFinite(u.pos.x + u.pos.z + u.pos.h + u.v)) v.push(`NaN ${who(u)}`);
      if (u.state === 'quarters' && Math.hypot(u.pos.x - u.home.x, u.pos.z - u.home.z) > 0.05) v.push(`in quarters away from home ${who(u)}`);
      const b = u.home.bay;   // through a door only when it is up
      if (b && Math.abs(u.pos.x - b.x) < 2.5) for (const [z, d] of [[b.zFront, b.door], [b.zBack, b.rear]])
        if (u.pos.z - u.len / 2 < z - 0.3 && u.pos.z + u.len / 2 > z + 0.3 && d.k < 0.9) v.push(`${who(u)} through a shut door (${d.k.toFixed(2)})`);
    }
    // the body turns no faster than a car (place: ~4.5 m radius at speed); no snaps between ways
    for (const u of UNITS) {
      const y = u.yaw, p = H.yaws.get(u); H.yaws.set(u, { y, st: u.state });
      if (p && p.st !== 'quarters' && u.state !== 'quarters' && Math.abs(angleWrap(y - p.y)) > (Math.max(0.35, u.v / 4.5) + 0.3) * DT + 1e-4) v.push(`${who(u)} spun ${(angleWrap(y - p.y) / DEG).toFixed(1)}° in a step`);
    }
    // no two units in one place (both on the move, or one driving into a parked one)
    for (let i = 0; i < UNITS.length; i++) for (let j = i + 1; j < UNITS.length; j++) {
      const a = UNITS[i], c = UNITS[j];
      if (!a.model.group.visible || !c.model.group.visible || (a.state === 'quarters' && c.state === 'quarters')) continue;
      if (Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) < (a.wid + c.wid) / 2) v.push(`${who(a)} and ${who(c)} overlap`);
    }
    // helicopters: known states, never below the ground or the pad, the rotor up to speed whenever they are off it
    for (const h of HELIS) {
      if (!HELI_STATES[h.state] || !TILE_STATES[h.state]) v.push(`unknown state ${who(h)}`);
      if (!Number.isFinite(h.pos.x + h.pos.y + h.pos.z + h.h + h.v)) v.push(`NaN ${who(h)}`);
      if (h.pos.y < -0.01) v.push(`${who(h)} below the ground`);
      if (h.state === 'quarters' && h.pos.distanceTo(h.pad) > 0.05) v.push(`on the pad away from it ${who(h)}`);
      if ((h.ph === 'fly' || h.ph === 'hover') && h.rpm < 0.95) v.push(`${who(h)} flying with the rotor at ${h.rpm.toFixed(2)}`);
    }
    // civilian cars: no NaN, never in a unit or in each other
    const civs = CIVS.filter(c => c.on), cw = c => `car ${c.i}`;
    for (const c of civs) if (!Number.isFinite(c.pos.x + c.pos.z + c.v + c.lat)) v.push(`NaN ${cw(c)}`);
    for (let i = 0; i < civs.length; i++) {
      const a = civs[i];
      for (let j = i + 1; j < civs.length; j++) { const b = civs[j]; if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < (a.wid + b.wid) / 2) v.push(`${cw(a)} and ${cw(b)} overlap`); }
      for (const u of UNITS) if (u.model.group.visible && Math.hypot(a.pos.x - u.pos.x, a.pos.z - u.pos.z) < (a.wid + u.wid) / 2) v.push(`${cw(a)} and ${who(u)} overlap`);
    }
    if (!Number.isFinite(T) || !Number.isFinite(LOAD.level)) v.push('NaN in the clock or the load');
    if (LOAD.level < 0 || LOAD.level > 1) v.push(`LOAD out of range ${LOAD.level}`);
    for (const b of CITY.bays) if (!(b.door.k >= 0 && b.door.k <= 1)) v.push(`bay ${b.i} door at ${b.door.k}`);
    return v;
  };

  /* ---- the simulation driver ----
     o.audio: true (music) / false (silence) / undefined (no audio input at all)
     o.check: run checkInvariants after every step (default true); o.until: stop early when it returns true */
  /* how long each unit has been in its state; the longest per state (stuck detector) */
  H.reset = () => { H.since = new Map(); H.maxT = {}; };
  H.track = () => {
    for (const u of [...UNITS, ...HELIS]) {
      const k = H.since.get(u);
      if (!k || k.state !== u.state) { H.since.set(u, { state: u.state, t0: T }); continue; }
      const d = T - k.t0, m = H.maxT[u.state];
      if (!m || d > m.t) H.maxT[u.state] = { t: d, who: u.cs };
    }
    for (const c of CIVS) if (c.on && c.stillT > (H.maxT.civStill ? H.maxT.civStill.t : 0)) H.maxT.civStill = { t: c.stillT, who: `car ${c.i}` };
  };
  H.stuck = () => Object.entries(H.maxT).filter(([st, m]) => !H.EXEMPT.has(st) && m.t > (H.STATE_LIMITS[st] || 600)).map(([st, m]) => `${m.who} spent ${m.t.toFixed(0)} s in ${st}`);
  H.sim = (sec, o = {}) => {
    const n = Math.round(sec / DT), violations = [];
    const check = o.check !== false;
    let i = 0;
    if (!H.since) H.reset();
    for (; i < n; i++) {
      if (o.audio !== undefined) feed(o.audio);
      step(DT); rt += DT; H.track();
      if (check) for (const s of H.checkInvariants()) if (violations.length < 25) violations.push(`T=${T.toFixed(2)} ${s}`);
      if (o.until && o.until()) { i++; break; }
    }
    return { violations, steps: i, t: T };
  };

  /* ---- rendering ---- */
  H.render = () => { if (CFG.shadows) fitShadow(); renderer.render(scene, camera); };   // what frame() does after the steps
  /* average colour [r, g, b] (0..255) of a rectangle in CSS pixels (y from the top), read straight after a render */
  H.sample = (x, y, w, h) => {
    H.render();
    const gl = renderer.getContext(), c = renderer.domElement, sx = c.width / innerWidth, sy = c.height / innerHeight;
    const px = Math.round(x * sx), py = Math.round(c.height - (y + h) * sy), pw = Math.max(1, Math.round(w * sx)), ph = Math.max(1, Math.round(h * sy));
    const buf = new Uint8Array(pw * ph * 4); gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const s = [0, 0, 0]; for (let i = 0; i < buf.length; i += 4) { s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; }
    const n = buf.length / 4; return s.map(x => x / n);
  };
  /* Geometry leaks. Every geometry reachable at a check is remembered; one that later is neither reachable nor
     disposed was dropped without disposeTree — a leak (the wallpaper never restarts). */
  H.geoSeen = new Set();
  H.geometries = () => {
    H.render();
    const g = new Set();
    scene.traverse(x => { if (x.geometry) g.add(x.geometry); });
    for (const x of g) H.geoSeen.add(x);
    const caches = H.GEO_CACHES(), leaked = [...H.geoSeen].filter(x => !g.has(x) && !x.__disposed && !caches.includes(x));
    return { gpu: renderer.info.memory.geometries, reach: g.size, leaked: leaked.length, leakedTypes: [...new Set(leaked.map(x => x.type))] };
  };
  // module-level geometry caches that are kept on purpose while nothing in the scene uses them
  H.GEO_CACHES = () => [];
  H.props = (o) => window.wallpaperPropertyListener.applyUserProperties(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }])));
})();

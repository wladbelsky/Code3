'use strict';
/* ===== Scenes on site: what a call looks like where it happens =====
   SCENES.open(call) when a call comes in, close() when it is closed (whatever it placed goes back to its pool).
   - FireScene (structure): flames and black smoke out of the front windows and the roof; it grows (heat 0.35 → 1) until
     water is on it: the engine's line from the front yard, the ladder's aerial raised over the roof (both once the unit
     has been on scene a few seconds), each taking the heat down; knocked down at 0, then white steam for a while.
     `ready` (the dispatcher may start clearing): out for 20 s.
   - CarFireScene (vehicle): a car at the curb burning from the hood until the engine's water puts it out; charred after.
   - CrashScene (mva): two cars at the curb near the crossing, at angles, steam from one radiator, cones.
   Crews (CREW): figures from one InstancedMesh pool stand by a unit while it is on scene (on the sidewalk side), the
   nozzle crew in the yard of a burning house. Everything is pooled: nothing is built per call.
   Particles: FX.fire (additive flames), FX.smoke (black smoke, white steam), FX.water (the streams: ballistic arcs). */
const SCENES = {
  list: [],
  open(c) {
    const k = c.type.kind, S = k === 'structure' && c.site.house ? new FireScene(c) : k === 'vehicle' ? new CarFireScene(c) : k === 'mva' ? new CrashScene(c) : k === 'pursuit' ? new PursuitScene(c) : null;
    if (S) { c.scene = S; this.list.push(S); }
  },
  update(dt) {
    for (const s of this.list) s.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].done) this.list.splice(i, 1);
    CREW.update(dt);
  },
  reset() { for (const s of this.list) s.close(true); this.list.length = 0; CREW.clear(); }
};
/* the direction a site's units drive along its curb (sign along the street) and the curb's offset from the centre line */
const siteSg = s => DIRV[s.ax === 'ew' ? (s.side > 0 ? 'E' : 'W') : (s.side > 0 ? 'N' : 'S')][s.ax === 'ew' ? 0 : 1];
const siteXZ = (s, a, off) => s.ax === 'ew' ? [a, s.at + s.side * off] : [s.at + s.side * off, a];
const _sp = new V3(), _sv = new V3(), _st = new V3();
/* a water arc from p to t (stream particles at ~rate/s; the arc's shape from a horizontal speed) */
function waterArc(p, t, acc, dt, rate) {
  acc.w = (acc.w || 0) + dt * rate;
  while (acc.w > 1) {
    acc.w--;
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz), vh = 13, tt = Math.max(0.25, d / vh), dy = t.y - p.y;
    _sv.set(dx / tt, (dy + 4.9 * tt * tt) / tt, dz / tt).multiplyScalar(rand(0.96, 1.04));
    FX.water.spawn(p, { v: _sv, rise: -9.8, s0: 0.22, s1: 0.9, life: tt * 1.05, a0: 0.75, color: 0xdcecff });
  }
}

/* ---- the house fire ---- */
class FireScene {
  constructor(c) {
    this.c = c; const h = this.h = c.site.house; this.heat = 0.35; this.out = false; this.outAt = 0; this.done = false; this.acc = {}; this.water = 0; this.big = false; this.bigK = 0; this.strikeT = 0;
    const R = h.rot ? -1 : 1, wp = (lx, ly, lz) => new V3(h.x + lx * R, ly, h.z + lz * R);
    // emitters: front windows (both storeys), the roof
    this.em = [wp(-h.w / 4, h.h * 0.55, h.d / 2 + 0.3), wp(h.w / 4, h.h * 0.8, h.d / 2 + 0.3), wp(-h.w / 5, h.h + 1.4, 0), wp(h.w / 5, h.h + 1.0, -h.d / 5),
      wp(-h.w / 2 - 0.3, h.h * 0.5, h.d / 5), wp(h.w / 2 + 0.3, h.h * 0.6, -h.d / 5), wp(0, h.h + 2, h.d / 4)];   // (the last three: only on a second alarm)
    this.targets = [wp(0, h.h * 0.6, h.d / 2), wp(-h.w / 2 + 0.5, h.h * 0.55, h.d / 2), wp(h.w / 2 - 0.5, h.h * 0.7, h.d / 2)];   // where the engines' streams aim
    this.yards = [wp(0.8, 0, h.d / 2 + 4), wp(-h.w / 2 - 1.5, 0, h.d / 2 + 3), wp(h.w / 2 + 1.5, 0, h.d / 2 + 3)];                 // their nozzle crews
    this.crews = [];
  }
  /* a second alarm: it gets away from the first companies until the neighbours' are working */
  strike() { this.big = true; this.strikeT = T; }
  dropCrews() { for (const i of this.crews) if (i != null) CREW.drop(i); this.crews = []; }
  get ready() { return this.out && T - this.outAt > 20; }
  update(dt) {
    if (this.closed) { this.done = true; return; }
    // the streams: an engine's line and the ladder's aerial, from a few seconds after they arrive
    let streams = 0, eng = 0, lad = 0, aidOn = false;
    for (const u of this.c.units) {
      if (u.callRef !== this.c || u.state !== 'on_scene' || u.t < 6 || this.out) { if (u.model.aerial && u.callRef === this.c) u.aerialWant = this.out ? 0 : u.aerialWant; continue; }
      if (u.aid) aidOn = true;
      if (u.type === 'engine' && eng < this.yards.length) {
        const i = eng++, y = this.yards[i], tg = this.targets[i], ak = 'e' + i;
        if (this.crews[i] == null) this.crews[i] = CREW.take('fire', y.x, y.z, Math.atan2(tg.x - y.x, tg.z - y.z));
        _sp.set(y.x, 1.2, y.z); waterArc(_sp, tg, this.acc[ak] || (this.acc[ak] = {}), dt, 26); streams++;
      } else if (u.type === 'ladder' && (!u.aid || Math.hypot(u.pos.x - this.c.site.house.x, u.pos.z - this.c.site.house.z) < 34)) {   // (a neighbour's parked too far down the street stands by)
        const e = this.em[2 + Math.min(lad, 1)], ak = 'l' + lad++;
        u.aimAerial(e);
        if (u.aerialK > 0.98) { u.aerialTip(_sp); _st.copy(e).setY(e.y + 0.5); waterArc(_sp, _st, this.acc[ak] || (this.acc[ak] = {}), dt, 30); streams++; }
      }
    }
    if (!this.out) {
      const flare = this.big && !aidOn && T - this.strikeT < 150;   // (the first alarm cannot hold it until help comes)
      this.heat = clamp(this.heat + dt * (flare ? 0.02 : streams ? -0.009 * streams * (this.big ? 0.5 : 1) : 0.01), 0, 1);
      if (this.heat <= 0) { this.out = true; this.outAt = T; this.dropCrews(); }
    }
    if (this.big) this.bigK = Math.min(1, this.bigK + dt / 25);
    const b = this.bigK;
    // flames and black smoke by the heat; after it, steam fading over a minute
    const k = this.heat, steam = this.out ? Math.max(0, 1 - (T - this.outAt) / 60) : streams ? 0.6 : 0;
    this.acc.f = (this.acc.f || 0) + dt * 22 * k * (1 + 0.8 * b); this.acc.s = (this.acc.s || 0) + dt * (5 * k * (1 + b) + 3 * steam);
    while (this.acc.f > 1) {
      this.acc.f--; const e = this.em[Math.floor(Math.random() * (b > 0.2 ? 7 : k > 0.6 ? 4 : 3))];
      _sp.copy(e).add(_sv.set(rand(-0.8, 0.8), rand(-0.2, 0.4), rand(-0.8, 0.8)));
      FX.fire.spawn(_sp, { v: _sv.set(WIND.x * 0.4, rand(2.5, 4.5), WIND.z * 0.4), s0: rand(1.2, 2) * (0.6 + k * 0.6) * (1 + 0.35 * b), s1: rand(2.2, 3.4) * (0.6 + k * 0.6) * (1 + 0.35 * b), life: rand(0.6, 1.0), a0: 0.9, color: Math.random() < 0.5 ? 0xffa040 : 0xff6a20 });
    }
    while (this.acc.s > 1) {
      this.acc.s--; const black = Math.random() < 5 * k / (5 * k + 3 * steam + 1e-6), e = this.em[2 + Math.floor(Math.random() * 2)];
      _sp.copy(e).add(_sv.set(rand(-1, 1), 1.5, rand(-1, 1)));
      FX.smoke.spawn(_sp, { v: _sv.set(WIND.x * 0.9, rand(2.5, 3.5), WIND.z * 0.9), drag: 0.08, s0: 2.5, s1: (black ? 11 : 8) + 4 * b, life: rand(6, 9), a0: black ? 0.6 : 0.35, color: black ? 0x2a2622 : 0xd8d8d4 });
    }
  }
  close() {
    this.closed = true; this.dropCrews();
    for (const u of this.c.units) if (u.model.aerial) u.aerialWant = 0;
  }
}

/* ---- a pursuit: a car comes in off the screen and runs through town with the neighbours' cruisers on its tail (VISITORS, along
   the same route), Air 1 after it; the town's patrols are called in when it is near the end, where it stops at the curb ---- */
const pursuitReady = () => CFG.visitors && SUSPECT.state === 'quarters' && VISITORS.some(v => v.type === 'patrol' && v.state === 'quarters' && !v.aidFor);
const streetAt = (x, z) => { const L = CITY_LAYOUT, s = L.streets.find(q => Math.abs(z - q.z) < EDGE), a = L.avenues.find(q => Math.abs(x - q.x) < EDGE); return (s || a || L.streets[0]).name; };
class PursuitScene {
  constructor(c) { this.c = c; this.on = false; this.halted = false; this.haltT = 0; this.called = false; this.tryT = 0; this.talkT = 0; }
  get ready() { return this.halted && T - this.haltT > 35; }
  /* a place to pass through: a crossing, along one of its two streets */
  place() {
    const L = CITY_LAYOUT, x = pick(L.avenues).x, z = pick(L.streets).z, sg = Math.random() < 0.5;
    return Math.random() < 0.5 ? { ax: 'ew', at: z, a: x, dir: sg ? 'E' : 'W' } : { ax: 'ns', at: x, a: z, dir: sg ? 'N' : 'S' };
  }
  plan(d, o) {
    const to = { ax: d.ax, at: d.at, a: d.a, dir: d.dir }; let best = null;
    for (let n = 0; n < 16; n++) {
      const start = endIn(offEnd()), via = [this.place(), this.place()], w = ROADS.wayVia(start, via, to, [d.curb], o);
      if (!w) continue;
      if (w.len > 450 && w.len < 1000) return { start, via, w };
      if (!best || Math.abs(w.len - 700) < Math.abs(best.w.len - 700)) best = { start, via, w };
    }
    return best;
  }
  /* the cruisers' way: its route, to a curb of their own (a Way carries its driver's progress: one each) */
  wayFor(u, d) { return ROADS.wayVia(this.route.start, this.route.via, { ax: d.ax, at: d.at, a: d.a, dir: d.dir }, [d.curb], u.runOpts(true)); }
  start() {
    const c = this.c, d = siteDest(c.site, 0), p = this.plan(d, SUSPECT.runOpts(true));
    if (!p || !SUSPECT.enter(p.w, d)) return;
    this.on = true; this.route = p; SUSPECT.scene = this; this.talkT = rand(9, 13);
    c.status = 'dispatched'; c.need.push('air1');
    const pool = VISITORS.filter(v => v.type === 'patrol' && v.state === 'quarters' && !v.aidFor).slice(0, 2);
    pool.forEach(v => { v.aidFor = c; }); c.aid = pool; c.aidT = rand(2.8, 3.4);
    if (pool.length) RADIO.say(pool[0].radio, radioLine(PURSUIT_LINES.start, this.vars(pool[0])), 'pd', 2);
  }
  vars(u) {
    const h = SUSPECT.pos.h, q = Math.round(((h % TAU) + TAU) % TAU / (Math.PI / 2)) % 4, onScreen = VIEW.onScreen(_sp.set(SUSPECT.pos.x, 0, SUSPECT.pos.z), 0);
    return Object.assign(DISPATCH.vars(this.c, u), { S: titleCase(onScreen ? streetAt(SUSPECT.pos.x, SUSPECT.pos.z) : lineOf(this.route.start.ax, this.route.start.at).name), X: ['east', 'south', 'west', 'north'][q], N: String(Math.round(Math.max(35, SUSPECT.v * 2.24 + rand(0, 8)))) });
  }
  /* the end of the road: it stands at the curb, the driver out */
  stopped() {
    this.halted = true; this.haltT = T;
    for (let i = 0; i < 14; i++) FX.smoke.spawn(_sp.set(SUSPECT.pos.x + rand(-2, 2), 0.4, SUSPECT.pos.z + rand(-2, 2)), { v: _sv.set(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)), s0: 1, s1: 4, life: rand(1, 2), a0: 0.45, color: 0xc8c4bc });
    const u = this.c.units.find(x => x.callRef === this.c && !x.air && x.aid) || this.c.units.find(x => x.callRef === this.c);
    if (u) RADIO.say(u.radio, radioLine(PURSUIT_LINES.stop, this.vars(u)), 'pd', 2);
  }
  update(dt) {
    if (this.closed) { this.done = true; return; }
    const c = this.c, S = SUSPECT;
    if (!this.on) { if (S.state === 'quarters' && (this.tryT -= dt) <= 0) { this.tryT = 1; this.start(); } return; }
    const air = c.units.find(u => u.air && u.callRef === c);
    if (air && air.goal && air.goal.kind === 'orbit') { air.goal.follow = !this.halted; air.goal.x = S.pos.x; air.goal.z = S.pos.z; }
    if (!this.called && S.way && S.way.len - S.way.s < 260) { this.called = true; c.need.push('patrol', 'patrol'); }   // (the town's cars: to meet it where it ends up)
    if (!this.halted && (this.talkT -= dt) <= 0) {
      this.talkT = rand(8, 13);
      const on = c.units.filter(u => u.callRef === c && u.state === 'responding' && u.aid), up = air && air.state === 'on_scene' && Math.random() < 0.4;
      if (up) RADIO.say(air.radio, radioLine(PURSUIT_LINES.air, this.vars(air)), 'pd', 1);
      else if (on.length) RADIO.say(on[0].radio, radioLine(PURSUIT_LINES.chase, this.vars(on[0])), 'pd', 1);
    }
  }
  close() { this.closed = true; if (SUSPECT.scene === this) SUSPECT.gone(); }
}

/* ---- pooled props: crash / burning cars, cones ---- */
const PROPS = {
  cars: null, burnt: null, cones: null,
  build() {
    this.cars = [0x8a1e1e, 0x1e3a6a, 0xd8d8d4, 0x2f4a36].map((c, i) => { const g = carModel(i % 2 ? 'suv' : 'sedan', c); mergeStatic(g, []); g.visible = false; scene.add(g); return { g, used: false }; });
    this.burnt = [0, 1].map(() => { const g = carModel('sedan', 0x1e1c1a); mergeStatic(g, []); g.visible = false; scene.add(g); return { g, used: false }; });
    const cg = new THREE.ConeGeometry(0.22, 0.7, 8); cg.translate(0, 0.35, 0);
    this.cones = new THREE.InstancedMesh(cg, M(0xff6a10), 24); this.cones.count = 0; this.cones.castShadow = true; this.cones.frustumCulled = false; scene.add(this.cones);
    this.coneList = [];
  },
  car(list) { const c = list.find(c => !c.used); if (!c) return null; c.used = true; c.g.visible = true; return c; },
  put(c) { if (!c) return; c.used = false; c.g.visible = false; },
  cone(x, z) { const c = [x, z]; this.coneList.push(c); this.layCones(); return c; },
  dropCones(list) { this.coneList = this.coneList.filter(c => !list.includes(c)); this.layCones(); },
  layCones() { const m = new THREE.Matrix4(); this.coneList.slice(0, 24).forEach(([x, z], i) => this.cones.setMatrixAt(i, m.makeTranslation(x, 0, z))); this.cones.count = Math.min(24, this.coneList.length); this.cones.instanceMatrix.needsUpdate = true; }
};

/* ---- a car fire at the curb, ahead of where the engine pulls up ---- */
class CarFireScene {
  constructor(c) {
    this.c = c; const s = c.site, sg = siteSg(s); this.acc = {}; this.heat = 0.6; this.out = false; this.done = false;
    this.car = PROPS.car(PROPS.cars);
    const [x, z] = siteXZ(s, s.a + sg * 10, ROAD_W / 2 + 0.6), h = s.ax === 'ew' ? (sg > 0 ? 0 : Math.PI) : (sg > 0 ? -Math.PI / 2 : Math.PI / 2);
    this.pos = new V3(x, 0, z); this.yaw = h;
    if (this.car) { this.car.g.position.set(x, 0, z); this.car.g.rotation.set(0, h, 0); }
    this.hood = new V3(x + Math.cos(h) * 1.6, 1.1, z - Math.sin(h) * 1.6);
  }
  get ready() { return this.out; }
  update(dt) {
    if (this.closed) { this.done = true; return; }
    let streams = 0;
    for (const u of this.c.units) if (u.callRef === this.c && u.type === 'engine' && u.state === 'on_scene' && u.t > 5 && !this.out) {
      const r = Math.atan2(this.pos.z - u.pos.z, this.pos.x - u.pos.x); _sp.set(u.pos.x + Math.cos(r) * 4, 1.1, u.pos.z + Math.sin(r) * 4);
      waterArc(_sp, this.hood, this.acc, dt, 20); streams++;
    }
    if (!this.out) {
      this.heat = clamp(this.heat + dt * (streams ? -0.02 : 0.004), 0, 1);
      if (this.heat <= 0) { this.out = true; this.outAt = T; const b = PROPS.car(PROPS.burnt); if (b) { b.g.position.copy(this.car ? this.car.g.position : this.pos); b.g.rotation.set(0, this.yaw, 0); PROPS.put(this.car); this.car = b; } }
    }
    const k = this.heat, steam = this.out ? Math.max(0, 1 - (T - this.outAt) / 30) : 0;
    this.acc.f = (this.acc.f || 0) + dt * 14 * k; this.acc.s = (this.acc.s || 0) + dt * (3 * k + 2 * steam);
    while (this.acc.f > 1) { this.acc.f--; _sp.copy(this.hood).add(_sv.set(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))); FX.fire.spawn(_sp, { v: _sv.set(WIND.x * 0.3, rand(2, 3.5), WIND.z * 0.3), s0: 0.9, s1: 1.9, life: rand(0.5, 0.8), a0: 0.9, color: 0xff8a30 }); }
    while (this.acc.s > 1) { this.acc.s--; const black = Math.random() < 3 * k / (3 * k + 2 * steam + 1e-6); FX.smoke.spawn(_sp.copy(this.hood).setY(2), { v: _sv.set(WIND.x * 0.9, rand(2, 3), WIND.z * 0.9), drag: 0.08, s0: 1.5, s1: 6, life: rand(4, 6), a0: black ? 0.55 : 0.3, color: black ? 0x2a2622 : 0xd8d8d4 }); }
  }
  close() { this.closed = true; PROPS.put(this.car); this.car = null; }
}

/* ---- a crash near the crossing: two cars at the curb at angles, steam, cones ---- */
class CrashScene {
  constructor(c) {
    this.c = c; const s = c.site, sg = siteSg(s), cross = (s.ax === 'ew' ? CITY_LAYOUT.avenues.map(v => v.x) : CITY_LAYOUT.streets.map(v => v.z)).reduce((b, v) => Math.abs(v - s.a) < Math.abs(b - s.a) ? v : b);
    const away = Math.sign(s.a - cross) || 1, base = s.ax === 'ew' ? (sg > 0 ? 0 : Math.PI) : (sg > 0 ? -Math.PI / 2 : Math.PI / 2);
    this.done = false; this.acc = {}; this.cars = []; this.cones = [];
    for (const [d, off, turn] of [[11, ROAD_W / 2 + 0.4, 0.5], [17, ROAD_W / 2 + 0.9, -0.35]]) {
      const car = PROPS.car(PROPS.cars); if (!car) continue;
      const [x, z] = siteXZ(s, cross + away * d, off); car.g.position.set(x, 0, z); car.g.rotation.set(0, base + turn, 0.04); this.cars.push(car);
    }
    const [sx, sz] = siteXZ(s, cross + away * 11, ROAD_W / 2 + 0.4); this.steam = new V3(sx, 1, sz);
    for (const d of [7, 9, 21]) { const [x, z] = siteXZ(s, cross + away * d, ROAD_W / 2 - 1.2); this.cones.push(PROPS.cone(x, z)); }
  }
  get ready() { return true; }
  update(dt) {
    if (this.closed) { this.done = true; return; }
    this.acc.s = (this.acc.s || 0) + dt * (T - this.c.t < 120 ? 1.5 : 0);
    while (this.acc.s > 1) { this.acc.s--; FX.smoke.spawn(this.steam, { v: _sv.set(WIND.x * 0.6, rand(1.2, 2), WIND.z * 0.6), drag: 0.1, s0: 0.8, s1: 3.5, life: rand(3, 4), a0: 0.35, color: 0xe0e0dc }); }
  }
  close() { this.closed = true; for (const c of this.cars) PROPS.put(c); this.cars.length = 0; PROPS.dropCones(this.cones); this.cones.length = 0; }
}

/* ===== Crews: figures standing by their unit on scene (one InstancedMesh, colour per service) ===== */
const CREW_COLORS = { fire: 0xc8a050, ems: 0x2c4470, pd: 0x1c2638 };
const CREW = {
  mesh: null, n: 60, used: [], byUnit: new Map(),
  build() {
    const geo = vegGeometry([[new THREE.CylinderGeometry(0.2, 0.24, 1.15, 6), 0xffffff, 0, 0.58, 0], [new THREE.SphereGeometry(0.17, 6, 4), 0xe8d8c8, 0, 1.38, 0], [new THREE.CylinderGeometry(0.22, 0.22, 0.12, 6), 0xffffff, 0, 1.53, 0]]);
    this.mesh = new THREE.InstancedMesh(geo, VEG_MAT, this.n); this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < this.n; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, new THREE.Color()); this.used.push(false); }
    scene.add(this.mesh);
  },
  take(svc, x, z, yaw) {
    const i = this.used.indexOf(false); if (i < 0) return null; this.used[i] = true;
    const m = new THREE.Matrix4().makeRotationY(yaw || 0).setPosition(x, 0, z), c = new THREE.Color(CREW_COLORS[svc]);
    this.mesh.setMatrixAt(i, m); this.mesh.setColorAt(i, c); this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    return i;
  },
  drop(i) { if (i == null || !this.used[i]) return; this.used[i] = false; this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); this.mesh.instanceMatrix.needsUpdate = true; },
  clear() { for (let i = 0; i < this.n; i++) this.drop(i); this.byUnit.clear(); },
  /* a unit standing on scene gets its crew beside it on the sidewalk side (2 for fire / EMS, 1 for police); gone when it leaves */
  update() {
    for (const u of MOVERS) {
      const has = this.byUnit.get(u), on = u.state === 'on_scene' && !u.way && u.t > 3;
      if (on && !has) {
        const h = u.pos.h, rx = -Math.sin(h), rz = Math.cos(h), cx = Math.cos(h), cz = Math.sin(h), n = u.spec.svc === 'pd' ? 1 : 2, list = [];
        for (let k = 0; k < n; k++) { const along = (k - (n - 1) / 2) * 2.2 + rand(-0.4, 0.4), side = u.wid / 2 + 1.0 + rand(0, 0.6); list.push(this.take(u.spec.svc, u.pos.x + rx * side + cx * along, u.pos.z + rz * side + cz * along, rand(0, TAU))); }
        this.byUnit.set(u, list);
      } else if (!on && has) { has.forEach(i => this.drop(i)); this.byUnit.delete(u); }
    }
  }
};

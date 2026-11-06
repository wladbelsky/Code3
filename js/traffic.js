'use strict';
/* ===== Civilian traffic: cars passing through town, giving way to lights and sirens =====
   A pool of cars (CIV_MAX, built once); CFG.traffic of them on the streets by day, fewer at night. Each comes in from
   off the screen along a street and leaves the same way on another (ROADS.way: the right lane), at the speed limit.
   Rules per step:
   - following: stops within the gap to whoever is ahead in its lane (units too), allowing for their braking;
   - crossings (the Way's `boxes`, found once): red / yellow it can stop for → stops at the line; all-way stops → a full
     stop, then in turn. Into a crossing's box only when nothing in it crosses its move (CIV_BOXES: the cars committed
     to it; same entry heading or opposite straights don't cross); committed, it clears the box whatever comes;
   - units: cars give way to them (`unitCap`: short of where a unit is going, if it can still stop; else it clears the
     way); a unit gives way to no car, it only never drives into one on its path (Unit.yieldCap); a code-3 unit coming up within 70 m: the car pulls over to the curb and stops (unless
     something stands at the curb: then it just slows) until the unit is by; the unit passes on the centre line;
   - obstacles at the curb (units on scene, wrecks): it eases left round them, slowly.
   Nothing is built per spawn: the Way is plain arrays; the model is the car's own for good.                      */
const CIV_MAX = 24, CIV_V = [10, 12.5];
let CIVS = [];
const CIV_BOXES = new Map(), UNIT_PTS = [];   // crossing key → Set of the cars committed to its box
const _tw = { x: 0, z: 0, h: 0, v: 0 }, _tob = { x: 0, z: 0, h: 0, v: 0 };
/* do two moves through a box cross? (same entry: one follows the other; opposite straights pass each other) */
const boxConflict = (a, b) => a.hIn !== b.hIn && !(a.hIn === a.hOut && b.hIn === b.hOut && a.hIn === OPP[b.hIn]);
const headingDir = h => dirOf(Math.cos(h), Math.sin(h));
/* on a street's carriageway */
const inStreet = (x, z) => CITY_LAYOUT.streets.some(s => Math.abs(z - s.z) < ROAD_W / 2) || CITY_LAYOUT.avenues.some(a => Math.abs(x - a.x) < ROAD_W / 2);
/* on a street's carriageway heading along it (not turning, not pulling out of a bay or a lot) */
const alongStreet = (x, z, h) => (Math.abs(Math.cos(h)) > 0.97 && CITY_LAYOUT.streets.some(s => Math.abs(z - s.z) < ROAD_W / 2)) || (Math.abs(Math.sin(h)) > 0.97 && CITY_LAYOUT.avenues.some(a => Math.abs(x - a.x) < ROAD_W / 2));
/* the crossing boxes along a way: { key, x, z, s0, s1 (way distances in / out), sig, axis, hIn, hOut } */
function wayBoxes(w) {
  const out = [], L = CITY_LAYOUT;
  let cur = null;
  for (let i = 0; i < w.n; i++) {
    const x = Math.round(w.X[i] / 50) * 50, z = Math.round(w.Z[i] / 50) * 50;
    const inBox = Math.abs(w.X[i] - x) < EDGE && Math.abs(w.Z[i] - z) < EDGE && L.avenues.some(a => a.x === x) && L.streets.some(s => s.z === z);
    if (inBox && (!cur || cur.key !== x + ',' + z)) {
      cur = { key: x + ',' + z, x, z, s0: w.S[i], s1: w.S[i], hIn: headingDir(w.H[i]), sig: L.signals.some(s => s[0] === x && s[1] === z) };
      cur.axis = cur.hIn === 'E' || cur.hIn === 'W' ? 'ew' : 'ns'; out.push(cur);
    } else if (inBox) cur.s1 = w.S[i];
    else if (cur) { cur.hOut = headingDir(w.H[i]); cur = null; }
  }
  for (const b of out) if (!b.hOut) b.hOut = b.hIn;
  return out;
}

class Civ {
  constructor(i) {
    this.i = i; const g = randomCar(); this.len = g.userData.len; this.wid = g.userData.wid;
    const L2 = this.len / 2, W2 = this.wid / 2 - 0.25;
    this.heads = navLights(g, [[L2 + 0.1, 0.75, W2, 0xfff2d8], [L2 + 0.1, 0.75, -W2, 0xfff2d8], [-L2 - 0.1, 0.85, W2, 0xff2010], [-L2 - 0.1, 0.85, -W2, 0xff2010]], null, 0.75).material;
    mergeStatic(g, []);
    g.visible = false; scene.add(g); this.model = { group: g };
    this.on = false; this.pos = { x: 0, z: 0, h: 0 }; this.v = 0; this.lat = 0; this.way = null; this.yaw = 0;
    this.yieldTo = null; this.boxIn = null; this.stopAt = null; this.stopT = 0; this.pulled = false;
  }
  get moving() { return this.on; }
  get state() { return this.on ? 'driving' : 'parked'; }
  /* a start off the screen on a street, heading into town, and an end off the screen on another */
  spawn() {
    const w = throughWay({ vmax: rand(...CIV_V), alat: 2.2, vEnd: 8 });
    if (!w) return false;
    const p = w.at(0, _tw);
    if ([...MOVERS, ...CIVS].some(o => o !== this && o.model.group.visible && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 30)) return false;
    this.start(w); return true;
  }
  start(w) {
    const p = w.at(0, _tw);
    w.boxes = wayBoxes(w); this.way = w; this.bi = 0; this.on = true; this.v = p.v * 0.8; this.lat = 0; this.yaw = p.h; this.pulled = false;
    this.boxIn = null; this.stopAt = null; this.stillT = 0; this.pushed = -9; this.backed = 0;
    this.model.group.visible = true; this.place(p.x, p.z, p.h, 0); TRAFFIC.spawned++;
  }
  despawn() { this.leaveBox(); this.on = false; this.way = null; this.model.group.visible = false; this.v = 0; }
  leaveBox() { if (this.boxIn) { const s = CIV_BOXES.get(this.boxIn.key); if (s) s.delete(this); this.boxIn = null; } }
  /* the code-3 unit coming up on it, if any (lights on, moving, within 70 m behind / toward it, near its line, going on past) */
  siren() {
    for (const u of MOVERS) {
      if (!u.lights || !u.model.group.visible || u.v < 2 || (u.state !== 'responding' && u.state !== 'transporting')) continue;
      const dx = this.pos.x - u.pos.x, dz = this.pos.z - u.pos.z, c = Math.cos(u.pos.h), s = Math.sin(u.pos.h), along = dx * c + dz * s;
      const by = u.latOff < -0.3 || u.v < 6 ? 10 : 3;   // (till its tail is by — well by while it is still coming back in off the centre line or slowing just ahead)
      if (along > -(u.len + this.len) / 2 - by && along < 70 && Math.abs(-dx * s + dz * c) < 30 && (!u.way || u.way.len - u.way.s > along + 30)) return u;   // (not one stopping right here: drive on out of its way)
    }
    return null;
  }
  /* something standing at the curb on its right near here (a unit on scene, a wreck): its lateral distance from the lane
     and the clearance it needs → how far to ease left; `curb`: anything at the curb within 12 m, or a driveway (no pulling over) */
  obstacles(out) {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h); let shift = 0, curb = false;
    const test = (x, z, r) => {
      const dx = x - this.pos.x, dz = z - this.pos.z, along = dx * c + dz * s, lat = -dx * s + dz * c + this.lat;   // (from the lane's centre)
      if (along < -8 || along > 30 || lat < 0 || lat > 6) return;
      if (Math.abs(along) < 12) curb = true;
      const need = r + this.wid / 2 + 0.3; if (lat < need) shift = Math.max(shift, need - lat);
    };
    for (const u of UNITS) if (u.state === 'on_scene' && !u.way && u.model.group.visible) test(u.pos.x, u.pos.z, u.wid / 2);
    for (const p of PROPS.cars) if (p.used) test(p.g.position.x, p.g.position.z, 2.4);
    for (const p of PROPS.burnt) if (p.used) test(p.g.position.x, p.g.position.z, 1.1);
    // a driveway or a gate at its right (the curb it would pull over onto): not there
    const rx = this.pos.x - s * 3.5, rz = this.pos.z + c * 3.5;
    if (CITY.drives.some(r => rx > r[0] - 6 && rx < r[2] + 6 && rz > r[1] - 6 && rz < r[3] + 6)) curb = true;
    out.shift = Math.min(1.3, shift); out.curb = curb;
    return out;
  }
  /* who is close behind it in its lane (within `gap` m bumper to bumper), if anyone */
  behindBy(gap) {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h);
    return [...MOVERS, ...CIVS].find(o => { if (o === this || !o.model.group.visible) return false; const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s;
      return along < 0 && along > -(this.len + o.len) / 2 - gap && Math.abs(-dx * s + dz * c) < (this.wid + o.wid) / 2 + 0.3; }) || null;
  }
  /* the vehicle ahead in its lane (units and cars), as Unit.gapCap */
  gapCap() {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h); let cap = Infinity; this.blocker = null;
    for (const L of [MOVERS, CIVS]) for (const o of L) {
      if (o === this || !o.model.group.visible || (L === MOVERS && (o.state === 'quarters' || (o.state === 'on_scene' && !o.way)))) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s, lat = Math.abs(-dx * s + dz * c);
      const dh = Math.abs(angleWrap(o.pos.h - this.pos.h));   // (one pulling out into the lane at an angle counts as in it)
      if (along <= 0 || along > 50 || lat > (this.wid + o.wid) / 2 + 0.1 + (dh > 0.15 && o.v > 0.3 ? 1.5 : 0) || dh > 1.6) continue;   // (not oncoming: crossing paths are the boxes' and the units' business)
      const gap = along - (this.len + o.len) / 2 - 2.5, ov = o.v * Math.cos(o.pos.h - this.pos.h);
      const k = ov >= 0 ? Math.sqrt(7 * (Math.max(0, gap) + ov * ov / 10)) : Math.max(0, Math.sqrt(7 * Math.max(0, gap)) + ov);
      if (k < cap) { cap = k; this.blocker = o; }
    }
    return cap;
  }
  /* the next crossing: stop at its line unless the light / the turn / the box lets it in */
  boxCap(w, held) {
    while (this.bi < w.boxes.length && w.s - this.len / 2 > w.boxes[this.bi].s1) { if (this.boxIn === w.boxes[this.bi]) this.leaveBox(); this.bi++; }
    const b = w.boxes[this.bi]; if (!b) return Infinity;
    const line = b.s0 - this.len / 2 - 1, d = line - w.s, inside = w.s + this.len / 2 > b.s0;
    if (inside && this.boxIn !== b && this.intruded !== b) { this.intruded = b; TRAFFIC.intruded++; }   // (in without being let in: the tests count it)
    // standing in a queue short of the box (whoever is ahead stands too): no claim on it — a claim it cannot use holds up the
    // cross traffic, and that may be what the one ahead waits for
    const queued = !inside && this.v < 0.5 && !!this.blocker && this.blocker.v < 0.5;
    if (this.boxIn === b) {   // committed: on through, unless it can still stop short and must after all
      if (inside || !(held || queued || (b.sig && CITY.signal(b.axis) !== 'g')) || this.v * this.v / 8 > d) return Infinity;
      this.leaveBox();
    }
    if (d > 40) return Infinity;
    const stopCap = Math.sqrt(2 * 3 * Math.max(0, d));
    if (held || queued) return stopCap;
    if (b.sig) { if (this.red(b, d)) return stopCap; }
    else {   // an all-way stop: a full stop at the line first, then in turn
      if (this.stopAt !== b) { if (d < 1.2 && this.v < 0.2) { this.stopAt = b; this.stopT = T; } return stopCap; }
      if (T - this.stopT < 0.8 || CIVS.some(o => o !== this && o.stopAt && o.stopAt.key === b.key && o.stopT < this.stopT && boxConflict(o.stopAt, b))) return stopCap;
    }
    const set = CIV_BOXES.get(b.key) || CIV_BOXES.set(b.key, new Set()).get(b.key);
    for (const o of set) if (boxConflict(o.boxIn, b)) return stopCap;
    // a unit in the box, at its line (free to go) or due in it within ~3.5 s, on a move across this one — one in the box
    // always, the others unless giving way to this car (Unit.yieldCap decided it this step); one queued further back waits its turn
    for (const u of MOVERS) {
      const uw = u.way; if (!uw || uw.rev || !u.model.group.visible) continue;
      const ub = (uw.boxes || (uw.boxes = wayBoxes(uw))).find(x => x.key === b.key && uw.s - u.len / 2 < x.s1), to = ub && ub.s0 - uw.s - u.len / 2;
      const go = !u.held && (!ub || !ub.sig || u.lights || CITY.signal(ub.axis) === 'g'), waits = u.yieldTo === this && this.yieldTo !== u;   // (code 1 coming up to a red: it will stop; one held for its zone stays put)
      if (ub && (to < 0 || (go && !waits && (to < 3 || (u.v > 1.5 && to / u.v < 3.5)))) && boxConflict(ub, b)) return stopCap;   // (one in the box: always)
    }
    set.add(this); this.boxIn = b; this.stopAt = null;
    return Infinity;
  }
  /* units give way to no car: it stops short of where a unit is going (its way ~3.5 s ahead; one held at a red light or
     waiting for its zone claims only where it stands, one about to move off 10 m) — if it still can, or is braking for it
     already; on that path or past stopping, it clears it (the unit holds back: Unit.yieldCap). Merging into one lane,
     the one nearer the merge goes first. */
  unitCap() {
    let cap = Infinity; const w = this.way, hj = clamp(this.v * 3, 12, 40), prev = this.yieldTo; this.yieldTo = null;
    for (const u of MOVERS) {
      const uw = u.way; if (!uw || uw.rev || !u.model.group.visible || Math.abs(u.pos.x - this.pos.x) + Math.abs(u.pos.z - this.pos.z) > 110) continue;
      const dh = Math.abs(angleWrap(u.pos.h - this.pos.h)), along = (u.pos.x - this.pos.x) * Math.cos(this.pos.h) + (u.pos.z - this.pos.z) * Math.sin(this.pos.h);
      if ((dh < 0.5 && along > 0) || (dh < 1.2 && along < 0)) continue;   // (one ahead going its way: followed; one behind: it follows)
      const hk = u.v > 0.5 ? clamp(u.v * 3.5, 14, 45) : u.held ? 0 : 10, R = (this.wid + u.wid) / 2 + 0.6, P = UNIT_PTS; P.length = 0;
      const e = u.len / 2 - u.wid / 2, ec = Math.cos(u.yaw) * e, es = Math.sin(u.yaw) * e;   // its body: front, middle, back (k −1)
      P.push(u.pos.x + ec, u.pos.z + es, -1, u.pos.h, u.pos.x, u.pos.z, -1, u.pos.h, u.pos.x - ec, u.pos.z - es, -1, u.pos.h);
      for (let k = 1.5; k <= hk && uw.s + k <= uw.len; k += 1.5) { const q = uw.at(uw.s + k, _tob), lo = u.latOff || 0; P.push(q.x - Math.sin(q.h) * lo, q.z + Math.cos(q.h) * lo, k, q.h); }
      for (let j = 0; j <= hj && w.s + j <= w.len; j += 1.5) {
        const q = j ? w.at(w.s + j, _tob) : this.pos; let hit = -1;
        for (let i = 0; i < P.length; i += 4) if (Math.hypot(q.x - P[i], q.z - P[i + 1]) < (Math.abs(angleWrap(P[i + 3] - q.h)) > 2.6 || (P[i + 2] < 0 && this.squeeze) ? R - 0.75 : R)) { hit = i; break; }   // (head-on in the next lane: they pass; squeezing by a unit's nose: no margin)
        if (hit < 0) continue;
        if (P[hit + 2] >= 0 && Math.abs(angleWrap(P[hit + 3] - q.h)) < 0.6 && j < P[hit + 2]) break;   // (a merge it is ahead in: the unit follows)
        const d = j - this.len / 2 - 2;   // (the unit's body itself, where it is: always stop short — never drive into it)
        if (P[hit + 2] < 0 || (j > this.len / 2 + 1 && (prev === u || d > this.v * this.v / 10 + 0.3))) { const c = Math.sqrt(7 * Math.max(0, d)); if (c < cap) { cap = c; this.yieldTo = u; } }
        break;
      }
    }
    return cap;
  }
  red(b, d) { return CITY.signal(b.axis) !== 'g' && this.v * this.v / 9 < d + 0.5; }   // (one that can no longer stop goes on)
  update(dt) {
    if (!this.on) return;
    const w = this.way, p = w.at(w.s, _tw), ob = this.obstacles(_tob);
    let vt = p.v, latT = -ob.shift;
    if (ob.shift > 0) vt = Math.min(vt, 6);
    // a code-3 unit coming: pull over and stop (or, with the curb taken, slow down) until it is by; not inside a box
    const u = this.siren();
    this.pulled = !!u && !(this.boxIn && w.s + this.len / 2 > this.boxIn.s0);   // (its nose in the box: it clears it first) if (this.pulled) TRAFFIC.pulls++;
    if (this.pulled) { if (ob.curb) vt = Math.min(vt, 4); else { latT = 1.2; vt = 0; } }
    const g = this.gapCap(), bx = this.boxCap(w, this.pulled && !ob.curb), y = this.unitCap();
    this.why = vt < 0.5 && this.pulled ? 'pull' : g < 0.5 ? 'gap' : bx < 0.5 ? 'box' : y < 0.5 ? 'yield' : '';
    vt = Math.min(vt, g, bx, y);
    this.v = this.v < vt ? Math.min(vt, this.v + 2.2 * dt) : Math.max(vt, this.v - (this.pulled ? 4.5 : 5) * dt);
    this.lat += clamp(latT - this.lat, -1.2 * dt, 1.2 * dt);
    this.stillT = this.v < 0.1 ? this.stillT + dt : 0;
    // nose to nose with a unit that waits for it (it turned across in front of the car): back off (up to 8 m) to let it by
    const jw = this.yieldTo || (this.blocker && this.blocker.spec ? this.blocker : null);   // (or a unit it follows that waits for it: one cutting in to its curb across the lane)
    this.jamT = jw && jw.yieldTo === this && this.v < 0.2 ? (this.jamT || 0) + dt : 0;
    if (this.v > 1) this.backed = 0;
    const back = (this.jamT > 1.5 || T - (this.pushed || -9) < 0.2) && (this.backed || 0) < 8, b = back && this.behindBy(1.5);   // (the car behind backs off too)
    if (b && b.pushed !== undefined) b.pushed = T;
    // jammed with no room to back (a unit close behind, or 8 m backed already): squeeze by the unit's nose, no margin
    if (this.jamT > 3 && (!back || (!!b && b.pushed === undefined))) this.squeezeT = T;
    this.squeeze = T - (this.squeezeT || -99) < 6;   // (for a while: moving clears jamT, and it must not stop again halfway by)
    if (back && !b) { this.v = 0; w.s = Math.max(0, w.s - dt); this.backed = (this.backed || 0) + dt; }
    w.s = Math.min(w.len, w.s + this.v * dt);
    const q = w.at(w.s, _tw); this.place(q.x, q.z, q.h, dt);
    if (w.done) this.despawn();
  }
  /* on the lane at (x, z), heading h, eased `lat` m to its right; the body turns no faster than a car */
  place(x, z, h, dt) {
    x -= Math.sin(h) * this.lat; z += Math.cos(h) * this.lat;
    const turn = Math.max(0.35, this.v / 4.5) * (dt || 0);
    this.yaw = dt ? this.yaw + clamp(angleWrap(h - this.yaw), -turn, turn) : h;
    this.pos.x = x; this.pos.z = z; this.pos.h = h;
    this.model.group.position.set(x, 0, z); this.model.group.rotation.y = -this.yaw;
    this.heads.userData.on = 1;
  }
}
const _tvp = new V3();

/* how many cars by the hour: a quiet night, a morning and an evening rush */
function trafficWanted() {
  const d = getNow(), h = d.getHours() + d.getMinutes() / 60;
  const k = h < 5 ? 0.25 : h < 6.5 ? lerp(0.25, 1, (h - 5) / 1.5) : h < 21 ? 1 : h < 24 ? lerp(1, 0.35, (h - 21) / 3) : 0.25;
  return Math.min(CIV_MAX, Math.round(clamp(CFG.traffic, 0, CIV_MAX) * k * (1 + LOAD.level * 0.35)));   // (a busy night: more about)
}
const TRAFFIC = {
  spawnT: 3, spawned: 0, intruded: 0, pulls: 0,
  update(dt) {
    for (const c of CIVS) c.update(dt);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const on = CIVS.filter(c => c.on).length, c = CIVS.find(c => !c.on), want = trafficWanted();
      this.spawnT = on < want - 3 ? rand(0.5, 1.2) : rand(1.5, 3.5);   // (well short of it: catch up quicker)
      if (c && on < want) for (let n = 0; n < 4 && !c.spawn(); n++);   // (an end too close to another car: try another)
    }
  },
  /* a car that has stood still a long while off the screen goes (it never should: a safety net, the tests watch it) */
  tidy() { for (const c of CIVS) if (c.on && c.stillT > 90 && !VIEW.onScreen(_tvp.set(c.pos.x, 0, c.pos.z), 0.1)) c.despawn(); }
};
function buildTraffic() { CIVS = []; for (let i = 0; i < CIV_MAX; i++) CIVS.push(new Civ(i)); }

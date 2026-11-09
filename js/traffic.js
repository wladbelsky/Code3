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
  constructor(i, kind) {
    this.i = i; this.kind = kind || 'car'; this.spec = null; this.bars = [];
    let g;
    if (kind) { const m = ROUTINE[kind].model(); g = m.group; this.bars = m.bars; this.len = m.len; this.wid = m.wid; }
    else { g = randomCar(); this.len = g.userData.len; this.wid = g.userData.wid; }
    const L2 = this.len / 2, W2 = this.wid / 2 - 0.25, hy = kind ? 1.1 : 0.75;
    this.heads = navLights(g, [[L2 + 0.1, hy, W2, 0xfff2d8], [L2 + 0.1, hy, -W2, 0xfff2d8], [-L2 - 0.1, hy + 0.1, W2, 0xff2010], [-L2 - 0.1, hy + 0.1, -W2, 0xff2010]], null, 0.75).material;
    mergeStatic(g, this.bars.map(b => b.mesh));
    g.visible = false; scene.add(g); this.model = { group: g };
    this.on = false; this.pos = { x: 0, z: 0, h: 0 }; this.v = 0; this.lat = 0; this.way = null; this.yaw = 0;
    this.yieldTo = null; this.boxIn = null; this.stopAt = null; this.stopT = 0; this.pulled = false; this.stops = null; this.dwellT = 0; this.atStop = false;
    this.flash(false);
  }
  /* its warning lights (a routine vehicle's): on at a stop, the two sides alternating (the van's hazards together) */
  flash(on) { const a = ((T * 2.2) % 1) < 0.5 ? 0 : 1, k = on ? a : -1; if (k === this.lastFlash) return; this.lastFlash = k; for (const b of this.bars) b.mesh.material = LB_MATS[b.col][on && b.ph === a ? 1 : 0]; }
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
  /* someone coming up behind in its lane or by it (~4 s), or right alongside */
  comingBy() {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h);
    return [...MOVERS, ...CIVS].some(o => { if (o === this || !o.model.group.visible) return false;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s, lat = Math.abs(-dx * s + dz * c);
      return lat < 4 && Math.cos(o.pos.h - this.pos.h) > 0.5 && along < this.len / 2 + o.len / 2 + 1 && along > -Math.max(25, o.v * 4 + 8) && (o.v > 0.5 || along > -this.len); });
  }
  /* a routine vehicle: a way across town and its stops on it (along a street, in town, clear of the crossings and of
     each other by the kind's spacing) */
  spawnRoutine() {
    if (this.on) return false;
    const R = ROUTINE[this.kind], w = throughWay({ vmax: R.vmax, alat: 2, vEnd: 8 }); if (!w) return false;
    const p0 = w.at(0, _tw);
    if ([...MOVERS, ...CIVS].some(o => o !== this && o.model.group.visible && Math.hypot(o.pos.x - p0.x, o.pos.z - p0.z) < 30)) return false;
    const boxes = wayBoxes(w), stops = [];
    for (let s = 30; s < w.len - 30; s += 2) {
      const q = w.at(s, _tw);
      if (!inTown(q) || !alongStreet(q.x, q.z, q.h) || boxes.some(b => s > b.s0 - 18 - this.len / 2 && s < b.s1 + 14 + this.len / 2)) continue;
      if (R.aside) { const rx = q.x - Math.sin(q.h) * 3.5, rz = q.z + Math.cos(q.h) * 3.5; if (CITY.drives.some(r => rx > r[0] - 6 && rx < r[2] + 6 && rz > r[1] - 6 && rz < r[3] + 6)) continue; }   // (not across a driveway: it pulls over there)
      if (!stops.length || s - stops[stops.length - 1] >= R.spacing) stops.push(s);
    }
    if (stops.length < R.min) return false;
    this.start(w); this.stops = stops.slice(0, R.max); this.dwellT = 0; this.dwellNow = rand(...R.dwell);
    return true;
  }
  start(w) {
    this.leaveBox();   // (a claim from before must not stay behind in CIV_BOXES)
    const p = w.at(0, _tw);
    w.boxes = wayBoxes(w); this.way = w; this.bi = 0; this.on = true; this.v = p.v * 0.8; this.lat = 0; this.yaw = p.h; this.pulled = false;
    this.boxIn = null; this.stopAt = null; this.stillT = 0; this.pushed = -9; this.backed = 0;
    this.model.group.visible = true; this.place(p.x, p.z, p.h, 0); TRAFFIC.spawned++;
  }
  despawn() { this.leaveBox(); this.on = false; this.way = null; this.model.group.visible = false; this.v = 0; this.stops = null; this.atStop = false; this.flash(false); }
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
    for (const o of CIVS) if (o !== this && o.atStop && ROUTINE[o.kind].aside) test(o.pos.x, o.pos.z, o.wid / 2);
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
      if (L === CIVS && o.atStop && ROUTINE[o.kind].aside && o.lat > 0.9) continue;   // (a van stopped aside: eased round, not queued behind)
      if (o === this || !o.model.group.visible || (L === MOVERS && (o.state === 'quarters' || (o.state === 'on_scene' && !o.way)))) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s, lat = Math.abs(-dx * s + dz * c);
      const dh = Math.abs(angleWrap(o.pos.h - this.pos.h));   // (one pulling out into the lane at an angle counts as in it)
      if (along <= 0 || along > 50 || lat > (this.wid + o.wid) / 2 + 0.1 + (dh > 0.15 && o.v > 0.3 ? 1.5 : 0) || dh > 1.6) continue;   // (not oncoming: crossing paths are the boxes' and the units' business)
      const gap = along - (this.len + o.len) / 2 - 2.5, ov = o.v * Math.cos(o.pos.h - this.pos.h);
      const k = gap < -1 ? 0 : ov >= 0 ? Math.sqrt(7 * (Math.max(0, gap) + ov * ov / 10)) : Math.max(0, Math.sqrt(7 * Math.max(0, gap)) + ov);   // (closer than the margin already: stand — not creep on at its pace)
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
      if (inside || !(held || queued || (b.sig && CITY.signal(b.axis) !== 'g') || this.unitDue(b)) || this.v * this.v / 8 > d) return Infinity;   // (a unit come up meanwhile: it lets go of the box while it can still stop)
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
    if (this.unitDue(b)) return stopCap;
    this.boxFor = null;
    set.add(this); this.boxIn = b; this.stopAt = null;
    return Infinity;
  }
  /* a unit in the box, at its line (free to go) or due in it within ~3.5 s, on a move across this one — one in the box
     always, the others unless giving way to this car (Unit.yieldCap decided it this step); one queued further back waits its turn */
  unitDue(b) {
    for (const u of MOVERS) {
      const uw = u.way; if (!uw || uw.rev || !u.model.group.visible) continue;
      const ub = (uw.boxes || (uw.boxes = wayBoxes(uw))).find(x => x.key === b.key && uw.s - u.len / 2 < x.s1), to = ub && ub.s0 - uw.s - u.len / 2;
      const go = !(u.held && u.waitKind === 'zone') && (!ub || !ub.sig || u.lights || CITY.signal(ub.axis) === 'g'), waits = u.yieldTo === this && this.yieldTo !== u;   // (code 1 coming up to a red: it will stop; one held for its zone stays put — not one held for this very box: it goes once it is clear)
      if (ub && (to < 0 || (go && !waits && (to < 3 || (u.v > 1.5 && to / u.v < 3.5)))) && boxConflict(ub, b)) { this.boxFor = u; return true; }   // (one in the box: always; boxFor: whom it waits for — the safety net)
    }
    return false;
  }
  /* units give way to no car: it stops short of where a unit is going (its way ~3.5 s ahead; one held at a red light or
     waiting for its zone claims only where it stands, one about to move off 10 m) — if it still can, or is braking for it
     already; on that path or past stopping, it clears it (the unit holds back: Unit.yieldCap). Merging into one lane,
     the one nearer the merge goes first. */
  unitCap() {
    let cap = Infinity; const w = this.way, hj = clamp(this.v * 3, 12, 40), prev = this.yieldTo, inBox = !!this.boxIn && w.s + this.len / 2 > this.boxIn.s0; this.yieldTo = null;
    for (const u of MOVERS) {
      const uw = u.way; if (!uw || uw.rev || !u.model.group.visible || Math.abs(u.pos.x - this.pos.x) + Math.abs(u.pos.z - this.pos.z) > 110) continue;
      const dh = Math.abs(angleWrap(u.pos.h - this.pos.h)), along = (u.pos.x - this.pos.x) * Math.cos(this.pos.h) + (u.pos.z - this.pos.z) * Math.sin(this.pos.h);
      if ((dh < 0.5 && along > 0) || (dh < 1.2 && along < 0)) continue;   // (one ahead going its way: followed; one behind: it follows)
      const hk = u.v > 0.5 ? clamp(u.v * 3.5, 14, 45) : u.held ? (prev === u ? 6 : 0) : 10, R =   /* (one it already gives way to keeps a few metres: a unit waiting a moment must not let it dart across) */ (this.wid + u.wid) / 2 + 0.6, P = UNIT_PTS; P.length = 0;
      const e = u.len / 2 - u.wid / 2, ec = Math.cos(u.yaw) * e, es = Math.sin(u.yaw) * e;   // its body: front, middle, back (k −1)
      P.push(u.pos.x + ec, u.pos.z + es, -1, u.pos.h, u.pos.x, u.pos.z, -1, u.pos.h, u.pos.x - ec, u.pos.z - es, -1, u.pos.h);
      for (let k = 1.5; k <= hk && uw.s + k <= uw.len; k += 1.5) { const q = uw.at(uw.s + k, _tob), lo = u.latOff || 0; P.push(q.x - Math.sin(q.h) * lo, q.z + Math.cos(q.h) * lo, k, q.h); }
      for (let j = 0; j <= hj && w.s + j <= w.len; j += 1.5) {
        const q = j ? w.at(w.s + j, _tob) : this.pos; let hit = -1;
        for (let i = 0; i < P.length; i += 4) if (Math.hypot(q.x - P[i], q.z - P[i + 1]) < (P[i + 2] < 0 && this.squeeze ? R - 0.75 : Math.abs(angleWrap(P[i + 3] - q.h)) > 2.6 ? R - 0.55 : R)) { hit = i; break; }   // (head-on in the next lane: they pass; squeezing by a unit's nose: no margin)
        if (hit < 0) continue;
        if (P[hit + 2] >= 0 && Math.abs(angleWrap(P[hit + 3] - q.h)) < 0.6 && j < P[hit + 2]) break;   // (a merge it is ahead in: the unit follows)
        const d = j - this.len / 2 - 2;   // (the unit's body itself, where it is: always stop short — never drive into it)
        if (P[hit + 2] < 0 || (!(inBox && w.s + j < this.boxIn.s1 + this.len / 2) && j > this.len / 2 + 1 && (prev === u || this.v < 6 || d > this.v * this.v / 10 + 0.3))) { const c = Math.sqrt(7 * Math.max(0, d)); if (c < cap) { cap = c; this.yieldTo = u; } }   // (in a box it is committed to: it clears it — only the unit's body stops it)
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
    this.atStop = false;
    if (this.stops && this.stops.length) {   // a routine vehicle's stop: in to it, stand there (toward the curb), on again
      const R = ROUTINE[this.kind], d = this.stops[0] - w.s;
      if (d < -2 || (d < 20 && d > 0.6 && (ob.shift > 0 || ob.curb && R.aside))) { this.stops.shift(); this.dwellT = 0; }   // (passed it — or something stands at the curb there: not this one)
      else {
        vt = Math.min(vt, Math.sqrt(2 * 2.2 * Math.max(0, d)) + (d < 0.5 ? 0 : 0.6)); if (d < 25) latT = Math.max(latT, R.lat * clamp(1 - d / 25, 0, 1));
        if (d < 0.6 && this.v < 0.3) { this.atStop = true; vt = 0; latT = R.lat; if ((this.dwellT += dt) > this.dwellNow && !(R.aside && this.comingBy())) { this.stops.shift(); this.dwellT = 0; this.dwellNow = rand(...R.dwell); } }   // (back out into the lane only with nobody coming up behind)
      }
    }
    if (this.bars.length) this.flash(this.atStop || (this.kind === 'garbage' && this.stops && this.stops.length > 0 && inTown(this.pos)));
    // a code-3 unit coming: pull over and stop (or, with the curb taken, slow down) until it is by; not inside a box
    const u = this.siren();
    this.pulled = !!u && !(this.boxIn && w.s + this.len / 2 > this.boxIn.s0);   // (its nose in the box: it clears it first) if (this.pulled) TRAFFIC.pulls++;
    if (this.pulled) { if (ob.curb) { const out = this.lat > 0.3; vt = Math.min(vt, ob.shift > 0 || out ? 0 : 4); latT = Math.max(latT, out ? this.lat : 0); } else { latT = 1.2; vt = 0; } }   // (the curb taken: slow — already over toward it (a driveway come up), stay there and stand; no easing out round something there while the unit goes by on the centre line)
    const g = this.gapCap(), bx = this.boxCap(w, this.pulled && !ob.curb), y = this.unitCap();
    this.why = vt < 0.5 && this.pulled ? 'pull' : g < 0.5 ? 'gap' : bx < 0.5 ? 'box' : y < 0.5 ? 'yield' : '';
    vt = Math.min(vt, g, bx, y);
    this.v = this.v < vt ? Math.min(vt, this.v + 2.2 * dt) : Math.max(vt, this.v - (this.pulled ? 4.5 : 5) * dt);
    this.lat += clamp(latT - this.lat, this.v > 0.5 ? -1.2 * dt : 0, 1.2 * dt);   // (back out toward the lane only while rolling: standing, it would edge into whoever is beside it)
    this.stillT = this.v < 0.1 ? this.stillT + dt : 0;
    // nose to nose with a unit that waits for it (it turned across in front of the car): back off (up to 8 m) to let it by
    const jw = this.yieldTo || (this.blocker && this.blocker.spec ? this.blocker : null);   // (or a unit it follows that waits for it: one cutting in to its curb across the lane)
    this.jamT = jw && jw.yieldTo === this && this.v < 0.2 ? (this.jamT || 0) + dt : 0;
    if (this.v > 1) this.backed = 0;
    const back = (this.jamT > 1.5 || T - (this.pushed || -9) < 0.2) && (this.backed || 0) < 14, b = back && this.behindBy(1.5);   // (the car behind backs off too)
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
/* the routine vehicles: their hours, how often one sets out, its stops (spacing, how many, how long, how far toward the
   curb) — the bus and the garbage truck stop in the lane (the traffic waits), the van pulls aside (the traffic eases round) */
const ROUTINE = {
  bus: { model: busModel, hours: [[7, 8.75], [14.5, 16.5]], every: [150, 300], vmax: 10, spacing: 110, min: 2, max: 3, dwell: [10, 15], lat: 0.5 },
  garbage: { model: garbageModel, hours: [[6.5, 12]], every: [240, 420], vmax: 8, spacing: 32, min: 4, max: 9, dwell: [5, 8], lat: 0.4 },
  delivery: { model: deliveryModel, hours: [[8.5, 18.5]], every: [120, 260], vmax: 11, spacing: 90, min: 1, max: 2, dwell: [18, 30], lat: 1.2, aside: true }
};
const inTown = p => Math.abs(p.x) < CITY_LAYOUT.inner - 12 && Math.abs(p.z) < CITY_LAYOUT.inner - 12;
function trafficWanted() {
  const d = getNow(), h = d.getHours() + d.getMinutes() / 60;
  const k = h < 5 ? 0.25 : h < 6.5 ? lerp(0.25, 1, (h - 5) / 1.5) : h < 21 ? 1 : h < 24 ? lerp(1, 0.35, (h - 21) / 3) : 0.25;
  return Math.min(CIV_MAX, Math.round(clamp(CFG.traffic, 0, CIV_MAX) * k * (1 + LOAD.level * 0.35)));   // (a busy night: more about)
}
const TRAFFIC = {
  spawnT: 3, spawned: 0, intruded: 0, pulls: 0, cleared: 0, unstuck: 0,
  update(dt) {
    for (const c of CIVS) c.update(dt);
    BEAMS.update();
    if (CFG.traffic > 0) for (const k in ROUTINE) {   // the routine vehicles: in their hours, one at a time each
      const R = ROUTINE[k], c = CIVS.find(c => c.kind === k);
      if (!c || c.on || (R.t = (R.t ?? rand(20, 60)) - dt) > 0) continue;
      R.t = rand(...R.every);
      const h = getNow().getHours() + getNow().getMinutes() / 60;
      if (R.hours.some(([a, b]) => h >= a && h < b)) for (let n = 0; n < 4 && !c.spawnRoutine(); n++);
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const on = CIVS.filter(c => c.on && c.kind === 'car').length, c = CIVS.find(c => !c.on && c.kind === 'car'), want = trafficWanted();
      this.spawnT = on < want - 3 ? rand(0.5, 1.2) : rand(1.5, 3.5);   // (well short of it: catch up quicker)
      if (c && on < want) for (let n = 0; n < 4 && !c.spawn(); n++);   // (an end too close to another car: try another)
    }
  },
  /* a car that has stood still a long while off the screen goes (it never should: a safety net, the tests watch it) */
  tidy() {
    for (const c of CIVS) if (c.on && c.stillT > 90 && !VIEW.onScreen(_tvp.set(c.pos.x, 0, c.pos.z), 0.1)) c.despawn();
    // a unit that has not got 3 m on in 25 s, waiting for a car (boxed in, nose to nose, no room to back — or both edging
    // to and fro): the car goes. The rules untangle nearly all of these; the rare rest must not stand there for good (the
    // tests count them: `cleared`)
    for (const u of MOVERS) {
      const w = u.way; if (!w) { u.prog = null; continue; }
      if (!u.prog || u.prog.w !== w || w.s - u.prog.s > 3) { u.prog = { w, s: w.s, t: T }; continue; }
      const c = u.wait; if (T - u.prog.t > 25 && c instanceof Civ && c.on && (c.yieldTo === u || c.blocker === u || c.boxFor === u || (c.stillT > 25 && c.why === 'yield'))) {   // (or a ring through other units: it has stood 25 s giving way)   // (each waiting for the other: not a queue at a red light)
        c.despawn(); this.cleared++; u.prog.t = T; }
      // two units each waiting for the other that long: the first in the roster ignores the other for 6 s (each is in the
      // other's way only by the body circles; centre to centre they fit — the tests' overlap check holds them to that)
      const o = u.wait; if (T - u.prog.t > 20 && o instanceof Unit && o.wait === u && u.i < o.i && !(u.ghostUntil > T)) { u.ghost = o; u.ghostUntil = T + 6; this.unstuck++; u.prog.t = T; }
    }
  }
};
function buildTraffic() { CIVS = []; for (let i = 0; i < CIV_MAX; i++) CIVS.push(new Civ(i)); for (const k in ROUTINE) CIVS.push(new Civ(CIVS.length, k)); BEAMS.build(); }

/* ===== Headlight beams at night: a soft oval of light on the road ahead of every car and unit with its lights on — one
   InstancedMesh (additive, no depth write) for all of them, faded with ENV.lightsOn like the street light pools ===== */
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new V3(), _bp = new V3(), _by = new V3(0, 1, 0);
const BEAMS = {
  mesh: null, mat: null,
  build() {
    if (this.mesh) return;
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ map: TEX.soft, color: 0xfff0d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(g, this.mat, CIV_MAX + 40); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  },
  update() {
    const on = ENV.lightsOn; this.mesh.visible = on > 0.02; if (!this.mesh.visible) return;
    this.mat.opacity = 0.32 * on;
    let n = 0;
    const put = (x, z, yaw, len, wid) => {   // (ahead of the bumper, a little longer than wide)
      const c = Math.cos(yaw), s = Math.sin(yaw), f = len / 2 + 4.2;
      _bq.setFromAxisAngle(_by, -yaw); _bs.set(8.5, 1, wid + 1.6);
      this.mesh.setMatrixAt(n++, _bm.compose(_bp.set(x + c * f, 0.055, z + s * f), _bq, _bs));
    };
    for (const c of CIVS) if (c.on) put(c.pos.x, c.pos.z, c.yaw, c.len, c.wid);
    for (const u of MOVERS) if (u.model.group.visible && u.state !== 'quarters' && !u.rev && n < this.mesh.instanceMatrix.count) put(u.pos.x, u.pos.z, u.yaw, u.len, u.wid);
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
};

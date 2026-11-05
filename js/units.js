'use strict';
/* ===== Units: the apparatus and patrol cars, their homes, the run state machine, light bars =====
   Homes: fire / EMS units in the drive-through bays (out the front doors onto Main St, back in from the yard behind:
   up the one-way lane, along the yard, in through the rear door — all forward, nobody maneuvers on the street);
   patrol cars in the police lot's front row (nose in: out backwards, in forwards, through the gate on 2nd Ave).
   A unit's trip is a queue of legs (ROADS ways, some driven backwards).
   States: quarters → turnout (crew boarding, the door up) → [pullout: out of the stall] → responding (code 3)
   → on_scene (at the curb, on the sidewalk side: off the lane) → returning (code 1) → [parking] → quarters;
   `away` = beyond the screen edge on a call out of town.
   The apron (in front of the bays), the yard (behind them) and the police lot take one unit at a time (ZONES):
   a crew rolling out books the apron; a unit coming home books the yard / the lot and waits short of it (in the lane /
   on the avenue) while it is busy, first come first served.
   Light bars flash on two phases (ph 0 / 1): alternating, or swapping on every beat while music plays (AUD.beat). */
const UNIT_TYPES = {
  engine: { svc: 'fire', name: 'ENGINE', tag: 'E', vmax: 15, alat: 2.6, turnout: [18, 30] },
  ladder: { svc: 'fire', name: 'LADDER', tag: 'L', vmax: 13, alat: 2.4, turnout: [18, 30] },
  rescue: { svc: 'fire', name: 'RESCUE', tag: 'R', vmax: 14, alat: 2.6, turnout: [18, 30] },
  medic:  { svc: 'ems',  name: 'MEDIC', tag: 'M', vmax: 17, alat: 3.2, turnout: [14, 24] },
  chief:  { svc: 'fire', name: 'BATTALION', tag: 'BC', vmax: 19, alat: 4.5, turnout: [10, 18] },
  patrol: { svc: 'pd',   name: 'UNIT', tag: 'P', vmax: 20, alat: 5, turnout: [3, 6] }
};
/* the default roster: [type, callsign, home]; bays west → east */
const ROSTER = [['engine', 'ENGINE 12', { bay: 0 }], ['ladder', 'LADDER 12', { bay: 1 }], ['rescue', 'RESCUE 12', { bay: 2 }],
  ['medic', 'MEDIC 12', { bay: 3 }], ['medic', 'MEDIC 14', { bay: 4 }], ['chief', 'BATTALION 1', { bay: 5 }],
  ['patrol', '2-ADAM-11', { stall: 3 }], ['patrol', '2-ADAM-12', { stall: 4 }], ['patrol', '2-ADAM-14', { stall: 5 }], ['patrol', '2-ADAM-15', { stall: 6 }]];   // (stalls clear of the lot's west edge: they back out westward)
const UNIT_STATES = { quarters: 'IN QTRS', turnout: 'TURNOUT', pullout: 'TURNOUT', responding: 'ENROUTE', on_scene: 'ON SCENE', away: 'ON SCENE', returning: 'RETURNING', parking: 'RETURNING', transporting: 'TRANSPORT', at_hospital: 'AT HOSP' };
/* the ER: in from Main St at x 72, under the canopy heading east (two places), out at x 96 */
const HOSP = { inX: 72, outX: 96, z: 31, slots: [{ x: 88, unit: null }, { x: 80, unit: null }] };
const MAIN_Z = 50;
let UNITS = [];
const ZONES = { apron: null, yard: null, lot: null };
const _ua = { x: 0, z: 0, h: 0, v: 0 }, _ub = { x: 0, z: 0, h: 0, v: 0 };
const YIELD_PTS = [], _av = new V3();
const avenueX = () => CITY_LAYOUT.avenues.find(a => a.x > 0 && a.x < 100).x;   // 2nd Ave: the police lot's gate

class Unit {
  constructor(type, cs, home, i) {
    this.type = type; this.spec = UNIT_TYPES[type]; this.cs = cs; this.i = i; this.ph = (i * 0.37) % 1;
    // on the radio "Engine 12", on the CAD "E12" / "BC1" / "2A11"; callRef = the call it is on (DISPATCH)
    this.radio = titleCase(cs); this.short = type === 'patrol' ? cs.replace(/-ADAM-/, 'A') : this.spec.tag + cs.split(' ').pop(); this.callRef = null; this.cadState = 'quarters';
    const m = this.model = UNIT_MODELS[type](); this.len = m.len; this.wid = m.wid;
    // glow points over the bar's two halves (they flash with it), head / tail lights at night
    const glow = ph => { const b = m.bars.filter(s => s.ph === ph && s.mesh.position.y > 1.6); if (!b.length) return null;
      const p = b.reduce((a, s) => a.add(s.mesh.position), new V3()).divideScalar(b.length); const c = b.some(s => s.col === 'b') ? 0x4070ff : 0xff3020;
      const pts = navLights(m.group, [[p.x, p.y + 0.15, p.z, c]], null, 2.4); pts.material.userData.day = true; return pts.material; };
    this.glow = [glow(0), glow(1)].filter(Boolean);
    const L2 = m.len / 2 - 0.05, W2 = m.wid / 2 - 0.3;
    this.heads = navLights(m.group, [[L2 + 0.1, 0.9, W2, 0xfff2d8], [L2 + 0.1, 0.9, -W2, 0xfff2d8], [-L2 - 0.1, 1.0, W2, 0xff2010], [-L2 - 0.1, 1.0, -W2, 0xff2010]], null, 0.9).material;
    mergeStatic(m.group, [...m.bars.map(b => b.mesh), ...(m.dyn || [])]);
    scene.add(m.group);
    this.home = this.makeHome(home);
    this.state = 'quarters'; this.t = 0; this.v = 0; this.legs = []; this.way = null; this.lights = false; this.call = null; this.blockT = 0; this.blocker = null;
    this.pos = { x: this.home.x, z: this.home.z, h: this.home.h };
    this.place(this.home.x, this.home.z, this.home.h, false);
    this.flash(false);
  }
  /* where it lives: { kind, x, z (parked centre), h (travel heading of the parked vehicle), bay / stall } */
  makeHome(h) {
    if (h.bay != null) { const b = CITY.bays[h.bay]; b.unit = this; return { kind: 'bay', bay: b, x: b.x, z: (b.zBack + b.zFront) / 2, h: Math.PI / 2 }; }
    const st = CITY.stalls.filter(s => s.row === -36)[h.stall]; st.unit = this;
    return { kind: 'stall', stall: st, x: st.x, z: st.z, h: -Math.PI / 2 };
  }
  get label() { return UNIT_STATES[this.state] || this.state.toUpperCase(); }
  get moving() { return !!this.way; }
  /* the zone it books going out / coming home */
  get zoneOut() { return this.home.kind === 'bay' ? 'apron' : 'lot'; }
  get zoneIn() { return this.home.kind === 'bay' ? 'yard' : 'lot'; }
  /* x, z, travel heading h (rev: driven backwards). With dt the body turns toward it no faster than a car can (a turning
     radius of ~4.5 m at speed, slowly at a crawl): never a snap, wherever two ways meet at an angle */
  place(x, z, h, rev, dt) {
    this.pos.x = x; this.pos.z = z; this.pos.h = h; this.rev = rev;
    const yaw = rev ? h + Math.PI : h;
    this.yaw = dt && this.yaw != null ? this.yaw + clamp(angleWrap(yaw - this.yaw), -Math.max(0.35, this.v / 4.5) * dt, Math.max(0.35, this.v / 4.5) * dt) : yaw;
    this.model.group.position.set(x, 0, z); this.model.group.rotation.y = -this.yaw;
  }
  /* ---- zones ---- */
  /* book a zone: a crew ready to roll (out) takes it over from one still well out on its way home; on the way home the
     nearest to its waiting point goes first (they queue in a lane: the order is where they are, not who asked first) —
     it even takes the zone over from a holder that has fallen behind it — and nobody books while a crew waits to roll out */
  get homeRem() { return this.state === 'returning' && this.way && this.way === this.firstWay ? this.waitS - this.way.s : Infinity; }
  take(z, out) {
    let h = ZONES[z]; if (h === this) return true;
    if (!out && h && h.homeRem < Infinity && h.homeRem > Math.max(0, this.homeRem) + 5) h = null;   // (never from one rolling out or already parking)
    const queued = !out && (UNITS.some(o => o !== this && o.zoneOut === z && o.wantOut) ||
      UNITS.some(o => o !== this && o !== ZONES[z] && o.zoneIn === z && o.homeRem < this.homeRem - 1 && o.homeRem > -10));
    if ((h && !(out && h.state === 'returning' && h.way && h.way.len - h.way.s > 60)) || queued) { if (!out) this.waitZone = z; return false; }
    ZONES[z] = this; if (this.waitZone === z) this.waitZone = null; return true;
  }
  free() { for (const z in ZONES) if (ZONES[z] === this) ZONES[z] = null; }
  /* ---- trips ---- */
  go(legs) { this.legs = legs.filter(l => l.way); this.next(); }
  next() {
    const l = this.legs.shift(); this.way = l ? l.way : null; this.leg = l || null;
    if (this.way) { this.way.s = 0; if (this.way.rev !== this.rev) this.v = 0; }
  }
  /* send it to a place on a street ({ ax, at, a, dir, curb: [x, z] }) or out of town ({ far: { ax, at, a, dir } }) */
  dispatch(dest) {
    if (this.state !== 'quarters') return false;
    this.call = dest; this.state = 'turnout'; this.t = 0; this.ready = rand(...this.spec.turnout); this.lights = true;
    if (this.home.bay) this.home.bay.door.want = 1;
    return true;
  }
  /* the way out of quarters to the call */
  wayOut() {
    const H = this.home, d = this.call, o = { vmax: this.spec.vmax, alat: this.spec.alat };
    const to = d.far ? { ax: d.far.ax, at: d.far.at, a: d.far.a, dir: d.far.dir } : { ax: d.ax, at: d.at, a: d.a, dir: d.dir };
    const post = d.far ? [] : [d.curb];
    if (H.kind === 'bay') return [{ way: ROADS.way({ ax: 'ew', at: MAIN_Z, a: H.x, dirs: ['E', 'W'], join: true }, to, [[H.x, H.z]], post, o) }];
    // a patrol car backs out of its stall (nose ending east), then drives out of the lot gate onto 2nd Ave
    // (the backing ends straight along the aisle, so the drive off starts the way the car already points)
    const LT = CITY_LAYOUT.lot, x = H.x, ay = LT.gate - 2.6;
    return [{ way: new Way([[x, H.z], [x, ay], [x - 9, ay]], { rev: true, vmax: 2.5, r: 5 }) },
      { way: ROADS.way({ ax: 'ns', at: avenueX(), a: LT.gate, dirs: ['N', 'S'], join: true }, to, [[x - 9, ay], [LT.x1 - 3, ay], [LT.x1 + 1.5, LT.gate]], post, o) }];
  }
  /* the way home from where it stands (at a curb, heading `dir`) or from beyond the edge */
  /* where it starts from when it leaves the call: the street end it went out by, or the curb (pulling away ahead) */
  fromCall() {
    const d = this.call;
    return d.far ? [{ ax: d.far.ax, at: d.far.at, a: d.far.a, dirs: [OPP[d.far.dir]] }, []] : [{ ax: d.ax, at: d.at, a: d.a + DIRV[d.dir][d.ax === 'ew' ? 0 : 1] * 16, dirs: [d.dir] }, [[this.pos.x, this.pos.z]]];
  }
  wayHome(from, pre) {
    const H = this.home, o = { vmax: this.spec.vmax * 0.7, alat: this.spec.alat };
    if (H.kind === 'bay') {   // up the lane, along the yard, in through the rear door
      const F = CITY_LAYOUT.fire, lx = F.laneX;
      return [{ way: ROADS.way(from, { ax: 'ew', at: MAIN_Z, a: lx, dir: null, join: true }, pre, [[lx, F.apron - 2], [lx, F.yardZ], [H.x + 6, F.yardZ], [H.x, F.yardZ + 6], [H.x, H.z]], o) }];
    }
    const LT = CITY_LAYOUT.lot, x = H.x, ay = LT.gate - 3.2;
    return [{ way: ROADS.way(from, { ax: 'ns', at: avenueX(), a: LT.gate, dir: null, join: true }, pre,
      [[LT.x1 + 1.5, LT.gate], [LT.x1 - 3, ay], [x + 5, ay], [x, ay - 4.5], [x, H.z]], o), then: () => { this.state = 'parking'; } }];
  }
  /* back to quarters; from beyond the edge only once the street end is clear (they come back one by one) */
  release() {
    if (this.state === 'away') { this.homeQ = true; return; }
    if (this.state === 'on_scene') this.goHome();
  }
  goHome(from, pre) {
    if (!from) [from, pre] = this.fromCall();
    this.state = 'returning'; this.lights = false; this.model.group.visible = true; this.homeQ = false;
    this.go(this.wayHome(from, pre)); this.firstWay = this.way;
    // where it waits while the yard / the lot is busy: in the lane short of the yard, on the avenue ~28 m short of the gate
    const W = this.way, F = CITY_LAYOUT.fire, [wx, wz] = this.home.kind === 'bay' ? [F.laneX, 14] : [avenueX(), CITY_LAYOUT.lot.gate];
    let best = Infinity; this.waitS = W.len;
    for (let i = 0; i < W.n; i++) { const d = Math.hypot(W.X[i] - wx, W.Z[i] - wz); if (d < best) { best = d; this.waitS = W.S[i]; } }
    if (this.home.kind === 'stall') this.waitS -= 28;
    const bx = (W.boxes || (W.boxes = wayBoxes(W))).find(b => this.waitS + this.len / 2 > b.s0 - 1 && this.waitS - this.len / 2 < b.s1 + 1);
    if (bx) this.waitS = bx.s0 - this.len / 2 - 1.5;   // (never waiting in a crossing: at its line instead)
  }
  /* a medic takes its patient to the ER (code 3 or not): in under the canopy, a while there, then home */
  transport(code3) {
    const [from, pre] = this.fromCall(), slot = HOSP.slots.find(s => !s.unit) || HOSP.slots[1];
    slot.unit = this; this.hosp = slot; this.code3 = code3; this.lights = code3; this.state = 'transporting';
    const o = { vmax: this.spec.vmax * (code3 ? 1 : 0.75), alat: this.spec.alat };
    this.go([{ way: ROADS.way(from, { ax: 'ew', at: MAIN_Z, a: HOSP.inX, dir: null, join: true }, pre, [[HOSP.inX, 42], [HOSP.inX, 35], [HOSP.inX + 6, HOSP.z], [slot.x, HOSP.z]], o) }]);
    this.firstWay = this.way;
  }
  leaveHospital() {
    const s = this.hosp; this.hosp = null; s.unit = null;
    this.goHome({ ax: 'ew', at: MAIN_Z, a: HOSP.outX, dirs: ['E', 'W'], join: true }, [[s.x, HOSP.z], [HOSP.outX - 4, HOSP.z], [HOSP.outX, HOSP.z + 4], [HOSP.outX, 42]]);
  }
  /* ---- the ladder's aerial: turned, raised and run out toward a point (want 1), or bedded (want 0); k 0 … 1 ---- */
  aimAerial(p) {
    if (!this.model.aerial) return;
    const g = this.model.group; g.updateMatrixWorld(true); const l = g.worldToLocal(_av.copy(p)), dx = l.x + 4.2, dz = l.z, hd = Math.hypot(dx, dz), dy = l.y - 3.25;
    this.aerialAim = { yaw: Math.atan2(-dz, dx), pitch: clamp(Math.atan2(dy, hd), 0.25, 1.2), ext: clamp(Math.hypot(hd, dy) - 9.5, 0, 8) };
    this.aerialWant = 1;
  }
  aerialTip(out) { const a = this.model.aerial; this.model.group.updateMatrixWorld(true); return a.fly.localToWorld(out.set(10.2, 0.3, 0)); }
  updateAerial(dt) {
    const a = this.model.aerial; if (!a) return;
    const want = this.aerialWant || 0, k = this.aerialK = clamp((this.aerialK || 0) + clamp(want - (this.aerialK || 0), -dt / 7, dt / 7), 0, 1);
    if (!this.aerialAim) return;
    const k1 = clamp(k * 2, 0, 1), k2 = clamp(k * 2 - 1, 0, 1);
    a.yawG.rotation.y = this.aerialAim.yaw * k1; a.pitchG.rotation.z = this.aerialAim.pitch * k2; a.fly.position.x = this.aerialAim.ext * k2;
  }
  /* ---- per step ---- */
  update(dt) {
    this.t += dt;
    const H = this.home;
    if (this.state === 'turnout') {
      this.wantOut = this.t >= this.ready && (!H.bay || H.bay.door.k > 0.97);   // the crew is aboard, the door is up
      this.wait = this.wantOut ? ZONES[this.zoneOut] : null; this.waitKind = 'zone';
      if (this.wantOut && this.take(this.zoneOut, true)) {
        this.wait = null;
        this.wantOut = false;
        const legs = this.wayOut();
        if (H.kind === 'stall') { this.state = 'pullout'; legs[0].then = () => { this.state = 'responding'; }; }
        else this.state = 'responding';
        this.go(legs); this.t = 0;
      }
    } else if (this.state === 'at_hospital' && this.t > this.dwellH) this.leaveHospital();
    else if (this.state === 'away' && this.homeQ) {
      const [x, z] = ROADS.pos(this.call.far); if (!UNITS.some(o => o !== this && o.model.group.visible && Math.hypot(o.pos.x - x, o.pos.z - z) < 35)) this.goHome();
    }
    this.updateAerial(dt);
    if (this.way) this.drive(dt);
    // the apron / the lot is free once the unit rolling out is out on the street (on the way home it keeps its zone till parked)
    if (this.state === 'responding' && ZONES[this.zoneOut] === this && this.clear) this.free();
    if (H.bay) {   // the front door shuts once it is out; both once it is home
      if (H.bay.door.want && this.state === 'responding' && this.pos.z > H.bay.zFront + this.len / 2 + 2) H.bay.door.want = 0;
      if (this.state === 'quarters') H.bay.door.want = H.bay.rear.want = 0;
    }
    this.updateLights();
  }
  /* out of its zone on the way out: on Main St clear of the apron / out of the lot gate and away from it */
  get clear() {
    if (this.zoneOut === 'apron') return (this.pos.z > MAIN_Z - 3 && Math.abs(this.pos.x - this.home.x) > this.len / 2 + 6) || (this.way && this.way.s > 40 + this.len);
    const LT = CITY_LAYOUT.lot; return this.pos.x > LT.x1 + 2 && Math.hypot(this.pos.x - LT.x1, this.pos.z - LT.gate) > 22;
  }
  drive(dt) {
    const w = this.way, p = w.at(w.s, _ua);
    let vt = p.v, wait = null, kind = null;
    if (!w.rev) {
      const g = this.gapCap(), y = this.yieldCap(w), x = this.crossCap(w);
      vt = Math.min(vt, g, y, x);
      if (vt < 0.5) { wait = y <= g ? this.yieldTo : this.blocker; kind = wait && 'move'; }
      this.held = x < 0.5 || (this.enterHeld && vt < 0.5);   // (at a red light, or waiting to get onto a street: its way ahead is not claimed — Civ.unitCap)
    }
    // on the way home: book the yard / the lot ~40 m before the waiting point; wait there while it is busy
    if (this.state === 'returning' && w === this.firstWay && ZONES[this.zoneIn] !== this && w.s > this.waitS - 40) {
      if (this.take(this.zoneIn)) { if (this.home.bay) this.home.bay.rear.want = 1; }
      else { const c = Math.sqrt(6 * Math.max(0, this.waitS - w.s)); if (c < vt) { vt = c; if (vt < 0.5) { wait = ZONES[this.zoneIn]; kind = 'zone'; } } }
    }
    this.wait = wait; this.waitKind = kind; if (kind === 'zone') this.held = true;
    // code 3 past the traffic pulled over at the curb: out onto the centre line, back in well before the end
    const rem = w.len - w.s, out = this.latOff < -0.3;
    const straight = Math.abs(angleWrap(w.at(Math.min(w.len, w.s + 25), _ub).h - p.h)) < 0.2;   // (a turn within 25 m: slowly, and back in first if a car is coming the other way)
    const pass = this.passing = this.lights && (this.state === 'responding' || this.state === 'transporting') && !w.rev && alongStreet(p.x, p.z, p.h) && !this.oncoming(straight ? 0 : 40) &&
      ((rem > 40 && this.civAhead(60)) || (out && (rem > 25 ? this.civAhead(60) : this.civAhead(this.len / 2 + 3))));   // (once out, until it is by; near the end only while one is still alongside)
    const ls = (this.v > 0.3 ? clamp(this.v * 0.4, 0.5, 2) : 0) * dt;   // (sideways only while rolling)
    this.latOff = (this.latOff || 0) + clamp((pass ? -LANE_OFF : 0) - (this.latOff || 0), -ls, ls);
    if (out && rem < 20) { const c = Math.max(1.5, Math.sqrt(6 * Math.max(0, rem - 10))); if (c < vt) vt = c; }   // (a crawl back in, not to the curb from the centre line)
    if (out && !straight && vt > 4) vt = 4;   // (nor into a turn)
    // pulling away from the curb: let anyone driving by pass first
    if ((this.state === 'returning' || this.state === 'transporting') && w === this.firstWay && this.v < 0.5 && w.s < 3 && this.trafficBy()) vt = 0;
    const acc = this.spec.svc === 'pd' || this.type === 'chief' ? 3.2 : 2.0;
    this.v = this.v < vt ? Math.min(vt, this.v + acc * dt) : Math.max(vt, this.v - 5 * dt);
    if (this.v < 0.05 && vt < 0.05) this.blockT += dt; else this.blockT = 0;
    w.s = Math.min(w.len, w.s + this.v * dt);
    w.at(w.s, _ua); if (this.latOff) { _ua.x -= Math.sin(_ua.h) * this.latOff; _ua.z += Math.cos(_ua.h) * this.latOff; }
    this.place(_ua.x, _ua.z, _ua.h, w.rev, dt);
    if (w.done) {
      const l = this.leg; this.next(); if (l && l.then) l.then();
      if (!this.way) this.arrive();
    }
  }
  /* the end of the last leg */
  arrive() {
    this.v = 0;
    if (this.state === 'transporting') { this.state = 'at_hospital'; this.t = 0; this.dwellH = rand(40, 80); this.lights = false; return; }
    if (this.state === 'responding') {
      if (this.call.far) { this.state = 'away'; this.model.group.visible = false; } else this.state = 'on_scene';
      this.t = 0; this.free();
    } else if (this.state === 'parking' || this.state === 'returning') {
      this.state = 'quarters'; this.t = 0; this.call = null; this.place(this.home.x, this.home.z, this.home.h, false); this.free();
    }
  }
  /* a civilian car ahead in its lane or at its curb (within `range` m, or still alongside) */
  civAhead(range) {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h), lo = this.latOff || 0;
    return CIVS.some(o => { if (!o.on) return false; const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s, lat = -dx * s + dz * c + lo;
      return along > -(this.len + o.len) / 2 - 1 && along < range && lat > -1.5 && lat < 3.2; });
  }
  /* another unit coming the other way within 60 m (in the opposite lane, or on the centre line itself); with `cars`, a car
     coming within that many metres too (one not pulled over) */
  oncoming(cars) {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h), lo = this.latOff || 0;
    const near = (o, range) => { if (o === this || !o.model.group.visible || Math.abs(angleWrap(o.pos.h - this.pos.h)) < 2.4) return false;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s, lat = -dx * s + dz * c + lo;
      return along > -this.len && along < range && lat > -7 && lat < 1; };
    return UNITS.some(o => o.way && near(o, 60)) || (cars > 0 && CIVS.some(o => o.on && !o.pulled && near(o, cars)));
  }
  /* someone driving by close behind or alongside (either lane) */
  trafficBy() {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h);
    return [...UNITS, ...CIVS].some(o => {
      if (o === this || !o.model.group.visible || o.v < 0.5) return false;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s;
      return along > -35 && along < 10 && Math.abs(-dx * s + dz * c) < 6;
    });
  }
  /* units waiting on each other round a circle (this waits for o … for this): the first of them that waits for one on
     the move (not for a zone) drives on — a run first, then the lower roster number */
  leads(o) {
    const ring = [this]; let u = this.wait;
    for (let n = 0; u && n < 10 && u !== this; n++) { ring.push(u); u = u.wait; }
    if (u !== this || !ring.includes(o)) return false;
    const movers = ring.filter(r => r.waitKind === 'move'); if (!movers.length) return false;
    movers.sort((a, b) => ((a.state === 'responding' ? 0 : 1) - (b.state === 'responding' ? 0 : 1)) || a.i - b.i);
    return movers[0] === this;
  }
  /* car following: slow down to stop short of a unit ahead in the lane, allowing for its own braking; two holding each
     other for 12 s: one drives on. Parked units (quarters, at the curb) are off the way. */
  gapCap() {
    const c = Math.cos(this.pos.h), s = Math.sin(this.pos.h); let cap = Infinity, blocker = null;
    for (const o of UNITS) {
      if (o === this || !o.model.group.visible || o.state === 'quarters' || (o.state === 'on_scene' && !o.way)) continue;
      if (this.blockT > 12 && o.blocker === this || this.leads(o)) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s, lat = Math.abs(-dx * s + dz * c);
      if (along <= 0 || along > 60 || lat > 2.4 || Math.abs(angleWrap(o.pos.h - this.pos.h)) > 1.6) continue;   // (not one coming the other way in the next lane)
      const gap = along - (this.len + o.len) / 2 - 3, ov = o.moving ? o.v * Math.cos(o.pos.h - this.pos.h) : 0,
        k = ov >= 0 ? Math.sqrt(7 * (Math.max(0, gap) + ov * ov / 10)) : Math.max(0, Math.sqrt(7 * Math.max(0, gap)) + ov);
      if (k < cap) { cap = k; blocker = o; }
    }
    for (const o of CIVS) {   // civilian cars ahead in the lane (one pulled over at the curb, or passed on the centre line, is not)
      if (!o.on) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z, along = dx * c + dz * s, lat = Math.abs(-dx * s + dz * c);
      if (along <= 0 || along > 60 || lat > (this.wid + o.wid) / 2 + 0.05 || Math.abs(angleWrap(o.pos.h - this.pos.h)) > 1.2) continue;   // (one across its way: yieldCap)
      const gap = along - (this.len + o.len) / 2 - 3, ov = o.v * Math.cos(o.pos.h - this.pos.h),
        k = ov >= 0 ? Math.sqrt(7 * (Math.max(0, gap) + ov * ov / 10)) : Math.max(0, Math.sqrt(7 * Math.max(0, gap)) + ov);
      if (k < cap) { cap = k; blocker = o; }
    }
    this.blocker = blocker;
    return cap;
  }
  /* paths that cross (out of a bay across the lanes, turning at a crossing, into the lane): whoever gets to the meeting
     point later stops short of it; a tie goes to the run (code 3), then to the lower roster number; never to one that
     is already giving way to this unit */
  yieldCap(w) {
    let cap = Infinity; this.yieldTo = null;
    for (const o of UNITS) {
      if (o === this || !o.model.group.visible || o.state === 'quarters' || (o.state === 'on_scene' && !o.way) || o.yieldTo === this || this.leads(o)) continue;
      if (Math.abs(o.pos.x - this.pos.x) + Math.abs(o.pos.z - this.pos.z) > 110) continue;
      const R = (this.wid + o.wid) / 2 + 0.6, ow = o.way, pts = YIELD_PTS; pts.length = 0;
      pts.push(o.pos.x, o.pos.z, 0);
      const hj = clamp(o.v * 3, 12, 45), hk = clamp(this.v * 3, 26, 45);   // ~3 s ahead for both
      if (ow) for (let j = 2; j <= hj && ow.s + j <= ow.len; j += 2) { const q = ow.at(ow.s + j, _ub); pts.push(q.x, q.z, j); }
      for (let k = 2; k <= hk && w.s + k <= w.len; k += 1.5) {
        const p = w.at(w.s + k, _ub);
        for (let i = 0; i < pts.length; i += 3) {
          if (Math.hypot(p.x - pts[i], p.z - pts[i + 1]) > R) continue;
          const t1 = k / Math.max(this.v, 2), t2 = pts[i + 2] / Math.max(o.v, 2);
          const first = t2 < t1 - 0.3 || (Math.abs(t1 - t2) <= 0.3 && ((o.state === 'responding') !== (this.state === 'responding') ? o.state === 'responding' : o.i < this.i));
          if (first) { const c = Math.sqrt(7 * Math.max(0, k - this.len / 2 - R)); if (c < cap) { cap = c; this.yieldTo = o; } }
          k = 99; break;   // (the first meeting point decides)
        }
      }
    }
    // civilian cars give way to it (Civ.unitCap); it only never drives into one standing on, or clearing, its path within
    // its stopping distance (the path where it is going to be: on the centre line while it passes)
    // coming out onto a street (from a bay, the lot, the ER, a curb): let a car about to pass where it gets on go by —
    // waiting so, it claims no more than where it stands (`held`: the cars go by)
    this.enterHeld = false;
    if (!inStreet(this.pos.x, this.pos.z)) for (let k = 1; k <= 14 && w.s + k <= w.len; k++) {
      const e = w.at(w.s + k, _ub); if (!inStreet(e.x, e.z)) continue;
      for (const o of CIVS) {
        if (!o.on) continue;
        const dx = e.x - o.pos.x, dz = e.z - o.pos.z, d = Math.hypot(dx, dz);
        if (o.v > 2 && d < 35 && d > 1 && dx * Math.cos(o.pos.h) + dz * Math.sin(o.pos.h) > d * 0.7 && d / o.v < 2.5) {
          const c = Math.sqrt(7 * Math.max(0, k - this.len / 2 - 1)); if (c < cap) { cap = c; this.yieldTo = o; this.enterHeld = true; }
        }
      }
      break;
    }
    const reach = Math.min(30, this.v * this.v / 6 + 10);
    for (const o of CIVS) {
      if (!o.on || Math.abs(o.pos.x - this.pos.x) + Math.abs(o.pos.z - this.pos.z) > 60) continue;
      if ((o.pos.x - this.pos.x) * Math.cos(this.pos.h) + (o.pos.z - this.pos.z) * Math.sin(this.pos.h) < 0) continue;   // (behind it)
      const R = (this.wid + o.wid) / 2 + 0.05, c = Math.cos(o.pos.h), s = Math.sin(o.pos.h), e = o.len / 2 - o.wid / 2;
      for (let k = 1; k <= reach && w.s + k <= w.len; k += 1) {
        const p = w.at(w.s + k, _ub), lo = k > 8 && this.passing ? -LANE_OFF : (this.latOff || 0);
        if (lo) { p.x -= Math.sin(p.h) * lo; p.z += Math.cos(p.h) * lo; }
        if (Math.hypot(p.x - o.pos.x - c * e, p.z - o.pos.z - s * e) < R || Math.hypot(p.x - o.pos.x, p.z - o.pos.z) < R || Math.hypot(p.x - o.pos.x + c * e, p.z - o.pos.z + s * e) < R) {
          const cc = Math.sqrt(7 * Math.max(0, k - this.len / 2 - 0.5)); if (cc < cap) { cap = cc; this.yieldTo = o; }
          break;
        }
      }
    }
    return cap;
  }
  /* crossings ahead: code 3 slows to clear a red light or a stop; code 1 stops at the line on red (or yellow, when it
     still can) and rolls through an all-way stop */
  crossCap(w) {
    if (this.state !== 'responding' && this.state !== 'returning' && this.state !== 'transporting') return Infinity;
    const code3 = this.state === 'responding' || (this.state === 'transporting' && this.code3);
    for (let k = 1; k <= 45; k++) {   // the first point of the way inside a crossing (the box between the sidewalks)
      if (w.s + k > w.len) break;
      const p = w.at(w.s + k, _ub), x = Math.round(p.x / 50) * 50, z = Math.round(p.z / 50) * 50;
      if (Math.abs(p.x - x) > EDGE || Math.abs(p.z - z) > EDGE || !CITY_LAYOUT.avenues.some(a => a.x === x) || !CITY_LAYOUT.streets.some(s => s.z === z)) continue;
      const stop = k - this.len / 2 - 1;                 // the front 1 m short of the box: behind the stop line
      // another unit in the box on a move across this one (and not giving way to it), or a car in it (or that can no longer
      // stop short of it): wait at the line — or where it stands, its nose over it but itself not in yet
      const key = x + ',' + z, my = stop > -this.len / 2 && (w.boxes || (w.boxes = wayBoxes(w))).find(b => b.key === key && w.s - this.len / 2 < b.s1);
      if (my) for (const o of UNITS) {
        if (o === this || !o.way || o.way.rev || !o.model.group.visible || o.yieldTo === this || Math.abs(o.pos.x - x) > EDGE || Math.abs(o.pos.z - z) > EDGE) continue;
        const ob = (o.way.boxes || (o.way.boxes = wayBoxes(o.way))).find(b => b.key === key && o.way.s - o.len / 2 < b.s1);
        if (ob && boxConflict(ob, my)) { this.yieldTo = this.yieldTo || o; return Math.sqrt(2 * 3 * Math.max(0, stop)); }
      }
      if (my) for (const o of CIV_BOXES.get(key) || []) if (o.boxIn && o.way.s + o.len / 2 > o.boxIn.s0 - o.v * o.v / 10 - 1 && boxConflict(o.boxIn, my)) { this.yieldTo = this.yieldTo || o; return Math.sqrt(2 * 3 * Math.max(0, stop)); }   // (a car in it or past stopping, too)
      if (stop < -1.5) return Infinity;                  // already over the line: clear out
      const sig = CITY_LAYOUT.signals.some(s => s[0] === x && s[1] === z), axis = Math.abs(Math.cos(p.h)) > Math.abs(Math.sin(p.h)) ? 'ew' : 'ns';
      const light = sig ? CITY.signal(axis) : 'g', red = sig && (light === 'r' || (light === 'y' && this.v * this.v / 9 < stop));
      const vIn = code3 ? (red || !sig ? 6 : Infinity) : (red ? 0 : sig ? Infinity : 2.2);
      return vIn === Infinity ? Infinity : Math.sqrt(vIn * vIn + 2 * 3 * Math.max(0, stop));
    }
    return Infinity;
  }
  /* ---- lights ---- */
  updateLights() {
    if (this.lights) {
      let a;
      if (LOAD.level > 0.15 && T - AUD.beat < 0.9) { if (AUD.beat !== this.lastBeat) { this.lastBeat = AUD.beat; this.beatPh = (this.beatPh || 0) ^ 1; } a = this.beatPh; }   // music: each beat swaps the sides
      else a = ((T * 2.4 + this.ph) % 1) < 0.5 ? 0 : 1;
      this.flash(true, a);
    } else this.flash(false);
    this.heads.userData.on = this.state === 'quarters' ? 0 : 1;
  }
  flash(on, a) {
    const k = on ? a : -1; if (k === this.lastFlash) return; this.lastFlash = k;
    for (const s of this.model.bars) s.mesh.material = LB_MATS[s.col][on && s.ph === a ? 1 : 0];
    this.glow.forEach((m, i) => { m.userData.on = on && i === a ? 1 : 0; });
  }
  dispose() {
    scene.remove(this.model.group);
    this.model.group.traverse(o => { if (o.isPoints) { const i = NAV_MATS.indexOf(o.material); if (i >= 0) NAV_MATS.splice(i, 1); } });
    disposeTree(this.model.group);
    if (this.home.bay) this.home.bay.unit = null; if (this.home.stall) this.home.stall.unit = null; if (this.hosp) this.hosp.unit = null; this.free();
  }
}
function buildUnits() {
  UNITS.forEach(u => u.dispose());
  UNITS = ROSTER.map(([type, cs, home], i) => new Unit(type, cs, home, i));
}

/* ===== Places a unit can be sent to ===== */
/* in front of a house: pulled over at the curb on the house's side (half on the sidewalk, off the lane), `slot` places
   along the street */
function houseDest(h, slot) {
  const st = CITY_LAYOUT.streets.find(s => s.name === h.street), dir = h.face > 0 ? 'W' : 'E', sg = DIRV[dir][0];
  const a = h.x + (slot || 0) * 15 * sg, curbZ = st.z - h.face * (ROAD_W / 2 + 0.5);
  return { ax: 'ew', at: st.z, a: a - sg * 8, dir, curb: [a, curbZ], house: h };
}
/* out of town along a street: one of the far ends */
function farDest() {
  const L = CITY_LAYOUT, ew = Math.random() < 0.5, line = ew ? pick(L.streets).z : pick(L.avenues).x, sgn = Math.random() < 0.5 ? -1 : 1;
  return { far: { ax: ew ? 'ew' : 'ns', at: line, a: sgn * L.ext, dir: ew ? (sgn > 0 ? 'E' : 'W') : (sgn > 0 ? 'S' : 'N') } };
}

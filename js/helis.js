'use strict';
/* ===== Helicopters: Air 1 (police, on the complex's pad) and Medevac 1 (on the hospital's roof pad) =====
   Not on the roads: a helicopter steers straight for its goal (the heading turns no faster than a bank allows, speed and
   height eased), orbits over a call (Air 1; its searchlight sweeps the ground below at night), lands at a landing zone
   (Medevac 1: the school field / the park, whichever is nearer the call) or leaves the screen on a call out of town. Home:
   a hover over the pad, a turn to the pad's heading, straight down, the rotor winding down.
   CAD states as the ground units' (the dispatcher drives both alike): quarters (on the pad) → turnout (spin-up)
   → responding → on_scene (orbiting / on the ground at the LZ) / away (out of town, hidden) → returning (Air 1) or
   transporting (Medevac 1: the patient to the hospital's roof) → [at_hospital] → quarters.
   The flight phase is `ph`: pad, spinup, lift, fly, hover, descend, ground (idling at an LZ), away.              */
const HELI_TYPES = {
  air1:    { svc: 'pd',  cruise: 24, alt: 45, orbitR: 38, orbitV: 13, spin: 10 },
  medevac: { svc: 'ems', cruise: 32, alt: 60, spin: 14 }
};
const HELI_STATES = { quarters: 'ON PAD', turnout: 'SPIN-UP', responding: 'ENROUTE', on_scene: 'ON SCENE', away: 'ON SCENE', returning: 'RETURNING', transporting: 'TRANSPORT', at_hospital: 'AT HOSP' };
/* Medevac 1's landing zones: open ground kept clear of trees (city.js) */
const HELI_LZ = [{ name: 'HIGH SCHOOL FIELD', x: 10, z: -78 }, { name: 'PARK LAWN', x: -22, z: 118 }];
function lzFor(s) {
  if (!s || !s.ax) return null;
  const [x, z] = siteXZ(s, s.a, 0);
  return HELI_LZ.reduce((b, l) => Math.hypot(l.x - x, l.z - z) < Math.hypot(b.x - x, b.z - z) ? l : b);
}
let HELIS = [];

/* ---- the model: a light twin-engine helicopter (~12 m over the rotor), facing +x, skids on y = 0 ----
   { group, rotor, tail, blades, disc, lights (nav materials: lit while the engine runs), sl? (searchlight), land? } */
function heliModel(body, stripe, n) {
  const g = new THREE.Group(), D = 0x24282c;
  taper(g, 3.2, 1.5, 1.6, body, 0, 1.3, 0, 0.85, 0.85, -0.1);                       // cabin
  taper(g, 1.2, 1.2, 1.5, CAB_GLASS, 2.1, 1.15, 0, 0.3, 0.75, -0.4);                 // nose glazing
  box(g, 3.22, 0.26, 1.62, stripe, -0.05, 0.95, 0);
  box(g, 1.3, 0.55, 1.63, CAB_GLASS, 0.55, 1.6, 0);                                   // side windows
  taper(g, 2.3, 0.55, 1.0, body, -0.5, 2.3, 0, 0.8, 0.8, 0);                         // engine cowling
  cyl(g, 0.1, 0.13, 0.5, 6, D, 0, 2.8, 0);                                            // mast
  const tb = cyl(g, 0.34, 0.16, 5.2, 8, body, -4.1, 1.75, 0); tb.rotation.z = -Math.PI / 2;
  box(g, 3.0, 0.12, 0.36, stripe, -3.4, 1.75, 0);
  taper(g, 0.9, 1.5, 0.08, body, -6.45, 2.4, 0, 0.6, 1, -0.3);                       // fin
  box(g, 0.6, 0.06, 2.0, body, -5.6, 1.8, 0);                                         // stabilizer
  for (const sd of [-1, 1]) {
    const s = cyl(g, 0.05, 0.05, 3.6, 5, D, 0.2, 0.06, sd * 0.95); s.rotation.z = Math.PI / 2;
    for (const x of [-0.9, 0.9]) strut(g, new V3(x, 0.06, sd * 0.95), new V3(x, 0.62, sd * 0.6), 0.045, D);
  }
  const tail = new THREE.Group(); tail.position.set(-6.6, 2.5, 0.14); g.add(tail);
  box(tail, 0.14, 1.5, 0.03, D, 0, 0, 0); box(tail, 1.5, 0.14, 0.03, D, 0, 0, 0);
  const rotor = new THREE.Group(); rotor.position.set(0, 3.08, 0); g.add(rotor);
  cyl(rotor, 0.2, 0.2, 0.16, 6, D, 0, 0, 0);
  const blades = [];
  for (let i = 0; i < n; i++) { const b = new THREE.Group(); b.rotation.y = i * TAU / n; rotor.add(b); box(b, 5.1, 0.05, 0.3, D, 2.7, 0, 0).castShadow = false; blades.push(b); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.35, 28), new THREE.MeshBasicMaterial({ color: 0x2a2f34, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; rotor.add(disc);
  const lights = [navLights(g, [[0.3, 1.2, -0.86, 0xff2a1a], [0.3, 1.2, 0.86, 0x22ff66], [-6.75, 1.9, 0, 0xffffff]], null, 1.0).material,
    navLights(g, [[-0.8, 2.62, 0, 0xff3030], [0.1, 0.5, 0, 0xff3030]], { period: 1.1, duty: 0.2, phase: 0.3 }, 1.6).material,
    navLights(g, [[-6.5, 3.2, 0, 0xffffff]], { period: 1.5, duty: 0.06 }, 1.4).material];
  lights[1].userData.day = lights[2].userData.day = true;   // the anti-collision beacon and the strobe show by day
  return { group: g, rotor, tail, blades, disc, lights };
}
const HELI_MODELS = {
  // Air 1: dark blue and white, a camera ball and a searchlight under the nose
  air1() {
    const m = heliModel(0x1a2438, 0xe8e8e4, 4);
    cyl(m.group, 0.24, 0.24, 0.32, 8, 0x30343a, 1.7, 0.42, -0.5);
    m.sl = makeSearchlight(m.group, 1.9, 0.42, 0.35, { color: 0xeef3ff, angle: 0.075, len: 90, intensity: 1.7, coneOpacity: 0.26 });
    m.sl.enabled = 0;
    mergeStatic(m.group, [m.rotor, m.tail, m.sl.holder]);
    return m;
  },
  // Medevac 1: white with a red band; a landing light (beam only) forward and down
  medevac() {
    const m = heliModel(0xf0f0ec, 0xc81e1e, 4);
    m.land = makeSearchlight(m.group, 2.5, 0.6, 0, { angle: 0.2, len: 34, noLight: true, coneOpacity: 0.2, housing: false });
    m.land.holder.quaternion.setFromUnitVectors(new V3(0, 0, 1), new V3(1, -1.3, 0).normalize()); m.land.enabled = 0;
    mergeStatic(m.group, [m.rotor, m.tail, m.land.holder]);
    return m;
  }
};

const _hd = new V3(), _ht = new V3(), _hc = new THREE.Color(), HC_WHITE = new THREE.Color(0xf4f0e8);
class Heli {
  constructor(type, cs, short, pad, padH) {
    this.type = type; this.spec = HELI_TYPES[type]; this.cs = cs; this.short = short; this.air = true;
    this.radio = titleCase(cs); this.callRef = null; this.cadState = 'quarters';
    this.pad = pad; this.padH = padH;
    this.model = HELI_MODELS[type](); scene.add(this.model.group);
    this.pos = new V3(pad.x, pad.y, pad.z); this.h = padH; this.v = 0; this.vy = 0; this.bank = 0; this.pitch = 0; this.rpm = 0; this.rot = 0;
    this.state = 'quarters'; this.ph = 'pad'; this.t = 0; this.goal = null; this.gy = pad.y; this.dust = 0; this.said = false;
    this.place();
  }
  get label() { return HELI_STATES[this.state]; }
  get moving() { return this.ph === 'lift' || this.ph === 'fly' || this.ph === 'hover' || this.ph === 'descend'; }
  /* a call: up from the pad (or the LZ) and to the call's site */
  dispatch(s) {
    this.site = s; this.state = 'turnout'; this.said = false;
    if (this.ph === 'pad') { this.ph = 'spinup'; this.t = 0; }
    if (s.kind === 'air') this.goal = { kind: 'exit', x: s.fx, z: s.fz };
    else if (this.type === 'air1') { const [x, z] = s.house ? [s.house.x, s.house.z] : siteXZ(s, s.a, s.kind === 'business' ? EDGE + 8 : 0); this.goal = { kind: 'orbit', x, z }; }
    else { const l = lzFor(s); this.goal = { kind: 'land', x: l.x, y: 0, z: l.z, h: null, lz: l }; }
  }
  /* released by the dispatcher: Air 1 flies home; Medevac 1 takes the patient to the hospital's roof (its home) */
  release() {
    if (this.type === 'medevac') { this.callRef = null; this.state = 'transporting'; } else this.state = 'returning';
    if (this.ph === 'away') {   // back over the edge of the screen from where it went
      const G = this.goal; this.pos.set(G.x, this.spec.alt, G.z); this.h = Math.atan2(this.pad.z - G.z, this.pad.x - G.x); this.v = this.spec.cruise;
      this.ph = 'fly'; this.model.group.visible = true;
    }
    if (this.ph === 'ground') { this.ph = 'lift'; this.gy = this.pos.y; }
    this.goal = { kind: 'land', x: this.pad.x, y: this.pad.y, z: this.pad.z, h: this.padH, home: true };
  }
  /* reached the call: orbiting / on the ground at the LZ / gone over the horizon */
  arrive(away) { if (this.state === 'responding' || this.state === 'turnout') this.state = away ? 'away' : 'on_scene'; this.t = 0; }
  /* on the ground at the goal */
  landed() {
    const G = this.goal; this.pos.set(G.x, G.y, G.z); this.v = this.vy = 0; this.bank = this.pitch = 0; this.t = 0;
    if (!G.home) { this.ph = 'ground'; this.arrive(false); return; }
    this.ph = 'pad'; this.goal = null;
    if (this.state === 'transporting') { this.state = 'at_hospital'; this.hospT = rand(40, 80); } else this.state = 'quarters';
  }
  update(dt) {
    this.t += dt; const S = this.spec, p = this.pos;
    switch (this.ph) {
      case 'pad':
        this.rpm = Math.max(0, this.rpm - dt / 14);
        if (this.state === 'at_hospital' && this.t > this.hospT) this.state = 'quarters';
        break;
      case 'spinup':
        this.rpm = Math.min(1, this.rpm + dt / S.spin);
        if (this.rpm >= 1) { this.ph = 'lift'; this.gy = p.y; }
        break;
      case 'ground': this.rpm += (0.7 - this.rpm) * Math.min(1, dt * 0.4); break;   // idling at the LZ
      case 'lift':
        if (this.state === 'turnout') this.state = 'responding';
        this.rpm = Math.min(1, this.rpm + dt / 3); if (this.rpm < 0.97) break;
        this.vy = Math.min(3, this.vy + dt * 1.5); p.y += this.vy * dt;
        if (p.y > this.gy + 8) this.ph = 'fly';
        break;
      case 'fly': this.fly(dt); break;
      case 'hover': {   // over the spot: settle, turn to the pad's heading, then down
        const G = this.goal, k = Math.min(1, dt * 1.2);
        p.x += (G.x - p.x) * k; p.z += (G.z - p.z) * k; this.v *= 1 - k;
        if (G.h != null) this.h = approachAngle(this.h, G.h, 0.45 * dt);
        this.vy = clamp((G.y + 8 - p.y) * 0.8, -2, 2); p.y += this.vy * dt;
        this.ease(0, 0, dt);
        if (this.t > 2.5 && (G.h == null || Math.abs(angleWrap(G.h - this.h)) < 0.01) && Math.abs(p.y - G.y - 8) < 0.6) { this.ph = 'descend'; this.t = 0; }
        break;
      }
      case 'descend': {
        const G = this.goal;
        p.x += (G.x - p.x) * Math.min(1, dt * 2); p.z += (G.z - p.z) * Math.min(1, dt * 2);
        this.vy = -clamp((p.y - G.y) * 0.35, 0.35, 2.2); p.y += this.vy * dt;
        this.ease(0, 0, dt);
        if (p.y <= G.y + 0.01) this.landed();
        break;
      }
    }
    this.rot += this.rpm * 30 * dt;
    this.wash(dt);
    this.lights(dt);
    this.place();
  }
  /* in the air: heading toward the goal (an orbit: along the circle), speed and height eased, banked into turns */
  fly(dt) {
    const G = this.goal, S = this.spec, p = this.pos, dx = G.x - p.x, dz = G.z - p.z, d = Math.hypot(dx, dz);
    let hd, vt, alt = S.alt, w = 0;
    if (G.kind === 'orbit') {
      const a = Math.atan2(p.z - G.z, p.x - G.x);
      hd = a + Math.PI / 2 + clamp((d - S.orbitR) / S.orbitR * 1.5, -1.2, 1.3); vt = d > S.orbitR + 60 ? S.cruise : S.orbitV;
      if (G.follow && d > S.orbitR + 15) { hd = Math.atan2(dz, dx); vt = S.cruise * 1.25; }   // (a pursuit: straight after the car)
      if (!G.there && Math.abs(d - S.orbitR) < 12) { G.there = true; this.arrive(false); }
      if (this.state === 'on_scene' && !this.said && this.t > 25 && this.callRef) { this.said = true; RADIO.say(this.radio, radioLine(AIR_LINES.air1.update, DISPATCH.vars(this.callRef, this)), 'pd'); }
    } else {
      hd = Math.atan2(dz, dx);
      if (G.kind === 'exit') {
        vt = S.cruise;
        if (d < 40) { this.ph = 'away'; this.model.group.visible = false; this.v = 0; this.arrive(true); return; }
      } else {
        vt = Math.min(S.cruise, Math.sqrt(2 * 1.4 * Math.max(0, d - 0.5)));   // slows to stop over the spot
        alt = Math.min(alt, G.y + 8 + d * 0.22);                                  // the approach: down to 8 m over it
        w = smoothstep(40, 8, d);                                                 // the last metres: straight at it, whatever the heading
        if (d < 2.5 && this.v < 2) { this.ph = 'hover'; this.t = 0; return; }
      }
    }
    const err = angleWrap(hd - this.h), wmax = Math.min(0.6, 9.8 * Math.tan(0.45) / Math.max(this.v, 3));
    const dh = clamp(err, -wmax * dt, wmax * dt); this.h += dh;
    const v0 = this.v; this.v += clamp(vt * (w ? 1 : Math.max(0.35, Math.cos(err))) - this.v, -2.5 * dt, 2.5 * dt);
    _hd.set(Math.cos(this.h), 0, Math.sin(this.h));
    if (w > 0 && d > 1e-3) _hd.lerp(_ht.set(dx / d, 0, dz / d), w).normalize();
    p.addScaledVector(_hd, this.v * dt);
    this.vy += clamp(clamp((alt - p.y) * 0.5, -3.5, 3.5) - this.vy, -2 * dt, 2 * dt); p.y += this.vy * dt;
    this.ease(clamp(Math.atan(this.v * dh / dt / 9.8), -0.45, 0.45), -0.12 * this.v / S.cruise - clamp((this.v - v0) / dt, -2, 2) * 0.05, dt);
  }
  ease(bank, pitch, dt) { const k = Math.min(1, dt * 2); this.bank += (bank - this.bank) * k; this.pitch += (pitch - this.pitch) * k; }
  /* rotor wash: dust (snow in winter) blown out from under it when it is low */
  wash(dt) {
    const low = this.ph === 'spinup' || this.ph === 'lift' || this.ph === 'hover' || this.ph === 'descend' || this.ph === 'ground';
    const gy = this.ph === 'hover' || this.ph === 'descend' ? this.goal.y : this.gy, hgt = this.pos.y - gy;
    if (!low || this.rpm < 0.6 || hgt > 14) return;
    this.dust += dt * 14 * this.rpm * (1 - hgt / 14); _hc.copy(ENV.dustTint).lerp(HC_WHITE, 0.4);   // (lighter than the ground: seen on grass too)
    while (this.dust > 1) {
      this.dust--;
      const a = rand(0, TAU), r = rand(3, 6), s = rand(4, 8);
      _ht.set(this.pos.x + Math.cos(a) * r, gy + 0.8, this.pos.z + Math.sin(a) * r);
      FX.smoke.spawn(_ht, { s0: 1.6, s1: 5.5, life: 1.6, a0: gy > 1 ? 0.15 : 0.45, color: _hc, v: _hd.set(Math.cos(a) * s, 0.8, Math.sin(a) * s), drag: 1.6 });
    }
  }
  /* nav lights while the engine runs; Air 1's searchlight on the ground under its orbit (wandering: a search), Medevac 1's
     landing light on the approach (both by night only: updateLights) */
  lights(dt) {
    const m = this.model, on = this.rpm > 0.05 ? 1 : 0, k = Math.min(1, dt * 2);
    for (const l of m.lights) l.userData.on = on;
    if (m.sl) {
      m.sl.enabled += ((this.state === 'on_scene' && this.ph === 'fly' ? 1 : 0) - m.sl.enabled) * k;
      if (this.goal && this.goal.kind === 'orbit') {
        m.group.updateMatrixWorld();
        m.sl.holder.lookAt(_ht.set(this.goal.x + Math.sin(T * 0.31) * 9, 0, this.goal.z + Math.cos(T * 0.23) * 9));
      }
    }
    if (m.land) m.land.enabled += ((this.ph === 'hover' || this.ph === 'descend' || (this.ph === 'fly' && this.goal.kind === 'land' && Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < 150) ? 1 : 0) - m.land.enabled) * k;
  }
  place() {
    const m = this.model;
    m.group.position.copy(this.pos); m.group.rotation.set(this.bank, -this.h, this.pitch, 'YZX');
    m.rotor.rotation.y = this.rot; m.tail.rotation.z = this.rot * 1.6;
    const blur = this.rpm > 0.85, f = Math.floor(T * 60);
    for (let i = 0; i < m.blades.length; i++) m.blades[i].visible = !blur || ((f + i) & 1) === 0;
    m.disc.material.opacity = 0.3 * smoothstep(0.4, 1, this.rpm);
  }
}

function buildHelis() {
  const H = CITY_LAYOUT.helipad, Hs = CITY_LAYOUT.hospital, P = Hs.pad;
  HELIS = [new Heli('air1', 'AIR 1', 'AIR1', { x: H.x, y: 0.035, z: H.z }, 0),
    new Heli('medevac', 'MEDEVAC 1', 'MDV1', { x: P.x, y: Hs.h + 0.45, z: P.z }, Math.PI)];
}

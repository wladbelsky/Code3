'use strict';
/* ===== The town (1 unit = 1 m): street grid, the public safety complex, the hospital, houses, street furniture =====
   CITY_LAYOUT is the one source of positions (the streets, the complex's bays / lot / helipad, the hospital's ER bay
   and roof pad); buildCity() builds everything static into one group (mergeStatic) and fills CITY: houses with their
   addresses, the fire station's bays (roll-up doors), the police lot's stalls, the signals, the name signs, and the
   keep-out rectangles behind CITY.vegAt (where trees may grow) and pavedAt.
   World axes as in Forward Air Base: +X east, +Z south, +Y up; the camera looks from the south-west, so north is the
   top-left of the screen, east the top-right. Traffic keeps right.                                               */
const ROAD_W = 9, WALK_W = 3, LANE_OFF = 2.25, STATION_NO = 12;
const EDGE = ROAD_W / 2 + WALK_W;   // a street's centre line to its blocks' edge (7.5)
const CITY_LAYOUT = {
  ext: 520,                         // the streets run on to here (calls out of town leave the screen along them)
  inner: 157.5,                     // the town's edge: the outer streets' far sidewalk
  streets: [{ name: 'BIRCH ST', z: -150 }, { name: 'OAK ST', z: -50 }, { name: 'MAIN ST', z: 50 }, { name: 'ELM ST', z: 150 }],   // east-west
  avenues: [{ name: 'PINE AVE', x: -150 }, { name: '1ST AVE', x: -50 }, { name: '2ND AVE', x: 50 }, { name: 'CEDAR AVE', x: 150 }],  // north-south
  signals: [[-50, -50], [50, -50], [-50, 50], [50, 50]],   // intersections with traffic lights (the others: all-way stops)
  // the public safety complex (the centre block, x / z -42.5..42.5)
  // the fire station: six drive-through bays (out the front onto Main St; in from the yard behind, up the one-way lane at laneX)
  fire: { x0: -38.5, x1: -4, zBack: 8, zFront: 28, hall: 7, h: 11.2, bays: 6, door: 4.2, apron: 42.5, rear: -14, laneX: 0.5, yardZ: -6.5 },
  police: { x0: 8, x1: 40, z0: 12, z1: 32, h: 8 },
  lot: { x0: 6, x1: 41, z0: -41, z1: 6, gate: -26 },     // the police lot, its gate onto 2nd Ave at z = gate
  helipad: { x: -20, z: -27, r: 7.5 },
  hospital: { x0: 80, x1: 130, z0: -38, z1: 2, h: 18, pad: { x: 108, z: -18, r: 6.5 }, er: { x0: 66, x1: 110, z0: 2, z1: 20 }, bay: { x: 81, z: 30 } }
};
const L_ = CITY_LAYOUT;
const CITY = {
  group: null, winMat: null, poolMat: null, bayLight: null,
  houses: [], bays: [], stalls: [], signals: [], signs: [], keep: [], zones: [], paved: [], drives: [],
  sigT: 0,
  /* 0 = no tree here, 1 = open country (forests in clumps); in between: yards, the park */
  vegAt(x, z) {
    for (const s of L_.streets) if (Math.abs(z - s.z) < EDGE + 1.5) return 0;
    for (const a of L_.avenues) if (Math.abs(x - a.x) < EDGE + 1.5) return 0;
    for (const r of this.keep) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return 0;
    if (Math.abs(x) > L_.inner || Math.abs(z) > L_.inner) return 1;
    for (const r of this.zones) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return r[4];
    return 0.06;
  },
  /* the signal for traffic moving along an axis ('ns': on an avenue, 'ew': on a street): 'g' / 'y' / 'r' */
  signal(axis) {
    const t = this.sigT % SIG_CYCLE, ns = t < 20 ? 'g' : t < 23 ? 'y' : 'r', ew = t < 25 ? 'r' : t < 45 ? 'g' : t < 48 ? 'y' : 'r';   // 2 s all-red between
    return axis === 'ns' ? ns : ew;
  },
  update(dt) {
    this.sigT += dt;
    const ns = this.signal('ns'), ew = this.signal('ew'), L = this.sigLamps; let moved = false;
    for (const h of this.signals) {   // the head's lit lamp: moved over the red / amber / green one and recoloured
      const s = h.axis === 'ns' ? ns : ew; if (s === h.shown) continue; h.shown = s; moved = true;
      L.setMatrixAt(h.i, _sgM.copy(h.base).multiply(_sgT.makeTranslation(0, SIG_LAMP_Y[s], 0.19))); L.setColorAt(h.i, SIG_COL[s]);
    }
    if (moved) { L.instanceMatrix.needsUpdate = true; L.instanceColor.needsUpdate = true; }
    for (const b of this.bays) for (const d of [b.door, b.rear]) {   // roll-up doors: up in ~4 s, down in ~5 s
      if (d.k === d.want) continue;
      d.k = d.want > d.k ? Math.min(d.want, d.k + dt / 4) : Math.max(d.want, d.k - dt / 5);
      d.g.scale.y = 1 - 0.96 * d.k;
    }
  },
  /* the town's name on the signs (CFG.townName) */
  setTown(name) { for (const s of this.signs) if (s.town) drawSign(s, s.text(name)); }
};
const SIG_CYCLE = 50;
const SIG_OFF = 0x262822, SIG_LAMP_Y = { r: 0.36, y: 0, g: -0.36 }, SIG_COL = { r: new THREE.Color(0xff3020), y: new THREE.Color(0xffb020), g: new THREE.Color(0x30ff90) };
const _sgM = new THREE.Matrix4(), _sgT = new THREE.Matrix4();
function pavedAt(x, z) {
  for (const s of L_.streets) if (Math.abs(z - s.z) < EDGE) return true;
  for (const a of L_.avenues) if (Math.abs(x - a.x) < EDGE) return true;
  for (const r of CITY.paved) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return true;
  return false;
}

/* ---- builders ---- */
/* a flat rectangle on the ground (y: layering — road 0.01, sidewalk 0.02, lots 0.025, markings 0.04) */
function pave(p, x0, z0, x1, z1, c, y) {
  const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mm(c)); m.receiveShadow = true; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); p.add(m); return m;
}
function disc(p, x, z, r, c, y, seg) {
  const g = new THREE.CircleGeometry(r, seg || 32); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mm(c)); m.receiveShadow = true; m.position.set(x, y, z); p.add(m); return m;
}
/* a gable roof: ridge along local x (width w), slopes down to ±d/2, apex h above y */
function gableRoof(p, w, d, h, mat, y) {
  const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, h); s.lineTo(-d / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(-w / 2, y, 0);
  const m = shade(new THREE.Mesh(g, mm(mat))); p.add(m); return m;
}
const keepOut = (x0, z0, x1, z1) => CITY.keep.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
const paved = (x0, z0, x1, z1) => { keepOut(x0, z0, x1, z1); CITY.paved.push(CITY.keep[CITY.keep.length - 1]); };
const drive = (x0, z0, x1, z1) => CITY.drives.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);   // where a driveway meets the street
/* a text sign on a canvas texture (redrawn when the town is renamed) */
function makeSign(p, text, w, h, bg, fg, x, y, z, rotY, town) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.max(32, Math.round(512 * h / w));
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex }); mat.userData.day = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.y = rotY || 0; p.add(m);
  const s = { c, tex, mat, mesh: m, bg, fg, town: typeof text === 'function', text: typeof text === 'function' ? text : () => text };
  drawSign(s, s.text(CFG.townName)); CITY.signs.push(s);
  return s;
}
function drawSign(s, txt) {
  const g = s.c.getContext('2d'), W = s.c.width, H = s.c.height;
  g.fillStyle = s.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = s.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let f = Math.floor(H * 0.62); g.font = `bold ${f}px Arial, Helvetica, sans-serif`;
  while (g.measureText(txt).width > W * 0.92 && f > 8) { f--; g.font = `bold ${f}px Arial, Helvetica, sans-serif`; }
  g.fillText(txt, W / 2, H / 2 + 1);
  s.tex.needsUpdate = true;
}
function parkCar(p, x, z, rotY) { const m = randomCar(); m.position.set(x, 0, z); m.rotation.y = rotY; p.add(m); return m; }

/* ---- streets: asphalt, sidewalks, centre lines, crosswalks, signals, stop signs, street lights ---- */
const ASPHALT = 0x3a3c40, WALK = 0x94928a, CONCRETE = 0x9a968c, LOT = 0x46484c, YELLOW = 0xd8b030, WHITE = 0xe8e8e2;
function buildStreets(g, dyn) {
  const E = L_.ext, lines = [...L_.streets.map(s => ({ ax: 'ew', at: s.z })), ...L_.avenues.map(a => ({ ax: 'ns', at: a.x }))];
  const cross = { ew: L_.avenues.map(a => a.x), ns: L_.streets.map(s => s.z) };
  for (const l of lines) {
    const ew = l.ax === 'ew', seg = (a0, a1, w, c, y) => ew ? pave(g, a0, l.at - w / 2, a1, l.at + w / 2, c, y) : pave(g, l.at - w / 2, a0, l.at + w / 2, a1, c, y);
    seg(-E, E, ROAD_W, ASPHALT, ew ? 0.01 : 0.012);
    // sidewalks both sides, inside the town, broken where a crossing street's asphalt is
    const bs = [-L_.inner, ...cross[l.ax], L_.inner];
    for (let i = 0; i + 1 < bs.length; i++) {
      const a0 = i ? bs[i] + ROAD_W / 2 : bs[i], a1 = i + 2 < bs.length ? bs[i + 1] - ROAD_W / 2 : bs[i + 1];
      for (const sd of [-1, 1]) {
        const o = l.at + sd * (ROAD_W / 2 + WALK_W / 2);
        if (ew) pave(g, a0, o - WALK_W / 2, a1, o + WALK_W / 2, WALK, 0.02); else pave(g, o - WALK_W / 2, a0, o + WALK_W / 2, a1, WALK, 0.021);
      }
    }
    // the double yellow line, broken at the crossings
    const cs = [-E, ...cross[l.ax].flatMap(c => [c - EDGE - 1, c + EDGE + 1]), E].sort((a, b) => a - b);
    for (let i = 0; i < cs.length; i += 2) for (const o of [-0.13, 0.13]) {
      if (ew) deckLine(g, cs[i], l.at + o, cs[i + 1], l.at + o, 0.12, YELLOW, 0.04); else deckLine(g, l.at + o, cs[i], l.at + o, cs[i + 1], 0.12, YELLOW, 0.04);
    }
  }
  // intersections: crosswalks + stop lines; signals or stop signs
  const isSig = (x, z) => L_.signals.some(s => s[0] === x && s[1] === z);
  for (const a of L_.avenues) for (const s of L_.streets) {
    const x = a.x, z = s.z, sig = isSig(x, z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // crosswalk across the street arriving from (dx, dz): zebra bars
      const c = ROAD_W / 2 + 1.6;
      for (let k = -3.75; k <= 3.75; k += 1.25) {
        if (dx) deckLine(g, x + dx * (c - 1.2), z + k, x + dx * (c + 1.2), z + k, 0.5, WHITE, 0.041);
        else deckLine(g, x + k, z + dz * (c - 1.2), x + k, z + dz * (c + 1.2), 0.5, WHITE, 0.041);
      }
      // stop line on the arriving lane (right-hand traffic: arriving from +x drives -x on the north half, z - LANE_OFF)
      const sl = c + 1.8;
      if (dx) deckLine(g, x + dx * sl, z - dx * 0.3, x + dx * sl, z - dx * ROAD_W / 2, 0.45, WHITE, 0.041);
      else deckLine(g, x + dz * 0.3, z + dz * sl, x + dz * ROAD_W / 2, z + dz * sl, 0.45, WHITE, 0.041);
    }
    if (sig) buildSignals(g, dyn, x, z);
    else for (const [cx, cz, ry] of [[1, 1, 0], [-1, 1, -Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI / 2]]) {   // all-way stop: a sign on each near-right corner
      const px = x + cx * (ROAD_W / 2 + 1), pz = z + cz * (ROAD_W / 2 + 1);
      cyl(g, 0.04, 0.04, 2.3, 5, 0x8a8c90, px, 1.15, pz);
      const sg = new THREE.Group(); sg.position.set(px, 2.35, pz); sg.rotation.y = ry; g.add(sg);   // the octagon faces the arriving traffic
      const o = cyl(sg, 0.38, 0.38, 0.04, 8, 0xb01818, 0, 0, 0); o.rotation.x = Math.PI / 2; o.rotation.y = Math.PI / 8;
    }
  }
}
/* a signal intersection: a pole on each near-right corner with a mast arm over the arriving lane and a head facing it */
function buildSignals(g, dyn, x, z) {
  // [corner dx, dz, the arriving traffic's axis, the direction the head faces (the arriving traffic comes from there)]
  for (const [cx, cz, axis, fx, fz] of [[1, 1, 'ns', 0, 1], [-1, 1, 'ew', -1, 0], [-1, -1, 'ns', 0, -1], [1, -1, 'ew', 1, 0]]) {
    const px = x + cx * (ROAD_W / 2 + 0.9), pz = z + cz * (ROAD_W / 2 + 0.9);
    cyl(g, 0.12, 0.15, 6.2, 6, 0x5a5c58, px, 3.1, pz);
    // the arm reaches over the arriving lane: across the road, perpendicular to the traffic
    const ex = fx ? px : px - cx * 4.2, ez = fx ? pz - cz * 4.2 : pz;
    box(g, fx ? 0.12 : Math.abs(ex - px) + 0.2, 0.14, fx ? Math.abs(ez - pz) + 0.2 : 0.12, 0x5a5c58, (px + ex) / 2, 6.0, (pz + ez) / 2);
    for (const [hx, hz, hy] of [[ex, ez, 5.4], [px, pz, 3.2]]) {
      const head = new THREE.Group(); head.position.set(hx, hy, hz); head.rotation.y = Math.atan2(fx, fz); g.add(head);
      box(head, 0.42, 1.15, 0.32, 0x2a2c24, 0, 0, 0);
      for (const y of [0.36, 0, -0.36]) box(head, 0.24, 0.24, 0.06, SIG_OFF, 0, y, 0.18);   // dark: merged with the rest
      CITY.signals.push({ axis, head, i: CITY.signals.length, base: null, shown: null });
    }
  }
}

/* the lit lamps of all the signal heads: one InstancedMesh (one draw call, not three meshes a head swapping materials) */
function buildSigLamps(g, dyn) {
  g.updateMatrixWorld(true);
  const L = CITY.sigLamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.25, 0.07), new THREE.MeshBasicMaterial(), CITY.signals.length);
  for (const h of CITY.signals) { h.base = h.head.matrixWorld.clone(); L.setMatrixAt(h.i, h.base); L.setColorAt(h.i, SIG_COL.r); }
  L.frustumCulled = false; g.add(L); dyn.push(L);
}

/* street lights: every ~34 m on alternating sides, inside the town; none right at a crossing or across a driveway
   (built last: the driveways are known then) */
function buildStreetLights(g, dyn) {
  const lines = [...L_.streets.map(s => ({ ax: 'ew', at: s.z })), ...L_.avenues.map(a => ({ ax: 'ns', at: a.x }))];
  const cross = { ew: L_.avenues.map(a => a.x), ns: L_.streets.map(s => s.z) }, glow = [], pools = [];
  const onDrive = (x, z) => CITY.drives.some(r => x > r[0] - 2.5 && x < r[2] + 2.5 && z > r[1] - 2.5 && z < r[3] + 2.5);
  for (const l of lines) {
    const ew = l.ax === 'ew';
    for (let a = -L_.inner + 10, i = 0; a < L_.inner - 6; a += 34, i++) {
      if (cross[l.ax].some(c => Math.abs(c - a) < 13)) continue;
      const sd = i % 2 ? 1 : -1, o = l.at + sd * (ROAD_W / 2 + 0.5), x = ew ? a : o, z = ew ? o : a;
      if (onDrive(x, z)) continue;
      cyl(g, 0.09, 0.12, 7.5, 6, 0x4a4c50, x, 3.75, z);
      const ax = ew ? 0 : -sd * 1.4, az = ew ? -sd * 1.4 : 0;
      box(g, ew ? 0.12 : 2.8, 0.12, ew ? 2.8 : 0.12, 0x4a4c50, x + ax / 2, 7.4, z + az / 2);
      box(g, ew ? 0.5 : 0.9, 0.18, ew ? 0.9 : 0.5, 0x2c2e30, x + ax, 7.3, z + az);
      glow.push([x + ax, 7.15, z + az, 0xffc878]); pools.push([x + ax, z + az]);
    }
  }
  navLights(g, glow, null, 1.3);
  const pm = CITY.poolMat = new THREE.MeshBasicMaterial({ map: TEX.soft, color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pg = new THREE.CircleGeometry(1, 24); pg.rotateX(-Math.PI / 2);
  const inst = new THREE.InstancedMesh(pg, pm, pools.length), mtx = new THREE.Matrix4();
  pools.forEach(([x, z], i) => inst.setMatrixAt(i, mtx.makeScale(8, 1, 8).setPosition(x, 0.06, z)));
  inst.renderOrder = 1; inst.frustumCulled = false; g.add(inst); dyn.push(inst);
  CITY.pools = pools;   // (WEATHER: their reflections on a wet road)
}

/* ---- the public safety complex ---- */
const BRICK = 0x8c3e2e, TRIM = 0xd8d2c2, BAY_DOOR = 0xe8e6e0;
/* a roll-up door: a group hanging from the top of the opening, scaled up into the header as it opens (facing ±z) */
function bayDoor(g, dyn, x, z, h, w, face) {
  const dg = new THREE.Group(); dg.position.set(x, h, z); if (face < 0) dg.rotation.y = Math.PI; g.add(dg); dyn.push(dg);
  box(dg, w, h, 0.1, BAY_DOOR, 0, -h / 2, 0);
  box(dg, w - 0.4, 0.5, 0.04, 0x3a4a58, 0, -h * 0.36, 0.06);                    // window strip
  for (let k = 1; k < 8; k++) box(dg, w, 0.03, 0.03, 0xbab8b0, 0, -k * h / 8, 0.06);
  mergeStatic(dg, []);   // one mesh a door (it moves as a whole)
  return { g: dg, k: 0, want: 0 };
}
function buildComplex(g, dyn) {
  const F = L_.fire, w = F.x1 - F.x0, dep = F.zFront - F.zBack, bw = w / F.bays, cx = (F.x0 + F.x1) / 2, cz = (F.zBack + F.zFront) / 2;
  // the station: drive-through apparatus bays on the ground floor (doors front and back), the quarters upstairs
  pave(g, F.x0, F.zFront, F.x1, F.apron, CONCRETE, 0.026); paved(F.x0, F.rear, F.x1, F.apron); drive(F.x0, F.zFront, F.x1, F.apron);
  pave(g, F.x0 + 0.4, F.zBack, F.x1 - 0.4, F.zFront, 0x8a8880, 0.03);
  for (const x of [F.x0 + 0.2, F.x1 - 0.2]) box(g, 0.4, F.hall, dep, BRICK, x, F.hall / 2, cz);
  box(g, w, F.h - F.hall, dep, BRICK, cx, F.hall + (F.h - F.hall) / 2, cz);                       // upper floor
  box(g, w + 0.8, 0.5, dep + 0.8, ROOF_MAT, cx, F.h + 0.25, cz);
  box(g, w + 0.1, 0.3, dep + 0.1, TRIM, cx, F.hall + 0.15, cz);                                    // floor line
  box(g, w - 0.8, 0.1, dep - 0.8, 0x7a7872, cx, F.hall - 0.06, cz);                               // hall ceiling
  const lightMat = CITY.bayLight = new THREE.MeshPhongMaterial({ color: 0xd8d4c8, emissive: 0x000000, flatShading: true });
  const dh = F.door + 0.2;
  for (const zf of [F.zFront - 0.2, F.zBack + 0.2]) {
    for (let i = 0; i <= F.bays; i++) {   // piers between the doors, the header over them
      const xa = i === 0 ? F.x0 : F.x0 + i * bw - (bw - F.door) / 2, xb = i === F.bays ? F.x1 : F.x0 + i * bw + (bw - F.door) / 2;
      box(g, xb - xa, dh, 0.4, BRICK, (xa + xb) / 2, dh / 2, zf);
    }
    box(g, w, F.hall - dh, 0.4, BRICK, cx, dh + (F.hall - dh) / 2, zf);
  }
  box(g, w + 0.1, 0.35, 0.5, TRIM, cx, dh + 0.17, F.zFront - 0.2);
  for (let i = 0; i < F.bays; i++) {
    const x = F.x0 + (i + 0.5) * bw;
    box(g, 2.6, 0.12, 1.2, lightMat, x, F.hall - 0.2, cz);                                         // ceiling light (lit at night)
    CITY.bays.push({ i, x, zFront: F.zFront, zBack: F.zBack, door: bayDoor(g, dyn, x, F.zFront - 0.08, F.door, F.door, 1), rear: bayDoor(g, dyn, x, F.zBack + 0.08, F.door, F.door, -1), unit: null });
  }
  for (let x = F.x0 + 2; x < F.x1 - 1; x += 3.4) box(g, 1.6, 1.4, 0.1, CITY.winMat, x, F.hall + 2.0, F.zFront + 0.03);   // quarters windows
  for (let z = F.zBack + 2; z < F.zFront - 1; z += 3.2) box(g, 0.1, 1.4, 1.6, CITY.winMat, F.x0 - 0.03, F.hall + 2.0, z);
  makeSign(g, n => `${n} FIRE DEPT · STATION ${STATION_NO}`, w * 0.8, 1.1, '#e8e2d0', '#7a1a12', cx, dh + 1.3, F.zFront + 0.02, 0, true);
  // hose tower on the lawn west of the hall
  box(g, 3.6, 16, 3.6, BRICK, F.x0 - 1.9, 8, 12); box(g, 4.1, 0.6, 4.1, TRIM, F.x0 - 1.9, 16.3, 12);
  for (const y of [5, 9, 13]) box(g, 0.1, 1.2, 0.8, CITY.winMat, F.x0 - 3.73, y, 12);
  keepOut(F.x0 - 4, F.zBack - 1, F.x1 + 1, F.zFront);
  // the yard behind (the way in, from Main St up the lane), the lane between the station and the police
  pave(g, F.x0, F.rear, 4, F.zBack, CONCRETE, 0.026);
  pave(g, -3, F.zBack, 4, F.apron, LOT, 0.026); paved(-3, F.rear, 4, F.apron); drive(-3, F.zBack, 4, F.apron);
  deckLine(g, F.laneX - 1, 38, F.laneX + 1, 38, 0.15, WHITE, 0.04);
  for (const z of [32, 24, 16]) { deckLine(g, F.laneX, z, F.laneX - 0.7, z + 1.2, 0.18, WHITE, 0.04); deckLine(g, F.laneX, z, F.laneX + 0.7, z + 1.2, 0.18, WHITE, 0.04); deckLine(g, F.laneX, z, F.laneX, z + 2.4, 0.18, WHITE, 0.04); }   // one-way arrows (north)
  // flagpole on the lawn west of the apron
  cyl(g, 0.07, 0.09, 11, 6, 0xcfd2d6, -40.5, 5.5, 38); box(g, 1.8, 1.0, 0.03, 0xb02424, -39.6, 10.3, 38);

  // police station: two storeys, its front (steps, canopy) on Main St
  const P = L_.police, pw = P.x1 - P.x0;
  box(g, pw, P.h, P.z1 - P.z0, 0xc2b8a2, (P.x0 + P.x1) / 2, P.h / 2, (P.z0 + P.z1) / 2);
  box(g, pw + 0.6, 0.45, P.z1 - P.z0 + 0.6, ROOF_MAT, (P.x0 + P.x1) / 2, P.h + 0.22, (P.z0 + P.z1) / 2);
  box(g, pw + 0.12, 0.5, P.z1 - P.z0 + 0.12, 0x24406a, (P.x0 + P.x1) / 2, 3.4, (P.z0 + P.z1) / 2);   // blue band
  for (const y of [1.8, 5.6]) {
    for (let x = P.x0 + 2; x < P.x1 - 1; x += 3) if (y > 3 || Math.abs(x - 24) > 3) box(g, 1.6, 1.4, 0.1, CITY.winMat, x, y, P.z1 + 0.03);
    for (let z = P.z0 + 2; z < P.z1 - 1; z += 3) box(g, 0.1, 1.4, 1.6, CITY.winMat, P.x0 - 0.03, y, z);
  }
  box(g, 4, 2.6, 0.1, 0x3a4a58, 24, 1.3, P.z1 + 0.04); box(g, 6, 0.25, 3, TRIM, 24, 3.0, P.z1 + 1.5);   // doors, canopy
  for (const x of [21.4, 26.6]) cyl(g, 0.12, 0.12, 2.9, 6, TRIM, x, 1.45, P.z1 + 2.8);
  pave(g, 22, P.z1, 26, 42.5, CONCRETE, 0.026); drive(22, P.z1, 26, 42.5);
  makeSign(g, n => `${n} POLICE`, 12, 0.9, '#20365a', '#f0f0f0', 24, 6.9, P.z1 + 0.05, 0, true);
  keepOut(P.x0 - 1, P.z0 - 1, P.x1 + 1, P.z1 + 4);
  cyl(g, 0.07, 0.09, 10, 6, 0xcfd2d6, 14, 5, 38); box(g, 1.7, 0.95, 0.03, 0x24406a, 14.9, 9.4, 38);
  // the lot behind it: two rows of stalls, the gate onto 2nd Ave
  const LT = L_.lot;
  pave(g, LT.x0, LT.z0, LT.x1, LT.z1, LOT, 0.025); paved(LT.x0, LT.z0, LT.x1 + 4.5, LT.z1);
  pave(g, LT.x1, LT.gate - 4, 42.5 + WALK_W, LT.gate + 4, LOT, 0.027); drive(LT.x1, LT.gate - 4, 42.5, LT.gate + 4);
  for (const [z, nose] of [[-36, -1], [-20, 1], [-14, -1]]) for (let x = LT.x0 + 3; x <= LT.x1 - 3; x += 3.2) {
    deckLine(g, x - 1.6, z - 2.7, x - 1.6, z + 2.7, 0.1, WHITE, 0.04);
    CITY.stalls.push({ x, z, rot: nose < 0 ? Math.PI / 2 : -Math.PI / 2, row: z, car: null });
  }
  for (const s of CITY.stalls) if (s.row !== -36 && Math.random() < 0.55) s.car = parkCar(g, s.x, s.z, s.rot);   // staff cars; the patrol row stays free
  // helipad north of the hall: a pad with its lights, a small hangar, a windsock
  const H = L_.helipad;
  pave(g, -40, -41, -6, -15, CONCRETE, 0.025); paved(-40, -41, -6, -15);
  disc(g, H.x, H.z, H.r, 0x5a5c60, 0.032); disc(g, H.x, H.z, H.r - 0.5, 0x6a6c70, 0.034);
  deckLine(g, H.x - 1.4, H.z - 2, H.x - 1.4, H.z + 2, 0.5, WHITE, 0.04); deckLine(g, H.x + 1.4, H.z - 2, H.x + 1.4, H.z + 2, 0.5, WHITE, 0.04); deckLine(g, H.x - 1.4, H.z, H.x + 1.4, H.z, 0.5, WHITE, 0.04);
  const pl = []; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; pl.push([H.x + Math.cos(a) * H.r, 0.15, H.z + Math.sin(a) * H.r, 0x40ff80]); }
  navLights(g, pl, null, 0.7);
  box(g, 9, 5, 9, 0x8a9096, -35.5, 2.5, -36.5); box(g, 9.4, 0.3, 9.4, ROOF_MAT, -35.5, 5.15, -36.5); box(g, 0.1, 4.2, 7, 0xb8bcc0, -31, 2.1, -36.5);
  cyl(g, 0.05, 0.05, 6, 5, 0xcfd2d6, -8, 3, -38); const sock = taper(g, 1.6, 0.6, 0.6, 0xf07020, -7.2, 5.8, -38, 0.5, 0.5, 0); sock.rotation.z = -Math.PI / 2;
  CITY.zones.push([-42.5, -42.5, 42.5, 42.5, 0.04]);
}

/* ---- the hospital (east of the complex): tower with a roof pad, the ER wing and its ambulance bay on Main St ---- */
function buildHospital(g) {
  const Hs = L_.hospital, E = Hs.er, P = Hs.pad, w = Hs.x1 - Hs.x0, d = Hs.z1 - Hs.z0;
  box(g, w, Hs.h, d, 0xd8d2c4, (Hs.x0 + Hs.x1) / 2, Hs.h / 2, (Hs.z0 + Hs.z1) / 2);
  box(g, w + 0.5, 0.9, d + 0.5, 0xc8c2b4, (Hs.x0 + Hs.x1) / 2, Hs.h + 0.45, (Hs.z0 + Hs.z1) / 2);   // parapet
  box(g, w - 0.6, 0.1, d - 0.6, ROOF_MAT, (Hs.x0 + Hs.x1) / 2, Hs.h + 0.06, (Hs.z0 + Hs.z1) / 2);
  for (let f = 0; f < 5; f++) {   // window bands on the west and south faces
    const y = 2 + f * 3.4;
    box(g, 0.1, 1.5, d - 3, CITY.winMat, Hs.x0 - 0.03, y, (Hs.z0 + Hs.z1) / 2);
    if (f > 1) box(g, w - 3, 1.5, 0.1, CITY.winMat, (Hs.x0 + Hs.x1) / 2, y, Hs.z1 + 0.03);
  }
  box(g, 8, 3.5, 6, 0xc8c2b4, 90, Hs.h + 1.75, -30);   // stair / lift house
  // the roof pad: raised deck, H in a circle, edge lights
  box(g, P.r * 2 + 1, 0.4, P.r * 2 + 1, 0x5a5c60, P.x, Hs.h + 0.2, P.z);
  disc(g, P.x, P.z, P.r, 0x707274, Hs.h + 0.42); disc(g, P.x, P.z, P.r - 0.6, 0x5a5c60, Hs.h + 0.43);
  deckLine(g, P.x - 1.3, P.z - 2, P.x - 1.3, P.z + 2, 0.5, 0xd82020, Hs.h + 0.45); deckLine(g, P.x + 1.3, P.z - 2, P.x + 1.3, P.z + 2, 0.5, 0xd82020, Hs.h + 0.45); deckLine(g, P.x - 1.3, P.z, P.x + 1.3, P.z, 0.5, 0xd82020, Hs.h + 0.45);
  const pl = []; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; pl.push([P.x + Math.cos(a) * (P.r + 0.3), Hs.h + 0.6, P.z + Math.sin(a) * (P.r + 0.3), 0x40ff80]); }
  navLights(g, pl, null, 0.7);
  makeSign(g, n => `${n} MEMORIAL HOSPITAL`, 30, 1.6, '#f4f2ec', '#1c4a7a', Hs.x0 - 0.06, Hs.h - 1.4, (Hs.z0 + Hs.z1) / 2, -Math.PI / 2, true);
  // ER wing, canopy over the ambulance bay, the drive from Main St
  box(g, E.x1 - E.x0, 6, E.z1 - E.z0, 0xd0cabc, (E.x0 + E.x1) / 2, 3, (E.z0 + E.z1) / 2);
  box(g, E.x1 - E.x0 + 0.4, 0.4, E.z1 - E.z0 + 0.4, ROOF_MAT, (E.x0 + E.x1) / 2, 6.2, (E.z0 + E.z1) / 2);
  for (let x = E.x0 + 3; x < E.x1 - 2; x += 3.5) if (Math.abs(x - 81) > 6) box(g, 1.8, 1.4, 0.1, CITY.winMat, x, 2.4, E.z1 + 0.03);
  box(g, 5, 2.6, 0.1, 0x3a4a58, 81, 1.3, E.z1 + 0.04);
  box(g, 18, 0.4, 8, TRIM, 81, 4.6, E.z1 + 4);
  for (const x of [73, 89]) for (const z of [E.z1 + 7.6]) cyl(g, 0.16, 0.16, 4.4, 6, TRIM, x, 2.2, z);
  makeSign(g, 'EMERGENCY', 9, 0.9, '#b01818', '#ffffff', 81, 5.25, E.z1 + 8.02, 0, false);
  pave(g, 64, E.z1, 100, 42.5, CONCRETE, 0.026); drive(64, E.z1, 100, 42.5); paved(62, Hs.z0 - 2, Hs.x1 + 2, 42.5);
  keepOut(E.x0 - 1, E.z0 - 1, E.x1 + 1, E.z1 + 9);
  // visitor lot east of the ER drive
  pave(g, 104, 23, 141, 41, LOT, 0.025); paved(104, 23, 141, 41);
  for (const z of [27.5, 36.5]) for (let x = 106.5; x < 140; x += 3) if (Math.random() < 0.7) parkCar(g, x, z, z < 30 ? Math.PI / 2 : -Math.PI / 2);
  CITY.zones.push([57.5, -42.5, 142.5, 42.5, 0.12]);
}

/* ---- the west block: a gas station on the corner of Main St and 1st Ave, a strip mall ---- */
function buildCommerce(g) {
  pave(g, -98, 6, -57.5, 42.5, CONCRETE, 0.026); paved(-98, 6, -57.5, 42.5); drive(-98, 6, -57.5, 42.5);
  box(g, 22, 0.6, 13, 0xe8e6e0, -76, 4.9, 25); box(g, 22.2, 0.25, 13.2, 0xc02020, -76, 4.55, 25);
  for (const x of [-85, -67]) for (const z of [20, 30]) cyl(g, 0.22, 0.22, 4.4, 6, 0xe8e6e0, x, 2.2, z);
  for (const x of [-81, -76, -71]) { box(g, 1.2, 0.3, 6, CONCRETE, x, 0.15, 25); for (const z of [23, 27]) box(g, 0.5, 1.6, 0.8, 0xd8d4c8, x, 1.1, z); }
  box(g, 12, 4.5, 11, 0xd8d0c0, -91, 2.25, 15); box(g, 12.4, 0.4, 11.4, ROOF_MAT, -91, 4.7, 15);
  box(g, 0.1, 2.2, 8, CITY.winMat, -84.97, 1.6, 15);
  cyl(g, 0.15, 0.15, 7, 6, 0x5a5c60, -60.5, 3.5, 38.5); makeSign(g, 'GAS · DIESEL', 4, 1.2, '#c02020', '#ffffff', -60.5, 6.6, 38.5, -Math.PI / 4, false);
  parkCar(g, -81, 21.5, 0); parkCar(g, -71, 28.5, Math.PI); parkCar(g, -89, 8.5, 0);
  // strip mall: shops facing south over their lot
  box(g, 40, 5.5, 16, 0xcab89a, -120, 2.75, -32); box(g, 40.6, 0.5, 16.6, ROOF_MAT, -120, 5.75, -32);
  const awn = [0x2a6a4a, 0xa83020, 0x2a4a8a, 0xc8a030, 0x6a3a7a];
  for (let i = 0; i < 5; i++) {
    const x = -136 + i * 8;
    box(g, 6.6, 2.4, 0.1, CITY.winMat, x, 1.6, -23.97);
    box(g, 7.4, 0.15, 1.6, awn[i], x, 3.25, -23.2).rotation.x = -0.25;
  }
  makeSign(g, 'MAPLE PLAZA', 14, 1.2, '#3a2a1a', '#f2d890', -120, 4.6, -23.9, 0, false);
  pave(g, -141, -24, -99, 4, LOT, 0.025); paved(-141, -41, -99, 4);
  for (const z of [-17, -5]) for (let x = -138; x < -101; x += 3) if (Math.random() < 0.45) parkCar(g, x, z, z < -10 ? Math.PI / 2 : -Math.PI / 2);
  CITY.zones.push([-142.5, -42.5, -57.5, 42.5, 0.1]);
}

/* ---- north of Oak St: the school (a sports field in front), apartments ---- */
function buildSchool(g) {
  box(g, 50, 7, 20, 0x9a4a3a, -14, 3.5, -131); box(g, 50.6, 0.5, 20.6, ROOF_MAT, -14, 7.25, -131);
  box(g, 14, 4.2, 26, 0xa0503e, -32, 2.1, -108); box(g, 14.6, 0.4, 26.6, ROOF_MAT, -32, 4.4, -108);
  for (const y of [1.9, 5.2]) for (let x = -37; x < 10; x += 3.2) box(g, 2, 1.3, 0.1, CITY.winMat, x, y, -120.97);
  for (let z = -119; z < -96; z += 3.2) box(g, 0.1, 1.3, 2, CITY.winMat, -39.03, 1.9, z);
  makeSign(g, n => `${n} HIGH SCHOOL`, 20, 1.2, '#f2eee4', '#6a1a12', -2, 6.0, -120.9, 0, true);
  keepOut(-41, -142, 12, -94);
  pave(g, -22, -118, 38, -102, LOT, 0.025); paved(-22, -118, 38, -102);
  for (let x = -18; x < 36; x += 3) if (Math.random() < 0.5) parkCar(g, x, -114.5, Math.PI / 2);
  box(g, 12, 3.2, 2.6, 0xf0b020, 20, 1.6, -106); // a parked school bus (body)
  // the field: green with white lines, two goals
  pave(g, -20, -96, 40, -60, 0x5a8a3a, 0.022); keepOut(-22, -98, 42, -58);
  for (const [x0, z0, x1, z1] of [[-17, -93, 37, -93], [-17, -63, 37, -63], [-17, -93, -17, -63], [37, -93, 37, -63], [10, -93, 10, -63]]) deckLine(g, x0, z0, x1, z1, 0.15, WHITE, 0.04);
  for (const x of [-17, 37]) { box(g, 0.12, 2.4, 7.3, 0xf0f0f0, x, 1.2, -78); }
  CITY.zones.push([-42.5, -142.5, 42.5, -57.5, 0.08]);
  // apartments (north-east): two three-storey blocks and their lot
  for (const x of [80, 120]) {
    box(g, 34, 10, 14, 0xb8a888, x, 5, -122); box(g, 34.6, 0.5, 14.6, ROOF_MAT, x, 10.25, -122);
    for (let f = 0; f < 3; f++) for (let k = -15; k <= 15; k += 3.4) box(g, 1.4, 1.4, 0.1, CITY.winMat, x + k, 1.9 + f * 3.2, -114.97);
    for (let f = 0; f < 3; f++) for (const k of [-4, 0, 4]) box(g, 0.1, 1.4, 1.4, CITY.winMat, x - 17.03, 1.9 + f * 3.2, -122 + k);
    keepOut(x - 18, -130, x + 18, -113);
  }
  pave(g, 62, -108, 141, -70, LOT, 0.025); paved(62, -108, 141, -70);
  for (const z of [-102, -88, -76]) for (let x = 65; x < 139; x += 3) if (Math.random() < 0.5) parkCar(g, x, z, z === -88 ? -Math.PI / 2 : Math.PI / 2);
  CITY.zones.push([57.5, -142.5, 142.5, -57.5, 0.1]);
}

/* ---- the park (south of Main St): paths, a pond, a playground ---- */
function buildPark(g) {
  const pathC = 0xc0b49a;
  deckLine(g, -40, 100, 40, 100, 2.5, pathC, 0.03); deckLine(g, 0, 58, 0, 142, 2.5, pathC, 0.03);
  deckLine(g, -38, 62, 38, 138, 2, pathC, 0.03); deckLine(g, -38, 138, 38, 62, 2, pathC, 0.03);
  disc(g, 20, 120, 11, 0x3a6a8a, 0.03, 40); disc(g, 20, 120, 12, 0x7a7a60, 0.025, 40); keepOut(7, 107, 33, 133);
  box(g, 7, 0.1, 7, 0xc8a878, -20, 0.05, 80); keepOut(-25, 75, -15, 85);
  keepOut(-31, 109, -13, 127);   // the lawn Medevac 1 lands on (HELI_LZ)
  box(g, 0.15, 2.6, 0.15, 0xc02020, -22, 1.3, 78); box(g, 0.15, 2.6, 0.15, 0xc02020, -18, 1.3, 78); box(g, 4.2, 0.15, 0.15, 0xc02020, -20, 2.6, 78);
  box(g, 2.4, 1.2, 1.2, 0x2a6ab0, -19, 0.6, 82); taper(g, 1.6, 2.2, 0.6, 0xf0c020, -22, 1.1, 82.4, 0.3, 1, 0);
  const gz = new THREE.Group(); gz.position.set(0, 0, 100); g.add(gz);
  cyl(gz, 4, 4, 0.4, 8, 0xd8d0c0, 0, 0.2, 0); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; cyl(gz, 0.12, 0.12, 2.8, 5, 0xf0ece0, Math.cos(a) * 3.6, 1.8, Math.sin(a) * 3.6); }
  const r = cyl(gz, 0.2, 4.6, 1.6, 8, 0x6a4a3a, 0, 4, 0); r.material = HOUSE_ROOFS[0]; keepOut(-5, 95, 5, 105);
  CITY.zones.push([-42.5, 57.5, 42.5, 142.5, 0.45]);
}

/* ---- houses: two rows per residential block, each facing its street, with an address ---- */
const SIDING = [0xd8d0bc, 0xb8c4c8, 0xc8b89a, 0xe0dccc, 0x9aa89a, 0xc4a88a, 0xa8b4c4, 0xd4c4a4];
function buildHouses(g) {
  const blocks = [[-150, -50, -150, -50], [-150, -50, 50, 150], [50, 150, 50, 150]];   // x0, x1 (lines), z0, z1 (lines)
  for (const [ax, bx, az, bz] of blocks) {
    CITY.zones.push([ax + EDGE, az + EDGE, bx - EDGE, bz - EDGE, 0.3]);
    const n = 4, lw = (bx - ax - 2 * EDGE) / n;
    for (const [street, face] of [[az, -1], [bz, 1]]) {   // face: the street is to the north (-1) or south (+1)
      const sName = L_.streets.find(s => s.z === street).name;
      for (let i = 0; i < n; i++) {
        const cx = ax + EDGE + (i + 0.5) * lw, front = street - face * EDGE;
        const lot = { cx, front, face, street: sName, addr: `${2 * Math.round((cx + 400) / 4) + (face > 0 ? 1 : 0)} ${sName}` };
        buildHouse(g, lot); CITY.houses.push(lot);
      }
    }
  }
}
function buildHouse(g, lot) {
  const w = rand(9, 12.5), d = rand(8.5, 10.5), st = Math.random() < 0.45 ? 2 : 1, h = st * 2.9 + 0.5, yard = rand(6.5, 9.5);
  const wall = pick(SIDING), roof = pick(HOUSE_ROOFS), gs = Math.random() < 0.5 ? 1 : -1;   // garage side
  const hg = new THREE.Group(), rot = lot.face > 0 ? 0 : Math.PI;   // local +z = toward the street
  const zc = lot.front - lot.face * (yard + d / 2), xc = lot.cx - gs * lot.face * 2.6;
  hg.position.set(xc, 0, zc); hg.rotation.y = rot; g.add(hg);
  box(hg, w, 0.5, d, 0x8a8478, 0, 0.25, 0);
  box(hg, w, h - 0.5, d, wall, 0, 0.5 + (h - 0.5) / 2, 0);
  gableRoof(hg, w + 0.8, d + 0.9, rand(2.2, 3.4), roof, h);
  for (let s = 0; s < st; s++) {
    const y = 1.75 + s * 2.9;
    for (const x of [-w / 2 + 1.6, w / 2 - 1.6, ...(w > 10.5 ? [0] : [])]) if (s || Math.abs(x - 0.4) > 1.4) box(hg, 1.2, 1.25, 0.1, CITY.winMat, x, y, d / 2 + 0.03);
    for (const sd of [-1, 1]) box(hg, 0.1, 1.25, 1.2, CITY.winMat, sd * (w / 2 + 0.03), y, 0);
  }
  box(hg, 1.0, 2.1, 0.1, 0x4a3426, 0.4, 1.55, d / 2 + 0.04);
  box(hg, 2.4, 0.3, 1.4, CONCRETE, 0.4, 0.15, d / 2 + 0.7);
  // garage beside the house, its door and the driveway out to the street
  const gx = gs * (w / 2 + 3.1);
  box(hg, 6.2, 3.1, 7, wall, gx, 1.55, d / 2 - 3.5);
  const gr = gableRoof(hg, 7.6, 6.6, 1.4, roof, 3.1); gr.position.set(gx, 0, d / 2 - 3.5); gr.rotation.y = Math.PI / 2;
  box(hg, 4.8, 2.3, 0.1, 0xeceae2, gx, 1.15, d / 2 + 0.04);
  const dl = yard + EDGE - ROAD_W / 2;
  pave(hg, gx - 2.6, d / 2, gx + 2.6, d / 2 + dl, CONCRETE, 0.027);
  pave(hg, 0, d / 2 + 1.4, 1.2, d / 2 + yard, CONCRETE, 0.026);
  if (Math.random() < 0.55) { const c = parkCar(hg, gx, d / 2 + rand(2.8, Math.max(3, yard - 2.5)), Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2); c.userData.house = lot; }
  // keep-out (world, axis-aligned: houses turn by 0 / 180 degrees)
  const wx = xc, gwx = xc + (lot.face > 0 ? gx : -gx);
  keepOut(Math.min(wx - w / 2, gwx - 3.1) - 1.5, zc - d / 2 - 1.5, Math.max(wx + w / 2, gwx + 3.1) + 1.5, zc + d / 2 + 1.5);
  keepOut(gwx - 3, lot.front - lot.face * (yard + 0.5), gwx + 3, lot.front); drive(gwx - 2.6, lot.front - lot.face * yard, gwx + 2.6, lot.front);
  Object.assign(lot, { x: xc, z: zc, w, d, h, stories: st, rot, garageX: gwx });
}

/* ---- everything ---- */
function buildCity() {
  const g = new THREE.Group(), dyn = [];
  CITY.winMat = windowMat();
  buildStreets(g, dyn); buildComplex(g, dyn); buildHospital(g); buildCommerce(g); buildSchool(g); buildPark(g); buildHouses(g); buildStreetLights(g, dyn); buildSigLamps(g, dyn);
  mergeStatic(g, [...dyn, ...CITY.signs.map(s => s.mesh)]);
  CITY.group = g;
  return g;
}

'use strict';
/* ===== Vehicle models (1 unit = 1 m). Every builder returns a group facing +x, wheels on y = 0 =====
   Civilian cars (parked in the lots and driveways, later the traffic) and the apparatus of the units.             */
const CAR_COLORS = [0xd8d8d4, 0x1c1e22, 0x8a8e94, 0x7a1e1e, 0x1e3a6a, 0x2f4a36, 0xb8b2a2, 0x4a4e56, 0x9a6a2a, 0xe8e6e0];
const GLASS = 0x22303c, TIRE = 0x16171a, RIM = 0x9a9ca0, HEADLAMP = 0xf4f0dc;
function wheels(g, xs, zs, r, w) {
  for (const x of xs) for (const z of zs) { const t = cyl(g, r, r, w, 10, TIRE, x, r, z); t.rotation.x = Math.PI / 2; }
}
/* kind: sedan / suv / pickup / van */
const CAR_SPECS = {
  sedan:  { L: 4.7, W: 1.82, body: 0.72, cab: [2.5, 0.62, 0.15], r: 0.32 },
  suv:    { L: 4.9, W: 1.95, body: 0.95, cab: [2.9, 0.75, -0.1], r: 0.38 },
  pickup: { L: 5.6, W: 2.0, body: 0.95, cab: [1.9, 0.8, 0.7], r: 0.4, bed: true },
  van:    { L: 5.2, W: 2.0, body: 1.0, cab: [3.9, 1.0, -0.4], r: 0.36 }
};
function carModel(kind, color) {
  const S = CAR_SPECS[kind], g = new THREE.Group(), y0 = S.r * 0.9, [cl, ch, cx] = S.cab;
  box(g, S.L, S.body, S.W, color, 0, y0 + S.body / 2, 0);
  taper(g, cl, ch, S.W * 0.92, GLASS, cx, y0 + S.body + ch / 2, 0, 0.78, 0.86, -0.12);
  box(g, cl * 0.74, 0.06, S.W * 0.8, color, cx - 0.12, y0 + S.body + ch + 0.02, 0);   // roof
  if (S.bed) box(g, 2.2, 0.35, S.W * 0.96, color, -S.L / 2 + 1.15, y0 + S.body + 0.17, 0);
  const hy = y0 + S.body * 0.62, ty = y0 + S.body * 0.66, lz = S.W / 2 - 0.3;
  for (const sd of [-1, 1]) {
    box(g, 0.08, 0.18, 0.44, HEADLAMP, S.L / 2, hy, sd * lz);                         // headlights
    box(g, 0.08, 0.15, 0.36, 0x8a1010, -S.L / 2, ty, sd * (lz + 0.02));               // tail lights
  }
  box(g, 0.06, 0.2, S.W - 1.25, 0x2a2c2e, S.L / 2 + 0.01, hy - 0.02, 0);              // grille
  wheels(g, [S.L * 0.32, -S.L * 0.32], [S.W / 2 - 0.12, -S.W / 2 + 0.12], S.r, 0.26);
  g.userData.len = S.L; g.userData.wid = S.W;
  return g;
}
const randomCar = () => carModel(pick(['sedan', 'sedan', 'sedan', 'suv', 'suv', 'pickup', 'van']), pick(CAR_COLORS));

/* ===== Apparatus: engine, ladder, rescue, medic, chief, patrol =====
   Every builder returns { group, bars, len, wid, dyn?, aerial? }: bars = the light bar segments ({ mesh, col, ph }:
   colour 'r' / 'b' / 'w' / 'a', flash phase 0 / 1) — units.js swaps their materials (LB_MATS) as they flash; the
   static rest is merged by the unit (mergeStatic) with the segments and the moving parts (dyn) kept dynamic. */
const FIRE_RED = 0xb3161a, FIRE_WHITE = 0xeeece6, CHROME = 0xc4c8cc, DIAMOND = 0x9a9ea2, CAB_GLASS = 0x1c2630;
/* liveries: the town's own (the defaults) and the neighbours' passing through (VISITORS: a county fire district in lime,
   a private ambulance service in blue, the sheriff in green and tan) */
const LIVERY = {
  town: { body: FIRE_RED, band: FIRE_WHITE, stripe: 0xc81e1e, mark: 0x2a5ab0, car: 'sedan', paint: 0x15171a, doors: 0xf2f2f0, bar: ['r', 'r', 'b', 'b'] },
  county: { body: 0xb8c823, band: FIRE_WHITE },
  ambulance: { stripe: 0x1f4fa8, mark: 0xc81e1e },
  sheriff: { car: 'suv', paint: 0x26382a, doors: 0xd6cba8, bar: ['r', 'b', 'b', 'r'] }
};
const livery = l => Object.assign({}, LIVERY.town, l || {});
const LB_MATS = {
  r: [M(0x5a1010), M(0xff3020, { emissive: 0xff2010 })], b: [M(0x101a5a), M(0x3060ff, { emissive: 0x2050ff })],
  w: [M(0x8a8a86), M(0xffffff, { emissive: 0xfff4e0 })], a: [M(0x6a4a10), M(0xffb020, { emissive: 0xff9a10 })]
};
/* a light bar across the roof at x (along the vehicle), y (its base), w wide (z); cols = segment colours left → right */
function lightBar(g, bars, x, y, w, cols, depth) {
  const d = depth || 0.3, sw = w / cols.length;
  box(g, d + 0.04, 0.08, w + 0.04, 0x222326, x, y + 0.04, 0);
  cols.forEach((c, i) => { const m = box(g, d, 0.14, sw - 0.03, LB_MATS[c][0], x, y + 0.15, -w / 2 + sw * (i + 0.5)); bars.push({ mesh: m, col: c, ph: i < cols.length / 2 ? 0 : 1 }); });
}
/* a corner / side flasher (a small box) */
function flasher(g, bars, x, y, z, c, ph, sx, sy, sz) { const m = box(g, sx || 0.12, sy || 0.22, sz || 0.22, LB_MATS[c][0], x, y, z); bars.push({ mesh: m, col: c, ph }); return m; }
/* a fire apparatus cab (front at x = fx, back at fx − 2.4): windscreen, side windows, white roof band, light bar */
function fireCab(g, bars, fx, W, h, L) {
  const bx = fx - 1.2, y0 = 0.95;
  box(g, 2.4, h - y0, W, L.body, bx, y0 + (h - y0) / 2, 0);
  box(g, 2.44, 0.22, W + 0.02, L.band, bx, h - 0.1, 0);                          // the roof band (its top just over the cab's: no z-fighting)
  box(g, 0.06, 0.95, W - 0.3, CAB_GLASS, fx + 0.01, h - 0.85, 0);
  for (const sd of [-1, 1]) { box(g, 1.7, 0.85, 0.05, CAB_GLASS, bx + 0.2, h - 0.85, sd * (W / 2 + 0.01)); box(g, 0.06, 1.0, 0.05, 0x222326, bx - 0.3, h - 0.85, sd * (W / 2 + 0.02)); }
  box(g, 0.25, 0.4, W + 0.1, CHROME, fx + 0.1, 0.75, 0);                        // bumper
  box(g, 0.05, 0.5, W * 0.6, 0x3a3c3e, fx + 0.02, 1.35, 0);                      // grille
  lightBar(g, bars, bx + 0.6, h + 0.01, W * 0.86, ['r', 'r', 'w', 'r', 'r']);
  // the front: headlights either side of the grille, grille lights, warning lights up on the roof band, corner flashers
  for (const sd of [-1, 1]) {
    box(g, 0.06, 0.3, 0.5, HEADLAMP, fx + 0.03, 1.17, sd * (W / 2 - 0.62));   // (over the bumper)
    flasher(g, bars, fx + 0.06, 1.5, sd * 0.36, sd < 0 ? 'r' : 'w', sd < 0 ? 1 : 0, 0.08, 0.2, 0.34);
    flasher(g, bars, fx + 0.04, h - 0.1, sd * (W / 2 - 0.34), 'r', sd < 0 ? 1 : 0, 0.06, 0.18, 0.42);
    flasher(g, bars, fx + 0.02, 1.15, sd * (W / 2 - 0.2), sd < 0 ? 'r' : 'w', sd < 0 ? 0 : 1);
  }
}
function stripe(g, x0, x1, y, W, c) { for (const sd of [-1, 1]) box(g, x1 - x0, 0.16, 0.03, c, (x0 + x1) / 2, y, sd * (W / 2 + 0.01)); }
function compartments(g, x0, x1, y0, y1, W, n) {   // roll-up compartment doors along both sides
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) for (const sd of [-1, 1]) box(g, w - 0.12, y1 - y0, 0.04, CHROME, x0 + w * (i + 0.5), (y0 + y1) / 2, sd * (W / 2 + 0.01));
}
function axle(g, x, W, r) { wheels(g, [x], [W / 2 - 0.25, -W / 2 + 0.25], r, 0.36); }
function engineModel(liv) {
  const g = new THREE.Group(), bars = [], L = 10.2, W = 2.5, fx = L / 2, LV = livery(liv);
  fireCab(g, bars, fx, W, 3.1, LV);
  box(g, L - 2.4, 1.95, W, LV.body, -1.2, 0.95 + 0.97, 0);                       // body
  compartments(g, -4.7, 2.3, 1.05, 2.45, W, 4);
  stripe(g, -L / 2, fx - 2.4, 2.65, W, LV.band);
  box(g, 5.4, 0.35, W - 0.4, 0x3a3434, -2.2, 3.05, 0);                           // hose bed
  for (const sd of [-1, 1]) box(g, 6.2, 0.1, 0.12, DIAMOND, -1.6, 3.05, sd * (W / 2 - 0.1));
  box(g, 5.6, 0.12, 0.35, 0xb8b8b4, -1.4, 3.3, -W / 2 + 0.3);                   // ground ladders on the rack
  box(g, 0.3, 1.9, W, DIAMOND, -L / 2 + 0.15, 1.9, 0);                           // tailboard
  for (const sd of [-1, 1]) flasher(g, bars, -L / 2 - 0.02, 2.75, sd * (W / 2 - 0.2), sd < 0 ? 'r' : 'a', sd < 0 ? 0 : 1);
  axle(g, fx - 1.2, W, 0.55); axle(g, -2.8, W, 0.55);
  return { group: g, bars, len: L, wid: W };
}
/* rear-mount aerial: the turntable over the back axles, the ladder lying forward over the cab (aerial: yaw / pitch / fly) */
function ladderModel(liv) {
  const g = new THREE.Group(), bars = [], L = 12.4, W = 2.5, fx = L / 2;
  fireCab(g, bars, fx, W, 3.1, livery(liv));
  box(g, L - 2.4, 1.55, W, FIRE_RED, -1.2, 0.95 + 0.77, 0);
  compartments(g, -5.4, 3.3, 1.05, 2.3, W, 5);
  stripe(g, -L / 2, fx - 2.4, 2.4, W, FIRE_WHITE);
  for (const sd of [-1, 1]) box(g, 0.9, 0.25, 0.5, DIAMOND, -4.0, 0.8, sd * (W / 2 + 0.25));   // outrigger housings
  const yawG = new THREE.Group(); yawG.position.set(-4.4, 2.5, 0); g.add(yawG);
  cyl(yawG, 1.05, 1.1, 0.35, 12, 0x5a5c60, 0, 0.17, 0);
  box(yawG, 0.9, 1.0, 0.7, FIRE_RED, -0.2, 0.7, 0.75);                           // turntable console
  const pitchG = new THREE.Group(); pitchG.position.set(0.2, 0.75, 0); yawG.add(pitchG);
  for (const sd of [-1, 1]) box(pitchG, 10.4, 0.42, 0.08, 0xd8dadc, 5.1, 0.2, sd * 0.55);
  for (let x = 0.4; x < 10.4; x += 0.75) box(pitchG, 0.05, 0.05, 1.1, 0xbcbec0, x, 0.05, 0);
  const fly = new THREE.Group(); pitchG.add(fly);
  for (const sd of [-1, 1]) box(fly, 9.6, 0.3, 0.06, 0xe8eaec, 5.4, 0.3, sd * 0.42);
  box(fly, 0.5, 0.6, 1.1, 0x5a5c60, 10.0, 0.3, 0);                               // tip
  axle(g, fx - 1.2, W, 0.55); axle(g, -3.4, W, 0.55); axle(g, -4.7, W, 0.55);
  for (const sd of [-1, 1]) flasher(g, bars, -L / 2 - 0.02, 2.3, sd * (W / 2 - 0.2), sd < 0 ? 'r' : 'a', sd < 0 ? 0 : 1);
  return { group: g, bars, len: L, wid: W, aerial: { yawG, pitchG, fly }, dyn: [yawG, pitchG, fly] };
}
function rescueModel(liv) {
  const g = new THREE.Group(), bars = [], L = 10.4, W = 2.55, fx = L / 2, LV = livery(liv);
  fireCab(g, bars, fx, W, 3.15, LV);
  box(g, L - 2.5, 2.5, W, LV.body, -1.25, 0.95 + 1.25, 0);
  compartments(g, -4.9, 2.4, 1.05, 3.0, W, 5);
  box(g, L - 2.5, 0.3, W + 0.02, LV.band, -1.25, 3.3, 0);
  box(g, 3.0, 0.5, 1.6, 0x5a5c60, -2.4, 3.65, 0);                                // light tower / gear on the roof
  for (const sd of [-1, 1]) { flasher(g, bars, -L / 2 - 0.02, 3.0, sd * (W / 2 - 0.2), sd < 0 ? 'r' : 'w', sd < 0 ? 0 : 1); flasher(g, bars, -L / 2 + 0.3, 3.55, sd * (W / 2 - 0.15), 'r', sd < 0 ? 1 : 0, 0.24, 0.2, 0.16); }
  axle(g, fx - 1.2, W, 0.55); axle(g, -3.0, W, 0.55);
  return { group: g, bars, len: L, wid: W };
}
/* Type I ambulance: a truck cab and a box module, white with a red stripe; light bar and box corner lights */
function medicModel(liv) {
  const g = new THREE.Group(), bars = [], L = 7.2, W = 2.4, fx = L / 2, LV = livery(liv);
  box(g, 1.7, 1.15, W - 0.1, 0xf2f2ee, fx - 0.85, 1.25, 0);                     // hood
  box(g, 1.4, 1.1, W - 0.1, 0xf2f2ee, fx - 2.4, 2.0, 0);                         // cab
  taper(g, 0.5, 0.75, W - 0.2, CAB_GLASS, fx - 1.55, 2.12, 0, 1, 0.95, -0.15);
  for (const sd of [-1, 1]) box(g, 0.9, 0.6, 0.05, CAB_GLASS, fx - 2.4, 2.2, sd * (W / 2 - 0.04));
  box(g, 0.2, 0.3, W, CHROME, fx + 0.05, 0.75, 0);
  box(g, 0.04, 0.42, 0.8, 0x3a3c3e, fx + 0.01, 1.22, 0);                         // grille
  for (const sd of [-1, 1]) {                                                    // headlights, grille lights
    box(g, 0.05, 0.28, 0.5, HEADLAMP, fx + 0.02, 1.15, sd * (W / 2 - 0.42));
    flasher(g, bars, fx + 0.04, 1.54, sd * 0.28, 'r', sd < 0 ? 1 : 0, 0.07, 0.17, 0.3);
  }
  const bx0 = -L / 2, bx1 = fx - 3.1;
  box(g, bx1 - bx0, 2.35, W, 0xf4f4f0, (bx0 + bx1) / 2, 0.85 + 1.17, 0);         // module
  stripe(g, bx0, fx, 1.45, W, LV.stripe); stripe(g, bx0, bx1, 2.95, W, LV.stripe);
  for (const sd of [-1, 1]) box(g, 0.6, 0.6, 0.04, LV.mark, bx0 + 1.6, 2.2, sd * (W / 2 + 0.02));   // the side marking (a square)
  box(g, 0.05, 1.7, 1.6, 0xe8e8e4, bx0 - 0.01, 1.6, 0);                          // rear doors
  lightBar(g, bars, fx - 2.4, 2.55, W * 0.8, ['r', 'r', 'w', 'r', 'r'], 0.25);
  for (const sd of [-1, 1]) {
    flasher(g, bars, bx1 + 0.02, 3.05, sd * (W / 2 - 0.15), 'r', sd < 0 ? 0 : 1, 0.12, 0.2, 0.2);
    flasher(g, bars, bx0 - 0.02, 3.05, sd * (W / 2 - 0.15), 'r', sd < 0 ? 1 : 0, 0.12, 0.2, 0.2);
    flasher(g, bars, bx0 - 0.03, 2.75, sd * 0.2, 'a', sd < 0 ? 0 : 1, 0.1, 0.16, 0.18);
  }
  wheels(g, [fx - 1.1, -1.9], [W / 2 - 0.22, -W / 2 + 0.22], 0.45, 0.32);
  return { group: g, bars, len: L, wid: W };
}
/* lights in the grille of a car-based unit (front at x, lamp height y): two small flashers between the headlights */
function grilleLights(g, bars, x, y, cols) { for (const sd of [-1, 1]) flasher(g, bars, x, y, sd * 0.24, sd < 0 ? cols[0] : cols[1], sd < 0 ? 0 : 1, 0.06, 0.14, 0.26); }
function chiefModel() {
  const g = carModel('suv', FIRE_RED), bars = [], S = CAR_SPECS.suv, y0 = S.r * 0.9;
  for (const sd of [-1, 1]) box(g, 4.0, 0.14, 0.02, FIRE_WHITE, 0, 0.95, sd * 0.99);
  lightBar(g, bars, -0.1, y0 + S.body + S.cab[1] + 0.06, 1.4, ['r', 'r', 'w', 'r']);
  grilleLights(g, bars, S.L / 2 + 0.05, y0 + S.body * 0.62 - 0.02, ['r', 'w']);
  return { group: g, bars, len: S.L, wid: S.W };
}
/* patrol car: black with white doors (the sheriff: an SUV, green with tan doors), a red / blue bar, a push bumper with
   lights in it */
function patrolModel(liv) {
  const LV = livery(liv), S = CAR_SPECS[LV.car], g = carModel(LV.car, LV.paint), bars = [], y = S.r * 0.9, fx = S.L / 2;
  for (const sd of [-1, 1]) box(g, 2.3, S.body - 0.06, 0.03, LV.doors, 0.1, y + S.body / 2 + 0.01, sd * (S.W / 2 + 0.015));
  box(g, 0.1, 0.12, 1.5, 0x15171a, fx + 0.32, y + 0.3, 0);                        // push bumper: the bar, its uprights
  for (const sd of [-1, 1]) box(g, 0.34, 0.5, 0.08, 0x15171a, fx + 0.15, y + 0.42, sd * 0.55);
  grilleLights(g, bars, fx + 0.36, y + 0.48, ['r', 'b']);
  lightBar(g, bars, 0, y + S.body + S.cab[1] + 0.06, 1.5, LV.bar);
  return { group: g, bars, len: S.L, wid: S.W };
}
/* ===== Routine vehicles (traffic.js ROUTINE): the school bus, the garbage truck, the delivery van — { group, bars, len, wid };
   bars are their warning lights (the bus's red flashers, the truck's amber beacon, the van's hazards) ===== */
function busModel() {
  const g = new THREE.Group(), bars = [], L = 11.2, W = 2.5, fx = L / 2, Y = 0xf2b51c;
  box(g, 1.7, 1.0, W - 0.3, Y, fx - 0.85, 1.25, 0);                              // hood
  box(g, L - 1.7, 2.35, W, Y, -0.85, 0.75 + 1.17, 0);                            // body
  box(g, 0.06, 0.9, W - 0.4, CAB_GLASS, fx - 1.72, 2.3, 0);                      // windscreen
  for (const sd of [-1, 1]) {
    for (let x = fx - 2.6; x > -L / 2 + 0.6; x -= 1.05) box(g, 0.8, 0.62, 0.04, CAB_GLASS, x, 2.35, sd * (W / 2 + 0.01));
    for (const y of [1.45, 1.75]) box(g, L - 1.8, 0.07, 0.03, 0x1a1a1a, -0.85, y, sd * (W / 2 + 0.02));   // rub rails
    box(g, 0.06, 0.26, 0.4, HEADLAMP, fx + 0.01, 1.2, sd * (W / 2 - 0.5));
    flasher(g, bars, fx - 1.7, 2.95, sd * (W / 2 - 0.3), 'r', sd < 0 ? 0 : 1, 0.12, 0.2, 0.26);   // the red flashers, front and back
    flasher(g, bars, -L / 2 - 0.02, 2.95, sd * (W / 2 - 0.3), 'r', sd < 0 ? 1 : 0, 0.12, 0.2, 0.26);
  }
  box(g, 0.2, 0.3, W, 0x1a1a1a, fx + 0.05, 0.7, 0);
  box(g, L - 1.8, 0.1, W - 0.1, 0xf6f2e8, -0.85, 3.15, 0);                       // roof
  wheels(g, [fx - 1.1, -L / 2 + 2.6], [W / 2 - 0.25, -W / 2 + 0.25], 0.5, 0.34);
  return { group: g, bars, len: L, wid: W };
}
function garbageModel() {
  const g = new THREE.Group(), bars = [], L = 9.2, W = 2.5, fx = L / 2, G = 0x2f6b3a;
  box(g, 2.0, 2.0, W, 0xeeeeea, fx - 1.0, 1.75, 0);                              // cab
  box(g, 0.06, 0.8, W - 0.4, CAB_GLASS, fx + 0.01, 2.15, 0);
  box(g, 0.2, 0.35, W, CHROME, fx + 0.05, 0.75, 0);
  for (const sd of [-1, 1]) box(g, 0.06, 0.26, 0.42, HEADLAMP, fx + 0.02, 1.15, sd * (W / 2 - 0.45));
  box(g, 5.4, 2.6, W, G, fx - 2.0 - 2.7, 0.85 + 1.3, 0);                         // body
  taper(g, 1.8, 2.4, W, 0x24522c, -L / 2 + 0.9, 0.85 + 1.2, 0, 1, 1, 0.35);      // hopper
  box(g, 0.08, 1.2, W - 0.5, 0x1a1a1a, -L / 2 + 0.02, 1.4, 0);
  for (const sd of [-1, 1]) flasher(g, bars, fx - 1.0, 2.85, sd * 0.35, 'a', sd < 0 ? 0 : 1, 0.3, 0.2, 0.3);   // the beacon
  wheels(g, [fx - 1.1, -1.9, -3.1], [W / 2 - 0.25, -W / 2 + 0.25], 0.5, 0.34);
  return { group: g, bars, len: L, wid: W };
}
function deliveryModel() {
  const S = CAR_SPECS.van, g = carModel('van', 0x6a4a2c), bars = [], y = S.r * 0.9, hy = y + S.body * 0.62;
  for (const sd of [-1, 1]) {
    box(g, 3.0, 0.5, 0.03, 0xe6d6a8, -0.5, y + S.body + 0.45, sd * (S.W / 2 + 0.015));   // the company's stripe
    flasher(g, bars, S.L / 2 + 0.02, hy, sd * (S.W / 2 - 0.12), 'a', 0, 0.06, 0.14, 0.16);   // hazards (together)
    flasher(g, bars, -S.L / 2 - 0.02, hy + 0.05, sd * (S.W / 2 - 0.12), 'a', 0, 0.06, 0.14, 0.16);
  }
  return { group: g, bars, len: S.L, wid: S.W };
}
const suspectModel = () => ({ group: carModel('sedan', 0xb02818), bars: [], len: CAR_SPECS.sedan.L, wid: CAR_SPECS.sedan.W, dyn: [] });   // (the car in a pursuit)
const UNIT_MODELS = { engine: engineModel, ladder: ladderModel, rescue: rescueModel, medic: medicModel, chief: chiefModel, patrol: patrolModel, suspect: suspectModel };

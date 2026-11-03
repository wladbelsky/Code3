'use strict';
/* ===== Call types and the places they happen =====
   A site is a curb on a street: { name (the CAD address), ax, at, a (along the street), side (±1: the curb right / left
   of the centre line, +x / +z), cross (the cross street), kind: house / business / street / far, house? }.
   siteDest(site, slot) is where a unit pulls over: at the curb on the site's side (half on the sidewalk, off the lane),
   `slot` × 13 m along the way it drives there. A far site (mutual aid) is a street's far end: the units drive out of
   town and are gone for a while.
   INCIDENT_TYPES: name (CAD type), kind (the line pools: ON_SCENE / UPDATE_LINES), svc (who tones out: fire / ems / pd),
   units (types needed, one each), extra ([type, chance] added sometimes), at (site kinds), dwell (s on scene after the
   first arrival), w (weight per load tier: routine / busy / surge), self (a patrol's own stop: no tone-out), details. */
const INCIDENT_TYPES = {
  medical:   { name: 'MEDICAL', kind: 'medical', svc: 'ems', units: ['medic'], extra: [['engine', 0.35]], at: ['house', 'house', 'business'], dwell: [60, 110], w: [6, 5, 4],
    details: ['Caller reports a male, 60s, chest pain.', 'Female, 80s, difficulty breathing.', 'Diabetic, not acting right.', 'Caller states her husband is dizzy and pale.', 'Unknown medical, caller hung up.'] },
  fall:      { name: 'FALL', kind: 'medical', svc: 'ems', units: ['medic'], at: ['house', 'business'], dwell: [50, 90], w: [3, 2, 2],
    details: ['Elderly female fell, possible hip injury.', 'Male fell from a ladder, conscious and breathing.', 'Fall in the parking lot, wrist injury.'] },
  alarm:     { name: 'FIRE ALARM', kind: 'alarm', svc: 'fire', units: ['engine', 'ladder'], at: ['business'], dwell: [50, 90], w: [3, 3, 2],
    details: ['Commercial alarm, general fire.', 'Alarm company reports a smoke detector, zone 4.', 'Waterflow alarm, no callback.'] },
  structure: { name: 'STRUCTURE FIRE', kind: 'structure', svc: 'fire', units: ['engine', 'ladder', 'rescue', 'medic', 'chief', 'patrol'], at: ['house'], dwell: [180, 300], w: [0.3, 1, 2],
    details: ['Multiple callers reporting smoke from the roof.', 'Neighbor reports flames from a window, unknown if occupied.', 'Caller reports a fire in the kitchen, everyone is out.'] },
  mva:       { name: 'MVA WITH INJURIES', kind: 'mva', svc: 'fire', units: ['engine', 'medic', 'patrol'], at: ['crossing'], dwell: [80, 140], w: [1, 2.5, 3],
    details: ['Two vehicles, one person complaining of neck pain.', 'Caller reports a car into a pole, driver is out.', 'T-bone collision, airbags deployed.'] },
  vehicle:   { name: 'VEHICLE FIRE', kind: 'vehicle', svc: 'fire', units: ['engine'], at: ['street'], dwell: [50, 90], w: [0.6, 1, 1.5],
    details: ['Car on fire on the shoulder, driver is out.', 'Smoke from under the hood of a pickup.'] },
  gas:       { name: 'GAS ODOR', kind: 'gas', svc: 'fire', units: ['engine', 'chief'], at: ['house', 'business'], dwell: [60, 120], w: [0.8, 1, 1],
    details: ['Resident reports a strong odor of gas in the basement.', 'Odor of gas outside the building.'] },
  stop:      { name: 'TRAFFIC STOP', kind: 'stop', svc: 'pd', units: ['patrol'], at: ['street'], dwell: [40, 80], w: [3, 3, 2], self: true },
  suspicious:{ name: 'SUSPICIOUS VEHICLE', kind: 'pd', svc: 'pd', units: ['patrol'], at: ['street', 'business'], dwell: [40, 70], w: [2, 1.5, 1],
    details: ['Vehicle parked with the engine running for an hour.', 'Caller reports a van circling the block.'] },
  burglary:  { name: 'BURGLARY ALARM', kind: 'pd', svc: 'pd', units: ['patrol', 'patrol'], at: ['business', 'house'], dwell: [60, 110], w: [1.5, 2, 2],
    details: ['Alarm company reports a rear door, zone 2.', 'Motion alarm, interior, no keyholder.'] },
  disturbance: { name: 'DISTURBANCE', kind: 'pd', svc: 'pd', units: ['patrol', 'patrol'], at: ['house', 'business'], dwell: [60, 120], w: [1.5, 2, 3],
    details: ['Caller reports loud yelling next door.', 'Two males arguing in the parking lot.', 'Neighbor dispute over a fence.'] },
  mutual:    { name: 'MUTUAL AID - STRUCTURE FIRE', kind: 'far', svc: 'fire', units: ['engine', 'chief'], at: ['far'], dwell: [150, 260], w: [0.3, 0.6, 1] }
};

/* ---- sites ---- */
const lineOf = (ax, at) => ax === 'ew' ? CITY_LAYOUT.streets.find(s => s.z === at) : CITY_LAYOUT.avenues.find(a => a.x === at);
/* the nearest cross street to a place on a street */
function crossOf(ax, a) {
  const L = ax === 'ew' ? CITY_LAYOUT.avenues.map(v => [v.x, v.name]) : CITY_LAYOUT.streets.map(v => [v.z, v.name]);
  return L.reduce((b, c) => Math.abs(c[0] - a) < Math.abs(b[0] - a) ? c : b)[1];
}
const blockNo = a => (Math.floor((a + 200) / 100) + 1) * 100;
/* a site on a street's curb */
function site(kind, ax, at, a, side, name) { return { kind, ax, at, a, side, name: name || `${blockNo(a) + Math.round(((a + 200) % 100) / 2) * 2 + (side > 0 ? 1 : 0)} ${lineOf(ax, at).name}`, cross: crossOf(ax, a) }; }
/* the businesses (their fronts on a street: the side away from the centre line toward them) */
const BUSINESSES = [
  () => site('business', 'ns', -150, -14, 1, 'MAPLE PLAZA, 1110 PINE AVE'),
  () => site('business', 'ew', 50, -78, -1, 'GAS STATION, 622 MAIN ST'),
  () => site('business', 'ew', -50, 8, -1, `${CFG.townName} HIGH SCHOOL, 300 OAK ST`),
  () => site('business', 'ew', -50, 104, -1, 'OAKWOOD APARTMENTS, 904 OAK ST'),
  () => site('business', 'ew', 50, 22, 1, 'CENTRAL PARK, 400 MAIN ST')
];
function houseSite(h) { const st = CITY_LAYOUT.streets.find(s => s.name === h.street); return Object.assign(site('house', 'ew', st.z, h.x, -h.face, h.addr), { house: h }); }
/* somewhere along a street in town, clear of the crossings and of driveways */
function streetSite() {
  const L = CITY_LAYOUT;
  for (let n = 0; n < 30; n++) {
    const ew = Math.random() < 0.5, at = ew ? pick(L.streets).z : pick(L.avenues).x, a = rand(-L.inner + 12, L.inner - 12), side = Math.random() < 0.5 ? 1 : -1;
    const cross = (ew ? L.avenues.map(v => v.x) : L.streets.map(v => v.z));
    if (cross.some(c => Math.abs(c - a) < 30)) continue;
    const [x, z] = ew ? [a, at + side * 5] : [at + side * 5, a];
    if (CITY.drives.some(r => x > r[0] - 14 && x < r[2] + 14 && z > r[1] - 6 && z < r[3] + 6)) continue;
    return site('street', ew ? 'ew' : 'ns', at, a, side);
  }
  return site('street', 'ew', 150, 100, -1);
}
/* a crossing: the curb ~22 m up one of its approaches (the crash itself comes with the scenes) */
function crossingSite() {
  const L = CITY_LAYOUT;
  for (let n = 0; n < 30; n++) {
    const s = pick(L.streets), v = pick(L.avenues), ew = Math.random() < 0.5, sg = Math.random() < 0.5 ? 1 : -1, side = Math.random() < 0.5 ? 1 : -1;
    const at = ew ? s.z : v.x, a = (ew ? v.x : s.z) + sg * 22, [x, z] = ew ? [a, at + side * 5] : [at + side * 5, a];
    if (Math.abs(a) > L.inner - 10 || CITY.drives.some(r => x > r[0] - 14 && x < r[2] + 14 && z > r[1] - 6 && z < r[3] + 6)) continue;
    return Object.assign(site('crossing', ew ? 'ew' : 'ns', at, a, side), { name: `${s.name} / ${v.name}` });
  }
  return streetSite();
}
const FAR_TOWNS = { N: 'NORTH VALLEY', S: 'SOUTH BEND', E: 'EASTON', W: 'WESTFIELD' };
function farSite() {
  const d = farDest().far, dirName = d.dir, road = lineOf(d.ax, d.at).name;
  return { kind: 'far', far: d, name: `${road} AT THE ${FAR_TOWNS[dirName]} LINE`, cross: FAR_TOWNS[dirName] };
}
/* a site of a kind, away from the other active calls */
function pickSite(kind, busy) {
  for (let n = 0; n < 20; n++) {
    const s = kind === 'house' ? houseSite(pick(CITY.houses)) : kind === 'business' ? pick(BUSINESSES)() : kind === 'street' ? streetSite() : kind === 'crossing' ? crossingSite() : farSite();
    if (s.kind === 'far' || !busy.some(b => b.kind !== 'far' && b.ax === s.ax && b.at === s.at && Math.abs(b.a - s.a) < 70)) return s;
  }
  return null;
}
/* the curb places for a site's units ({ a, side }): 15 m apart around it on its own side, then across the street; none
   on a crossing or past the town's edge */
function siteSlots(s) {
  if (s.slots) return s.slots;
  const cross = s.ax === 'ew' ? CITY_LAYOUT.avenues.map(v => v.x) : CITY_LAYOUT.streets.map(v => v.z), out = [];
  for (const side of [s.side, -s.side]) for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const a = s.a + k * 15; if (!cross.some(c => Math.abs(c - a) < 16) && Math.abs(a) < CITY_LAYOUT.inner - 8) out.push({ a, side });
  }
  return s.slots = out;
}
/* where a unit pulls over for a site (its slot-th curb place); far: the street's end */
function siteDest(s, slot) {
  if (s.kind === 'far') return { far: s.far };
  const sl = siteSlots(s), { a, side } = sl[(slot || 0) % sl.length];
  const dir = s.ax === 'ew' ? (side > 0 ? 'E' : 'W') : (side > 0 ? 'N' : 'S'), sg = DIRV[dir][s.ax === 'ew' ? 0 : 1], off = s.at + side * (ROAD_W / 2 + 0.5);
  return { ax: s.ax, at: s.at, a: a - sg * 8, dir, curb: s.ax === 'ew' ? [a, off] : [off, a], house: s.house };
}

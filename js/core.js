'use strict';
/* ===== Shared utils, settings, ground & seasons, sun position, textures ===== */
const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function angleWrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function approachAngle(cur, target, maxStep) { const d = angleWrap(target - cur); return cur + clamp(d, -maxStep, maxStep); }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* Settings (overridden by Wallpaper Engine user properties) */
const CFG = {
  zoom: 100,          // %
  camAngle: 135,      // initial camera azimuth, degrees
  camRotate: false,   // slow automatic orbit (no mouse control)
  camSpeed: 2,        // degrees per second
  camDir: 1,          // 1 = clockwise, -1 = counter-clockwise
  camElev: 35.264,    // isometric
  timeMode: 'real',
  fixedHour: 12,
  lat: 41.5,          // sun latitude (fixed, not a user setting)
  lon: -new Date().getTimezoneOffset() / 4,   // longitude estimated from the PC time zone (15° per hour)
  sens: 100,          // audio sensitivity, %
  calls: 5,           // how often calls come in when it is quiet (0 = never)
  traffic: 8,         // civilian cars on the streets by day (fewer at night; 0 = none, up to CIV_MAX)
  townName: 'FAIRHAVEN',   // the town (dispatch, panel)
  season: 'auto',     // auto (PC date) / spring / summer / autumn / winter
  weather: true,      // snowfall in winter, falling leaves in autumn
  terminal: true,     // the dispatch terminal (CAD) on screen
  termPos: 'tl',
  saveState: true,    // remember who is out on a call between sessions
  shadows: true,
  showPanel: true,
  panelPos: 'br',
  panelScale: 100,
  uiColor: '255,186,82'
};

/* ===== Ground & wind =====
   The town stands on flat ground (y = 0); WIND is the drift of smoke and dust. 1 unit = 1 m. */
const WIND = new V3(-1.6, 0, 0.6);
function groundH(x, z) { return 0; }

/* ===== Seasons: auto from the PC date (northern hemisphere) or fixed in the settings =====
   ground = base colour of the terrain texture, grass = its speckles, hg = hemisphere bounce from the ground,
   roof = flat roof colour (snow in winter), veg = vegetation set (terrain.js), leaf = crown tints              */
const SEASONS = {
  spring: { ground: 0x5f7d3a, grass: [0x6f8f44, 0x52702e, 0x7a9a4c, 0x8aa858], hg: 0x343c22, roof: 0x5d636a, veg: 'leaf', leaf: [0x5c8a34, 0x6c9a3c, 0x4f7a2c, 0xd9b8c8, 0x7aa848] },
  summer: { ground: 0x6f7c3a, grass: [0x7f8c44, 0x5f6c30, 0x8f9a50, 0x9a9858], hg: 0x383c22, roof: 0x6a6660, veg: 'leaf', leaf: [0x3f6a28, 0x4c7a30, 0x365e22, 0x5a8638, 0x44702a] },
  autumn: { ground: 0x7a6a3a, grass: [0x8a7440, 0x6a5a30, 0x948048, 0x5e6a32], hg: 0x3a3020, roof: 0x5d636a, veg: 'leaf', leaf: [0xd8a028, 0xc8661e, 0xe0c040, 0xa8401c, 0x8a8a30] },
  winter: { ground: 0xdfe6ee, grass: [0xeef2f6, 0xccd6e0, 0xf6f8fa, 0xb8c4d0], hg: 0x5a6270, roof: 0xe8eef4, veg: 'fir' }
};
function seasonNow() {
  if (CFG.season && CFG.season !== 'auto') return CFG.season;
  const m = getNow().getMonth();
  return m === 11 || m < 2 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
}

/* ===== Sun position (simplified algorithm, ~0.5 deg accuracy) ===== */
function sunPosition(date, lat, lon) {
  const rad = DEG;
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  let gmst = (18.697374558 + 24.06570982441908 * d) % 24; if (gmst < 0) gmst += 24;
  const H = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;
  const elev = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { elev: elev / rad, az: az / rad };
}
function getNow() {
  const d = new Date();
  if (CFG.timeMode === 'fixed') {
    const h = CFG.fixedHour % 24;
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  }
  return d;
}

/* ===== Time-of-day palette keyed by sun elevation ===== */
const SKY_KEYS = [
  { e: -90, sun: 0x7a90c0, si: 0.45, hs: 0x44557e, hg: 0x141a26, hi: 0.85, fog: 0x0b1424, smoke: 0x3a4250 },
  { e: -10, sun: 0x7a90c0, si: 0.45, hs: 0x44557e, hg: 0x141a26, hi: 0.85, fog: 0x0b1424, smoke: 0x3a4250 },
  { e: -4,  sun: 0x7080a8, si: 0.45, hs: 0x4a5078, hg: 0x161820, hi: 0.80, fog: 0x1c2240, smoke: 0x4a4e5c },
  { e: 0,   sun: 0xff7a40, si: 0.80, hs: 0x9a7a96, hg: 0x2a2024, hi: 0.85, fog: 0xb86a54, smoke: 0x6e6262 },
  { e: 6,   sun: 0xffa860, si: 0.95, hs: 0xaeb2c8, hg: 0x2c2622, hi: 0.72, fog: 0xcf9a7c, smoke: 0x9a9090 },
  { e: 20,  sun: 0xfff2dc, si: 1.05, hs: 0xc4dcf0, hg: 0x3a3a36, hi: 0.62, fog: 0x9fc0da, smoke: 0xb8b8b8 },
  { e: 90,  sun: 0xfff6e8, si: 1.10, hs: 0xc8e0f4, hg: 0x3a3a36, hi: 0.62, fog: 0x9fc0da, smoke: 0xbcbcbc }
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
function skyAt(elev) {
  let i = 0; while (i < SKY_KEYS.length - 2 && elev > SKY_KEYS[i + 1].e) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = clamp((elev - a.e) / (b.e - a.e), 0, 1);
  const out = {};
  for (const k of ['sun', 'hs', 'hg', 'fog', 'smoke']) {
    _ca.setHex(a[k]); _cb.setHex(b[k]); out[k] = _ca.clone().lerp(_cb, t);
  }
  out.si = lerp(a.si, b.si, t); out.hi = lerp(a.hi, b.hi, t);
  return out;
}

/* ===== Canvas-generated textures ===== */
function radialTex(stops, size) {
  size = size || 64;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(s => gr.addColorStop(s[0], s[1]));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
function smokeTex() {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = s / 2 + rand(-10, 10), y = s / 2 + rand(-10, 10), r = rand(12, 22);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  return new THREE.CanvasTexture(c);
}
const TEX = {
  glow: radialTex([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]),
  flash: radialTex([[0, 'rgba(255,255,240,1)'], [0.25, 'rgba(255,220,120,0.9)'], [0.6, 'rgba(255,120,30,0.3)'], [1, 'rgba(255,80,0,0)']]),
  soft: radialTex([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]),
  smoke: smokeTex()
};

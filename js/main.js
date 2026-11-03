'use strict';
/* ===== Scene, camera, light & seasons, audio (→ the call load), the panel, Wallpaper Engine properties, main loop ===== */
let scene, camera, renderer, sunLight, hemi;
const FX = {};
let T = 0, paused = false, fpsLimit = 0, lastMs = 0, ready = false;
const ENV = { elev: 30, lightsOn: 0, night: 0, day: 1, ppu: 10, smokeTint: new THREE.Color(0xbbbbbb), dustTint: new THREE.Color(0xa89878) };

/* ---- URL test parameters (for browser preview) ---- */
const QS = new URLSearchParams(location.search);
if (QS.has('hour')) { CFG.timeMode = 'fixed'; CFG.fixedHour = parseFloat(QS.get('hour')); }
if (QS.has('zoom')) CFG.zoom = parseFloat(QS.get('zoom'));
if (QS.has('season')) CFG.season = QS.get('season');

/* ---- Wallpaper Engine properties ---- */
function rgbFromWE(str) { return str.split(' ').map(c => Math.round(clamp(parseFloat(c), 0, 1) * 255)).join(','); }
window.wallpaperPropertyListener = {
  applyUserProperties(p) {
    const has = k => p[k] !== undefined && p[k] !== null;
    if (has('zoom')) CFG.zoom = p.zoom.value;
    if (has('camerarotate')) CFG.camRotate = p.camerarotate.value;
    if (has('rotationspeed')) CFG.camSpeed = p.rotationspeed.value;
    if (has('rotationdirection')) CFG.camDir = parseInt(p.rotationdirection.value, 10) || 1;
    if (has('timemode')) CFG.timeMode = p.timemode.value;
    if (has('fixedhour')) CFG.fixedHour = p.fixedhour.value;
    if (has('audiosensitivity')) CFG.sens = p.audiosensitivity.value;
    if (has('callfrequency')) CFG.calls = p.callfrequency.value;
    if (has('shadows')) CFG.shadows = p.shadows.value;
    if (has('season') && !QS.has('season')) CFG.season = p.season.value;
    if (has('weather')) CFG.weather = p.weather.value;
    if (has('showpanel')) CFG.showPanel = p.showpanel.value;
    if (has('panelposition')) CFG.panelPos = p.panelposition.value;
    if (has('panelscale')) CFG.panelScale = p.panelscale.value;
    if (has('terminal')) CFG.terminal = p.terminal.value;
    if (has('terminalposition')) CFG.termPos = p.terminalposition.value;
    if (has('uicolor')) CFG.uiColor = rgbFromWE(p.uicolor.value);
    if (has('savestate')) CFG.saveState = p.savestate.value;
    if (has('townname')) CFG.townName = String(p.townname.value || '').trim().toUpperCase().slice(0, 18) || 'FAIRHAVEN';
    applySettings();
  },
  applyGeneralProperties(p) { if (p.fps !== undefined) fpsLimit = p.fps; },
  setPaused(v) { paused = v; }
};

let townShown = null;
function applySettings() {
  const panel = document.getElementById('panel');
  if (panel) {
    panel.style.display = CFG.showPanel ? '' : 'none';
    panel.className = 'pos-' + CFG.panelPos + (panel.classList.contains('collapsed') ? ' collapsed' : '');
    panel.style.setProperty('--ui', CFG.uiColor);
    panel.style.setProperty('--scale', CFG.panelScale / 100);
  }
  const title = document.querySelector('#panel .title'); if (title) title.textContent = `◆ ${CFG.townName} · DISPATCH`;
  if (!ready) return;
  if (townShown !== CFG.townName) { townShown = CFG.townName; CITY.setTown(CFG.townName); }
  TERM.apply();
  sunLight.castShadow = CFG.shadows;
  updateCamera(); updateEnvironment();
}

/* ---- init ---- */
function init() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, precision: 'highp', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x9fc0da, 300, 900);
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200);

  hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.6); scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.castShadow = CFG.shadows;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: -200, far: 700 });   // bounds: fitShadow()
  sunLight.shadow.bias = -0.0006; sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight); scene.add(sunLight.target);

  scene.add(buildCity());
  ROADS.build();
  townShown = CFG.townName;
  TERRAIN.build(seasonNow());

  FX.tracers = new Tracers(scene, 600);
  FX.flash = new SpriteFX(scene, TEX.flash, THREE.AdditiveBlending, 120);
  FX.smoke = new SpriteFX(scene, TEX.smoke, THREE.NormalBlending, 360, true);
  FX.scorch = new Scorch(scene, 40);
  FX.fire = new SpriteFX(scene, TEX.flash, THREE.AdditiveBlending, 260);
  FX.water = new SpriteFX(scene, TEX.soft, THREE.NormalBlending, 420, true);
  PROPS.build(); CREW.build();
  FX.lights = new FlashLights(scene, 4);

  ready = true;
  window.addEventListener('resize', resize);
  buildUnits();
  TERM.build();
  buildUI(); applySettings(); resize(); updateEnvironment(); updateLights();
  requestAnimationFrame(frame);
}

/* ---- camera: orthographic, isometric; 1 unit = 1 m, ~125 m of screen height at 100 % ---- */
const VIEW_H = 125, CAM_D = 320, CAM_TGT = new V3(0, 0, 0);
let camAz = CFG.camAngle * DEG;
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  updateCamera();
}
function updateCamera() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  const viewH = VIEW_H * 100 / CFG.zoom;
  camera.left = -viewH * aspect / 2; camera.right = viewH * aspect / 2; camera.top = viewH / 2; camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
  ENV.ppu = h / viewH;
  scene.fog.near = CAM_D - 40; scene.fog.far = CAM_D + 560;
  updateCameraPose();
}
function updateCameraPose() {
  const el = CFG.camElev * DEG;
  camera.position.set(CAM_TGT.x + Math.cos(el) * Math.cos(camAz) * CAM_D, CAM_TGT.y + Math.sin(el) * CAM_D, CAM_TGT.z + Math.cos(el) * Math.sin(camAz) * CAM_D);
  camera.lookAt(CAM_TGT);
}
/* screen helpers (orthographic camera: any zoom / rotation) */
const _nd = new V3(), _ro = new V3(), _rd = new V3();
const VIEW = {
  ndc(p) { return _nd.copy(p).project(camera); },
  onScreen(p, m) { const n = this.ndc(p); return Math.abs(n.x) < 1 + (m || 0) && Math.abs(n.y) < 1 + (m || 0); },
  groundAt(nx, ny, alt, out) {          // the point at height alt seen at screen position (nx, ny)
    _ro.set(nx, ny, -1).unproject(camera); _rd.set(0, 0, -1).transformDirection(camera.matrixWorld);
    return (out || new V3()).copy(_ro).addScaledVector(_rd, (alt - _ro.y) / _rd.y);
  }
};

/* ---- time of day, season & lighting ---- */
const _hg = new THREE.Color();
function updateEnvironment() {
  const season = seasonNow(); if (season !== TERRAIN.season) TERRAIN.build(season);   // a new month, or the setting changed
  const S = SEASONS[season];
  const sp = sunPosition(getNow(), CFG.lat, CFG.lon);
  ENV.elev = sp.elev;
  const k = skyAt(sp.elev);
  const dirOf = (az, el) => new V3(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG));
  const sunDir = dirOf(sp.az, Math.max(sp.elev, 7)), moonDir = dirOf(sp.az + 160, 42);
  const dir = sunDir.lerp(moonDir, smoothstep(-2, -7, sp.elev)).normalize();
  sunLight.position.copy(dir).multiplyScalar(300); sunLight.target.position.set(0, 0, 0);
  sunLight.color.copy(k.sun); sunLight.intensity = k.si;
  _hg.setHex(S.hg).multiplyScalar(lerp(0.35, 1, smoothstep(-8, 12, sp.elev)));
  hemi.color.copy(k.hs); hemi.groundColor.copy(k.hg).lerp(_hg, 0.6); hemi.intensity = k.hi;
  scene.fog.color.copy(k.fog); renderer.setClearColor(k.fog);
  ENV.smokeTint.copy(k.smoke);
  ENV.dustTint.setHex(S.ground).lerp(k.smoke, 0.45);
  ENV.lightsOn = 1 - smoothstep(-3, 5, sp.elev);
  ENV.night = 1 - smoothstep(-10, 1, sp.elev);
  ENV.day = smoothstep(-6, 10, sp.elev);
  CITY.winMat.emissive.setHex(0xffc27a).multiplyScalar(0.75 * ENV.lightsOn);
  CITY.bayLight.emissive.setHex(0xfff0d0).multiplyScalar(0.9 * ENV.lightsOn);
  CITY.poolMat.opacity = 0.42 * ENV.lightsOn;
  for (const s of CITY.signs) s.mat.color.setScalar(lerp(0.32, 1, ENV.day));   // (unlit: dimmed by hand at night)
}
function updateLights() {
  for (const m of NAV_MATS) {
    let a = (m.userData.day ? Math.max(ENV.lightsOn, 0.75) : ENV.lightsOn) * (m.userData.on ?? 1); const b = m.userData.blink;   // light bars flash by day too; on: per unit
    if (b) { const ph = ((T / b.period) + (b.phase || 0)) % 1; a *= ((ph + 1) % 1) < b.duty ? 1 : 0; }
    m.opacity = a; m.size = m.userData.scale * ENV.ppu;
  }
  for (const s of SEARCHLIGHTS) {
    const on = ENV.lightsOn * s.enabled;
    if (s.light) { s.light.intensity = s.o.intensity * on; s.light.visible = ENV.lightsOn > 0; }
    if (s.cone) s.cone.material.uniforms.uOpacity.value = s.o.coneOpacity * on * (0.45 + 0.55 * ENV.night);
  }
}

/* ---- audio → the call load ----
   The music doesn't start a fight here: it is how busy the town is. LOAD.level (0..1) climbs while sound plays (faster
   when it is dense and loud) and drains slowly in silence; the dispatcher reads it for how often calls come in and how
   big they get. Beats flash the light bars in time. Short notification sounds barely move it. */
const LOAD = { level: 0, label: 'ROUTINE',
  update(dt) {
    const target = AUD.active && AUD.soundStart >= 0 && RT() - AUD.soundStart > 3 ? clamp(0.35 + AUD.heavy * 0.75, 0, 1) : 0;
    this.level += (target - this.level) * dt * (target > this.level ? 0.035 : 0.012);
    this.level = clamp(this.level, 0, 1);
    this.label = this.level < 0.25 ? 'ROUTINE' : this.level < 0.55 ? 'BUSY' : this.level < 0.8 ? 'HEAVY' : 'SURGE';
  } };
const AUD = { level: 0, lastActive: -99, soundStart: -1, raw: new Float32Array(128), demo: false, heavy: 0, beat: -9,
  get active() { return RT() - this.lastActive < 1.6; } };
function RT() { return performance.now() / 1000; }   // real-time clock (independent of FPS limits)
const BANDS = {
  low:  { from: 0, to: 4,   thr: 0.10, ratio: 1.35, gap: 0.2,  hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 },
  mid:  { from: 6, to: 22,  thr: 0.05, ratio: 1.30, gap: 0.12, hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 },
  high: { from: 26, to: 56, thr: 0.03, ratio: 1.30, gap: 0.10, hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 }
};
const PREV_RAW = new Float32Array(128);
function onAudio(arr) {
  if (!ready) return;
  for (let i = 0; i < 128; i++) AUD.raw[i] = Math.min(1, arr[i] || 0);
  const sens = Math.max(0.1, CFG.sens / 100); let tot = 0;
  for (const key in BANDS) {
    const b = BANDS[key]; let e = 0, n = 0;
    for (let i = b.from; i <= b.to; i++) { e += AUD.raw[i] + AUD.raw[64 + i]; n += 2; }
    e /= n;
    let avg = e; if (b.hist.length) { avg = 0; for (const h of b.hist) avg += h; avg /= b.hist.length; }
    b.hist.push(e); if (b.hist.length > 40) b.hist.shift();
    const thr = b.thr / sens, ratio = 1 + (b.ratio - 1) / sens;
    let flux = 0;
    for (let i = b.from; i <= b.to; i++) flux += Math.max(0, AUD.raw[i] - PREV_RAW[i]) + Math.max(0, AUD.raw[64 + i] - PREV_RAW[64 + i]);
    flux /= n;
    let fm = 0, fs = 0; for (const f of b.fh) fm += f; fm /= Math.max(1, b.fh.length);
    for (const f of b.fh) fs += (f - fm) * (f - fm); fs = Math.sqrt(fs / Math.max(1, b.fh.length));
    b.fh.push(flux); if (b.fh.length > 30) b.fh.shift();
    const energyHit = e > thr && e > avg * ratio && e > b.prev * 1.04;
    const fluxHit = e > thr * 0.6 && flux > fm + fs * (1.6 / sens) && flux > 0.02 / sens;
    if ((energyHit || fluxHit) && RT() - b.last > b.gap) {
      b.last = RT(); onBeat(key, clamp(Math.max(e / Math.max(avg, 0.01), 1 + flux / Math.max(fm, 0.005) * 0.15), 1, 3));
    }
    b.peak = Math.max(e, b.peak * 0.9985, 0.05); b.norm = e / b.peak;
    b.prev = e; b.val = e; tot += e;
  }
  PREV_RAW.set(AUD.raw);
  const dense = (BANDS.mid.norm * 0.5 + BANDS.low.norm * 0.3 + BANDS.high.norm * 0.2) * smoothstep(0.03, 0.12, (BANDS.mid.val + BANDS.low.val) / 2);
  AUD.heavy += (dense - AUD.heavy) * (dense > AUD.heavy ? 0.08 : 0.02);
  AUD.level = tot / 3;
  if (AUD.level > 0.012) { if (AUD.soundStart < 0 || !AUD.active) AUD.soundStart = RT(); AUD.lastActive = RT(); }
  else if (!AUD.active) AUD.soundStart = -1;
}
/* a beat: the light bars of the units on a run flash on it (units.js reads AUD.beat) */
function onBeat(band, strength) {
  if (paused) return;
  if (band === 'low' || band === 'mid') AUD.beat = T;
}
/* Browser-only demo beat (controlled from the settings panel) */
const DEMO = { on: false, bpm: 124, level: 1, pauses: true, notifyUntil: 0 };
const FILE_AUDIO = { playing: false };           // filled in by settings.js (browser only)
function demoAudio() {
  if (FILE_AUDIO.playing) return;                   // the audio file feeds onAudio() itself
  const t = performance.now() / 1000, arr = new Array(128).fill(0);
  if (!DEMO.on) { onAudio(arr); return; }
  const beat = 60 / DEMO.bpm, ph = t % beat, bi = Math.floor(t / beat), bar = Math.floor(bi / 4) % 12;
  if (DEMO.pauses && bar >= 10) { onAudio(arr); return; } // silent bars to test the 'no music' state
  const kick = Math.exp(-ph * 14), snare = (bi % 2 === 1) ? Math.exp(-ph * 12) : 0, hat = Math.exp(-(t % (beat / 2)) * 30);
  for (let i = 0; i < 64; i++) {
    let v = 0.03 * Math.random();
    if (i < 6) v += 0.8 * kick; if (i >= 6 && i < 24) v += 0.55 * snare + 0.08; if (i >= 26) v += 0.35 * hat * (1 - i / 80);
    arr[i] = arr[64 + i] = v * DEMO.level;
  }
  onAudio(arr);
}

/* ---- panel ---- */
let uiTimer = 0, meterTimer = 0, envTimer = 0;
function buildUI() {
  document.getElementById('collapse').onclick = () => {
    const p = document.getElementById('panel'); p.classList.toggle('collapsed');
    document.getElementById('collapse').textContent = p.classList.contains('collapsed') ? '+' : '–';
  };
  const meter = document.getElementById('meter');
  for (let i = 0; i < 28; i++) meter.appendChild(document.createElement('i'));
}
/* the panel's DOM is written only where a value changed (4×/s: a rewrite invalidates style and layout every time) */
const setTxt = (el, t) => { if (el._t !== t) { el._t = t; el.textContent = t; } };
const setCls = (el, c) => { if (el._c !== c) { el._c = c; el.className = c; } };
const UI_EL = {}, uiEl = id => UI_EL[id] || (UI_EL[id] = document.getElementById(id));
let uiMinute = -1;
function updateUI() {
  if (!CFG.showPanel) return;
  const now = getNow(), mi = now.getHours() * 60 + now.getMinutes();
  if (mi !== uiMinute) { uiMinute = mi; setTxt(uiEl('clock'), now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); }
  const e = ENV.elev;
  setTxt(uiEl('daystate'), (e > 6 ? 'DAY' : e > -6 ? 'TWILIGHT' : 'NIGHT') + ' · ' + TERRAIN.season.toUpperCase());
  const ld = uiEl('load'), n = Math.round(LOAD.level * 10);
  setTxt(ld, '▮'.repeat(n) + '▯'.repeat(10 - n) + '  ' + LOAD.label + (FILE_AUDIO.playing ? ' (FILE)' : AUD.demo && DEMO.on ? ' (DEMO)' : ''));
  setCls(ld, 'lv' + Math.min(3, Math.floor(LOAD.level * 4)));
}
function updateMeter() {
  if (!CFG.showPanel) return;
  const bars = uiEl('meter').children;
  for (let i = 0; i < bars.length; i++) {
    const bin = Math.floor(Math.pow(i / bars.length, 1.4) * 60);
    const v = (AUD.raw[bin] + AUD.raw[64 + bin]) / 2, k = Math.round(Math.max(0.06, Math.min(1, v * 1.4)) * 100);
    if (bars[i]._k !== k) { bars[i]._k = k; bars[i].style.transform = `scaleY(${k / 100})`; }
  }
}

/* ---- main loop ---- */
let frameDue = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  if (paused) { lastMs = ms; return; }
  if (fpsLimit > 0) {
    if (ms < frameDue - 2) return;
    frameDue += 1000 / fpsLimit; if (frameDue <= ms) frameDue = ms + 1000 / fpsLimit;
  }
  // simulate the real elapsed time in sub-steps of at most 50 ms: low FPS limits don't slow the world down
  const el = clamp((ms - lastMs) / 1000, 0, 0.25); lastMs = ms;
  const n = Math.max(1, Math.ceil(el / 0.05)), dt = el / n;
  for (let i = 0; i < n * TIME_SCALE; i++) step(dt);
  if (CFG.shadows) fitShadow();
  renderer.render(scene, camera);
}
/* The sun's shadow camera covers just the visible ground (the light-space bounds of the screen corners at ground level) */
const _shc = new V3(), _shi = new THREE.Matrix4(), SCREEN_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
function fitShadow() {
  const sc = sunLight.shadow.camera;
  camera.updateMatrixWorld();
  _shi.lookAt(sunLight.position, sunLight.target.position, sc.up).setPosition(sunLight.position).invert();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of SCREEN_CORNERS) {
    VIEW.groundAt(c[0], c[1], 0, _shc).applyMatrix4(_shi);
    x0 = Math.min(x0, _shc.x); x1 = Math.max(x1, _shc.x); y0 = Math.min(y0, _shc.y); y1 = Math.max(y1, _shc.y);
  }
  const m = 14;   // buildings and trees just off the screen edge
  if (Math.abs(sc.left - (x0 - m)) + Math.abs(sc.right - (x1 + m)) + Math.abs(sc.bottom - (y0 - m)) + Math.abs(sc.top - (y1 + m)) < 0.5) return;
  sc.left = x0 - m; sc.right = x1 + m; sc.bottom = y0 - m; sc.top = y1 + m; sc.updateProjectionMatrix();
}
const TIME_SCALE = Math.max(1, Math.round(parseFloat(QS.get('ts') || '1')));
/* start-up splash: covers the first seconds, when settings / WE properties may rebuild things */
let splash = document.getElementById('splash');
function step(dt) {
  T += dt;
  if (splash && T > 3.2) { const s = splash; splash = null; s.classList.add('off'); setTimeout(() => s.remove(), 700); }
  if (CFG.camRotate) { camAz += CFG.camDir * CFG.camSpeed * DEG * dt; updateCameraPose(); }
  CITY.update(dt);
  for (const u of UNITS) u.update(dt);
  DISPATCH.update(dt);
  RADIO.update(dt);
  LOAD.update(dt);
  FX.tracers.update(dt);
  FX.flash.update(dt);
  FX.smoke.update(dt, ENV.smokeTint, camera);
  FX.fire.update(dt);
  FX.water.update(dt, null, camera);
  SCENES.update(dt);
  FX.scorch.update(dt);
  FX.lights.update(dt, 0.6 + ENV.night * 0.8);
  TERRAIN.update(dt);
  updateLights();

  envTimer -= dt; if (envTimer <= 0) { envTimer = 2; updateEnvironment(); }
  uiTimer -= dt; if (uiTimer <= 0) { uiTimer = 0.25; updateUI(); TERM.update(); }
  meterTimer -= dt; if (meterTimer <= 0) { meterTimer = 0.05; updateMeter(); }
}

init();

'use strict';
/* ===== In-browser settings panel (only outside Wallpaper Engine) =====
   Mirrors every property from project.json (via properties.js), feeds changes
   through the same wallpaperPropertyListener WE uses, and keeps them in localStorage. */
(function () {
  if (window.wallpaperRegisterAudioListener) return;          // running inside Wallpaper Engine
  const KEY = 'code3.settings.v1';
  const QSP = new URLSearchParams(location.search);
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } },
    save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable */ } },
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  };
  const saved = store.load();
  const vals = {};
  for (const [k, p] of Object.entries(WE_PROPERTIES)) vals[k] = saved.props && k in saved.props ? saved.props[k] : p.value;
  Object.assign(DEMO, saved.demo2 || {});
  const persist = () => store.save({ props: vals, demo2: { on: DEMO.on, bpm: DEMO.bpm, level: DEMO.level, pauses: DEMO.pauses } });

  // URL test parameters win over stored values
  const skip = new Set();
  if (QSP.has('hour')) { skip.add('timemode'); skip.add('fixedhour'); }
  if (QSP.has('zoom')) skip.add('zoom');
  const apply = obj => window.wallpaperPropertyListener.applyUserProperties(obj);
  const initial = {}; for (const k in vals) if (!skip.has(k)) initial[k] = { value: vals[k] };
  apply(initial);

  /* ---- helpers ---- */
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const weToHex = s => '#' + s.split(' ').map(c => Math.round(clamp(parseFloat(c), 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  const hexToWe = h => [1, 3, 5].map(i => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3)).join(' ');
  const condFn = c => { try { return new Function('v', 'return (' + c.replace(/(\w+)\.value/g, 'v["$1"]') + ');'); } catch (e) { return () => true; } };
  const GROUPS = [[0, 9, 'Camera & time'], [10, 19, 'Audio & calls'], [20, 29, 'Terrain & season'], [30, 39, 'Panel & terminal'], [40, 49, 'Units'], [50, 59, 'Town']];

  /* ---- UI ---- */
  const gear = el('button', 'cfg-gear', '⚙ SETTINGS'); gear.id = 'cfgGear';
  const drawer = el('div', 'cfg'); drawer.id = 'cfg';
  const head = el('div', 'cfg-head'); head.append(el('span', 'cfg-title', '◆ WALLPAPER SETTINGS'));
  const close = el('button', 'cfg-x', '✕'); head.append(close);
  const body = el('div', 'cfg-body');
  drawer.append(head, body);
  document.body.append(gear, drawer);
  gear.onclick = () => drawer.classList.toggle('open');
  close.onclick = () => drawer.classList.remove('open');

  const rows = [];
  const entries = Object.entries(WE_PROPERTIES).filter(([k]) => k !== 'schemecolor').sort((a, b) => a[1].order - b[1].order);
  for (const [g0, g1, gname] of GROUPS) {
    const items = entries.filter(([, p]) => p.order >= g0 && p.order <= g1);
    if (!items.length) continue;
    body.append(el('div', 'cfg-sec', gname));
    for (const [k, p] of items) {
      const row = el('div', 'cfg-row'); const lab = el('label', 'cfg-lab', p.text);
      let ctrl, out = null;
      const set = v => { vals[k] = v; apply({ [k]: { value: v } }); persist(); refresh(); };
      if (p.type === 'slider') {
        const step = p.fraction ? Math.pow(10, -(p.precision || 1)) : 1;
        ctrl = el('input'); Object.assign(ctrl, { type: 'range', min: p.min, max: p.max, step, value: vals[k] });
        out = el('span', 'cfg-val', String(vals[k]));
        ctrl.oninput = () => { const v = parseFloat(ctrl.value); out.textContent = String(v); set(v); };
      } else if (p.type === 'bool') {
        ctrl = el('input'); ctrl.type = 'checkbox'; ctrl.checked = !!vals[k];
        ctrl.onchange = () => set(ctrl.checked);
        row.classList.add('cfg-bool');
      } else if (p.type === 'combo') {
        ctrl = el('select');
        for (const o of p.options) { const op = el('option', null, o.label); op.value = o.value; ctrl.append(op); }
        ctrl.value = vals[k]; ctrl.onchange = () => set(ctrl.value);
      } else if (p.type === 'color') {
        ctrl = el('input'); ctrl.type = 'color'; ctrl.value = weToHex(vals[k]);
        ctrl.oninput = () => set(hexToWe(ctrl.value));
      } else {
        ctrl = el('input'); ctrl.type = 'text'; ctrl.maxLength = 20; ctrl.value = vals[k];
        ctrl.oninput = () => set(ctrl.value);
      }
      ctrl.classList.add('cfg-ctl');
      row.append(lab, ctrl); if (out) row.append(out);
      body.append(row);
      rows.push({ row, cond: p.condition ? condFn(p.condition) : null });
    }
  }

  /* demo audio */
  body.append(el('div', 'cfg-sec', 'Demo audio (browser only)'));
  const demoRow = (label, make) => { const r = el('div', 'cfg-row'); r.append(el('label', 'cfg-lab', label)); make(r); body.append(r); return r; };
  demoRow('Demo beat', r => { r.classList.add('cfg-bool'); const c = el('input', 'cfg-ctl'); c.type = 'checkbox'; c.checked = DEMO.on; c.onchange = () => { DEMO.on = c.checked; persist(); }; r.append(c); });
  demoRow('Tempo, BPM', r => { const c = el('input', 'cfg-ctl'), o = el('span', 'cfg-val', String(DEMO.bpm)); Object.assign(c, { type: 'range', min: 70, max: 180, step: 1, value: DEMO.bpm }); c.oninput = () => { DEMO.bpm = +c.value; o.textContent = c.value; persist(); }; r.append(c, o); });
  demoRow('Loudness', r => { const c = el('input', 'cfg-ctl'), o = el('span', 'cfg-val', DEMO.level.toFixed(1)); Object.assign(c, { type: 'range', min: 0.3, max: 1.5, step: 0.1, value: DEMO.level }); c.oninput = () => { DEMO.level = +c.value; o.textContent = (+c.value).toFixed(1); persist(); }; r.append(c, o); });
  demoRow('Silent gaps between loops', r => { r.classList.add('cfg-bool'); const c = el('input', 'cfg-ctl'); c.type = 'checkbox'; c.checked = DEMO.pauses; c.onchange = () => { DEMO.pauses = c.checked; persist(); }; r.append(c); });
  body.append(el('div', 'cfg-note', 'The longer and louder the music plays, the busier the town gets (LOAD on the panel); in silence it calms down slowly.'));

  /* audio file player — analysed with Web Audio into the same 128-bin array WE provides */
  body.append(el('div', 'cfg-sec', 'Play an audio file'));
  const FA = FILE_AUDIO;
  const pickIn = el('input'); pickIn.type = 'file'; pickIn.accept = 'audio/*'; pickIn.style.display = 'none';
  const pickBtn = el('button', 'cfg-btn', '📂 CHOOSE AUDIO FILE…');
  const nameEl = el('div', 'cfg-file', 'No file loaded');
  const prog = el('div', 'cfg-prog'); const progBar = el('i'); prog.append(progBar);
  const ctrlRow = el('div', 'cfg-player');
  const playBtn = el('button', null, '▶ PLAY'), stopBtn = el('button', null, '■ STOP');
  ctrlRow.append(playBtn, stopBtn);
  body.append(pickIn, pickBtn, nameEl, prog, ctrlRow);
  demoRow('Volume', r => { const c = el('input', 'cfg-ctl'), o = el('span', 'cfg-val', '80'); Object.assign(c, { type: 'range', min: 0, max: 100, step: 1, value: 80 }); c.oninput = () => { o.textContent = c.value; if (FA.el) FA.el.volume = c.value / 100; }; r.append(c, o); FA.volCtl = c; });
  demoRow('Loop', r => { r.classList.add('cfg-bool'); const c = el('input', 'cfg-ctl'); c.type = 'checkbox'; c.checked = true; c.onchange = () => { if (FA.el) FA.el.loop = c.checked; }; r.append(c); FA.loopCtl = c; });
  pickBtn.onclick = () => pickIn.click();
  pickIn.onchange = () => {
    const f = pickIn.files && pickIn.files[0]; if (!f) return;
    if (FA.el) { FA.el.pause(); URL.revokeObjectURL(FA.el.src); }
    if (!FA.ctx) FA.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const a = new Audio(URL.createObjectURL(f)); a.loop = FA.loopCtl.checked; a.volume = FA.volCtl.value / 100;
    const src = FA.ctx.createMediaElementSource(a);
    FA.an = FA.ctx.createAnalyser(); FA.an.fftSize = 2048; FA.an.smoothingTimeConstant = 0.3; FA.an.minDecibels = -90; FA.an.maxDecibels = -10;
    src.connect(FA.an); FA.an.connect(FA.ctx.destination);
    FA.bins = new Uint8Array(FA.an.frequencyBinCount); FA.el = a;
    a.onplay = () => { FA.playing = true; playBtn.textContent = '❚❚ PAUSE'; };
    a.onpause = a.onended = () => { FA.playing = false; playBtn.textContent = '▶ PLAY'; };
    nameEl.textContent = f.name;
    FA.ctx.resume(); a.play();
  };
  playBtn.onclick = () => { if (!FA.el) return pickIn.click(); FA.ctx.resume(); FA.el.paused ? FA.el.play() : FA.el.pause(); };
  stopBtn.onclick = () => { if (FA.el) { FA.el.pause(); FA.el.currentTime = 0; } };
  prog.onclick = e => { if (FA.el && FA.el.duration) { const r = prog.getBoundingClientRect(); FA.el.currentTime = (e.clientX - r.left) / r.width * FA.el.duration; } };
  // ~30 Hz, like Wallpaper Engine: 64 log-spaced bands per channel, 0..1
  setInterval(() => {
    if (FA.el && FA.el.duration) progBar.style.width = (FA.el.currentTime / FA.el.duration * 100).toFixed(1) + '%';
    if (!FA.playing || !FA.an) return;
    FA.an.getByteFrequencyData(FA.bins);
    const bw = FA.ctx.sampleRate / FA.an.fftSize, arr = new Array(128);
    for (let i = 0; i < 64; i++) {
      const f0 = 40 * Math.pow(14000 / 40, i / 64), f1 = 40 * Math.pow(14000 / 40, (i + 1) / 64);
      const b0 = Math.floor(f0 / bw), b1 = Math.max(b0 + 1, Math.ceil(f1 / bw));
      let m = 0; for (let b = b0; b < b1 && b < FA.bins.length; b++) m = Math.max(m, FA.bins[b]);
      const v = Math.pow(m / 255, 2.2);
      arr[i] = arr[64 + i] = v;
    }
    onAudio(arr);
  }, 33);

  const reset = el('button', 'cfg-btn cfg-reset', 'RESET ALL TO DEFAULTS');
  reset.onclick = () => { store.clear(); location.reload(); };
  body.append(reset);

  function refresh() { for (const r of rows) r.row.style.display = !r.cond || r.cond(vals) ? '' : 'none'; }
  refresh();
})();

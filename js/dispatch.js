'use strict';
/* ===== The dispatcher (CAD): calls coming in, units assigned, the call's course, the terminal =====
   Calls come every (600 / CFG.calls) s, down to a quarter of that as the music builds the load (LOAD), at most
   MAX_CALLS at once; the type is weighted by the load tier (INCIDENT_TYPES.w). A call gets one free unit (in quarters)
   of each type it needs; what is missing is filled in as units come free (status HOLDING while it has none).
   The units' state changes drive the radio (DISPATCH.onState): en route, on scene (the first arriving gives a size-up),
   updates while working, released one by one once the call's dwell has run (first arrival + dwell), available,
   in quarters. A call closes once every unit has cleared it.                                                      */
const MAX_CALLS = 4, TRANSPORTS = new Set(['medical', 'mva']);
const CALL_STATUS = { pending: 'PENDING', holding: 'HOLDING', dispatched: 'DISPATCHED', onscene: 'ON SCENE', clearing: 'CLEARING', closed: 'CLOSED' };
const DISPATCH = {
  calls: [], timer: 25, seq: 0, fillT: 0,
  reset() { for (const c of this.calls) for (const u of c.units) if (u.callRef === c) u.callRef = null; this.calls = []; this.timer = 25; },
  get open() { return this.calls.filter(c => c.status !== 'closed'); },
  interval() { return CFG.calls > 0 ? 600 / CFG.calls * lerp(1, 0.25, LOAD.level) * rand(0.6, 1.4) : Infinity; },
  free(type) { return (HELI_TYPES[type] ? HELIS : UNITS).filter(u => u.type === type && u.state === 'quarters' && !u.callRef); },
  /* a call type by the load tier's weights, among those whose first unit type has someone free */
  pickType() {
    const tier = LOAD_TIERS.indexOf(loadTier()), c = Object.entries(INCIDENT_TYPES).filter(([, t]) => t.w[tier] > 0 && this.free(t.units[0]).length);
    let r = Math.random() * c.reduce((s, [, t]) => s + t.w[tier], 0);
    for (const [k, t] of c) if ((r -= t.w[tier]) <= 0) return k;
    return c.length ? c[c.length - 1][0] : null;
  },
  newCall(key) {
    const type = INCIDENT_TYPES[key], s = pickSite(pick(type.at), this.open.map(c => c.site)); if (!s) return null;
    const need = [...type.units]; for (const [u, p] of type.extra || []) if (Math.random() < p) need.push(u);
    const c = { id: `26-${110341 + this.seq++}`, key, type, site: s, need, units: [], t: T, status: 'pending', arrived: null, dwell: rand(...type.dwell), updates: 0, detail: type.details ? pick(type.details) : '' };
    this.calls.push(c);
    SCENES.open(c);
    RADIO.say('CAD', `#${c.id}  ${type.name}  ${s.name}`, 'sys');
    if (!type.self) TERM.tones();
    this.assign(c);
    return c;
  },
  /* free units for what the call still needs: the tone-out (or a patrol's own stop) and the acknowledgements */
  assign(c) {
    const have = c.units.map(u => u.type), got = [];
    for (const t of c.need) {
      const i = have.indexOf(t); if (i >= 0) { have.splice(i, 1); continue; }
      const u = this.free(t)[0]; if (!u) continue;
      u.callRef = c; c.units.push(u); got.push(u);
      u.dispatch(u.air ? c.site : siteDest(c.site, c.units.filter(x => !x.air).length - 1));   // (a helicopter: the site itself)
      RADIO.say('CAD', `${u.short}  DISP  #${c.id}`, 'sys');
    }
    if (got.length) {
      const v = this.vars(c, got[0]);
      if (c.type.self) RADIO.say(got[0].radio, radioLine(['{U}, traffic stop, {A}.', '{U}, I\'ll be out on a stop, {A}.', '{U}, show me out with a vehicle, {A}.'], v), 'pd', 1);
      else {
        const air = got.every(u => u.air) && AIR_LINES[got[0].type], far = c.site.kind === 'air';   // (a helicopter on its own: its own launch request)
        RADIO.say('DISPATCH', radioLine(air ? air[far ? 'dispFar' : 'disp'] : DISPATCH_LINES[c.type.kind === 'far' ? 'far' : c.type.svc], Object.assign(v, { L: nameList(got) })), 'disp', 2);
        for (const u of got) if (u.air || Math.random() < 0.75) RADIO.say(u.radio, radioLine(u.air ? AIR_LINES[u.type][far ? 'ackFar' : 'ack'] : ACK_LINES[u.spec.svc], this.vars(c, u)), u.spec.svc);
      }
      if (c.status === 'pending' || c.status === 'holding') c.status = 'dispatched';
    } else if (!c.units.length && c.status === 'pending') { c.status = 'holding'; RADIO.say('DISPATCH', radioLine(HOLD_LINES, { P: titleCase(CFG.townName) }), 'disp', 1); }
  },
  vars(c, u) {
    const s = c.site, st = s.ax ? lineOf(s.ax, s.at).name : '', lz = lzFor(s);
    return { U: u && u.radio, T: c.type.name.toLowerCase(), A: titleCase(s.name), X: titleCase(s.cross || ''), N: c.id, D: c.detail, S: titleCase(st.split(' ')[0]), H: 'Memorial', P: titleCase(CFG.townName), Z: lz ? titleCase(lz.name) : '' };
  },
  update(dt) {
    // new calls
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.interval();
      if (Number.isFinite(this.timer) && this.open.length < MAX_CALLS) { const k = this.pickType(); if (k) this.newCall(k); }
    }
    // fill what calls still need as units come free
    this.fillT -= dt;
    if (this.fillT <= 0) { this.fillT = 2; for (const c of this.open) if (c.status !== 'clearing' && c.units.length < c.need.length) this.assign(c); }
    // the units' state changes
    for (const L of [UNITS, HELIS]) for (const u of L) if (u.state !== u.cadState) { const f = u.cadState; u.cadState = u.state; this.onState(u, f, u.state); }
    // calls on scene: updates while working, then the units released one by one
    for (const c of this.calls) {
      if (c.status === 'closed') continue;
      const there = c.units.filter(u => u.callRef === c && (u.state === 'on_scene' || (u.state === 'away' && !u.homeQ))), ground = there.filter(u => !u.air);
      if (c.arrived != null && c.status === 'onscene') {
        if (T > c.nextUpdate && ground.length && c.updates < 2) {   // (the helicopters have their own: helis.js)
          c.updates++; c.nextUpdate = T + rand(30, 60);
          const u = ground.find(u => u.spec.svc === (c.type.svc === 'pd' ? 'pd' : 'fire')) || ground[0];
          RADIO.say(u.radio, radioLine(UPDATE_LINES[u.spec.svc === 'pd' && c.type.svc !== 'pd' ? 'pd' : c.type.kind], this.vars(c, u)), u.spec.svc);
        }
        if (T - c.arrived > c.dwell && (!c.scene || c.scene.ready)) { c.status = 'clearing'; c.relT = 0; }   // (a fire: once it is out)
      }
      if (c.status === 'clearing') {
        c.relT -= dt;
        if (c.relT <= 0 && there.length) {   // the chief clears last
          const u = there.find(u => u.type !== 'chief') || there[0];
          if (u.aerialK > 0.01) { u.aerialWant = 0; c.relT = 1; }   // the aerial is bedded first
          else if (u.type === 'medic' && TRANSPORTS.has(c.type.kind) && !c.transported && Math.random() < 0.7) {   // the patient goes to the ER
            c.transported = true; const code3 = Math.random() < 0.25;
            RADIO.say(u.radio, radioLine(code3 ? ['{U}, transporting one to {H}, priority one.', '{U}, emergent to {H} with one.'] : ['{U}, transporting one to {H}, non-emergent.', '{U}, en route to {H} with one, stable.'], this.vars(c, u)), 'ems', 1);
            u.callRef = null; u.transport(code3); c.relT = rand(3, 7);
          } else { u.release(); c.relT = rand(3, 7); }
        }
        if (c.units.every(u => u.callRef !== c)) { c.status = 'closed'; c.closedAt = T; RADIO.say('CAD', `#${c.id}  CLOSED`, 'sys'); if (c.scene) c.scene.close(); }
      }
    }
    if (this.calls.length > 12) this.calls = this.calls.filter(c => c.status !== 'closed' || T - c.closedAt < 10);
  },
  onState(u, from, to) {
    if (u.air) return this.onAir(u, from, to);
    const c = u.callRef;
    if (!c) {   // a transport: no call any more, still on the radio
      const v = { U: u.radio, H: 'Memorial' };
      if (to === 'transporting') RADIO.say('CAD', `${u.short}  TRAN  MEMORIAL`, 'sys');
      else if (to === 'at_hospital') { RADIO.say('CAD', `${u.short}  AT HOSP`, 'sys'); RADIO.say(u.radio, radioLine(['{U}, at {H}.', '{U}, arriving at {H}.'], v), 'ems'); }
      else if (to === 'returning' && from === 'at_hospital') { RADIO.say('CAD', `${u.short}  AVAIL`, 'sys'); RADIO.say(u.radio, radioLine(['{U}, clear of {H}, available.', '{U}, back in service from {H}.'], v), 'ems'); }
      return;
    }
    const v = this.vars(c, u), svc = u.spec.svc;
    if (to === 'responding' && from !== 'pullout') RADIO.say('CAD', `${u.short}  ENRT  #${c.id}`, 'sys');
    else if (to === 'on_scene' || to === 'away') {
      RADIO.say('CAD', `${u.short}  ONSC  #${c.id}`, 'sys');
      if (c.arrived == null) {
        c.arrived = T; c.status = 'onscene'; c.nextUpdate = T + rand(14, 26);
        RADIO.say(u.radio, radioLine(ON_SCENE[svc === 'pd' && c.type.svc !== 'pd' ? 'pd' : c.type.kind], v), svc, 1);
        if (c.type.air) { RADIO.say(u.radio, radioLine(REQ_AIR_LINES, v), svc, 1); c.need.push(c.type.air); }   // the first in asks for the helicopter
      } else if (Math.random() < 0.5) RADIO.say(u.radio, radioLine(svc === 'pd' ? ON_SCENE.pd : ['{U} on scene.', '{U} arriving.'], v), svc);
    } else if (to === 'returning') {
      RADIO.say('CAD', `${u.short}  AVAIL`, 'sys');
      RADIO.say(u.radio, radioLine(CLEAR_LINES[svc], v), svc);
      if (Math.random() < 0.6) RADIO.say('DISPATCH', radioLine(COPY_LINES, v), 'disp');
      u.callRef = null;
    }
  }
};
/* the helicopters on the radio (helis.js): launch, overhead / on the ground at the LZ, the patient to the roof, back */
DISPATCH.onAir = function (u, from, to) {
  const c = u.callRef, L = AIR_LINES[u.type], v = c ? this.vars(c, u) : { U: u.radio, H: 'Memorial' }, svc = u.spec.svc;
  if (to === 'responding' && c) RADIO.say('CAD', `${u.short}  ENRT  #${c.id}`, 'sys');
  else if ((to === 'on_scene' || to === 'away') && c) {
    RADIO.say('CAD', `${u.short}  ONSC  #${c.id}`, 'sys');
    RADIO.say(u.radio, radioLine(to === 'away' ? L.away : ENV.night > 0.5 && L.night ? L.night : L.onScene, v), svc, 1);
    if (c.arrived == null && c.units.every(x => x.air)) { c.arrived = T; c.status = 'onscene'; c.nextUpdate = Infinity; }   // a call of its own (out of town)
  } else if (to === 'returning' && c) { RADIO.say('CAD', `${u.short}  AVAIL`, 'sys'); RADIO.say(u.radio, radioLine(L.clear, v), svc); u.callRef = null; }
  else if (to === 'transporting') { RADIO.say('CAD', `${u.short}  TRAN  MEMORIAL`, 'sys'); RADIO.say(u.radio, radioLine(L.transport, v), svc, 1); }
  else if (to === 'at_hospital') { RADIO.say('CAD', `${u.short}  AT HOSP`, 'sys'); RADIO.say(u.radio, radioLine(L.atHosp, v), svc); }
  else if (to === 'quarters' && from === 'at_hospital') { RADIO.say('CAD', `${u.short}  AVAIL`, 'sys'); if (Math.random() < 0.6) RADIO.say(u.radio, radioLine(L.avail, v), svc); }
};
const titleCase = s => s.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, n, x) => n + x.toLowerCase());
const nameList = us => us.length === 1 ? us[0].radio : us.slice(0, -1).map(u => u.radio).join(', ') + ' and ' + us[us.length - 1].radio;

/* ===== The CAD terminal: a screen of its own (header, active calls with their units, the radio log) =====
   Written only where something changed (the cards are compared as strings; log lines are appended). */
const TERM = {
  el: null, cardsHtml: '', toneUntil: 0, lines: 0,
  build() {
    const d = this.el = document.createElement('div'); d.id = 'cad';
    d.innerHTML = '<div class="cad-hdr"><span class="cad-title"></span><span class="cad-tones">▶ TONES</span><span class="cad-clock"></span></div><div class="cad-calls"></div><div class="cad-log"></div>';
    document.body.appendChild(d);
    this.title = d.querySelector('.cad-title'); this.clock = d.querySelector('.cad-clock'); this.callsEl = d.querySelector('.cad-calls'); this.log = d.querySelector('.cad-log'); this.hdr = d.querySelector('.cad-hdr');
    RADIO.onLine = l => this.line(l);
  },
  apply() {
    if (!this.el) return;
    this.el.style.display = CFG.terminal ? '' : 'none';
    this.el.className = 'pos-' + CFG.termPos;
    setTxt(this.title, `${CFG.townName} 911 · CAD`);
  },
  tones() { this.toneUntil = T + 3; },
  line(l) {
    if (!this.el) return;
    const row = document.createElement('div'); row.className = 'l ' + l.kind;
    const t = l.at.toLocaleTimeString('en-GB');
    row.innerHTML = `<span class="t">${t}</span><span class="w"></span><span class="x"></span>`;
    row.children[1].textContent = l.kind === 'sys' ? '' : l.who.toUpperCase(); row.children[2].textContent = l.text;
    this.log.appendChild(row);
    while (this.log.children.length > 9) this.log.removeChild(this.log.firstChild);
  },
  update() {
    if (!this.el || !CFG.terminal) return;
    setTxt(this.clock, cadNow().toLocaleTimeString('en-GB'));
    setCls(this.hdr, 'cad-hdr' + (T < this.toneUntil && Math.floor(T * 4) % 2 ? ' tone' : ''));
    const cls = u => u.callRef !== null && u.state === 'turnout' ? 'dsp' : u.state === 'responding' || u.state === 'pullout' ? 'enr' : u.state === 'on_scene' || u.state === 'away' ? 'osc' : 'avl';
    const html = DISPATCH.calls.filter(c => c.status !== 'closed' || T - c.closedAt < 6).slice(-3).reverse().map(c =>
      `<div class="card ${c.status}"><div><b>#${c.id}</b><i>${c.type.name}</i><s>${CALL_STATUS[c.status]}</s></div><div class="a">${c.site.name}${c.site.cross && !c.site.name.includes(c.site.cross) ? ' · ' + c.site.cross : ''}</div><div class="us">${c.units.map(u => `<span class="${u.callRef === c ? cls(u) : 'clr'}">${u.short}</span>`).join('')}</div></div>`).join('');
    if (html !== this.cardsHtml) { this.cardsHtml = html; this.callsEl.innerHTML = html; }
  }
};

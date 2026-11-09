'use strict';
/* ===== The dispatcher (CAD): calls coming in, units assigned, the call's course, the terminal =====
   Calls come every (600 / CFG.calls) s, down to a quarter of that as the music builds the load (LOAD), at most
   maxOpen() at once (more under load); the type is weighted by the load tier (INCIDENT_TYPES.w). A call gets one free unit (in quarters)
   of each type it needs; what is missing is filled in as units come free (status HOLDING while it has none).
   The units' state changes drive the radio (DISPATCH.onState): en route, on scene (the first arriving gives a size-up),
   updates while working, released one by one once the call's dwell has run (first arrival + dwell), available,
   in quarters. A call closes once every unit has cleared it.                                                      */
const MAX_CALLS = 6, TRANSPORTS = new Set(['medical', 'mva']), ALARM2_UNITS = ['engine', 'ladder', 'engine', 'medic'];
const callName = c => c.type.name + (c.second ? ' · 2ND ALARM' : '');
const CALL_STATUS = { pending: 'PENDING', holding: 'HOLDING', dispatched: 'DISPATCHED', onscene: 'ON SCENE', clearing: 'CLEARING', closed: 'CLOSED' };
const DISPATCH = {
  calls: [], timer: 25, seq: 0, fillT: 0,
  reset() { for (const c of this.calls) for (const u of c.units) if (u.callRef === c) u.callRef = null; this.calls = []; this.timer = 25; },
  get open() { return this.calls.filter(c => c.status !== 'closed'); },
  interval() { return CFG.calls > 0 ? 600 / CFG.calls * lerp(1, 0.14, LOAD.level) * rand(0.6, 1.4) : Infinity; },
  /* calls open at once: 3 in a quiet town, up to MAX_CALLS under a heavy load */
  maxOpen() { return Math.min(MAX_CALLS, 3 + Math.floor(LOAD.level * 3.4)); },
  free(type) { return (HELI_TYPES[type] ? HELIS : UNITS).filter(u => u.type === type && u.state === 'quarters' && !u.callRef); },
  /* a call type by the load tier's weights, among those whose first unit type has someone free */
  pickType() {
    const tier = LOAD_TIERS.indexOf(loadTier()), c = Object.entries(INCIDENT_TYPES).filter(([, t]) => t.w[tier] > 0 && this.free(t.units[0]).length && (t.kind !== 'pursuit' || pursuitReady()));
    const w = t => t.w[tier] * (t.kind === 'mva' ? 1 + 1.5 * WEATHER.rain : 1);   // (crashes: more in the rain)
    let r = Math.random() * c.reduce((s, [, t]) => s + w(t), 0);
    for (const [k, t] of c) if ((r -= w(t)) <= 0) return k;
    return c.length ? c[c.length - 1][0] : null;
  },
  newCall(key) {
    const type = INCIDENT_TYPES[key], s = pickSite(pick(type.at), this.open.map(c => c.site)); if (!s) return null;
    const need = type.late ? [] : [...type.units]; for (const [u, p] of type.extra || []) if (Math.random() < p) need.push(u);   // (late: its scene asks for them)
    const c = { id: `26-${110341 + this.seq++}`, key, type, site: s, need, units: [], t: T, status: 'pending', arrived: null, dwell: rand(...type.dwell), updates: 0, detail: type.details ? pick(type.details) : '', strike: type.kind === 'structure' && Math.random() < lerp(0.25, 0.7, LOAD.level) };
    this.calls.push(c); PERSIST.count(c);
    SCENES.open(c);
    RADIO.say('CAD', `#${c.id}  ${type.name}  ${s.name}`, 'sys');
    if (!type.self) TERM.tones();
    this.assign(c);
    return c;
  },
  /* the first curb place of the site that no other unit holds (they come and go: a count would repeat one) */
  freeSlot(c, u, nearest) {   // (nearest: the closest free one on either side, -1 when none is — a second alarm's companies)
    if (c.site.kind === 'far') return 0;
    // (taken: a curb another unit is headed for or still stands at — of this call or one just closed, not yet pulled away)
    const near = (q, x) => Math.hypot(q[0] - x[0], q[1] - x[1]) < 9;   // (the curb across the street is 10 m away: not the same place)
    const taken = q => MOVERS.some(x => x !== u && x.state !== 'quarters' && ((x.call && x.call.curb && x.state !== 'returning' && near(q, x.call.curb)) || near(q, [x.pos.x, x.pos.z])));
    const sl = siteSlots(c.site), order = [...sl.keys()];
    if (nearest) order.sort((p, q) => Math.abs(sl[p].a - c.site.a) - Math.abs(sl[q].a - c.site.a));
    for (const k of order) if (!taken(siteDest(c.site, k).curb)) return k;
    return nearest ? -1 : sl.length - 1;
  },
  /* free units for what the call still needs: the tone-out (or a patrol's own stop) and the acknowledgements */
  assign(c) {
    const have = c.units.filter(u => !u.aid).map(u => u.type), got = [];
    for (const t of c.need) {
      const i = have.indexOf(t); if (i >= 0) { have.splice(i, 1); continue; }
      const u = this.free(t)[0]; if (!u) continue;
      u.callRef = c; c.units.push(u); got.push(u);
      u.dispatch(u.air ? c.site : siteDest(c.site, this.freeSlot(c, u)));   // (a helicopter: the site itself)
      RADIO.say('CAD', `${u.short}  DISP  #${c.id}`, 'sys');
    }
    if (got.length) {
      const v = this.vars(c, got[0]);
      if (c.type.self) RADIO.say(got[0].radio, radioLine(['{U}, traffic stop, {A}.', '{U}, I\'ll be out on a stop, {A}.', '{U}, show me out with a vehicle, {A}.'], v), 'pd', 1);
      else {
        const air = got.every(u => u.air) && AIR_LINES[got[0].type], far = c.site.kind === 'air';   // (a helicopter on its own: its own launch request)
        RADIO.say('DISPATCH', radioLine(air ? air[far ? 'dispFar' : c.type.kind === 'pursuit' ? 'dispChase' : 'disp'] : DISPATCH_LINES[c.type.kind === 'far' ? 'far' : c.type.svc], Object.assign(v, { L: nameList(got) })), 'disp', 2);
        for (const u of got) if (u.air || Math.random() < 0.75) RADIO.say(u.radio, radioLine(u.air ? AIR_LINES[u.type][far ? 'ackFar' : 'ack'] : ACK_LINES[u.spec.svc], this.vars(c, u)), u.spec.svc);
      }
      if (c.status === 'pending' || c.status === 'holding') c.status = 'dispatched';
    } else if (!c.units.length && c.status === 'pending' && !c.type.late) { c.status = 'holding'; RADIO.say('DISPATCH', radioLine(HOLD_LINES, { P: titleCase(CFG.townName) }), 'disp', 1); }
  },
  /* the fire has got away from the first alarm: the neighbours' companies are called in (VISITORS), if an engine is free */
  secondAlarm(c) {
    const pool = VISITORS.filter(v => v.state === 'quarters' && !v.aidFor), aid = [];
    for (const t of ALARM2_UNITS) { const i = pool.findIndex(v => v.type === t); if (i >= 0) aid.push(pool.splice(i, 1)[0]); }
    const u = c.units.find(x => x.type === 'chief' && x.state === 'on_scene') || c.units.find(x => x.spec.svc === 'fire' && x.state === 'on_scene');
    if (!u || !aid.some(v => v.type === 'engine')) return false;
    c.second = true; c.aid = aid; c.aidT = 0; c.dwell += 60; c.scene.strike();
    aid.forEach(v => { v.aidFor = c; });
    const v = this.vars(c, u);
    RADIO.say('CAD', `#${c.id}  2ND ALARM`, 'sys'); TERM.tones();
    RADIO.say(u.radio, radioLine(ALARM2_LINES.strike, v), 'fire', 2);
    RADIO.say('DISPATCH', radioLine(ALARM2_LINES.tone, Object.assign(v, { L: nameList(aid) })), 'disp', 2);
    return true;
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
      if (Number.isFinite(this.timer) && this.open.length < this.maxOpen()) { const k = this.pickType(); if (k) this.newCall(k); }
    }
    // fill what calls still need as units come free
    this.fillT -= dt;
    if (this.fillT <= 0) { this.fillT = 2; for (const c of this.open) if (c.status !== 'clearing' && c.units.filter(u => !u.aid).length < c.need.length) this.assign(c); }
    // the units' state changes
    for (const L of [UNITS, HELIS, VISITORS]) for (const u of L) if (u.state !== u.cadState) { const f = u.cadState; u.cadState = u.state; this.onState(u, f, u.state); }
    // calls on scene: updates while working, then the units released one by one
    for (const c of this.calls) {
      if (c.status === 'closed') continue;
      const there = c.units.filter(u => u.callRef === c && (u.state === 'on_scene' || (u.state === 'away' && !u.homeQ))), ground = there.filter(u => !u.air);
      if (c.strikeAt != null && T > c.strikeAt) c.strikeAt = c.status === 'onscene' && CFG.visitors && c.scene && !c.scene.out && !this.secondAlarm(c) ? T + 4 : null;   // (nobody from the fire service there yet, or no engine free: a little later)
      if (c.aid && c.aid.length && (c.aidT -= dt) <= 0) {   // (the neighbours' companies come in one by one)
        c.aidT = c.type.kind === 'pursuit' ? rand(2.8, 3.4) : rand(2, 6);
        if (c.aid[0].respond(c)) { const v = c.aid.shift(); RADIO.say('CAD', `${v.short}  DISP  #${c.id}`, 'sys'); if (Math.random() < 0.6) RADIO.say(v.radio, radioLine(ACK_LINES[v.spec.svc], this.vars(c, v)), v.spec.svc); }
      }
      if (c.arrived != null && c.status === 'onscene') {
        if (T > c.nextUpdate && ground.length && c.updates < 2) {   // (the helicopters have their own: helis.js)
          c.updates++; c.nextUpdate = T + rand(30, 60);
          const u = ground.find(u => u.spec.svc === (c.type.svc === 'pd' ? 'pd' : 'fire')) || ground[0];
          RADIO.say(u.radio, radioLine(c.second && !c.scene.out && u.spec.svc === 'fire' ? ALARM2_LINES.update : UPDATE_LINES[u.spec.svc === 'pd' && c.type.svc !== 'pd' ? 'pd' : c.type.kind], this.vars(c, u)), u.spec.svc);
        }
        if (T - c.arrived > c.dwell && (!c.scene || c.scene.ready)) { c.status = 'clearing'; c.relT = 0; if (c.aid) { c.aid.forEach(v => { v.aidFor = null; }); c.aid = []; } }   // (a fire: once it is out; the neighbours not sent yet stay out of it)
      }
      if (c.status === 'clearing') {
        c.relT -= dt;
        if (c.relT <= 0 && there.length) {   // the chief clears last
          const u = there.find(u => u.aid) || there.find(u => u.type !== 'chief') || there[0];   // (the neighbours go first)
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
        if (c.strike) c.strikeAt = T + rand(14, 28);
      } else if (u.aid && c.type.kind === 'structure') RADIO.say(u.radio, radioLine(svc === 'ems' ? ALARM2_LINES.arriveEms : ALARM2_LINES.arrive, v), svc);
      else if (Math.random() < 0.5) RADIO.say(u.radio, radioLine(svc === 'pd' ? ON_SCENE.pd : ['{U} on scene.', '{U} arriving.'], v), svc);
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
    if (c.arrived == null && c.units.every(x => x.air) && c.type.kind !== 'pursuit') { c.arrived = T; c.status = 'onscene'; c.nextUpdate = Infinity; }   // a call of its own (out of town)
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
      `<div class="card ${c.status}"><div><b>#${c.id}</b><i>${callName(c)}</i><s>${CALL_STATUS[c.status]}</s></div><div class="a">${escHtml(c.site.name + (c.site.cross && !c.site.name.includes(c.site.cross) ? ' · ' + c.site.cross : ''))}</div><div class="us">${c.units.map(u => `<span class="${u.callRef === c ? cls(u) : 'clr'}">${u.short}</span>`).join('')}</div></div>`).join('');
    if (html !== this.cardsHtml) { this.cardsHtml = html; this.callsEl.innerHTML = html; }
  }
};

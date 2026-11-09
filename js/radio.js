'use strict';
/* ===== Radio traffic: line pools, radioLine, the queue the CAD terminal shows =====
   Fire and EMS talk in plain language, police with 10-codes (10-4 copy, 10-8 in service, 10-97 on scene, 10-98
   done, code 4 no further help needed). Every line goes through radioLine(pool, vars): a pool is an array, or an
   object keyed by load tier (routine / busy / surge, from LOAD) — a missing tier falls back to the nearest calmer one,
   then to any. The same line never comes twice in a row from one pool.
   Placeholders: {U} the unit ("Engine 12"), {L} the unit list ("Engine 12, Ladder 12 and Medic 12"), {T} the call
   type ("structure fire"), {A} the address, {X} the cross street, {N} the call number, {D} the caller's detail,
   {S} the street (for "Oak command"), {H} the hospital, {P} the town, {Z} the helicopter's landing zone.                                           */
const LOAD_TIERS = ['routine', 'busy', 'surge'];
/* the CAD's clock: the PC clock, or with a fixed hour (the sun stands still) the hour plus the time run since */
const cadNow = () => CFG.timeMode === 'fixed' ? new Date(getNow().getTime() + T * 1000) : getNow();
const loadTier = () => LOAD.level < 0.3 ? 'routine' : LOAD.level < 0.7 ? 'busy' : 'surge';
const LAST_LINE = new Map();
function radioLine(pool, vars) {
  let list = pool;
  if (!Array.isArray(pool)) {
    const i = LOAD_TIERS.indexOf(loadTier());
    list = null; for (let k = i; k >= 0 && !list; k--) list = pool[LOAD_TIERS[k]];
    if (!list) list = pool[Object.keys(pool)[0]];
  }
  let line = pick(list);
  if (list.length > 1) for (let n = 0; n < 4 && line === LAST_LINE.get(list); n++) line = pick(list);
  LAST_LINE.set(list, line);
  return line.replace(/\{(\w)\}/g, (m, k) => vars && vars[k] != null ? vars[k] : m);
}

/* the dispatcher toning out a call: the opener, then the call */
const DISPATCH_LINES = {
  fire: ['{L}, respond to a {T}, {A}, cross of {X}. {D}', '{L}, {T}, {A} at {X}. {D}', 'Station 12, {L}: {T}, {A}, cross street {X}. {D}'],
  ems: ['{L}, respond to a {T}, {A}, cross of {X}. {D}', '{L}, medical call, {A} at {X}. {D}', '{L}, {T}, {A}. {D}'],
  pd: ['{L}, {T}, {A} near {X}. {D}', '{L}, respond to {A}, {T}. {D}', '{L}, copy a {T} at {A}. {D}'],
  far: ['{L}, mutual aid request, {T}, {A}. Respond out of the district.', '{L}, respond mutual aid to {A}, {T}.']
};
/* a second alarm: command asks for it, the dispatcher tones out the neighbours ({L}), they report in */
const ALARM2_LINES = {
  strike: ['{U} to dispatch, fire has extended to the attic. Strike a second alarm.', '{U}, we are going defensive. Give me a second alarm at {A}.', '{U}, heavy fire through the roof. Second alarm, {A}.'],
  tone: ['Second alarm, {A}. {L}, respond mutual aid, report to {S} command.', '{L}, second alarm, {A} at {X}. County, report to {S} command.'],
  arrive: ['{U} on scene, reporting to {S} command.', '{U} arriving on the second alarm.', '{U} on scene, taking a line to the exposure side.'],
  arriveEms: ['{U} on scene, setting up rehab at the command post.', '{U} arriving on the second alarm, staging with command.'],
  update: ['{U}, exposures are protected, still heavy fire in the attic.', '{U}, we have water on it from three sides.', '{U}, roof is failing on the east side, everybody stay out.']
};
/* units answering the tone-out */
const ACK_LINES = {
  fire: ['{U}, responding.', '{U} copies, responding.', '{U} en route.'],
  ems: ['{U}, responding.', '{U} copies, en route.', '{U}, on the way.'],
  pd: ['{U}, 10-4, en route.', '{U}, show me en route.', '{U}, copy, responding.']
};
/* first arriving units: a size-up per call kind */
const ON_SCENE = {
  structure: ['{U} on scene, two-story residential, smoke showing. {U} is establishing {S} command.', '{U} on scene, one-story residential, fire showing from the garage. Pulling a line.', '{U} on scene, working fire, side alpha. Requesting the ladder to side alpha.', '{U} on scene, light smoke from the eaves. Investigating.'],
  alarm: ['{U} on scene, nothing showing. Investigating.', '{U} on scene, building is being evacuated. We\'ll check the panel.', '{U} on scene, nothing showing from the exterior.'],
  medical: ['{U} on scene.', '{U} on scene, we\'ll be making patient contact.', '{U} arriving.'],
  mva: ['{U} on scene, two vehicles, moderate damage. Checking for injuries.', '{U} on scene, one vehicle into a pole. Fluids on the roadway.', '{U} on scene, minor collision, blocking the eastbound lane.'],
  vehicle: ['{U} on scene, passenger vehicle, fire in the engine compartment.', '{U} on scene, smoke from under the hood, no extension.'],
  gas: ['{U} on scene, odor of gas outside the structure. Metering now.', '{U} on scene, nothing on the meter at the door.'],
  pd: ['{U}, 10-97.', '{U}, on scene.', '{U}, 10-97, will advise.'],
  stop: ['{U}, out with one occupant.', '{U}, out on the stop, plate to follow.'],
  far: ['{U} on scene with mutual aid command.', '{U} on scene, reporting to command.']
};
/* later in the call */
const UPDATE_LINES = {
  structure: { routine: ['{U}, primary search is negative.', '{U}, knockdown on the fire. We\'ll be checking for extension.', '{U}, fire is under control.'],
    busy: ['{U}, primary search is negative.', '{U}, we have the fire knocked down, opening up the walls.', '{U}, ventilation is complete.'],
    surge: ['{U}, we need another line on side charlie.', '{U}, fire extending into the attic. Pulling crews back for a second.', '{U}, knockdown. Holding all units on scene.'] },
  alarm: ['{U}, it\'s a malfunctioning detector. Resetting the panel.', '{U}, burnt food on the second floor. Ventilating.', '{U}, false alarm, contractor working near a head.'],
  medical: ['{U}, patient is alert and talking.', '{U}, we\'ll be transporting one, non-emergent.', '{U}, patient refusing transport.'],
  mva: ['{U}, no injuries, standing by for the tow.', '{U}, one patient complaining of neck pain.', '{U}, roadway is clear.'],
  vehicle: ['{U}, fire is out. Overhauling.'],
  gas: ['{U}, found a leak at the meter. Gas company is en route.', '{U}, readings are zero throughout.'],
  stop: ['{U}, plate comes back clear.', '{U}, driver is valid, issuing a citation.', '{U}, verbal warning, clearing shortly.'],
  pd: ['{U}, one detained, checking ID.', '{U}, code 4.', '{U}, parties separated, all calm.', '{U}, the area is secure.', '{U}, nothing found, checking the perimeter.'],
  far: ['{U}, assigned to exposure protection.', '{U}, working on side bravo.']
};
const CLEAR_LINES = {
  fire: ['{U}, available.', '{U}, back in service.', '{U}, clearing the scene, available.'],
  ems: ['{U}, available.', '{U}, clear and available.'],
  pd: ['{U}, 10-8.', '{U}, 10-98, back in service.', '{U}, clear, 10-8.']
};
/* the helicopters: Air 1 over a call, Medevac 1 to a landing zone (or out of town) and the patient to the hospital's roof */
const AIR_LINES = {
  air1: {
    disp: ['{L}, assist units at {A}, {T}. {D}', '{L}, respond to {A}, {T}, units on scene. {D}'],
    ack: ['{U} copies, lifting.', '{U}, we\'re up, about a minute out.', '{U}, copy, en route.'],
    onScene: ['{U} is overhead, starting a search pattern.', '{U}, on scene, setting up an orbit.', '{U} overhead {A}.'],
    night: ['{U} is overhead, light is on.', '{U}, on scene, we\'ll light up the backyards.', '{U} overhead, FLIR is up.'],
    update: ['{U}, I have a heat source behind the house to the north, have a unit check it.', '{U}, nothing on the camera in the immediate area.', '{U}, the subject is moving east through the backyards.', '{U}, the perimeter looks good from up here.'],
    clear: ['{U}, clearing, returning to base.', '{U}, we\'re done here, heading back to the pad.']
  },
  medevac: {
    disp: ['{L}, launch request, {T}, {A}. Landing zone at the {Z}.', '{L}, scene flight to {A}, {T}. LZ is the {Z}.'],
    dispFar: ['{L}, launch request, {A}. {D}', '{L}, scene flight out of district, {A}. {D}'],
    ack: ['{U} copies, lifting. Landing at the {Z}.', '{U}, launching, ETA three minutes to the {Z}.'],
    ackFar: ['{U} copies, lifting, en route to {X}.', '{U}, launching, about twelve minutes out.'],
    onScene: ['{U} is on the ground at the {Z}.', '{U}, skids down at the {Z} LZ.'],
    away: ['{U} is on the ground with {X} units.', '{U}, landed at the scene in {X}.'],
    transport: ['{U}, lifting with one patient, en route to {H}.', '{U}, off the ground with one, headed to {H}, priority one.'],
    atHosp: ['{U}, on the pad at {H}.', '{U}, landed at {H}.'],
    avail: ['{U}, back in service at {H}.', '{U}, available at {H}.']
  }
};
/* the first unit in on a bad crash asks for the helicopter */
const REQ_AIR_LINES = ['{U}, we have one trapped, critical. Start Medevac 1, land it at the {Z}.', '{U}, we\'re going to need a helicopter for this one. LZ will be the {Z}.'];
const COPY_LINES = ['Copy, {U}.', 'Copy.', '{U}, copy.', 'Received, {U}.'];
const HOLD_LINES = ['All units, {P} has calls holding. Any unit available, advise.', 'Calls holding, no units available.'];

/* ===== The radio queue: lines come one at a time, with a gap, as on a scanner =====
   say(who, text, kind): kind 'disp' (dispatch), 'fire', 'ems', 'pd', 'sys' (CAD status lines: no queue, shown at
   once). The terminal (DISPATCH.term) prints whatever comes off it. */
const RADIO = {
  q: [], gap: 0, log: [],
  say(who, text, kind, prio) {
    if (kind === 'sys') { this.push({ who, text, kind }); return; }
    if (this.q.length > 12) this.q.splice(this.q.findIndex(l => !l.prio), 1);   // a backlog drops the least important
    this.q.push({ who, text, kind, prio: prio || 0, t: T });
  },
  push(l) { l.at = cadNow(); this.log.push(l); if (this.log.length > 60) this.log.shift(); if (this.onLine) this.onLine(l); },
  update(dt) {
    this.gap -= dt; if (this.gap > 0 || !this.q.length) return;
    const l = this.q.shift(); if (T - l.t > 45 && !l.prio) return;   // stale chatter is dropped
    this.push(l); this.gap = 1.6 + l.text.length * 0.035;
  },
  reset() { this.q.length = 0; this.log.length = 0; this.gap = 0; }
};

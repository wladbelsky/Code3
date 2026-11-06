# Code 3 — Wallpaper Engine web wallpaper

Isometric three.js scene of a small US town's public safety center: a fire station, a police station and EMS, the
hospital, houses, a school and a park around them. Units roll out to calls on their own and come back; a dispatch
terminal (CAD) logs the radio traffic. The music sets how busy the town is (`LOAD`), the light bars flash to the beat.
Built on the engine of Forward Air Base (`../Forward Air Base`, same author): utilities, seasons, sky, effects, the
main loop, audio analysis, the panel, the settings drawer and the test harness come from there.
Runs 24/7 inside Wallpaper Engine (CEF/Chromium); also previewable in a normal browser.
User-facing docs: `README.md` (keep it in sync when behaviour or properties change).

## Plan (stages)
1. Skeleton from FAB — done. 2. Town and complex (`city.js`) — done. 3. Units: apparatus models, `Unit` state machine,
roll out / return, road graph (`roads.js`), traffic rules — done. 4. CAD: calls, unit assignment, status, line pools,
the terminal UI — done. 5. Scenes on site: structure fire, crash, car fire, crews, transport to the hospital — done. 6. Helicopters
(medevac, police) — done. 7. Civilian traffic yielding to lights and sirens — done. 8. Load from the music, persistence, the new panel (a graphite
dispatch board), the splash and the settings drawer to match — done (see "Panel & persistence"). 9. Polish: performance (vegetation sectors, merged doors, instanced signal lamps), the animated
preview GIF, screenshots, README — done; left: the Workshop upload (by hand, from WE) and GitHub Pages for the live demo.
**After stage 9** (approved, in this order): civilian headlights at night — done; drills at the station in quiet hours —
done; routine vehicles (school bus, garbage truck, delivery van); weather (rain / fog, wet reflections, more crashes);
2nd-alarm fires with the neighbouring districts' units joining; a police pursuit with Air 1; pedestrians **last, as a
concept first** (a basic model, screenshots and a performance measurement before building it out). Also: in the browser
the ⚙ Settings button overlaps the CAD terminal (radio log) — move one of them.
Original work in the genre: no names, logos, models or assets of existing games or real departments; the town is
fictional (default FAIRHAVEN).

## Stack & layout
- Plain JS, no build step, no npm. `'use strict'` classic scripts sharing **global** scope
  (no modules). three.js **r149** is vendored as `js/three.min.js` — never edit it.
- `index.html` loads scripts in dependency order (later files use globals of earlier ones):
  `core → models → vehicles → city → terrain → effects → roads → units → traffic → radio → incidents → dispatch → scenes → helis → persist → main → properties → settings`,
  then an inline script registers the WE audio listener (or starts the browser demo beat).
  `main.js` calls `init()` at its end, so anything `init()` needs must be defined before `main.js`.

| File | Contents |
|---|---|
| `js/core.js` | utils (`V3`, `TAU`, `rand`, `clamp`, `lerp`, `smoothstep`, `pick`…), `CFG` defaults, `WIND` (smoke drift), `groundH` (flat ground), `SEASONS` + `seasonNow()`, sun position, sky palette, canvas textures `TEX` |
| `js/models.js` | mesh helpers (`M`, `box`, `cyl`, `taper`, `prism`, `strut`, `deckLine`…), `mergeStatic`, `disposeTree`, nav lights (`navLights`, `NAV_MATS`), searchlights, seasonal shared materials `ROOF_MAT` / `HOUSE_ROOFS` (`seasonMats`) |
| `js/vehicles.js` | vehicle models, facing +x, wheels on y = 0: civilian cars (`carModel(kind, colour)`, `randomCar`); apparatus `UNIT_MODELS[type](livery)` (engine, ladder with `aerial` yaw / pitch / fly, rescue, medic, chief, patrol) → `{ group, bars, len, wid, dyn }`; `LIVERY` (town / county / ambulance / sheriff, `livery(l)` fills in the town's); headlights, grille and front warning lights; light bar segments swap `LB_MATS` [off, on] |
| `js/city.js` | `CITY_LAYOUT` (the one source of positions), `buildCity()`, `CITY` (houses with addresses, bays with roll-up doors, police lot stalls, signals, signs, `vegAt`, `signal(axis)`, `update`, `setTown`), `pavedAt` — see "Town" |
| `js/terrain.js` | `TERRAIN`: the ground (tiled canvas texture + vertex-colour patches), the vegetation per season (InstancedMesh per kind, placed where `CITY.vegAt` allows), weather particles (snowfall, falling leaves) |
| `js/roads.js` | `ROADS`: the street graph (crossings + far ends), `route(from, to)` (Dijkstra over node × heading: no U-turns on screen), `lane` (right-hand offsets), `way(from, to, pre, post, o)`; `Way` (rounded, sampled polyline with headings and a curvature / braking speed limit) — see "Units & traffic" |
| `js/units.js` | `UNIT_TYPES`, `ROSTER`, `HOSP` (the ER places), `Unit` (homes, run state machine, zones, traffic rules, light bars; `radio` / `short` names, `callRef`; `transport` / `leaveHospital`; the ladder's aerial: `aimAerial`, `aerialTip`, `aerialK` / `aerialWant`), `UNITS`, `ZONES`, `houseDest` / `farDest`; `Visitor`, `VISITORS`, `VISITS`, `MOVERS`, `offEnd` / `throughWay` — see "Units & traffic" |
| `js/traffic.js` | `CIVS` (a pool of `CIV_MAX` civilian cars), `Civ` (spawn off screen → across town → off screen; following, crossings and their boxes `CIV_BOXES`, giving way to units `unitCap`, pulling over for code 3, easing round obstacles, backing off), `TRAFFIC` (spawning by `trafficWanted`: `CFG.traffic` by the hour), `wayBoxes`, `boxConflict`, `alongStreet` — see "Civilian traffic" |
| `js/radio.js` | line pools (`DISPATCH_LINES`, `ACK_LINES`, `ON_SCENE`, `UPDATE_LINES`, `CLEAR_LINES`…), `radioLine(pool, vars)`, load tiers, `cadNow`, `RADIO` (the queue the terminal prints) — see "CAD" |
| `js/incidents.js` | `INCIDENT_TYPES`, sites (houses, `BUSINESSES`, street spots, crossings, far ends), `pickSite`, `siteSlots`, `siteDest` |
| `js/dispatch.js` | `DISPATCH` (calls, assignment, the call's course, `onState`), `TERM` (the CAD terminal DOM) |
| `js/helis.js` | `HELI_TYPES`, `HELI_LZ` / `lzFor`, `heliModel` / `HELI_MODELS`, `Heli` (flight, CAD states like a unit's, searchlight / landing light, rotor wash), `HELIS`, `buildHelis` — see "Helicopters" |
| `js/persist.js` | `PERSIST`: the CAD between sessions (call counter, today's calls by service, the last log lines, the load) — see "Panel & persistence" |
| `js/scenes.js` | `SCENES`, `FireScene`, `CarFireScene`, `CrashScene`, `PROPS` (pooled wrecks / burnt cars / cones), `CREW` (figures on scene), `waterArc` — see "Scenes" |
| `js/effects.js` | `Tracers` (InstancedMesh, will carry the hose streams), `SpriteFX` (flash / smoke pools), `Scorch`, `FlashLights` |
| `js/main.js` | WE property listener, scene init, camera, `VIEW` (screen helpers), light / season (`updateEnvironment`, `updateLights`), audio analysis + `onBeat`, `LOAD`, the panel (`buildUI` / `updateUI`, `TILE_STATES`), main loop |
| `js/properties.js` | **generated** from `project.json` — do not edit by hand |
| `js/settings.js` | browser-only settings drawer, demo beat, audio-file player (returns early inside WE) |
| `tools/gen_properties.py` | regenerates `js/properties.js` |
| `tools/preview.spec.js` | renders image candidates (`powershell -ExecutionPolicy Bypass -File tools/test.ps1 -c tools/preview.config.js [-g gif]` → `test-results/gif-<seed>.gif` animated 256², scene only (a dusk house fire, the aerial up), + `-sheet.png` stills: the Workshop preview `preview.gif` from `project.json` — WE takes ≤ 256 px, < 1 MB (aim < 500 KB), encoded with the `gifenc` devDependency; `test-results/<scene>-<seed>.jpg` 1280x720 for each of `SCENES` (`-g "night,"` for one), `screenshots/<scene>.jpg` in README.md; copy the best over them). A scene whose moment never comes fails |
| `tests/`, `playwright.config.js`, `package.json` | automated tests (Playwright Test) — see "Running & testing"; `tools/test.ps1` runs them in Docker, `.github/workflows/tests.yml` in CI |

## Rules / conventions
- **After changing any JS/CSS file, bump the cache-buster** `?v=N` on all `<script>`/`<link>` tags in
  `index.html` (WE's CEF caches aggressively). Current: `v=14`.
- **New WE property**: add it to `project.json`, read it in `applyUserProperties` (`main.js`) into `CFG`,
  then run `python tools/gen_properties.py`. Property `order` decides the browser-drawer group
  (0–9 camera/time, 10–19 audio/calls, 20–29 terrain & season, 30–39 panel & terminal, 40–49 units, 50–59 town).
- Match the existing style: dense one-liners, short comments, `const` scratch vectors at module level.
- Sim time is `T` (advances only in `step(dt)`); real time is `RT()` (audio, beat gaps).
- **No scrolling UI**: WE passes clicks and mouse movement to the wallpaper but not the wheel (page long lists).
- **The music is load, not combat**: `LOAD.level` (0..1) climbs while sound plays (higher when dense, `AUD.heavy`) over
  ~2 minutes and drains over ~3 in silence; what it drives must show: calls every `600 / calls` s × (1 … 0.14), up to
  3 … 6 open (`maxOpen`), the heavier types (tiers), the visitors, a third more traffic; labels ROUTINE / BUSY / HEAVY / SURGE. `AUD.beat` = `T` of the last low / mid beat.

## World & town (`js/city.js`)
- World axes: +X east, +Y up, +Z south; **1 unit = 1 m** (Forward Air Base: 10 m — its vegetation is scaled by
  `VEG_SCALE`). The camera looks from the south-west (azimuth 135°): north is the top-left of the screen, east the
  top-right. ~125 m of screen height at 100 % zoom (`VIEW_H`). Traffic keeps right.
- **Streets**: E-W streets `CITY_LAYOUT.streets` (z −150 Birch, −50 Oak, 50 Main, 150 Elm), N-S avenues `avenues`
  (x −150 Pine, −50 1st, 50 2nd, 150 Cedar), running on to `ext` (±520, off screen); the town (sidewalks, lights,
  houses) inside `inner` (157.5). Carriageway `ROAD_W` 9 (lanes at ±`LANE_OFF` 2.25 from the centre line), sidewalk
  `WALK_W` 3; a block's edge is `EDGE` (7.5) from the street's centre line. Signals at the four inner crossings
  (`signals`), all-way stops elsewhere. `CITY.signal(axis)` — `'ns'` (on an avenue) / `'ew'`: `'g'`/`'y'`/`'r'`,
  50 s cycle (`SIG_CYCLE`) with 2 s all-red; the heads swap lamp materials (`SIG_MATS`) only on a change.
- **Blocks**: centre — the complex (the fire station: six drive-through bays on the ground floor, doors front (Main St)
  and back (the yard), the quarters upstairs, a hose tower on the west lawn; the one-way lane `fire.laneX` from Main St
  up to the yard; the police station east with its lot behind (gate onto 2nd Ave at `lot.gate`); the helipad north); east — the hospital (roof pad
  `hospital.pad`, ER wing, ambulance bay `hospital.bay` off Main St); west — gas station (Main / 1st) and strip mall;
  north — the school and its field, apartments (north-east); south — the park; NW / SW / SE — houses (two rows of four
  per block, each facing its street: `CITY.houses` with `addr` "214 OAK ST", `face` ±1, `x`, `z`, `garageX`).
- **Bays** (`CITY.bays`): `x`, `zFront`, `zBack`, `door` (front) and `rear` (`g` = the door group, `k` 0 shut … 1 up,
  `want`), `unit`. A door group hangs from the top of the opening and scales up into the header (`scale.y = 1 − 0.96 k`).
- **Signs** (`makeSign`): canvas textures; `town` ones are redrawn by `CITY.setTown` (property `townname`); unlit
  (MeshBasic), dimmed by hand at night (`updateEnvironment`).
- **Vegetation**: `CITY.vegAt(x, z)` 0 (streets, `CITY.keep` rectangles: buildings, lots, driveways) … `zones`
  (yards 0.3, park 0.45…) … 1 outside the town. Register anything new on the ground with `keepOut` / `paved`, and a
  driveway onto a street with `drive` (no street light there; street lights are built last, `buildStreetLights`).
- Plane layering (y): ground −0.02, road 0.01, sidewalk 0.02, lots / aprons 0.025–0.027, markings 0.04.

## Units & traffic (`js/units.js`, `js/roads.js`)
- **Roads**: a place on a street is `{ ax: 'ew' | 'ns', at, a }`; `ROADS.way(from, to, pre, post, o)` = exact points
  `pre`, the route on the right lane, exact points `post` (`join`: the exact points meet the street square on, like a
  driveway, and the lane corner turns from / into them). Headings are letters E W N S (+x −x −z +z). `Way.at(s, out)`:
  position, travel heading `h`, speed limit `v`; `rev` ways are driven backwards (the vehicle faces against `h`).
- **Homes & runs**: fire / EMS / the chief in the bays (out the front onto Main St; home up the lane, along the yard
  (`fire.yardZ`), in through the rear door — everything forward, nobody maneuvers on the street); patrol cars in the lot's
  front row (`stalls` row −36; out backwards (`pullout`), home forwards through the gate). On scene a unit pulls over
  at the curb half on the sidewalk (`houseDest`: `ROAD_W/2 + 0.5` from the centre line), off the lane: nobody has to
  get round it. `farDest`: out of town to a street's far end (`away`, hidden; back one at a time when the end is clear).
- **States**: quarters → turnout → [pullout] → responding (code 3, lights) → on_scene / away → returning (code 1)
  → [parking] → quarters. `UNIT_STATES` = state labels, `TILE_STATES` (`main.js`) = the board's tiles; a new state needs an
  entry in both (the harness checks; a helicopter's: `HELI_STATES` and `TILE_STATES`).
- **Zones** (`ZONES`: apron, yard, lot) — one unit at a time: a crew ready to roll books the apron / the lot (`take(z,
  true)`; it may take it over from one on its way home still > 20 m short of its waiting point — past it, it would stop where it stands, maybe in a crossing), freed once `clear`; a unit coming home books
  the yard / the lot ~40 m before its waiting point (`waitS`: in the lane at z 14 / 28 m short of the gate; never in a
  crossing's box — at its line instead) and waits
  there while it is busy, the nearest to its waiting point first (`homeRem`: a lane's order; it takes the zone over from a
  holder that fell behind it); freed in quarters. Every zone holder must reach a
  state that frees it (quarters, `arrive`).
- **Traffic rules** (per step, in `drive`): `gapCap` (follow the unit ahead in the lane: stop within the gap allowing
  for its own braking), `crossCap` (code 1 stops at the line on red / rolls through stops; code 3 slows to 7 m/s through
  a red, 10 through a stop), `yieldCap` (paths that cross within ~3 s: the later one stops short; a tie goes to code 3, then the lower
  roster number), pulling away from a curb waits for `trafficBy`. Each unit records whom it waits for (`wait`, `waitKind`
  'move' / 'zone'); `leads(o)`: units waiting on each other round a circle — the first 'move' waiter (code 3 first, then
  the roster) drives on. The harness flags two units closer than half their widths, a unit through a shut door, and
  states held past `STATE_LIMITS`.
- **Code 3 runs** (`runOpts(true)`: responding, a code-3 transport, the visitors): vmax × 1.12, `alat` × 1.4, braking
  4 m/s², off the line × 1.4, 6 m/s through a red, 8 through a stop — they drive like a run, not like the drive home.
  (Pushing it further — × 1.25 / 1.6, 7 / 10 m/s — gained ~0.3 m/s on average on these short blocks and broke the
  giving-way timings: overlaps. The blocks are 100 m: a run is mostly getting up to speed and braking for the next turn.)
- **Visitors** (`VISITORS`, `Visitor extends Unit`, `VISITS`; property `visitors`): units of the neighbouring districts
  (`VISITOR_ROSTER`, liveries `LIVERY.county / ambulance / sheriff`) passing through code 3 — `throughWay` (off the screen in
  on one street, out on another, as the civilian cars), hidden in 'quarters' between passes, never on the CAD or the board.
  At once `1 + floor(LOAD × 2.6)`, one every `lerp(200, 25, LOAD)` s × rand. **`MOVERS`** = units + visitors: everything
  physical (following, giving way, crossings, cars pulling over, the harness's overlaps) iterates `MOVERS`; the CAD, the
  zones and the board iterate `UNITS`.
- **Drills** (`DRILLS`, `units.js`; state `drill`, tile 'Training'): with the load < 0.2 and calls on, every 3–6 min a
  free fire / EMS unit with a bay rolls out onto the apron in front of it (`spot`: its tail just clear of the door), works
  80–140 s — the engine's deck gun straight up (`pump`), the ladder's aerial raised (`aerial`), the rescue / medics washed
  (a hose and suds, `wash`) with a crew from `CREW` on the west (camera) side — then backs in (a `rev` way) and the door
  comes down (CAD: `OOS TRAINING` / `IN SVC`). Not free while drilling; a call that needs that type, or the load > 0.3,
  ends it early (the aerial bedded first). Only while nobody holds the apron.
- **Light bars**: `flash(on, a)` swaps the segments' materials and the glow points' `userData.on` only on a change; with
  music (`LOAD.level` > 0.15) every beat swaps the sides, otherwise they alternate at ~2.4 Hz.

## CAD (`js/dispatch.js`, `js/incidents.js`, `js/radio.js`)
- **Calls**: every `600 / CFG.calls` s × (1 … 0.14 with `LOAD`) × rand, at most `maxOpen()` open (3 quiet … `MAX_CALLS` 6); the type by the load
  tier's weights (`INCIDENT_TYPES.w` = [routine, busy, surge]) among types whose first unit type has someone free.
  `newCall(key)` → a site of one of the type's kinds (`pickSite`, ≥ 70 m from other open calls on the same street) →
  `assign`: one free unit (quarters, no `callRef`) per needed type (+ `extra` by chance); what is missing is filled in
  every 2 s as units come free (HOLDING while none). Statuses: pending → holding / dispatched → onscene → clearing → closed.
- **Course**: `DISPATCH.update` watches each unit's state (`cadState`) and calls `onState`: ENRT, ONSC (the first
  arrival sets `arrived` and gives the size-up `ON_SCENE[kind]`), returning = cleared (AVAIL, `callRef` = null). Up to two
  `UPDATE_LINES` while working; after `dwell` the units are released one by one (the chief last); closed once all cleared.
  Police units on a fire / EMS call use the `pd` pools.
- **Sites**: curbs (`site(kind, ax, at, a, side, name)`); `siteSlots` = curb places 15 m apart on the site's side, then
  across the street (±8 × 15 m), none within 16 m of a crossing (a crash's wrecks are 11 / 17 m from it) or across a wide entrance (a `drive` wider than 6 m: the ER, the apron, the lot gate, the gas station); each unit takes the first place no other unit is headed for or still stands at (`freeSlot`: a closed call's unit may not have pulled away yet); units pull over 8 m after leaving the lane. Far (mutual aid): a
  street's end, the same for all of the call's units.
- **Radio** (`RADIO.say(who, text, kind, prio)`): 'sys' CAD lines go straight to the log, the rest are queued one at a
  time (gap ~1.6 s + length), stale ones (> 45 s, prio 0) dropped. Every line through `radioLine` (tiers: routine /
  busy / surge from `LOAD`; placeholders {U} {L} {T} {A} {X} {N} {D} {S} {H} {P}). Fire / EMS plain language, police
  10-codes. Times: `cadNow` (the fixed hour runs on with T).
- **Terminal** (`TERM`, `#cad`): header (town 911 · CAD, TONES flashing on a new call, clock), up to 3 call cards (unit
  chips coloured by status: dsp / enr / osc / avl / clr), the last 9 log lines; properties `terminal`, `terminalposition`.
  The cards are rebuilt only when their HTML changes.

## Scenes (`js/scenes.js`)
- `SCENES.open(call)` when a call comes in (by `type.kind`), `scene.close()` when it closes; `scene.ready` gates the
  dispatcher's clearing (a fire: out for 20 s). Nothing is built per call: wrecks / burnt cars come from `PROPS` pools
  (`car(list)` / `put`), cones are one InstancedMesh (`cone` / `dropCones`), crews one InstancedMesh (`CREW.take` /
  `drop`; `CREW.update` puts a unit's crew beside it on the sidewalk side while it stands on scene).
- **FireScene**: emitters at the front windows and the roof (`house.rot` 0 / π: local → world by ±1); `heat` 0.35 → 1
  until water, −0.009/s per stream (the engine's line from the yard, the ladder's aerial over the roof, from 6 s after
  arrival); `out` at 0, steam for a minute. Particles by time accumulators: `FX.fire` (additive flames), `FX.smoke` (black
  smoke / white steam — colour given, not tinted), `FX.water` (`waterArc`: ballistic, `rise` −9.8).
- **Aerial** (`Unit.aimAerial(p)`): yaw first, then pitch and fly together (`aerialK` 0 … 1 at 1/7 per s). The
  dispatcher beds it (`aerialWant` 0) before releasing the ladder; it never drives with it up (tested).
- **Transports**: on medical / crash calls the dispatcher sends the first medic it clears (70 %) to the ER (`transport`,
  code 3 at 25 %): in at `HOSP.inX`, under the canopy to a free place (`HOSP.slots`), `at_hospital` 40–80 s, out at
  `HOSP.outX` and home (`leaveHospital` → `goHome(from, pre)`). Its radio goes on without the call (`onState`, `!callRef`).
- **CrashScene**: the wrecks 11 / 17 m from the crossing; the units' curb (`crossingSite`) 30 m up the approach.

## Civilian traffic (`js/traffic.js`)
- A pool of `CIV_MAX` (24) cars built once; `CFG.traffic` (property **traffic**, default 16) of them by day, a quarter at
  night, a third more under a full load (`trafficWanted`); well short of it, they spawn every ~1 s instead of ~2.5. Each comes in off the screen on a street end (`spawn`: the first point off the screen ≥ 175 m out) and
  leaves off the screen on another (`ROADS.way` on the right lane, `vmax` 10–12.5), then goes back to the pool.
- **Crossings** (`way.boxes` from `wayBoxes`: key, way distances in / out, entry / exit headings, signal): stop at the line
  on red (or yellow when it can), a full stop then in turn at all-way stops; into a box only when no car committed to it
  (`CIV_BOXES`) and no unit in it, at its line (free to go: no red) or due within 3.5 s makes a crossing move
  (`boxConflict`: same entry heading or opposite straights don't cross). Committed, it clears the box.
- **Units**: cars give way to units, units to no car. `Civ.unitCap`: short of where a unit is going (its way ~3.5 s ahead;
  one held at a red light or waiting for its zone (`held`) claims only its body, one standing 10 m), if the car can still
  stop or already brakes for it; on that way or past stopping it clears it — but never into the unit's body (front /
  middle / back points); merging into one lane, the one nearer the merge goes first. A unit only never drives into a car
  on its path within its stopping distance (`Unit.yieldCap`), waits at a crossing's line while a car is in its box (or
  can no longer stop short of it: `crossCap`), and follows cars ahead in its lane (`gapCap`, not one across its way). A
  car nose to nose with a unit that waits for it backs off up to 14 m (`jamT`, `behindBy`).
- **Code 3**: a car with a code-3 unit coming within 70 m pulls over to the curb (`lat` +1.2) and stops — unless the
  curb is taken (then it just slows), its nose is in a box (it clears it first) or the unit stops right there (then it
  drives on out of its way); it moves on once the unit's tail is by. The unit passes on the centre line (`latOff`
  −`LANE_OFF`, only along a street (`alongStreet`), sideways only while rolling, not with a unit coming the other way
  (`oncoming`)), back in 25 m before its stop (crawling if a car is still alongside); into a turn slowly, and back in first if a car comes the other way.
  Coming back in, its `gapCap` measures the cars from the lane it is going to, not from where it is (a car pulled over
  just short of its stop was out of its way on the centre line and right in it back in the lane: too late to brake).
- **Pulled over**, a car stays at the curb till the unit's tail is 3 m by — 10 m while the unit is still coming back in
  off the centre line or slower than 6 m/s (it cuts in just ahead, slowing for a turn). The unit stays out on a straight
  while a car is alongside or within its stopping distance (`abreast`), whatever comes the other way in its own lane;
  two out head-on: the one later in the roster goes back in. It starts out only with no unit coming within 60 m + 3 s.
- **In a box it is committed to**, a car clears it: inside the box only a unit's body stops it, not the unit's way (beyond the box it gives way as ever; stopping
  mid-box for a unit still coming leaves it standing in the way of that unit).
- **Oncoming**: a unit about to turn into the street toward the passer counts (its way 15 / 30 m on); other units'
  ways are taken where they really drive (out on the centre line while passing: `yieldCap`). A unit waits for a car in
  its box until half its length is in (braking for it from code 3) — not for one that waits for its body (it clears out:
  else both stand) — and for another unit only while its nose is barely in.
- **Queues and boxes**: a car standing in a queue short of a box (whoever is ahead stands too) has no claim on it
  (`queued`: one it cannot use holds up the cross traffic, maybe what the one ahead waits for); a unit `held` for its zone
  or a red does not hold a box it is not in. A car jammed with a unit and no room to back (a unit close behind, or 8 m
  backed) squeezes by the unit's nose with no margin for 6 s (`squeeze`). A car backs off from a unit it follows too
  (`gapCap`), not only one it gives way to, when that unit waits for it (one cutting in to its curb across the lane).
- **Pulling away** from a curb (`trafficBy`): nobody coming its way within ~4 s behind (`o.v × 4 + 10` m, ≥ 35), in a
  10 m wide band (it is already turned out toward the lane).
- **Look-ahead by speed**: a unit's `yieldCap` looks at least its stopping distance + 15 m ahead (≤ 80), `crossCap`
  finds the next box within its stopping distance + 12 m (≥ 45): at code 3 speeds 45 m was too short to stop.
- **Waiting claims little**: a unit stopped waiting for another mover (`wait`, kind 'move') is `held` like one at a red —
  the cars go by it (a ring of waits through a car otherwise). It drives by a car that stands waiting for it with a
  centre-to-centre check (`waits`), not the car's front / back circles; a car backs off up to 14 m.
- **A committed car re-checks** the units while it is still short of the box and can stop (`unitDue`): one come up
  meanwhile (it crawled, it pulled over) and it lets go of the box. Under 6 m/s a car brakes for a unit's way even past
  its stopping point (it stops short of the hit anyway); a held unit it already gives way to keeps a 6 m claim.
- **Tight pairs**: out on the centre line a unit is `LANE_OFF` from the other lane's centre — a wide unit and a wide
  car coming the other way don't fit side by side, so such a car (one not truly over at the curb, `lat` > 0.6) stops a
  pass even on a straight (`oncoming`); a car coming the other way in the next lane is passed with 0.3 m less margin
  (`yieldCap`). A pulled-over car that comes up to a driveway stays where it is while the unit goes by.
- **Safety net** (`TRAFFIC.tidy`, every 2 s): a unit that has not got 3 m on its way in 25 s while it and a car wait for
  each other (`yieldTo`, `blocker`, or the box it waits at for that unit: `boxFor`) — or the car has stood 25 s giving way (a ring through other units): the car goes (`TRAFFIC.cleared`). The rules untangle nearly all standoffs; this is for the rare rest.
- **Obstacles** at the curb (units on scene, wrecks, burnt cars): a car eases left round them, slowly.
- **Headlight beams** (`BEAMS`): at night a soft oval on the road ahead of every car and unit with its lights on — one
  additive InstancedMesh, faded with `ENV.lightsOn`, updated in `TRAFFIC.update`.
- The tests count cars let into a box without committing (`TRAFFIC.intruded`, must be 0) and watch `civStill` (a car
  standing > 100 s) with the stuck detector.

## Helicopters (`js/helis.js`)
- **Air 1** (police) lives on the complex's pad (`CITY_LAYOUT.helipad`), **Medevac 1** on the hospital's roof pad. They
  are not `UNITS` (no roads, no zones): `HELIS`, the same CAD states (`HELI_STATES`), `air: true`; the dispatcher treats
  them as units (`free`, `assign` → `dispatch(site)`, `release`; their radio: `DISPATCH.onAir`, `AIR_LINES`).
- **Flight** (`ph`): pad → spinup → lift (8 m) → fly → hover (8 m over the spot, turned to the pad's heading) → descend →
  pad / ground. `fly` steers: the heading turns no faster than a 0.45 rad bank allows, speed and height are eased; a landing
  slows to stop over the spot (the last 40 m straight at it), an orbit keeps `orbitR` round the call, an exit leaves the
  screen (`away`: hidden until released, then back from there). Rotor wash: dust (`ENV.dustTint`) when low.
- **Calls**: SUSPECT SEARCH (two patrols + Air 1; a burglary alarm sometimes gets it), Air 1 orbits the site, its
  searchlight (the one real `SpotLight`) wandering on the ground there at night. MVA WITH ENTRAPMENT: the first unit in asks
  for the helicopter (`type.air` → `need`), Medevac 1 lands at the nearest landing zone (`HELI_LZ`: the school field, the
  park lawn — kept clear of trees) and, released, flies the patient to the roof (`transporting` → `at_hospital` →
  quarters). MEDEVAC REQUEST (`kind: 'air'`, `airSite`): out of town and back to the roof.

## Panel & persistence (`index.html`, `style.css`, `js/main.js`, `js/persist.js`)
- **The panel** is a flat graphite dispatch board (not FAB's radar look): a red-blue stripe, the header (a `911` badge in
  the accent colour — property `uicolor` — the town, the clock), the day and the season, today's calls, the load (10
  cells: `#loadbar`, label `#load`; the label, its colour and the cells' colours all from `loadLv`), the sound (`#meter`), the units as status tiles (`#units`: one per unit and
  helicopter, built in `buildUI`; the service's colour on the left edge, the status as the tile's colour —
  `TILE_STATES`: avl / ret green, dsp / enr amber, osc red, trn blue), the open calls as cards (`#callcards`, at most 3).
  Sans-serif text, monospace only for numbers and callsigns. `updateUI` (4×/s) writes only what changed (`setTxt` /
  `setCls`; the cards as one string compared). The splash and the browser settings drawer share the style; the CAD
  terminal (`#cad`) stays a phosphor screen on purpose.
- **Persistence** (`PERSIST`, property `savestate`): `code3.cad.v1` in localStorage, every 10 s only when changed and on
  `pagehide` / hiding: the call counter (`DISPATCH.seq`: the numbers run on), today's calls by service (`count` from
  `DISPATCH.newCall`; a new day starts again), the last 9 log lines (back on the terminal with their times, then
  `CAD RECONNECTED`, one: the previous one is not restored), the load (rounded to 0.05). Not the units: they start in
  quarters, open calls are dropped. `restore()` runs in `init()`, before the properties come in: turning `savestate` off
  clears the key (`applyUserProperties`), or the next start would restore it. Text into `innerHTML` goes through
  `escHtml` (site names carry the town name).

## Performance & memory invariants (the wallpaper never restarts — leaks accumulate for days)
- **Never create geometry per spawn and drop it.** Pool and clone templates; anything removed for good is disposed
  (`disposeTree`; it skips materials with `userData.shared`: everything from `M()` / `sharedMat()`).
- **Static meshes are merged** via `mergeStatic(root, dynamicNodes)` (per material, all plain `M(colour)` together into
  `PLAIN_MAT`). Every node that moves, rotates, toggles `visible` or swaps its material at runtime (bay doors, signal
  lamps, signs) **must be listed as dynamic**. Don't keep references to static meshes after the builder returns.
- Repeated objects are `InstancedMesh` (vegetation, street light pools, the signals' lit lamps: one mesh moved and
  recoloured, `CITY.sigLamps`). **InstancedMesh turns `frustumCulled` off** (r149: its sphere is the geometry's): the
  vegetation is one mesh per kind **and sector** (`VEG_CELL`) with the sector's own bounding sphere and culling back on —
  one mesh for all 820 trees drew them all (and into the shadow map) for the ~20 on screen. A dynamic group that moves
  as a whole (a bay door) is merged on its own (`mergeStatic(door, [])`).
- Budget (a busy night, 3 calls, full traffic, default zoom): ~350 draw calls (shadow pass included), ~290k triangles,
  `step()` ≈ 0.1 ms. Measure with `renderer.info` (`autoReset = false`, `reset()`, one `__t.render()`).
- `THREE.MathUtils.generateUUID` uses `Math.random`: adding or removing objects shifts the seeded sequence, so the
  town and the preview scenes change with them (tests must not depend on a seed's exact layout).
- Shared scratch vectors must not be passed into a function that also writes them. Top-level names are global across
  all files: no duplicates.
- Pools are ring buffers; spawn rates must not scale with FPS (time accumulators).
- The sun's shadow camera is fitted to the visible ground every frame (`fitShadow`): no fixed shadow bounds.
- Main loop (`frame`): FPS limit keeps cadence via `frameDue`; simulation runs in ≤50 ms sub-steps.
- The panel's DOM is written only where a value changed (`setTxt` / `setCls`).

## Running & testing
- WE: "Open from File" → `project.json` (audio listener + properties come from WE).
- Browser preview: serve the folder, e.g. `python -m http.server 8766`, open `http://localhost:8766/`.
  The ⚙ Settings drawer mirrors all WE properties (stored in `localStorage`); URL params `?hour=22`,
  `?zoom=150`, `?season=winter`, `?demo=1`, `?ts=N` (time scale).
- **Automated tests** (`tests/`, Playwright Test in headless Chromium + SwiftShader WebGL): run them in Docker —
  `powershell -ExecutionPolicy Bypass -File tools/test.ps1 [file / -g pattern]` (no local Node; `$env:SEED = N` for
  another seed); CI runs the same image on every push / PR. Run them after a change.
  - The harness (`tests/support/harness.js`) boots the page deterministically: seeded `Math.random` (`SEED`), fixed
    date in UTC, no `requestAnimationFrame` (time only advances through `__t.sim(sec)` = `step(0.05)` per tick),
    `RT()` on simulated time, Wallpaper Engine mode (audio fed by `__t.sim(sec, { audio: true/false })`).
  - `tests/support/inpage.js` (`window.__t`): `sim` runs `checkInvariants()` after every step; `sample` (pixels);
    `geometries` (leak check); `props` (apply WE properties).
  - `repo.spec.js` checks the cache-buster (all tags equal, matches "Current: `v=N`" here), the load order line above,
    and that `js/properties.js` is regenerated.
- **Close-ups in the browser**: `CFG.zoom = 320; CAM_TGT.set(x, 0, z); updateCamera()`; hide the UI with
  `#panel, #cfgGear` → `display: none`. The Browser pane's screenshot can show a stale frame: render by hand
  (`renderer.render(scene, camera)`) and take it in a call of its own.

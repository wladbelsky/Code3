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
the terminal UI — done. 5. Scenes on site: structure fire, crash, medical, transport to the hospital. 6. Helicopters
(medevac, police). 7. Civilian traffic yielding to lights and sirens. 8. Load from the music, persistence, panel,
properties; **a new panel design** — the FAB / CSG "radar" look (glowing green on black, monospace everywhere) goes:
a flat graphite dispatch board with a red-blue header stripe, sans-serif text (monospace only for numbers), units as
status tiles (service colour + status colour: AVAIL green, ENRT amber, ONSC red, TRAN blue, OOS grey), active calls
as cards; the splash and the settings drawer to match. The CAD terminal stays a "screen" on purpose. 9. Polish: performance, preview GIF (**`preview.gif` is still Forward Air Base's placeholder**),
screenshots, README, Workshop.
Original work in the genre: no names, logos, models or assets of existing games or real departments; the town is
fictional (default FAIRHAVEN).

## Stack & layout
- Plain JS, no build step, no npm. `'use strict'` classic scripts sharing **global** scope
  (no modules). three.js **r149** is vendored as `js/three.min.js` — never edit it.
- `index.html` loads scripts in dependency order (later files use globals of earlier ones):
  `core → flightpath → models → vehicles → city → terrain → effects → roads → units → radio → incidents → dispatch → main → properties → settings`,
  then an inline script registers the WE audio listener (or starts the browser demo beat).
  `main.js` calls `init()` at its end, so anything `init()` needs must be defined before `main.js`.

| File | Contents |
|---|---|
| `js/core.js` | utils (`V3`, `TAU`, `rand`, `clamp`, `lerp`, `smoothstep`, `pick`…), `CFG` defaults, `WIND` (smoke drift), `groundH` (flat ground), `SEASONS` + `seasonNow()`, sun position, sky palette, canvas textures `TEX` |
| `js/flightpath.js` | `FlightPath`: Dubins CSC curves (turn-radius-limited flight) + lines — for the helicopters |
| `js/models.js` | mesh helpers (`M`, `box`, `cyl`, `taper`, `prism`, `strut`, `deckLine`…), `mergeStatic`, `disposeTree`, nav lights (`navLights`, `NAV_MATS`), searchlights, seasonal shared materials `ROOF_MAT` / `HOUSE_ROOFS` (`seasonMats`) |
| `js/vehicles.js` | vehicle models, facing +x, wheels on y = 0: civilian cars (`carModel(kind, colour)`, `randomCar`); apparatus `UNIT_MODELS` (engine, ladder with `aerial` yaw / pitch / fly, rescue, medic, chief, patrol) → `{ group, bars, len, wid, dyn }`; light bar segments swap `LB_MATS` [off, on] |
| `js/city.js` | `CITY_LAYOUT` (the one source of positions), `buildCity()`, `CITY` (houses with addresses, bays with roll-up doors, police lot stalls, signals, signs, `vegAt`, `signal(axis)`, `update`, `setTown`), `pavedAt` — see "Town" |
| `js/terrain.js` | `TERRAIN`: the ground (tiled canvas texture + vertex-colour patches), the vegetation per season (InstancedMesh per kind, placed where `CITY.vegAt` allows), weather particles (snowfall, falling leaves) |
| `js/roads.js` | `ROADS`: the street graph (crossings + far ends), `route(from, to)` (Dijkstra over node × heading: no U-turns on screen), `lane` (right-hand offsets), `way(from, to, pre, post, o)`; `Way` (rounded, sampled polyline with headings and a curvature / braking speed limit) — see "Units & traffic" |
| `js/units.js` | `UNIT_TYPES`, `ROSTER`, `Unit` (homes, run state machine, zones, traffic rules, light bars; `radio` / `short` names, `callRef`), `UNITS`, `ZONES`, `houseDest` / `farDest` — see "Units & traffic" |
| `js/radio.js` | line pools (`DISPATCH_LINES`, `ACK_LINES`, `ON_SCENE`, `UPDATE_LINES`, `CLEAR_LINES`…), `radioLine(pool, vars)`, load tiers, `cadNow`, `RADIO` (the queue the terminal prints) — see "CAD" |
| `js/incidents.js` | `INCIDENT_TYPES`, sites (houses, `BUSINESSES`, street spots, crossings, far ends), `pickSite`, `siteSlots`, `siteDest` |
| `js/dispatch.js` | `DISPATCH` (calls, assignment, the call's course, `onState`), `TERM` (the CAD terminal DOM) |
| `js/effects.js` | `Tracers` (InstancedMesh, will carry the hose streams), `SpriteFX` (flash / smoke pools), `Scorch`, `FlashLights` |
| `js/main.js` | WE property listener, scene init, camera, `VIEW` (screen helpers), light / season (`updateEnvironment`, `updateLights`), audio analysis + `onBeat`, `LOAD`, panel, main loop |
| `js/properties.js` | **generated** from `project.json` — do not edit by hand |
| `js/settings.js` | browser-only settings drawer, demo beat, audio-file player (returns early inside WE) |
| `tools/gen_properties.py` | regenerates `js/properties.js` |
| `tests/`, `playwright.config.js`, `package.json` | automated tests (Playwright Test) — see "Running & testing"; `tools/test.ps1` runs them in Docker, `.github/workflows/tests.yml` in CI |

## Rules / conventions
- **After changing any JS/CSS file, bump the cache-buster** `?v=N` on all `<script>`/`<link>` tags in
  `index.html` (WE's CEF caches aggressively). Current: `v=6`.
- **New WE property**: add it to `project.json`, read it in `applyUserProperties` (`main.js`) into `CFG`,
  then run `python tools/gen_properties.py`. Property `order` decides the browser-drawer group
  (0–9 camera/time, 10–19 audio/calls, 20–29 terrain & season, 30–39 panel & terminal, 40–49 units, 50–59 town).
- Match the existing style: dense one-liners, short comments, `const` scratch vectors at module level.
- Sim time is `T` (advances only in `step(dt)`); real time is `RT()` (audio, beat gaps).
- **No scrolling UI**: WE passes clicks and mouse movement to the wallpaper but not the wheel (page long lists).
- **The music is load, not combat**: `LOAD.level` (0..1) climbs while sound plays (faster when dense, `AUD.heavy`) and
  drains slowly in silence; labels ROUTINE / BUSY / HEAVY / SURGE. `AUD.beat` = `T` of the last low / mid beat.

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
  → [parking] → quarters. `UNIT_STATES` = panel labels; a new state needs an entry there (the harness checks).
- **Zones** (`ZONES`: apron, yard, lot) — one unit at a time: a crew ready to roll books the apron / the lot (`take(z,
  true)`; it may take it over from one still > 60 m out on its way home), freed once `clear`; a unit coming home books
  the yard / the lot ~40 m before its waiting point (`waitS`: in the lane at z 14 / 28 m short of the gate) and waits
  there while it is busy, first come first served (`waitSince`); freed in quarters. Every zone holder must reach a
  state that frees it (quarters, `arrive`).
- **Traffic rules** (per step, in `drive`): `gapCap` (follow the unit ahead in the lane: stop within the gap allowing
  for its own braking), `crossCap` (code 1 stops at the line on red / rolls through stops; code 3 slows to 6 m/s through
  a crossing), `yieldCap` (paths that cross within ~3 s: the later one stops short; a tie goes to code 3, then the lower
  roster number), pulling away from a curb waits for `trafficBy`. Each unit records whom it waits for (`wait`, `waitKind`
  'move' / 'zone'); `leads(o)`: units waiting on each other round a circle — the first 'move' waiter (code 3 first, then
  the roster) drives on. The harness flags two units closer than half their widths, a unit through a shut door, and
  states held past `STATE_LIMITS`.
- **Light bars**: `flash(on, a)` swaps the segments' materials and the glow points' `userData.on` only on a change; with
  music (`LOAD.level` > 0.15) every beat swaps the sides, otherwise they alternate at ~2.4 Hz.

## CAD (`js/dispatch.js`, `js/incidents.js`, `js/radio.js`)
- **Calls**: every `600 / CFG.calls` s × (1 … 0.25 with `LOAD`) × rand, at most `MAX_CALLS` open; the type by the load
  tier's weights (`INCIDENT_TYPES.w` = [routine, busy, surge]) among types whose first unit type has someone free.
  `newCall(key)` → a site of one of the type's kinds (`pickSite`, ≥ 70 m from other open calls on the same street) →
  `assign`: one free unit (quarters, no `callRef`) per needed type (+ `extra` by chance); what is missing is filled in
  every 2 s as units come free (HOLDING while none). Statuses: pending → holding / dispatched → onscene → clearing → closed.
- **Course**: `DISPATCH.update` watches each unit's state (`cadState`) and calls `onState`: ENRT, ONSC (the first
  arrival sets `arrived` and gives the size-up `ON_SCENE[kind]`), returning = cleared (AVAIL, `callRef` = null). Up to two
  `UPDATE_LINES` while working; after `dwell` the units are released one by one (the chief last); closed once all cleared.
  Police units on a fire / EMS call use the `pd` pools.
- **Sites**: curbs (`site(kind, ax, at, a, side, name)`); `siteSlots` = curb places 15 m apart on the site's side, then
  across the street, none within 16 m of a crossing; units pull over 8 m after leaving the lane. Far (mutual aid): a
  street's end, the same for all of the call's units.
- **Radio** (`RADIO.say(who, text, kind, prio)`): 'sys' CAD lines go straight to the log, the rest are queued one at a
  time (gap ~1.6 s + length), stale ones (> 45 s, prio 0) dropped. Every line through `radioLine` (tiers: routine /
  busy / surge from `LOAD`; placeholders {U} {L} {T} {A} {X} {N} {D} {S} {H} {P}). Fire / EMS plain language, police
  10-codes. Times: `cadNow` (the fixed hour runs on with T).
- **Terminal** (`TERM`, `#cad`): header (town 911 · CAD, TONES flashing on a new call, clock), up to 3 call cards (unit
  chips coloured by status: dsp / enr / osc / avl / clr), the last 9 log lines; properties `terminal`, `terminalposition`.
  The cards are rebuilt only when their HTML changes.

## Performance & memory invariants (the wallpaper never restarts — leaks accumulate for days)
- **Never create geometry per spawn and drop it.** Pool and clone templates; anything removed for good is disposed
  (`disposeTree`; it skips materials with `userData.shared`: everything from `M()` / `sharedMat()`).
- **Static meshes are merged** via `mergeStatic(root, dynamicNodes)` (per material, all plain `M(colour)` together into
  `PLAIN_MAT`). Every node that moves, rotates, toggles `visible` or swaps its material at runtime (bay doors, signal
  lamps, signs) **must be listed as dynamic**. Don't keep references to static meshes after the builder returns.
- Repeated objects are `InstancedMesh` (vegetation, street light pools).
- Shared scratch vectors must not be passed into a function that also writes them. Top-level names are global across
  all files: no duplicates.
- Pools are ring buffers; spawn rates must not scale with FPS (time accumulators).
- The sun's shadow camera is fitted to the visible ground every frame (`fitShadow`): no fixed shadow bounds.
- Main loop (`frame`): FPS limit keeps cadence via `frameDue`; simulation runs in ≤50 ms sub-steps.
- The panel's DOM is written only where a value changed (`setTxt` / `setCls`).

## Running & testing
- WE: "Open from File" → `project.json` (audio listener + properties come from WE).
- Browser preview: serve the folder, e.g. `python -m http.server 8766`, open `http://localhost:8766/`.
  The ⚙ SETTINGS drawer mirrors all WE properties (stored in `localStorage`); URL params `?hour=22`,
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

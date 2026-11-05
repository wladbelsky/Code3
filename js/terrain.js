'use strict';
/* ===== Terrain: the ground around the town and its vegetation, by season (SEASONS / seasonNow in core.js) =====
   One big plane with a tiled canvas texture (grass / sand / snow speckles) and large-scale vertex-colour patches;
   vegetation is an InstancedMesh per kind and sector (VEG_CELL): trees out of the view are culled whole, also from the
   shadow pass (one mesh for all 820 trees drew them all for the ~20 on screen).
   A season change rebuilds the texture and the vegetation (disposed, never leaked) and recolours the roofs (seasonMats).
   Where trees may grow is the town's business: CITY.vegAt(x, z) → 0 (never) .. 1 (open country).
   Weather: snowfall in winter, falling leaves in autumn — a points pool around the screen centre.          */
const VEG_CELL = 120;   // vegetation sectors, m: one InstancedMesh per kind and sector, culled by its own bounding sphere
const _tm = new THREE.Matrix4(), _tq = new THREE.Quaternion(), _ts = new V3(), _tp = new V3(), _tc = new THREE.Color();
/* cheap value noise for patches and forest clumps (deterministic for a seed) */
function vnoise(x, z, seed) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(h(xi, zi), h(xi + 1, zi), u), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
}
/* a geometry from parts with per-vertex colours (one InstancedMesh per vegetation kind) */
function vegGeometry(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color();
  for (const [geo, hex, x, y, z, sx, sy, sz] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; g.scale(sx || 1, sy || 1, sz || 1); g.translate(x || 0, y || 0, z || 0); g.computeVertexNormals();
    c.setHex(hex);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    g.dispose(); if (g !== geo) geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
const VEG_MAT = sharedMat(0xffffff, { vertexColors: true });
/* vegetation kinds: geometry (built per season), how many, size range, where (forest clumps or scattered), tint list */
function vegKinds(season) {
  const S = SEASONS[season], ico = (r, d) => new THREE.IcosahedronGeometry(r, d || 0), cone = (r, h, s) => new THREE.ConeGeometry(r, h, s || 6), cy = (a, b, h, s) => new THREE.CylinderGeometry(a, b, h, s || 5);
  if (S.veg === 'fir') return [
    { geo: vegGeometry([[cy(0.12, 0.16, 0.8), 0x4a3a2a, 0, 0.4, 0], [cone(1.0, 1.6, 7), 0x1f3d2a, 0, 1.4, 0], [cone(0.8, 1.3, 7), 0x24452f, 0, 2.2, 0], [cone(0.55, 1.1, 7), 0x2a4d34, 0, 2.95, 0],
      [cone(0.86, 0.5, 7), 0xf2f6fa, 0, 1.78, 0], [cone(0.66, 0.42, 7), 0xf2f6fa, 0, 2.5, 0], [cone(0.42, 0.45, 7), 0xf6f8fb, 0, 3.32, 0]]), n: 900, size: [0.8, 1.6], clump: 0.42, tint: [0xffffff, 0xe8f0e8, 0xf4f4ec] },
    { geo: vegGeometry([[cy(0.06, 0.09, 1.6, 4), 0x8a8478, 0, 0.8, 0], [ico(0.5), 0x9a9488, 0, 1.6, 0, 1, 1.3, 1]]), n: 160, size: [0.7, 1.2], clump: 0.6, tint: [0xffffff, 0xdddddd] },   // bare birch
    { geo: vegGeometry([[ico(0.6), 0xf0f4f8, 0, 0.15, 0, 1.4, 0.45, 1.1]]), n: 260, size: [0.6, 1.8], clump: 0, tint: [0xffffff, 0xe6eef6] }                                        // snow drifts
  ];
  // spring / summer / autumn: deciduous trees (crown tint from the season's leaf colours), bushes, a few firs
  return [
    { geo: vegGeometry([[cy(0.12, 0.17, 1.4), 0x5a4632, 0, 0.7, 0], [ico(0.95, 1), 0xffffff, 0, 1.9, 0, 1, 0.9, 1], [ico(0.6, 1), 0xffffff, 0.45, 2.35, 0.2]]), n: 820, size: [0.8, 1.6], clump: 0.42, tint: S.leaf, leafy: true },
    { geo: vegGeometry([[ico(0.55, 1), 0xffffff, 0, 0.4, 0, 1.2, 0.8, 1]]), n: 360, size: [0.6, 1.3], clump: 0.2, tint: S.leaf, leafy: true },
    { geo: vegGeometry([[cy(0.1, 0.14, 0.7), 0x4a3a2a, 0, 0.35, 0], [cone(0.9, 1.5, 7), 0x2a4a30, 0, 1.3, 0], [cone(0.65, 1.2, 7), 0x2e5236, 0, 2.1, 0]]), n: 160, size: [0.9, 1.5], clump: 0.55, tint: [0xffffff, 0xe0f0e0] }
  ];
}
/* the leafy part of a deciduous geometry is white in the vertex colours: only it takes the tint; trunks stay brown —
   done by tinting per instance and letting the trunk colour be dark enough not to show the tint much */

const TERRAIN = {
  season: null, ground: null, veg: [], tex: null, weather: null,
  /* build or rebuild for a season */
  build(season) {
    this.season = season;
    const S = SEASONS[season];
    if (!this.ground) {
      let geo = new THREE.PlaneGeometry(1200, 1200, 120, 120); geo.rotateX(-Math.PI / 2);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      this.ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
      this.ground.receiveShadow = true; this.ground.position.y = -0.02; scene.add(this.ground);
    }
    // large-scale patches: darker / lighter areas
    const pos = this.ground.geometry.attributes.position, col = this.ground.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), n = vnoise(x / 38, z / 38, 3) * 0.6 + vnoise(x / 11, z / 11, 7) * 0.4;
      const k = 0.82 + n * 0.32;
      col.setXYZ(i, k, k, k);
    }
    col.needsUpdate = true;
    if (this.tex) this.tex.dispose();
    this.tex = this.groundTex(S); this.ground.material.map = this.tex; this.ground.material.needsUpdate = true;
    seasonMats(season);
    this.buildVeg(season);
    this.buildWeather(season);
  },
  groundTex(S) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = '#' + S.ground.toString(16).padStart(6, '0'); g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = '#' + pick(S.grass).toString(16).padStart(6, '0'); g.globalAlpha = rand(0.25, 0.75);
      const x = rand(0, 256), y = rand(0, 256), w = rand(1, 4), h = rand(1, S.veg === 'leaf' ? 5 : 3);
      g.fillRect(x, y, w, h); if (x + w > 256) g.fillRect(x - 256, y, w, h); if (y + h > 256) g.fillRect(x, y - 256, w, h);
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(110, 110); t.anisotropy = 4;
    return t;
  },
  buildVeg(season) {
    for (const v of this.veg) { scene.remove(v); v.geometry.dispose(); v.dispose(); }   // the mesh too: its instance buffers (the shared attributes go with the first)
    this.veg = [];
    let seed = { spring: 11, summer: 23, autumn: 37, winter: 41 }[season];
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };   // same layout every rebuild
    for (const K of vegKinds(season)) {
      const cells = new Map();   // sector → [{ m, c, x, z, s }]
      let n = 0, tries = 0;
      while (n < K.n && tries++ < K.n * 30) {
        const r = Math.pow(rnd(), 0.7) * 420, a = rnd() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
        const k = CITY.vegAt(x, z); if (k <= 0 || rnd() > k) continue;                      // the town: yards and parks only
        if (K.clump && k >= 1 && vnoise(x / 70, z / 70, 5 + K.n) < K.clump && rnd() > 0.08) continue;   // forests in clumps out of town
        const s = lerp(K.size[0], K.size[1], rnd()) * VEG_SCALE;
        _tq.setFromAxisAngle(WUP_T, rnd() * TAU); _ts.set(s, s * lerp(0.85, 1.2, rnd()), s);
        const key = Math.floor(x / VEG_CELL) + ',' + Math.floor(z / VEG_CELL), list = cells.get(key) || cells.set(key, []).get(key);
        list.push({ m: _tm.compose(_tp.set(x, 0, z), _tq, _ts).clone(), c: K.tint[Math.floor(rnd() * K.tint.length)], x, z, s });
        n++;
      }
      // a mesh per sector: its own geometry object (the kind's attributes shared: one GPU buffer) with the sector's sphere
      for (const list of cells.values()) {
        const g = new THREE.BufferGeometry(); for (const k in K.geo.attributes) g.setAttribute(k, K.geo.attributes[k]);
        let cx = 0, cz = 0, r = 0; for (const e of list) { cx += e.x / list.length; cz += e.z / list.length; }
        for (const e of list) r = Math.max(r, Math.hypot(e.x - cx, e.z - cz) + e.s * 4);
        g.boundingSphere = new THREE.Sphere(new V3(cx, 1.5, cz), r);
        const inst = new THREE.InstancedMesh(g, VEG_MAT, list.length);
        list.forEach((e, i) => { inst.setMatrixAt(i, e.m); inst.setColorAt(i, _tc.setHex(e.c)); });
        inst.frustumCulled = true;   // (InstancedMesh turns it off: its geometry's sphere is not the instances' — here it is)
        inst.castShadow = true; inst.receiveShadow = true; inst.instanceColor.needsUpdate = true;
        scene.add(inst); this.veg.push(inst);
      }
    }
  },
  /* snowflakes / leaves: a pool of points falling through a box around the screen centre; spawn by time, not by frame */
  buildWeather(season) {
    const kind = season === 'winter' ? 'snow' : season === 'autumn' ? 'leaves' : null;
    if (!this.weather) {
      const n = 900, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.PointsMaterial({ size: 3, map: TEX.soft, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0.9 });
      const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 2; scene.add(pts);
      this.weather = { pts, n, v: new Float32Array(n * 3), life: new Float32Array(n), ph: new Float32Array(n), next: 0, acc: 0, kind: null };
    }
    const w = this.weather; w.kind = kind; w.life.fill(0);
    w.pts.material.size = kind === 'leaves' ? 4 : 3; w.pts.material.blending = kind === 'snow' ? THREE.AdditiveBlending : THREE.NormalBlending;
    w.pts.visible = !!kind;
  },
  update(dt) {
    const w = this.weather; if (!w) return;
    const on = w.kind && CFG.weather; w.pts.visible = !!on;
    if (!on) return;
    const P = w.pts.geometry.attributes.position.array, C = w.pts.geometry.attributes.color.array, snow = w.kind === 'snow';
    w.acc += dt * (snow ? 220 : 26);
    while (w.acc > 1) {
      w.acc--; const i = w.next; w.next = (w.next + 1) % w.n;
      const p = VIEW.groundAt(rand(-1.15, 1.15), rand(-1.2, 1.3), 0);
      P[i * 3] = p.x + rand(-20, 20); P[i * 3 + 1] = rand(35, 75); P[i * 3 + 2] = p.z + rand(-20, 20);
      w.v[i * 3] = WIND.x * (snow ? 2 : 3.5); w.v[i * 3 + 1] = snow ? -rand(5.5, 8.5) : -rand(3, 5); w.v[i * 3 + 2] = WIND.z * (snow ? 2 : 3.5);
      w.life[i] = 1; w.ph[i] = rand(0, TAU);
      const c = snow ? _tc.setRGB(0.8, 0.82, 0.86) : _tc.setHex(pick(SEASONS.autumn.leaf));
      C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
    }
    for (let i = 0; i < w.n; i++) {
      if (w.life[i] <= 0) { P[i * 3 + 1] = -50; continue; }
      const sway = Math.sin(T * (snow ? 1.3 : 2.4) + w.ph[i]) * (snow ? 1.5 : 4);
      P[i * 3] += (w.v[i * 3] + sway) * dt; P[i * 3 + 1] += w.v[i * 3 + 1] * dt; P[i * 3 + 2] += (w.v[i * 3 + 2] + sway * 0.5) * dt;
      if (P[i * 3 + 1] < 0.05) w.life[i] = 0;
    }
    w.pts.geometry.attributes.position.needsUpdate = true; w.pts.geometry.attributes.color.needsUpdate = true;
    if (snow) w.pts.material.opacity = lerp(0.55, 0.9, ENV.night);
  }
};
const WUP_T = new V3(0, 1, 0), VEG_SCALE = 3.2;   // the vegetation was made for 1 unit = 10 m (Forward Air Base); here 1 unit = 1 m

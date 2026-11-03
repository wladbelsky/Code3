'use strict';
/* ===== Low-poly model helpers, lights, searchlights, seasonal shared materials ===== */
const MAT_CACHE = {};
function M(color, o) {
  const k = color + '|' + (o ? JSON.stringify(o) : '');
  if (!MAT_CACHE[k]) {
    MAT_CACHE[k] = new THREE.MeshPhongMaterial(Object.assign({ color: color, flatShading: true, shininess: 8, specular: 0x151515 }, o || {}));
    MAT_CACHE[k].userData.shared = true;   // cached: never disposed with a model
    if (!o) MAT_CACHE[k].userData.plain = true;   // just a colour: mergeStatic may bake it into vertex colours (PLAIN_MAT)
  }
  return MAT_CACHE[k];
}
/* every plain M(colour) at once: the colour comes from the vertices (mergeStatic) */
const PLAIN_MAT = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 8, specular: 0x151515 }); PLAIN_MAT.userData.shared = true;
/* Free a removed model's GPU resources (cached materials and the sprite geometry all sprites share are kept) */
function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    if (o.material && !o.material.userData.shared) o.material.dispose();
  });
}
/* Static meshes that share a material are merged into one mesh per material — and all those with a plain M(colour) into
   one mesh in PLAIN_MAT, their colours baked into the vertices: far fewer draw calls in both the shadow and the main
   pass. `dynamic` nodes (moving or toggled parts) stay separate; the static meshes inside each of them are merged the
   same way. (A material may be swapped on a merged mesh later: one without vertexColors ignores the baked colours.) */
const _mInv = new THREE.Matrix4(), _mRel = new THREE.Matrix4();
function concatF32(arrs) { let n = 0; for (const a of arrs) n += a.length; const out = new Float32Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
function mergeStatic(root, dynamic) {
  const skip = new Set(dynamic.filter(Boolean)), nested = [], groups = new Map();
  root.updateMatrixWorld(true); _mInv.copy(root.matrixWorld).invert();
  (function walk(o) {
    for (const c of o.children) {
      if (skip.has(c)) { nested.push(c); continue; }
      const mt = c.material;
      if (c.isMesh && !c.children.length && mt && !Array.isArray(mt) && !mt.transparent && !mt.map && c.geometry.attributes.normal) {
        const key = (mt.userData.plain ? 'plain' : mt.uuid) + '|' + c.castShadow + '|' + c.receiveShadow;
        (groups.get(key) || groups.set(key, []).get(key)).push(c);
      }
      walk(c);
    }
  })(root);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const vc = list.some(m => m.material !== list[0].material), pos = [], nor = [], col = [];   // several colours: baked into the vertices
    for (const m of list) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(_mRel.multiplyMatrices(_mInv, m.matrixWorld));
      pos.push(g.attributes.position.array); nor.push(g.attributes.normal.array);
      if (vc) { const c = m.material.color, n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } col.push(a); }
      g.dispose(); m.geometry.dispose(); m.removeFromParent();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(concatF32(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(concatF32(nor), 3));
    if (vc) geo.setAttribute('color', new THREE.BufferAttribute(concatF32(col), 3));
    const mesh = new THREE.Mesh(geo, vc ? PLAIN_MAT : list[0].material);
    mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
    root.add(mesh);
  }
  for (const d of nested) mergeStatic(d, dynamic);
}
const mm = c => (c && c.isMaterial) ? c : M(c);
function shade(m, cast) { m.castShadow = cast !== false; m.receiveShadow = true; return m; }
function box(p, w, h, d, c, x, y, z) { const m = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mm(c))); m.position.set(x, y, z); p.add(m); return m; }
function cyl(p, rt, rb, h, seg, c, x, y, z) { const m = shade(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mm(c))); m.position.set(x, y, z); p.add(m); return m; }
/* Box whose top face is scaled (tx, tz) and shifted (sx) — sloped walls */
function taper(p, w, h, d, c, x, y, z, tx, tz, sx) {
  const g = new THREE.BoxGeometry(w, h, d), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) { pos.setX(i, pos.getX(i) * tx + (sx || 0)); pos.setZ(i, pos.getZ(i) * tz); }
  g.computeVertexNormals();
  const m = shade(new THREE.Mesh(g, mm(c))); m.position.set(x, y, z); p.add(m); return m;
}
/* Prism from an XZ outline ([[x,z],...]) from y0 with height h */
function prism(p, pts, y0, h, c) {
  const s = new THREE.Shape();
  pts.forEach((q, i) => i ? s.lineTo(q[0], -q[1]) : s.moveTo(q[0], -q[1]));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  const m = shade(new THREE.Mesh(g, mm(c))); p.add(m); return m;
}
/* Pole between two points */
function strut(p, a, b, r, c) {
  const d = new V3().subVectors(b, a), L = d.length();
  const m = shade(new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 4), mm(c)));
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize()); p.add(m); return m;
}
const DECK_MARK_MATS = {};
function deckLine(p, x1, z1, x2, z2, w, color, y) {
  if (!DECK_MARK_MATS[color]) {
    DECK_MARK_MATS[color] = new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    DECK_MARK_MATS[color].userData.shared = true;
  }
  const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
  const g = new THREE.PlaneGeometry(L, w); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, DECK_MARK_MATS[color]); m.receiveShadow = true;
  m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2); m.rotation.y = Math.atan2(-dz, dx);
  p.add(m); return m;
}
function dashed(p, x1, z1, x2, z2, w, color, y, dash, gap) {
  const L = Math.hypot(x2 - x1, z2 - z1), ux = (x2 - x1) / L, uz = (z2 - z1) / L;
  for (let s = 0; s < L; s += dash + gap) { const e = Math.min(L, s + dash); deckLine(p, x1 + ux * s, z1 + uz * s, x1 + ux * e, z1 + uz * e, w, color, y); }
}
function windowMat() { return new THREE.MeshPhongMaterial({ color: 0x14202c, emissive: 0x000000, shininess: 70, specular: 0x7090b0, flatShading: true }); }

/* ===== Navigation lights (point sprites) ===== */
const NAV_MATS = [];
function navLights(parent, list, blink, scale) {
  const pos = [], col = [], c = new THREE.Color();
  list.forEach(l => { pos.push(l[0], l[1], l[2]); c.setHex(l[3]); col.push(c.r, c.g, c.b); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 8, map: TEX.glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false, opacity: 0 });
  m.userData = { scale: scale || 1.1, blink: blink || null };
  NAV_MATS.push(m);
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5;
  parent.add(pts); return pts;
}

/* ===== Searchlights with visible beam ===== */
const SEARCHLIGHTS = [];
function coneMaterial(color, len) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uLen: { value: len } },
    vertexShader: `uniform float uLen; varying float vD; varying float vRim;
      void main(){ vD = position.z/uLen; vec3 n = normalize(normalMatrix*normal); vRim = abs(n.z);
      gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vD; varying float vRim;
      void main(){ float d = clamp(vD,0.0,1.0); float a = uOpacity*pow(1.0-d,1.7)*(0.25+0.75*pow(vRim,1.3)); gl_FragColor = vec4(uColor*a,1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
}
function makeSearchlight(parent, x, y, z, opts) {
  const o = Object.assign({ color: 0xfff1d6, angle: 0.16, len: 22, intensity: 2.2, cone: true, coneOpacity: 0.35, housing: true }, opts || {});
  const holder = new THREE.Object3D(); holder.position.set(x, y, z); parent.add(holder);
  let light = null;
  if (!o.noLight) {   // real light is optional: many spotlights get expensive on the GPU
    light = new THREE.SpotLight(o.color, 0, o.len * 2.2, o.angle, 0.45, 1.0);
    holder.add(light);
    const target = new THREE.Object3D(); target.position.set(0, 0, 10); holder.add(target); light.target = target;
  }
  if (o.housing) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 6), M(0x2b2f33)); h.rotation.x = Math.PI / 2; holder.add(h); }
  let cone = null;
  if (o.cone) {
    const g = new THREE.ConeGeometry(Math.tan(o.angle) * o.len, o.len, 20, 1, true);
    g.translate(0, -o.len / 2, 0); g.rotateX(-Math.PI / 2);
    cone = new THREE.Mesh(g, coneMaterial(o.color, o.len)); cone.renderOrder = 4; cone.frustumCulled = false;
    holder.add(cone);
  }
  const s = { holder, light, cone, o, enabled: 1 };
  SEARCHLIGHTS.push(s);
  return s;
}

/* ===== Seasonal shared materials: roofs turn white in winter (seasonMats, called by TERRAIN.build) ===== */
function sharedMat(color, o) { const m = new THREE.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 6, specular: 0x111111 }, o || {})); m.userData.shared = true; return m; }
const ROOF_MAT = sharedMat(0x5d636a);
/* pitched roofs of the houses: their own colour, snow-covered in winter */
const HOUSE_ROOFS = [0x5a3a30, 0x3c4048, 0x6a5a48, 0x2e3a4a, 0x7a4a34, 0x4a4a42].map(c => { const m = sharedMat(c); m.userData.base = c; return m; });
function seasonMats(season) {
  ROOF_MAT.color.setHex(SEASONS[season].roof);
  for (const m of HOUSE_ROOFS) m.color.setHex(season === 'winter' ? 0xe6ecf2 : m.userData.base);
}

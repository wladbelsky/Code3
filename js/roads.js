'use strict';
/* ===== Road graph and lane ways (right-hand traffic) =====
   Nodes are the crossings of the street grid plus each street's two far ends (±ext, off screen: there a vehicle may
   turn back). A place on a street is { ax: 'ew' | 'ns', at (the street's z / the avenue's x), a (the position along it) }.
   ROADS.route(from, to) finds the cheapest way with no U-turns on screen (Dijkstra over node × heading, turns cost a
   little) and returns its centre-line points; ROADS.way(...) offsets them onto the right lane, rounds the corners and
   samples the result into a Way: points every ≤ 1.5 m with headings and a speed limit from the curvature (braking
   ahead of turns and of the end).
   Headings are letters: E (+x), W (−x), N (−z), S (+z).                                                            */
const DIRV = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] }, OPP = { E: 'W', W: 'E', N: 'S', S: 'N' };
const dirOf = (dx, dz) => Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
const LINE_DIRS = { ew: ['E', 'W'], ns: ['N', 'S'] };
const ROADS = {
  nodes: null,   // key "x,z" → { x, z, end, out: { E: { key, len }, … } }
  build() {
    const L = CITY_LAYOUT, E = L.ext, N = this.nodes = {}, key = (x, z) => x + ',' + z;
    const node = (x, z) => N[key(x, z)] || (N[key(x, z)] = { x, z, key: key(x, z), end: Math.abs(x) === E || Math.abs(z) === E, out: {} });
    const link = (a, b) => { const d = dirOf(b.x - a.x, b.z - a.z), len = Math.hypot(b.x - a.x, b.z - a.z); a.out[d] = { key: b.key, len }; b.out[OPP[d]] = { key: a.key, len }; };
    for (const s of L.streets) { const xs = [-E, ...L.avenues.map(a => a.x), E]; for (let i = 1; i < xs.length; i++) link(node(xs[i - 1], s.z), node(xs[i], s.z)); }
    for (const a of L.avenues) { const zs = [-E, ...L.streets.map(s => s.z), E]; for (let i = 1; i < zs.length; i++) link(node(a.x, zs[i - 1]), node(a.x, zs[i])); }
  },
  pos(p) { return p.ax === 'ew' ? [p.a, p.at] : [p.at, p.a]; },
  /* the first node from place p heading d (strictly ahead) */
  nextNode(p, d) {
    let best = null, bd = Infinity;
    for (const n of Object.values(this.nodes)) {
      if (p.ax === 'ew' ? n.z !== p.at : n.x !== p.at) continue;
      const along = (p.ax === 'ew' ? n.x : n.z) - p.a, s = DIRV[d][p.ax === 'ew' ? 0 : 1];
      if (along * s > 0.01 && Math.abs(along) < bd) { bd = Math.abs(along); best = n; }
    }
    return best && { n: best, len: bd };
  },
  /* from: { ax, at, a, dirs: [headings allowed at the start], join? }; to: { ax, at, a, dir: heading required on arrival or null, join? }
     → centre-line points [[x, z] …] from `from` to `to` (both included) */
  route(from, to) {
    const turn = (h, e) => h === e ? 0 : (h === 'N' && e === 'E') || (h === 'E' && e === 'S') || (h === 'S' && e === 'W') || (h === 'W' && e === 'N') ? 6 : 12;
    const onLine = (n, p) => p.ax === 'ew' ? n.z === p.at : n.x === p.at;
    const [gx, gz] = this.pos(to);
    let best = null;
    const heap = [], seen = new Map(), push = (st) => { heap.push(st); };
    for (const d of from.dirs) {
      if (to.ax === from.ax && to.at === from.at) {   // straight along the same street
        const along = (to.a - from.a) * DIRV[d][from.ax === 'ew' ? 0 : 1];
        if (along > 0 && (!to.dir || to.dir === d) && (!best || along < best.cost)) best = { cost: along, path: [] };
      }
      const nx = this.nextNode(from, d); if (nx) push({ cost: nx.len, n: nx.n, h: d, prev: null });
    }
    while (heap.length) {
      heap.sort((a, b) => b.cost - a.cost); const s = heap.pop();
      if (best && s.cost >= best.cost) break;
      const sk = s.n.key + s.h; if (seen.has(sk)) continue; seen.set(sk, s);
      // the goal on a street through this node, ahead in a direction we may take
      if (onLine(s.n, to)) {
        const g = dirOf(gx - s.n.x, gz - s.n.z), dist = Math.hypot(gx - s.n.x, gz - s.n.z);
        if (dist > 0.01 && (g !== OPP[s.h] || s.n.end) && (!to.dir || to.dir === g)) {
          const c = s.cost + dist + turn(s.h, g);
          if (!best || c < best.cost) best = { cost: c, st: s };
        }
      }
      for (const [e, o] of Object.entries(s.n.out)) {
        if (e === OPP[s.h] && !s.n.end) continue;
        push({ cost: s.cost + o.len + (s.n.end ? 0 : turn(s.h, e)), n: this.nodes[o.key], h: e, prev: s });
      }
    }
    if (!best) return null;
    const pts = [];
    for (let s = best.st; s; s = s.prev) pts.unshift([s.n.x, s.n.z]);
    return [this.pos(from), ...pts, [gx, gz]];
  },
  /* lane points for a centre line: each corner where the two right-hand offset lines meet (a U-turn: both offsets) */
  lane(cl, inDir, outDir, off) {
    const L = off || LANE_OFF, out = [], n = cl.length, unit = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    for (let i = 0; i < n; i++) {
      let u = i > 0 ? unit(cl[i - 1], cl[i]) : inDir, v = i < n - 1 ? unit(cl[i], cl[i + 1]) : outDir;
      if (!u) u = v; if (!v) v = u;
      const ru = [-u[1], u[0]], rv = [-v[1], v[0]], d = ru[0] * rv[0] + ru[1] * rv[1], [x, z] = cl[i];
      if (d < -0.9) out.push([x + ru[0] * L, z + ru[1] * L], [x + rv[0] * L, z + rv[1] * L]);
      else out.push([x + (ru[0] + rv[0]) * L / (1 + d), z + (ru[1] + rv[1]) * L / (1 + d)]);
    }
    return out;
  },
  /* a way through the places `via` in turn (each passed straight, heading via.dir) to `to`, then the exact points post */
  wayVia(from, via, to, post, o) {
    let cl = null, f = from;
    for (const t of [...via, to]) { const c = this.route(f, t); if (!c) return null; cl = cl ? [...cl, ...c.slice(1)] : c; f = { ax: t.ax, at: t.at, a: t.a, dirs: [t.dir] }; }
    return new Way([...this.lane(cl), ...(post || [])], o);
  },
  /* a way from place to place: pre (exact points before the start, e.g. out of a bay), the route on the right lane,
     post (exact points after it, e.g. into a stall); o: Way options */
  way(from, to, pre, post, o) {
    const cl = this.route(from, to); if (!cl) return null;
    pre = pre || []; post = post || [];
    const dir = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    // from.join / to.join: the exact points meet the street square on (a driveway): the corner turns from / into them
    const inDir = pre.length && from.join ? dir(pre[pre.length - 1], cl[0]) : null, outDir = post.length && to.join ? dir(cl[cl.length - 1], post[0]) : null;
    return new Way([...pre, ...this.lane(cl, inDir, outDir), ...post], o);
  }
};

/* ===== Way: a smooth polyline a vehicle follows (by its centre) =====
   Corners are rounded (quadratic, radius ≤ o.r), then the line is sampled every ≤ 1.5 m; per sample: position,
   travel heading, distance, speed limit (lateral acceleration o.alat in the bends, o.decel braking ahead of them and
   of the end, o.vmax on the straights). o.rev: driven backwards (the vehicle faces against the way).           */
class Way {
  constructor(pts, o = {}) {
    this.rev = !!o.rev; const R = o.r || 6, vmax = o.vmax || 12, alat = o.alat || 3, decel = o.decel || 2.5, vEnd = o.vEnd || 0;
    const q = [pts[0]]; for (const p of pts) if (Math.hypot(p[0] - q[q.length - 1][0], p[1] - q[q.length - 1][1]) > 0.2) q.push(p);
    if (q.length < 2) q.push([q[0][0] + 0.1, q[0][1]]);
    // round the corners
    const r = [q[0]];
    for (let i = 1; i < q.length - 1; i++) {
      const [ax, az] = q[i - 1], [bx, bz] = q[i], [cx, cz] = q[i + 1];
      const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz), u = [(bx - ax) / l1, (bz - az) / l1], v = [(cx - bx) / l2, (cz - bz) / l2];
      const ang = Math.acos(clamp(u[0] * v[0] + u[1] * v[1], -1, 1));
      if (ang < 0.05) { r.push(q[i]); continue; }
      const t = Math.min(R * Math.tan(ang / 2), l1 * 0.48, l2 * 0.48), p0 = [bx - u[0] * t, bz - u[1] * t], p2 = [bx + v[0] * t, bz + v[1] * t];
      const k = Math.max(3, Math.ceil(ang * 6));
      for (let j = 0; j <= k; j++) { const s = j / k, a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s; r.push([a * p0[0] + b * bx + c * p2[0], a * p0[1] + b * bz + c * p2[1]]); }
    }
    r.push(q[q.length - 1]);
    // sample every ≤ 1.5 m
    const X = [], Z = [];
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, az] = r[i], [bx, bz] = r[i + 1], l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / 1.5));
      for (let j = 0; j < n; j++) { X.push(ax + (bx - ax) * j / n); Z.push(az + (bz - az) * j / n); }
    }
    X.push(r[r.length - 1][0]); Z.push(r[r.length - 1][1]);
    const n = X.length, S = new Float32Array(n), H = new Float32Array(n), V = new Float32Array(n);
    for (let i = 1; i < n; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); H[i] = Math.atan2(Z[b] - Z[a], X[b] - X[a]); }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2), ds = S[b] - S[a], dh = Math.abs(angleWrap(H[b] - H[a]));
      V[i] = ds > 0.01 && dh > 0.01 ? Math.min(vmax, Math.sqrt(alat * ds / dh)) : vmax;
    }
    V[n - 1] = Math.min(V[n - 1], vEnd);
    for (let i = n - 2; i >= 0; i--) V[i] = Math.min(V[i], Math.sqrt(V[i + 1] * V[i + 1] + 2 * decel * (S[i + 1] - S[i])));
    Object.assign(this, { X, Z, S, H, V, n, len: S[n - 1], s: 0 });
  }
  /* position / heading / speed limit at distance s (into out: { x, z, h, v }) */
  at(s, out) {
    s = clamp(s, 0, this.len);
    let lo = 0, hi = this.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.S[m] <= s) lo = m; else hi = m; }
    const t = this.S[hi] > this.S[lo] ? (s - this.S[lo]) / (this.S[hi] - this.S[lo]) : 0;
    out.x = lerp(this.X[lo], this.X[hi], t); out.z = lerp(this.Z[lo], this.Z[hi], t);
    out.h = this.H[lo] + angleWrap(this.H[hi] - this.H[lo]) * t; out.v = lerp(this.V[lo], this.V[hi], t);
    return out;
  }
  get done() { return this.s >= this.len - 0.05; }
}

'use strict';
/* ===== Flight paths with a minimum turn radius (Dubins CSC curves) =====
   Horizontal plane is (x, z); heading h -> direction (cos h, 0, sin h).
   'L' turns increase h (turn toward +z), 'R' turns decrease h.            */
const mod2pi = a => { a %= TAU; return a < 0 ? a + TAU : a; };

function dubinsShortest(x0, z0, h0, x1, z1, h1, R) {
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz) / R, th = mod2pi(Math.atan2(dz, dx));
  const a = mod2pi(h0 - th), b = mod2pi(h1 - th);
  const sa = Math.sin(a), sb = Math.sin(b), ca = Math.cos(a), cb = Math.cos(b), cab = Math.cos(a - b);
  const c = [];
  let p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
  if (p2 >= 0) { const t1 = Math.atan2(cb - ca, d + sa - sb); c.push(['LSL', mod2pi(t1 - a), Math.sqrt(p2), mod2pi(b - t1)]); }
  p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
  if (p2 >= 0) { const t1 = Math.atan2(ca - cb, d - sa + sb); c.push(['RSR', mod2pi(a - t1), Math.sqrt(p2), mod2pi(t1 - b)]); }
  p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
  if (p2 >= 0) { const p = Math.sqrt(p2), t0 = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p); c.push(['LSR', mod2pi(t0 - a), p, mod2pi(t0 - b)]); }
  p2 = -2 + d * d + 2 * cab - 2 * d * (sa + sb);
  if (p2 >= 0) { const p = Math.sqrt(p2), t0 = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p); c.push(['RSL', mod2pi(a - t0), p, mod2pi(b - t0)]); }
  let best = null, bl = Infinity;
  for (const w of c) { const l = w[1] + w[2] + w[3]; if (l < bl) { bl = l; best = w; } }
  return best || ['LSL', 0, d, 0];
}
function dubinsStep(type, x, z, h, s) {
  if (type === 'L') return [x + Math.sin(h + s) - Math.sin(h), z - Math.cos(h + s) + Math.cos(h), h + s];
  if (type === 'R') return [x - Math.sin(h - s) + Math.sin(h), z + Math.cos(h - s) - Math.cos(h), h - s];
  return [x + Math.cos(h) * s, z + Math.sin(h) * s, h];
}

class FlightPath {
  constructor() { this.pieces = []; this.length = 0; }
  addLine(p0, p1) {
    const len = p0.distanceTo(p1);
    this.pieces.push({ kind: 'line', p0: p0.clone(), p1: p1.clone(), len, s0: this.length });
    this.length += len; return this;
  }
  /* slope0: the climb rate (dy per unit along the ground) it starts with, so a climbing line before it joins without a
     kink; the altitude is a cubic (Hermite) from that slope to level at p1, the start slope capped so it never overshoots */
  addDubins(p0, h0, p1, h1, R, slope0 = 0) {
    const w = dubinsShortest(p0.x, p0.z, h0, p1.x, p1.z, h1, R);
    const types = w[0].split(''), lens = [w[1], w[2], w[3]];
    const starts = []; let q = [0, 0, h0];
    for (let i = 0; i < 3; i++) { starts.push(q); q = dubinsStep(types[i], q[0], q[1], q[2], lens[i]); }
    const len = (lens[0] + lens[1] + lens[2]) * R, dy = p1.y - p0.y;
    const m0 = len > 0 ? clamp(slope0 * len, Math.min(0, 3 * dy), Math.max(0, 3 * dy)) : 0;   // start slope × length (monotone while |m0| ≤ 3|dy|)
    this.pieces.push({ kind: 'dubins', x0: p0.x, z0: p0.z, y0: p0.y, y1: p1.y, m0, R, types, lens, starts, len, s0: this.length });
    this.length += len; return this;
  }
  /* returns {pos, dir, turn(-1/0/1), R} at arc length s */
  sample(s, out) {
    out = out || { pos: new V3(), dir: new V3(), turn: 0, R: 1 };
    s = clamp(s, 0, this.length);
    let pc = this.pieces[this.pieces.length - 1];
    for (const p of this.pieces) if (s <= p.s0 + p.len) { pc = p; break; }
    const ls = clamp(s - pc.s0, 0, pc.len);
    if (pc.kind === 'line') {
      const u = pc.len > 0 ? ls / pc.len : 1;
      out.pos.copy(pc.p0).lerp(pc.p1, u); out.dir.subVectors(pc.p1, pc.p0).normalize(); out.turn = 0; out.R = 1;
      return out;
    }
    let sn = ls / pc.R, i = 0;
    while (i < 2 && sn > pc.lens[i]) { sn -= pc.lens[i]; i++; }
    const st = pc.starts[i], q = dubinsStep(pc.types[i], st[0], st[1], st[2], Math.min(sn, pc.lens[i]));
    const u = pc.len > 0 ? ls / pc.len : 1, S = u * u * (3 - 2 * u), dS = 6 * u * (1 - u);
    const H = u * (1 - u) * (1 - u), dH = (1 - u) * (1 - 3 * u);                                   // Hermite start-slope term
    out.pos.set(pc.x0 + q[0] * pc.R, pc.y0 + (pc.y1 - pc.y0) * S + pc.m0 * H, pc.z0 + q[1] * pc.R);
    const slope = pc.len > 0 ? ((pc.y1 - pc.y0) * dS + pc.m0 * dH) / pc.len : 0;
    out.dir.set(Math.cos(q[2]), slope, Math.sin(q[2])).normalize();
    out.turn = pc.types[i] === 'L' ? 1 : pc.types[i] === 'R' ? -1 : 0; out.R = pc.R;
    return out;
  }
  get lastDubinsEnd() { let e = 0; for (const p of this.pieces) if (p.kind === 'dubins') e = p.s0 + p.len; return e; }
}

/* Road network worker for EV-loki: energy-limited search along roads (range), routes to points and stations. */
'use strict';
let N = 0, E = 0, NX, EA, EB, ELEN, ESPD, EGS, EGC, GEO, ADJS, ADJE, CELL = null;
let last = null;   // last search: { time, en, km, prevE, budget, s (start snap), off, kwhKm, winter }

function load(meta, buf) {
  const I = new Int32Array(buf);
  N = meta.nodes; E = meta.edges;
  NX = I.subarray(0, 2 * N);
  const e0 = 2 * N;
  EA = new Int32Array(E); EB = new Int32Array(E); ELEN = new Float64Array(E); ESPD = new Int32Array(E); EGS = new Int32Array(E); EGC = new Int32Array(E);
  for (let i = 0; i < E; i++) { const o = e0 + 7 * i; EA[i] = I[o]; EB[i] = I[o + 1]; ELEN[i] = I[o + 2] / 1000; ESPD[i] = I[o + 3]; EGS[i] = I[o + 5]; EGC[i] = I[o + 6]; }
  GEO = I.subarray(e0 + 7 * E);
  const deg = new Int32Array(N + 1);
  for (let i = 0; i < E; i++) { deg[EA[i] + 1]++; deg[EB[i] + 1]++; }
  for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
  ADJS = deg; ADJE = new Int32Array(2 * E); const fill = deg.slice(0, N);
  for (let i = 0; i < E; i++) { ADJE[fill[EA[i]]++] = i; ADJE[fill[EB[i]]++] = i; }
  buildCells();
  return { nodes: N, edges: E };
}
const lonOf = (i) => NX[2 * i] / 1e5, latOf = (i) => NX[2 * i + 1] / 1e5;
function metres(la1, lo1, la2, lo2) { const k = Math.cos((la1 * Math.PI) / 180) * 111320; return Math.hypot((lo2 - lo1) * k, (la2 - la1) * 110574); }
const edgePts = (e) => { const p = [[latOf(EA[e]), lonOf(EA[e])]]; for (let k = 0; k < EGC[e]; k++) p.push([GEO[2 * (EGS[e] + k) + 1] / 1e5, GEO[2 * (EGS[e] + k)] / 1e5]); p.push([latOf(EB[e]), lonOf(EB[e])]); return p; };
// edges by 0.05° cells (every cell an edge passes through, sampled every ~1 km)
function buildCells() {
  CELL = new Map();
  const add = (la, lo, e) => { const k = Math.floor(lo * 20) + ':' + Math.floor(la * 20); let l = CELL.get(k); if (!l) CELL.set(k, (l = [])); if (l[l.length - 1] !== e) l.push(e); };
  for (let e = 0; e < E; e++) {
    const p = edgePts(e);
    for (let k = 0; k < p.length; k++) {
      add(p[k][0], p[k][1], e);
      if (k) { const n = Math.ceil(metres(p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]) / 1000); for (let j = 1; j < n; j++) add(p[k - 1][0] + ((p[k][0] - p[k - 1][0]) * j) / n, p[k - 1][1] + ((p[k][1] - p[k - 1][1]) * j) / n, e); }
    }
  }
}
// nearest point on any road: { e, t (0..1 along the edge from a to b), m (metres away) }
function nearest(lat, lon, maxM) {
  const cx = Math.floor(lon * 20), cy = Math.floor(lat * 20), kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110574;
  let best = null, seen = new Set();
  for (let r = 0; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const list = CELL.get((cx + dx) + ':' + (cy + dy)); if (!list) continue;
      for (const e of list) {
        if (seen.has(e)) continue; seen.add(e);
        const p = edgePts(e); let acc = 0; const segs = [];
        for (let k = 1; k < p.length; k++) {
          const ax = (p[k - 1][1] - lon) * kx, ay = (p[k - 1][0] - lat) * ky, bx = (p[k][1] - lon) * kx, by = (p[k][0] - lat) * ky;
          const dx2 = bx - ax, dy2 = by - ay, L2 = dx2 * dx2 + dy2 * dy2, L = Math.sqrt(L2);
          const u = L2 ? Math.max(0, Math.min(1, -(ax * dx2 + ay * dy2) / L2)) : 0;
          segs.push([Math.hypot(ax + u * dx2, ay + u * dy2), acc + u * L]); acc += L;
        }
        for (const [d, at] of segs) if (!best || d < best.m) best = { e, t: acc ? at / acc : 0, m: d };
      }
    }
    if (best && best.m < r * 2500) break;   // a ring further out cannot be nearer
  }
  return best && best.m <= maxM ? best : null;
}
const effSpeed = (v, winter) => (winter ? (v >= 120 ? 100 : v >= 100 ? 80 : v) : v);
const speedOf = (e, winter) => Math.min(160, Math.max(5, effSpeed(ESPD[e], winter)));
const edgeCost = (e, kwhKm, winter) => ELEN[e] * kwhKm[speedOf(e, winter)];
const edgeTime = (e, winter) => ELEN[e] / speedOf(e, winter);

// Fastest routes (as a navigator would drive, at the speed limits) from the road nearest to (lat, lon);
// energy is summed along them, and nothing is expanded once the budget (kWh) is spent.
function search(lat, lon, budget, kwhKm, winter) {
  const t0 = Date.now();
  const s = nearest(lat, lon, 5000); if (!s) return { error: 'noroad' };
  const time = new Float64Array(N).fill(Infinity), en = new Float64Array(N).fill(Infinity), km = new Float64Array(N), prevE = new Int32Array(N).fill(-1);
  const off = (s.m / 1000) * kwhKm[30];   // from the point to the road at town speed
  const hv = [], hn = [];   // binary heap on time
  const push = (v, n) => { hv.push(v); hn.push(n); let c = hv.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (hv[p] <= hv[c]) break; [hv[p], hv[c]] = [hv[c], hv[p]]; [hn[p], hn[c]] = [hn[c], hn[p]]; c = p; } };
  const pop = () => { const v = hv[0], n = hn[0], lv = hv.pop(), ln = hn.pop(); if (hv.length) { hv[0] = lv; hn[0] = ln; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hv.length && hv[l] < hv[m]) m = l; if (r < hv.length && hv[r] < hv[m]) m = r; if (m === c) break; [hv[m], hv[c]] = [hv[c], hv[m]]; [hn[m], hn[c]] = [hn[c], hn[m]]; c = m; } } return [v, n]; };
  const e0 = s.e, T = edgeTime(e0, winter), Cc = edgeCost(e0, kwhKm, winter);
  for (const [n, f] of [[EA[e0], s.t], [EB[e0], 1 - s.t]]) {   // both ends of the road the start is on
    const tt = f * T, ee = off + f * Cc;
    if (tt < time[n]) { time[n] = tt; en[n] = ee; km[n] = s.m / 1000 + f * ELEN[e0]; prevE[n] = -2; push(tt, n); }
  }
  while (hv.length) {
    const [d, u] = pop();
    if (d > time[u] || en[u] > budget) continue;
    for (let k = ADJS[u]; k < ADJS[u + 1]; k++) {
      const e = ADJE[k], w = EA[e] === u ? EB[e] : EA[e], nt = d + edgeTime(e, winter);
      if (nt < time[w]) { time[w] = nt; en[w] = en[u] + edgeCost(e, kwhKm, winter); km[w] = km[u] + ELEN[e]; prevE[w] = e; push(nt, w); }
    }
  }
  last = { time, en, km, prevE, budget, s, off, kwhKm, winter };
  let maxOne = 0, maxRound = 0;
  for (let i = 0; i < N; i++) { if (en[i] <= budget && km[i] > maxOne) maxOne = km[i]; if (en[i] <= budget / 2 && km[i] > maxRound) maxRound = km[i]; }
  return { ms: Date.now() - t0, snapM: Math.round(s.m), maxOne, maxRound };
}
// a point t (0..1) along edge e: arrive from whichever end is faster → { en, km, from: node or -1 (start edge), t }
function atEdge(e, t) {
  const { time, en, km, s, off, kwhKm, winter } = last, T = edgeTime(e, winter), c = edgeCost(e, kwhKm, winter), Lk = ELEN[e];
  let best = null;
  const opt = (tm, eg, k, from) => { if (isFinite(tm) && (!best || tm < best.tm)) best = { tm, en: eg, km: k, from }; };
  opt(time[EA[e]] + t * T, en[EA[e]] + t * c, km[EA[e]] + t * Lk, EA[e]);
  opt(time[EB[e]] + (1 - t) * T, en[EB[e]] + (1 - t) * c, km[EB[e]] + (1 - t) * Lk, EB[e]);
  if (e === s.e) opt(Math.abs(t - s.t) * T, off + Math.abs(t - s.t) * c, s.m / 1000 + Math.abs(t - s.t) * Lk, -1);
  return best;
}
// reached road pieces for drawing: [lat1, lon1, lat2, lon2, r] with r = share of the budget left at that point (1 = start, 0 = range end)
function pieces() {
  if (!last) return new Float32Array(0);
  const { en, budget } = last, out = [];
  for (let e = 0; e < E; e++) {
    if (!(Math.min(en[EA[e]], en[EB[e]]) <= budget) && e !== last.s.e) continue;
    const pts = edgePts(e);
    const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + metres(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]));
    const L = cum[cum.length - 1] || 1;
    // split long pieces so the colour and the cut follow the energy smoothly
    const ts = []; for (let k = 0; k < pts.length; k++) { if (k) { const n = Math.ceil((cum[k] - cum[k - 1]) / 1500); for (let j = 1; j < n; j++) ts.push([(cum[k - 1] + ((cum[k] - cum[k - 1]) * j) / n) / L, pts[k - 1], pts[k], j / n]); } ts.push([cum[k] / L, pts[k], pts[k], 0]); }
    const P = ts.map(([t, a, b, f]) => { const x = atEdge(e, t); return { t, la: a[0] + (b[0] - a[0]) * f, lo: a[1] + (b[1] - a[1]) * f, en: x ? x.en : Infinity }; });
    for (let k = 1; k < P.length; k++) {
      let p1 = P[k - 1], p2 = P[k], e1 = p1.en, e2 = p2.en;
      if (e1 > budget && e2 > budget) continue;
      let a = [p1.la, p1.lo], b = [p2.la, p2.lo];
      if (e1 > budget || e2 > budget) {   // cut where the energy runs out
        const tt = (budget - e1) / (e2 - e1), q = [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt];
        if (e1 > budget) { a = q; e1 = budget; } else { b = q; e2 = budget; }
      }
      out.push(a[0], a[1], b[0], b[1], 1 - (e1 + e2) / 2 / budget);
    }
  }
  return new Float32Array(out);
}
// chamfer distance (in cells) to the nearest set cell: two passes, O(cells)
function chamfer(a, W, H) {
  const n = W * H, d = new Float32Array(n), D2 = Math.SQRT2;
  for (let i = 0; i < n; i++) d[i] = a[i] ? 0 : 1e9;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x; let v = d[i]; if (v === 0) continue;
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (y > 0) { if (d[i - W] + 1 < v) v = d[i - W] + 1; if (x > 0 && d[i - W - 1] + D2 < v) v = d[i - W - 1] + D2; if (x < W - 1 && d[i - W + 1] + D2 < v) v = d[i - W + 1] + D2; }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let v = d[i]; if (v === 0) continue;
      if (x < W - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (y < H - 1) { if (d[i + W] + 1 < v) v = d[i + W] + 1; if (x < W - 1 && d[i + W + 1] + D2 < v) v = d[i + W + 1] + D2; if (x > 0 && d[i + W - 1] + D2 < v) v = d[i + W - 1] + D2; }
      d[i] = v;
    }
  }
  return d;
}
// zone outline from road pieces [lat1,lon1,lat2,lon2,r,...] with r >= minR:
// grid → closing (bridges gaps under closeKm, leaves padKm around the outermost roads) → hole fill → blur → marching squares → smoothed rings [[lat, lon], ...]
function outline(p, minR, cellKm, closeKm, padKm) {
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180, any = false;
  for (let i = 0; i < p.length; i += 5) {
    if (p[i + 4] < minR) continue; any = true;
    const a = p[i], b = p[i + 2], c = p[i + 1], d = p[i + 3];
    if (a < la0) la0 = a; if (b < la0) la0 = b; if (a > la1) la1 = a; if (b > la1) la1 = b;
    if (c < lo0) lo0 = c; if (d < lo0) lo0 = d; if (c > lo1) lo1 = c; if (d > lo1) lo1 = d;
  }
  if (!any) return [];
  const dla = cellKm / 110.574, dlo = cellKm / (111.32 * Math.cos(((la0 + la1) / 2) * Math.PI / 180));
  const R = Math.ceil((closeKm + padKm) / cellKm) + 3;
  const W = Math.ceil((lo1 - lo0) / dlo) + 2 * R + 1, H = Math.ceil((la1 - la0) / dla) + 2 * R + 1;
  const ox = lo0 - R * dlo, oy = la0 - R * dla;
  let g = new Uint8Array(W * H);
  for (let i = 0; i < p.length; i += 5) {
    if (p[i + 4] < minR) continue;
    const n = Math.max(1, Math.ceil(Math.hypot((p[i + 2] - p[i]) / dla, (p[i + 3] - p[i + 1]) / dlo) * 2));
    const y0 = (p[i] - oy) / dla, x0 = (p[i + 1] - ox) / dlo, sy = ((p[i + 2] - oy) / dla - y0) / n, sx = ((p[i + 3] - ox) / dlo - x0) / n;
    for (let k = 0; k <= n; k++) g[Math.round(y0 + sy * k) * W + Math.round(x0 + sx * k)] = 1;
  }
  const dist = (a) => chamfer(a, W, H);
  const rc = closeKm / cellKm, rp = padKm / cellKm;
  const d1 = dist(g), grown = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) grown[i] = d1[i] <= rc + rp ? 1 : 0;
  const outside = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) outside[i] = 1 - grown[i];
  const d2 = dist(outside);
  for (let i = 0; i < W * H; i++) g[i] = d2[i] > rc ? 1 : 0;   // closing: grow by close + pad, shrink back by close
  // fill holes: flood the outside from the border (queue in a typed array)
  const N2 = W * H, out = new Uint8Array(N2), q = new Int32Array(N2); let qh = 0, qt = 0;
  const seed = (i) => { if (!out[i] && !g[i]) { out[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); } for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (qh < qt) { const i = q[qh++], x = i % W; if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (i >= W) seed(i - W); if (i < N2 - W) seed(i + W); }
  // soft field (separable 3-box blur twice) for a smooth contour
  let f = new Float32Array(N2); for (let i = 0; i < N2; i++) f[i] = out[i] ? 0 : 1;
  for (let it = 0; it < 2; it++) {
    const h = new Float32Array(N2), v = new Float32Array(N2);
    for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; h[i] = (f[i - 1] + f[i] + f[i + 1]) / 3; }
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) { const i = y * W + x; v[i] = (h[i - W] + h[i] + h[i + W]) / 3; }
    f = v;
  }
  // marching squares at 0.5; edge ids: 2·(y·W + x) for the edge right of corner (x, y), +1 for the edge below it
  const PX = new Float64Array(2 * N2), PY = new Float64Array(2 * N2), L1 = new Int32Array(2 * N2).fill(-1), L2 = new Int32Array(2 * N2).fill(-1);
  const E = (x, y, v) => {
    const id = 2 * (y * W + x) + v, a = f[y * W + x], b = v ? f[(y + 1) * W + x] : f[y * W + x + 1], t = (0.5 - a) / (b - a);
    PX[id] = v ? x : x + t; PY[id] = v ? y + t : y; return id;
  };
  const link = (a, b) => { if (L1[a] < 0) L1[a] = b; else L2[a] = b; if (L1[b] < 0) L1[b] = a; else L2[b] = a; };
  const T = [null, [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 2], [0, 1]], [[0, 2]], [[3, 2]], [[2, 3]], [[2, 0]], [[3, 0], [1, 2]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], null];
  const starts = [];
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x, c = (f[i] > 0.5) | ((f[i + 1] > 0.5) << 1) | ((f[i + W + 1] > 0.5) << 2) | ((f[i + W] > 0.5) << 3);
    if (!T[c]) continue;
    const e = [E(x, y, 0), E(x + 1, y, 1), E(x, y + 1, 0), E(x, y, 1)];   // bottom, right, top, left
    for (const [u, w] of T[c]) { link(e[u], e[w]); starts.push(e[u]); }
  }
  const used = new Uint8Array(2 * N2), rings = [];
  for (const k0 of starts) {
    if (used[k0]) continue;
    const ring = []; let prev = -1, k = k0;
    while (k >= 0 && !used[k]) { used[k] = 1; ring.push([oy + PY[k] * dla, ox + PX[k] * dlo]); const n = L1[k] !== prev && !used[L1[k]] ? L1[k] : L2[k] !== prev && L2[k] >= 0 && !used[L2[k]] ? L2[k] : -1; prev = k; k = n; }
    if (ring.length > 8) rings.push(ring);
  }
  // Chaikin smoothing
  return rings.map((r) => { let q = r; for (let it = 0; it < 2; it++) { const o = []; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } q = o; } return q; });
}
// both zones of the last search: half = enough to come back, one = one way
function zones() {
  if (!last) return null;
  const p = pieces();
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
  for (let i = 0; i < p.length; i += 5) { la0 = Math.min(la0, p[i], p[i + 2]); la1 = Math.max(la1, p[i], p[i + 2]); lo0 = Math.min(lo0, p[i + 1], p[i + 3]); lo1 = Math.max(lo1, p[i + 1], p[i + 3]); }
  if (!p.length) return { half: [], one: [] };
  const areaKm2 = (la1 - la0) * 110.574 * (lo1 - lo0) * 111.32 * Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const cell = Math.max(0.7, Math.sqrt(areaKm2 / 250000));   // keeps the grid at about 250 000 cells or less
  return { half: outline(p, 0.5, cell, 4, 1.5), one: outline(p, 0, cell, 4, 1.5), cellKm: cell };
}
function pathTo(n) {
  const { prevE, s } = last, pts = []; let guard = 0;
  while (prevE[n] >= 0 && guard++ < 1e6) { const e = prevE[n], p = edgePts(e); const fwd = EB[e] === n; const seq = fwd ? p.slice().reverse() : p; pts.push(...seq.slice(0, -1)); n = fwd ? EA[e] : EB[e]; }
  pts.push([latOf(n), lonOf(n)]);
  if (prevE[n] === -2) pts.push(...partial(s.e, n, s.t));   // back along the start road to where the start snapped
  return pts.reverse();
}
// part of edge e between node end n and position t
const partial = (e, n, t) => { const p = edgePts(e), L = p.length - 1; const seg = n === EA[e] ? p : p.slice().reverse(), tt = n === EA[e] ? t : 1 - t; const k = Math.min(L - 1, Math.floor(tt * L)); return seg.slice(1, k + 1); };
function toPoint(lat, lon, maxM) {
  if (!last) return null;
  const t = nearest(lat, lon, maxM); if (!t) return null;
  const x = atEdge(t.e, t.t); if (!x) return null;
  return { x, t, kwh: x.en + (t.m / 1000) * last.kwhKm[30], km: x.km + t.m / 1000 };
}
function route(lat, lon) {
  const r = toPoint(lat, lon, 2000); if (!r) return null;
  const pts = r.x.from >= 0 ? pathTo(r.x.from).concat(partial(r.t.e, r.x.from, r.t.t)) : [];
  pts.push([lat, lon]);
  return { pts, km: r.km, kwh: r.kwh };
}
function stations(list) {
  return list.map((st) => { const r = toPoint(st.lat, st.lon, 2000); return r ? { id: st.id, km: r.km, kwh: r.kwh } : null; });
}

onmessage = (ev) => {
  const m = ev.data, id = m.id;
  try {
    let res;
    if (m.cmd === 'load') res = load(m.meta, m.buf);
    else if (m.cmd === 'search') res = search(m.lat, m.lon, m.budget, m.kwhKm, m.winter);
    else if (m.cmd === 'pieces') { const p = pieces(); postMessage({ id, res: p }, [p.buffer]); return; }
    else if (m.cmd === 'zones') res = zones();
    else if (m.cmd === 'route') res = route(m.lat, m.lon);
    else if (m.cmd === 'stations') res = stations(m.list);
    postMessage({ id, res });
  } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};

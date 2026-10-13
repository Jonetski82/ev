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
    else if (m.cmd === 'route') res = route(m.lat, m.lon);
    else if (m.cmd === 'stations') res = stations(m.list);
    postMessage({ id, res });
  } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};

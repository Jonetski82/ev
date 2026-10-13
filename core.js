/* EV-loki — test version of the Popcorn Fuel Log for an electric car.
   Internal names follow the boat app: "kn" = km/h, "NM"/distNm = km, "L"/litres = kWh, "mm" = state of charge %,
   tank 'bat' = the battery, "refuel" = a charge. No UI code here. */
'use strict';

const Core = (() => {
  // ---------- constants ----------
  const MAX_KN = 150;             // bands: 0 = standing (< 3 km/h), 1 = 3–10, 2.. = 10-km/h bands up to 150, last = above
  const NB = 17;
  const KN = 3.6;                 // m/s -> km/h
  const NM = 1000;                // m per km
  const DB_NAME = 'evlog';        // own database: the boat app on the same site keeps its own
  const DB_VER = 1;
  const ENG = ['bat'];
  const MODES = ['both'];
  const MEAS_SD = 0.6, ROUGH_SD = 1.5;   // kWh: one interval between two charge readings (whole-% display)

  const bandOf = (v) => (v < 3 ? 0 : v < 10 ? 1 : Math.min(NB - 1, 1 + Math.floor(v / 10)));
  const bandMid = (b) => (b === 0 ? 0 : b === 1 ? 6.5 : b === NB - 1 ? 155 : (b - 1) * 10 + 5);
  const bandLabel = (b) => (b === 0 ? '< 3 km/h' : b === 1 ? '3–10 km/h' : b === NB - 1 ? '> 150 km/h' : (b - 1) * 10 + '–' + b * 10 + ' km/h');
  const zeros = () => new Array(NB).fill(0);
  const emptyBands = () => ({ both: zeros(), bat: zeros() });

  // ---------- helpers ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = (v) => {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return NaN;
    return Number(s);
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  function haversine(a, b) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const polyEval = (c, x) => c.reduce((acc, ci, i) => acc + ci * Math.pow(x, i), 0);
  function interp(xs, ys, x) { // linear, clamped; xs ascending
    if (!xs.length) return NaN;
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const u = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1); return ys[i - 1] + u * (ys[i] - ys[i - 1]); }
    return ys[ys.length - 1];
  }
  function solve(A, y) { // Gauss-Jordan with partial pivoting; returns {x, inv}
    const n = A.length;
    const M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)), [y[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c] || 1e-12;
      for (let j = 0; j < M[c].length; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) {
        const f = M[r][c];
        if (f) for (let j = 0; j < M[r].length; j++) M[r][j] -= f * M[c][j];
      }
    }
    return { x: M.map((r) => r[2 * n]), inv: M.map((r) => r.slice(n, 2 * n)) };
  }

  // ---------- defaults ----------
  function defaultState() {
    return {
      version: 1, app: 'ev-log',
      settings: {
        minCruiseKn: 30, effMarginPct: 10, base: 'osm', seamarks: false, nlsKey: '', price: '', homePrice: '', lastLoad: 'normal', rangeStart: null
      },
      tanks: [{ id: 'bat', name: 'Battery', color: '#1F5675', capacity: 50, maxMm: 100, pipeMm: 10, pipeL: null }],
      events: [],       // {id,t,type:'dip'(charge reading)|'refuel'(charge),tank:'bat',mm:%,afterMm:%,pumped:charger kWh,price,src}
      trips: [],
      active: null,
      hull: { clean: [], cleanSample: true, cleanings: [] },
      fit: null,
      cons: defaultCons()
    };
  }
  // consumption: your estimate points (km/h, kWh/km), the base curve fitted to them, the curve in use and the proposal
  const defaultCons = () => ({ pts: { both: [] }, base: { both: null }, idle: { bat: 1 }, active: null, pending: null, rejected: null, history: [] });
  function migrate(s) {
    const d = defaultState();
    if (!s || s.app !== 'ev-log') return d;
    s.settings = Object.assign(d.settings, s.settings || {});
    ['tanks', 'hull'].forEach((k) => { if (!s[k]) s[k] = d[k]; });
    s.events = s.events || []; s.trips = s.trips || []; s.accuracy = s.accuracy || [];
    s.userStations = s.userStations || []; s.stationPrices = s.stationPrices || {};
    if (!s.cons) s.cons = defaultCons();
    if (!s.cons.idle) s.cons.idle = { bat: 1 };
    return s;
  }

  // ---------- IndexedDB ----------
  let db = null;
  function openDb() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks');
      };
      rq.onsuccess = () => { db = rq.result; res(db); };
      rq.onerror = () => rej(rq.error);
    });
  }
  function idb(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
    });
  }
  const kvGet = (k) => idb('kv', 'readonly', (s) => s.get(k));
  const kvSet = (k, v) => idb('kv', 'readwrite', (s) => s.put(v, k));
  const trackGet = (id) => idb('tracks', 'readonly', (s) => s.get(id));
  const trackSet = (id, pts) => idb('tracks', 'readwrite', (s) => s.put(pts, id));
  const trackDel = (id) => idb('tracks', 'readwrite', (s) => s.delete(id));
  const trackAll = () => new Promise((res, rej) => {
    const out = {};
    const tx = db.transaction('tracks', 'readonly');
    const rq = tx.objectStore('tracks').openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } };
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error);
  });

  let S = null, saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => kvSet('state', S).catch(() => {}), 150); }
  function saveNow() { clearTimeout(saveTimer); return kvSet('state', S); }

  async function init() {
    await openDb();
    S = migrate(await kvGet('state'));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    refit();
    return S;
  }

  // =====================================================================
  // BATTERY: energy = state of charge % × usable capacity
  // =====================================================================
  const tank = (id) => S.tanks.find((t) => t.id === id) || S.tanks[0];
  function litres(tk, pct) { const t = typeof tk === 'string' ? tank(tk) : tk; return isFinite(pct) ? (t.capacity * pct) / 100 : NaN; }
  function unusableL(tk) { const t = typeof tk === 'string' ? tank(tk) : tk; return (t.capacity * (t.pipeMm || 0)) / 100; }   // below the lowest charge you allow
  const eventsFor = (tid) => S.events.filter((e) => e.tank === tid).sort((a, b) => a.t - b.t);
  function levelAfter(e) {
    if (e.type !== 'refuel') return litres(e.tank, e.mm);
    return litres(e.tank, isFinite(e.afterMm) ? e.afterMm : e.mm);
  }
  // charging losses: energy from the charger vs energy into the battery (charge % change × capacity)
  function chargeStats() {
    let fromCharger = 0, intoBattery = 0, n = 0;
    S.events.filter((e) => e.type === 'refuel' && e.pumped > 0 && isFinite(e.afterMm) && e.afterMm - e.mm >= 10).forEach((e) => {
      fromCharger += e.pumped; intoBattery += litres(e.tank, e.afterMm) - litres(e.tank, e.mm); n++;
    });
    return n ? { n, loss: fromCharger / intoBattery - 1, fromCharger, intoBattery } : { n: 0, loss: NaN };
  }

  // =====================================================================
  // CONSUMPTION: per engine, both-engine mode and solo mode, L/h per speed band
  // =====================================================================
  // ---------- base curve: your estimate points or the default formula ----------
  const CF_METHODS = ['power', 'spline', 'poly2', 'linear'];
  const CF_MIN = { power: 2, spline: 2, poly2: 3, linear: 2 };
  // idle use per engine, L/h (you set it): the base curve starts from it and never goes below it
  const floorOf = (series) => { const i = S.cons.idle; return series === 'both' ? ENG.reduce((t, e) => t + i[e], 0) : i[series]; };
  function lsq(rows, y) {
    const n = rows[0].length, H = Array.from({ length: n }, () => new Array(n).fill(0)), g = new Array(n).fill(0);
    rows.forEach((r, k) => { for (let i = 0; i < n; i++) { g[i] += r[i] * y[k]; for (let j = 0; j < n; j++) H[i][j] += r[i] * r[j]; } });
    return solve(H, g).x;
  }
  function pchipD(xs, ys) {
    const n = xs.length, h = [], dl = [], d = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; dl[i] = (ys[i + 1] - ys[i]) / h[i]; }
    if (n === 2) return [dl[0], dl[0]];
    for (let i = 1; i < n - 1; i++) {
      if (dl[i - 1] * dl[i] <= 0) d[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; d[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
    }
    const end = (h0, h1, d0, d1) => { let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (Math.sign(v) !== Math.sign(d0)) v = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > Math.abs(3 * d0)) v = 3 * d0; return v; };
    d[0] = end(h[0], h[1], dl[0], dl[1]); d[n - 1] = end(h[n - 2], h[n - 3], dl[n - 2], dl[n - 3]);
    return d;
  }
  // fit one method to points [[kn, L/h]]; returns a model or null
  function cfFit(m, pts, floor) {
    let p = pts.slice().sort((a, b) => a[0] - b[0]);
    if (p.length < CF_MIN[m] || new Set(p.map((q) => q[0])).size < p.length) return null;
    if (m !== 'power' && isFinite(floor) && p[0][0] > 0.5) p = [[0, floor]].concat(p);   // at zero speed: idle use
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    if (m === 'linear') return { m, xs, ys };
    if (m === 'spline') return { m, xs, ys, d: pchipD(xs, ys) };
    if (m === 'poly2') { const c = lsq(xs.map((v) => [1, v, v * v]), ys); return c.every(isFinite) ? { m, c } : null; }
    let best = null;   // power: L/h = idle + b·v^n — at zero speed the engines burn their idle use; b and n fitted
    const a = floor || 0;
    for (let n = 1; n <= 4.0001; n += 0.01) {
      const X = xs.map((v) => Math.pow(v, n));
      const b = X.reduce((t, x, i) => t + x * (ys[i] - a), 0) / X.reduce((t, x) => t + x * x, 0);
      if (!(b > 0)) continue;
      const sse = X.reduce((t, x, i) => t + (a + b * x - ys[i]) ** 2, 0);
      if (!best || sse < best.sse) best = { m, a, b, n: +n.toFixed(2), sse };
    }
    return best;
  }
  function cfEval(md, v) {
    if (md.m === 'power') return md.a + md.b * Math.pow(v, md.n);
    if (md.m === 'poly2') return md.c[0] + md.c[1] * v + md.c[2] * v * v;
    const xs = md.xs, ys = md.ys, n = xs.length;
    const sl = (i) => (md.m === 'spline' ? md.d[i] : i === 0 ? (ys[1] - ys[0]) / (xs[1] - xs[0]) : (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]));
    if (v <= xs[0]) return ys[0] + sl(0) * (v - xs[0]);
    if (v >= xs[n - 1]) return ys[n - 1] + sl(n - 1) * (v - xs[n - 1]);
    let i = 0; while (v > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (v - xs[i]) / h;
    if (md.m === 'linear') return ys[i] + t * (ys[i + 1] - ys[i]);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * md.d[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * md.d[i + 1];
  }
  function cfMonotonic(md, floor) {
    let prev = -Infinity;
    for (let v = 1; v <= MAX_KN + 1.5; v += 0.25) { const y = Math.max(floor, cfEval(md, v)); if (!isFinite(y) || y < prev - 1e-6) return false; prev = y; }
    return true;
  }
  const cfSeries = (series) => (S.cons.pts[series] || []).map((q) => [q.kn, q.lpnm * q.kn]);
  // suggested fits for one series: error in L/NM when each point is left out (4+ points); with 2–3 points all fits pass through them
  function consSuggestions(series) {
    const pts = cfSeries(series), floor = floorOf(series);
    if (pts.length < 2) return { list: [], loo: false };
    const loo = pts.length >= 4, out = [];
    CF_METHODS.forEach((m) => {
      const md = cfFit(m, pts, floor); if (!md || !cfMonotonic(md, floor)) return;
      let r = [];
      if (loo) pts.forEach((q, i) => { const o = cfFit(m, pts.filter((_, j) => j !== i), floor); if (o) r.push((Math.max(floor, cfEval(o, q[0])) - q[1]) / q[0]); });
      else r = pts.map((q) => (Math.max(floor, cfEval(md, q[0])) - q[1]) / q[0]);
      if (!r.length) return;
      out.push({ m, model: md, rms: Math.sqrt(r.reduce((t, x) => t + x * x, 0) / r.length) });
    });
    const pref = (m) => CF_METHODS.indexOf(m);
    out.sort((a, b) => (loo && Math.abs(a.rms - b.rms) > 0.005 ? a.rms - b.rms : pref(a.m) - pref(b.m)));
    return { list: out, loo };
  }
  // base L/h at a speed: 'both' = whole boat with both engines, 'port' / 'stbd' = that engine alone
  function baseLph(series, kn) {
    const md = S.cons && S.cons.base[series];
    if (series === 'both') return md ? Math.max(floorOf('both'), cfEval(md, kn)) : floorOf('both') + 0.111 * kn + 0.0000077 * kn * kn * kn;   // kW: auxiliaries + rolling + air
    return Math.max(floorOf(series), md ? cfEval(md, kn) : baseLph('both', kn) * 1.1);
  }
  // per-engine prior of one band and its uncertainty: ±25 % on your own base curve, wide on the default formula
  function priorBand(e, m, b) {
    if (b === 0) { const p = S.cons.idle[e]; return { p, sd: 0.25 * p + 0.5 }; }   // idle band: your idle use, ±25 %
    const kn = bandMid(b), own = m === 'both' ? !!S.cons.base.both : !!(S.cons.base[e] || S.cons.base.both);
    const p = m === 'both' ? baseLph('both', kn) / ENG.length : baseLph(e, kn);
    return { p, sd: own ? 0.25 * p + 0.5 : 0.6 * p + 2 };
  }
  const IDX = (e, m, b) => ((ENG.indexOf(e) * 2) + (m === 'both' ? 0 : 1)) * NB + b;
  const NX = 2 * ENG.length * NB;
  const tripBands = (tr) => tr.bandsBy || emptyBands();

  function intervals() {
    const out = [];
    ENG.forEach((e) => {
      const ev = eventsFor(e);
      for (let i = 1; i < ev.length; i++) {
        const a = ev[i - 1], b = ev[i];
        const trips = S.trips.filter((tr) => tr.end > a.t && tr.end <= b.t);
        if (!trips.length) continue;
        const parts = trips.map((tr) => { const bb = tripBands(tr); return { tr, both: bb.both, solo: bb[e] }; });
        out.push({ tank: e, t0: a.t, t1: b.t, used: levelAfter(a) - litres(e, b.mm), rough: !!(a.rough || b.rough), trips: trips.map((t) => t.id), parts, dist: trips.reduce((s, t) => s + t.distNm, 0) });
      }
    });
    return out;
  }

  // ---------- conditions: wind, waves (from wind strength) and load ----------
  const ZERO_COND = { a: 0, c: 0, bL: 0, bF: 0 };
  function condFeat(tr) {
    const w = tr.wind && tr.wind.status === 'ok' ? tr.wind : null;
    return { H: w ? w.head : 0, W: w ? Math.max(0, w.ws - 4) : 0, L: tr.load === 'light' ? 1 : 0, F: tr.load === 'full' ? 1 : 0 };
  }
  function condFactor(tr, cond) {
    const k = cond || (S.fit && S.fit.cond) || ZERO_COND, q = condFeat(tr);
    return Math.max(0.5, 1 + k.a * q.H + k.c * q.W + k.bL * q.L + k.bF * q.F);
  }
  function loadFactor(load) { const k = (S.fit && S.fit.cond) || ZERO_COND; return Math.max(0.5, 1 + (load === 'light' ? k.bL : load === 'full' ? k.bF : 0)); }
  function baseFuel(tr, e, x) { const bb = tripBands(tr); let L = 0; for (let b = 0; b < NB; b++) L += bb.both[b] * x.both[b] + bb[e][b] * x.solo[b]; return L; }

  function solveCurves(ints, cond) {
    const H = Array.from({ length: NX }, () => new Array(NX).fill(0)), g = new Array(NX).fill(0);
    ints.forEach((iv) => {
      const a = new Array(NX).fill(0);
      iv.parts.forEach((p) => { const f = condFactor(p.tr, cond); for (let b = 0; b < NB; b++) { a[IDX(iv.tank, 'both', b)] += f * p.both[b]; a[IDX(iv.tank, 'solo', b)] += f * p.solo[b]; } });
      const sig = iv.rough ? ROUGH_SD : MEAS_SD, w = 1 / (sig * sig);
      const nz = []; for (let i = 0; i < NX; i++) if (a[i]) nz.push(i);
      nz.forEach((i) => { g[i] += w * a[i] * iv.used; nz.forEach((j) => { H[i][j] += w * a[i] * a[j]; }); });
    });
    const P = {}; ENG.forEach((e) => ['both', 'solo'].forEach((m) => { for (let b = 0; b < NB; b++) P[IDX(e, m, b)] = priorBand(e, m, b); }));
    ENG.forEach((e) => ['both', 'solo'].forEach((m) => {
      for (let b = 0; b < NB; b++) { // prior: the base curve
        const i = IDX(e, m, b), { p, sd } = P[i];
        H[i][i] += 1 / (sd * sd); g[i] += p / (sd * sd);
      }
      const ls = 1 / Math.pow(m === 'both' ? 3 : 4, 2); // smooth correction over moving bands: the base keeps its shape
      for (let b = 2; b < NB - 1; b++) {
        const idx = [IDX(e, m, b - 1), IDX(e, m, b), IDX(e, m, b + 1)], cf = [1, -2, 1];
        const dp = cf.reduce((t, c, k) => t + c * P[idx[k]].p, 0);
        for (let i = 0; i < 3; i++) { g[idx[i]] += ls * cf[i] * dp; for (let j = 0; j < 3; j++) H[idx[i]][idx[j]] += ls * cf[i] * cf[j]; }
      }
    }));
    if (ENG.length === 2) ['both', 'solo'].forEach((m) => { // link the two engines: similar corrections unless data says otherwise
      for (let b = 0; b < NB; b++) {
        const i = IDX('port', m, b), j = IDX('stbd', m, b), dp = P[i].p - P[j].p;
        const sc = 0.15 * (P[i].p + P[j].p) / 2 + 0.5, w = 1 / (sc * sc);
        H[i][i] += w; H[j][j] += w; H[i][j] -= w; H[j][i] -= w; g[i] += w * dp; g[j] -= w * dp;
      }
    });
    const r = solve(H, g);
    const x = r.x.map((v) => Math.max(0.1, v));
    const pick = (e, m) => Array.from({ length: NB }, (_, b) => x[IDX(e, m, b)]);
    const xo = {}; ENG.forEach((e) => { xo[e] = { both: pick(e, 'both'), solo: pick(e, 'solo') }; });
    return { x: xo, inv: r.inv };
  }
  function solveCond(ints, x) {
    // used - sum(base) = sum(base * (a*H + c*W + bL*L + bF*F)), with priors around 0
    const sig = [0.03, 0.03, 0.15, 0.15], H = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 / (sig[i] * sig[i]) : 0))), g = [0, 0, 0, 0];
    let nWind = 0; const nLoad = { light: 0, full: 0 };
    ints.forEach((iv) => {
      let base = 0; const a = [0, 0, 0, 0];
      iv.parts.forEach((p) => { const b0 = baseFuel(p.tr, iv.tank, x[iv.tank]), q = condFeat(p.tr); base += b0; a[0] += b0 * q.H; a[1] += b0 * q.W; a[2] += b0 * q.L; a[3] += b0 * q.F; });
      if (iv.parts.some((p) => p.tr.wind && p.tr.wind.status === 'ok')) nWind++;
      if (iv.parts.some((p) => p.tr.load === 'light')) nLoad.light++;
      if (iv.parts.some((p) => p.tr.load === 'full')) nLoad.full++;
      const y = iv.used - base, s2 = (iv.rough ? ROUGH_SD : MEAS_SD) ** 2;
      for (let i = 0; i < 4; i++) { g[i] += a[i] * y / s2; for (let j = 0; j < 4; j++) H[i][j] += a[i] * a[j] / s2; }
    });
    const r = solve(H, g), lim = [[-0.05, 0.08], [-0.02, 0.08], [-0.3, 0.2], [-0.1, 0.4]];
    const v = r.x.map((z, i) => clamp(z, lim[i][0], lim[i][1]));
    return { cond: { a: v[0], c: v[1], bL: v[2], bF: v[3] }, sd: r.inv.map((row, i) => Math.sqrt(Math.max(0, row[i]))), nWind, nLoad };
  }
  // the curve in use (S.cons.active) changes only when you accept a proposal, change the base or restore an earlier curve
  const r3 = (v) => Math.round(v * 1000) / 1000;
  function packFit(cur, cond, condSd) {
    const I = cur.inv, sd = (i) => r3(Math.sqrt(Math.max(0, I[i][i])));
    const sig = { tot: Array.from({ length: NB }, (_, b) => { const ix = ENG.map((e) => IDX(e, 'both', b)); return r3(Math.sqrt(Math.max(0, ix.reduce((t, i) => t + ix.reduce((u, j) => u + I[i][j], 0), 0)))); }) };
    ENG.forEach((e) => { sig[e] = { both: Array.from({ length: NB }, (_, b) => sd(IDX(e, 'both', b))), solo: Array.from({ length: NB }, (_, b) => sd(IDX(e, 'solo', b))) }; });
    const x = {}; ENG.forEach((e) => { x[e] = { both: cur.x[e].both.map(r3), solo: cur.x[e].solo.map(r3) }; });
    return { t: Date.now(), x, sig, cond: { ...cond }, condSd: (condSd || [0.03, 0.03, 0.15, 0.15]).slice() };
  }
  function solveAll(ints) {
    let cond = { ...ZERO_COND }, cur = solveCurves(ints, cond), cs = { sd: [0.03, 0.03, 0.15, 0.15], nWind: 0, nLoad: { light: 0, full: 0 } };
    if (ints.length) for (let it = 0; it < 4; it++) { cs = solveCond(ints, cur.x); cond = cs.cond; cur = solveCurves(ints, cond); }
    return { fit: packFit(cur, cond, cs.sd), condN: { wind: cs.nWind, light: cs.nLoad.light, full: cs.nLoad.full } };
  }
  const lphX = (x, e, mode, kn) => (mode === 'both' ? bandInterp(x[e].both, kn) : mode === e ? bandInterp(x[e].solo, kn) : 0);
  // biggest relative change on speed bands you have driven (0.25 h or more), and the change in condition effects
  function consChange(a, b, loggedH) {
    let rel = 0;
    for (let k = 0; k < NB - 1; k++) {   // band 0 = idle runs and standing
      if (loggedH.both[k] >= 0.25) { const u = ENG.reduce((t, e) => t + a.x[e].both[k], 0), v = ENG.reduce((t, e) => t + b.x[e].both[k], 0); rel = Math.max(rel, Math.abs(v - u) / Math.max(0.5, u)); }
      if (ENG.length > 1) ENG.forEach((e) => { if (loggedH[e][k] >= 0.25) rel = Math.max(rel, Math.abs(b.x[e].solo[k] - a.x[e].solo[k]) / Math.max(0.5, a.x[e].solo[k])); });
    }
    const ca = a.cond, cb = b.cond;
    const cond = Math.max(Math.abs(cb.a - ca.a) * 5, Math.abs(cb.c - ca.c) * 6, Math.abs(cb.bL - ca.bL), Math.abs(cb.bF - ca.bF));
    return { rel, cond };
  }
  function intervalRms(ints, fit) {
    if (!ints.length) return NaN;
    const r = ints.map((iv) => iv.used - iv.parts.reduce((t, p) => t + condFactor(p.tr, fit.cond) * baseFuel(p.tr, iv.tank, fit.x[iv.tank]), 0));
    return Math.sqrt(r.reduce((t, v) => t + v * v, 0) / r.length);
  }
  function refit() {
    const ints = intervals(), C = S.cons;
    const { fit: cand, condN } = solveAll(ints);
    const loggedH = emptyBands();
    S.trips.forEach((tr) => { const bb = tripBands(tr); MODES.forEach((m) => bb[m].forEach((h, b) => { loggedH[m][b] += h; })); });
    if (!C.active) C.active = cand;   // first start: what the data says now is the curve in use
    const ch = consChange(C.active, cand, loggedH);
    const rj = C.rejected ? consChange(C.rejected, cand, loggedH) : null;
    if ((ch.rel > 0.03 || ch.cond > 0.03) && !(rj && rj.rel < 0.01 && rj.cond < 0.01)) {
      C.pending = { ...cand, rel: ch.rel, condChange: ch.cond, n: ints.length, errBefore: intervalRms(ints, C.active), errAfter: intervalRms(ints, cand) };
    } else C.pending = null;
    const A = C.active;
    S.fit = { x: A.x, sig: A.sig, cond: A.cond, condSd: A.condSd, condN, loggedH, nIntervals: ints.length, nTrips: S.trips.filter((t) => !t.idle).length, updated: Date.now() };
    return S.fit;
  }
  function consSnapshot(note) {
    const C = S.cons;
    C.history.unshift({ t: Date.now(), note, active: C.active, base: JSON.parse(JSON.stringify(C.base)), idle: { ...C.idle } });
    C.history = C.history.slice(0, 10);
  }
  function acceptCons() {
    const C = S.cons, p = C.pending; if (!p) return false;
    consSnapshot('before accepting a proposal');
    const { rel, condChange, n, errBefore, errAfter, ...fit } = p;
    C.active = { ...fit, t: Date.now() }; C.pending = null; C.rejected = null; refit(); save(); return true;
  }
  function rejectCons() { const C = S.cons; if (C.pending) C.rejected = { x: C.pending.x, cond: C.pending.cond }; C.pending = null; save(); }
  // a new base curve for one series (model from consSuggestions, or null = default formula): the correction starts from zero
  function setConsBase(series, model) {
    const C = S.cons;
    consSnapshot('before a new base curve');
    C.base[series] = model ? JSON.parse(JSON.stringify(model)) : null;
    const keep = C.active ? C.active : null;
    C.active = packFit(solveCurves([], keep ? keep.cond : ZERO_COND), keep ? keep.cond : ZERO_COND, keep ? keep.condSd : null);
    C.rejected = null; refit(); save();
  }
  // new idle use: power-curve bases are refitted from the new starting point, then the base is new (correction from zero)
  function setConsIdle(idle) {
    const C = S.cons;
    consSnapshot('before a new idle use');
    C.idle = { ...idle };
    Object.keys(C.base).forEach((k) => {
      const md = C.base[k]; if (!md || md.m !== 'power') return;
      const nf = cfFit('power', cfSeries(k), floorOf(k));
      C.base[k] = nf || { ...md, a: floorOf(k) };
    });
    const keep = C.active;
    C.active = packFit(solveCurves([], keep ? keep.cond : ZERO_COND), keep ? keep.cond : ZERO_COND, keep ? keep.condSd : null);
    C.rejected = null; refit(); save();
  }
  function restoreCons(i) {
    const C = S.cons, h = C.history[i]; if (!h) return false;
    consSnapshot('before restoring an earlier curve');
    C.base = JSON.parse(JSON.stringify(h.base)); if (h.idle) C.idle = { ...h.idle }; C.active = h.active; C.history.splice(i + 1, 1);
    C.rejected = null; refit(); save(); return true;
  }
  function addConsPoint(series, kn, lpnm) { const q = { id: uid(), kn, lpnm, t: Date.now() }; S.cons.pts[series].push(q); S.cons.pts[series].sort((a, b) => a.kn - b.kn); save(); return q; }
  function findConsPoint(id) { for (const k of Object.keys(S.cons.pts)) { const q = S.cons.pts[k].find((x) => x.id === id); if (q) return { series: k, q }; } return null; }
  function updateConsPoint(id, kn, lpnm) { const f = findConsPoint(id); if (!f) return; f.q.kn = kn; f.q.lpnm = lpnm; S.cons.pts[f.series].sort((a, b) => a.kn - b.kn); save(); }
  function deleteConsPoint(id) { Object.keys(S.cons.pts).forEach((k) => { S.cons.pts[k] = S.cons.pts[k].filter((x) => x.id !== id); }); save(); }
  const mids = Array.from({ length: NB - 1 }, (_, i) => bandMid(i + 1));
  function bandInterp(arr, kn) { if (kn < 1) return arr[0]; return interp(mids, arr.slice(1), kn); }
  // L/h of one engine in a mode ('both' | 'port' | 'stbd')
  function lphEng(e, mode, kn) {
    if (!S.fit) return NaN;
    if (mode === 'both') return bandInterp(S.fit.x[e].both, kn);
    if (mode === e) return bandInterp(S.fit.x[e].solo, kn);
    return 0;
  }
  const lphTotal = (mode, kn) => ENG.reduce((t, e) => t + lphEng(e, mode, kn), 0);
  const lpnm = (mode, kn) => (kn >= 3 ? lphTotal(mode, kn) / kn : NaN);
  function lphSigma(mode, kn) {
    if (!S.fit || !S.fit.sig) return NaN;
    const b = bandOf(kn);
    return mode === 'both' ? S.fit.sig.tot[b] : S.fit.sig[mode].solo[b];
  }
  const lpnmSigma = (mode, kn) => (kn >= 3 ? lphSigma(mode, kn) / kn : NaN);

  function tripFuel(tr, e) {
    const x = S.fit ? S.fit.x[e] : { both: Array.from({ length: NB }, (_, b) => priorBand(e, 'both', b).p), solo: Array.from({ length: NB }, (_, b) => priorBand(e, 'solo', b).p) };
    return baseFuel(tr, e, x) * condFactor(tr);
  }
  const tripFuelTotal = (tr) => ENG.reduce((t, e) => t + tripFuel(tr, e), 0);
  function tripMeasured(tr) {
    const ints = intervals().filter((iv) => iv.trips.includes(tr.id));
    if (new Set(ints.map((i) => i.tank)).size < ENG.length) return null;
    let used = 0, dist = 0, shared = false;
    ENG.forEach((e) => { const iv = ints.find((i) => i.tank === e); used += iv.used; if (!dist) dist = iv.dist; if (iv.trips.length > 1) shared = true; });
    return dist && used > 0 ? { lpnm: used / dist, used, shared } : null;   // a negative difference is a reading error, not a measurement
  }

  // ---------- levels, usable fuel, range ----------
  function levelNow(tid) {
    const ev = eventsFor(tid);
    if (!ev.length) return { L: NaN, since: null, known: false };
    const last = ev[ev.length - 1];
    let used = 0;
    S.trips.filter((tr) => tr.end > last.t).forEach((tr) => { used += tripFuel(tr, tid); });
    if (S.active && S.active.start >= last.t) used += tripFuel(S.active, tid);
    const ir = idleNow(); if (ir && ir.start >= last.t) used += tripFuel(ir, tid);
    return { L: Math.max(0, levelAfter(last) - used), since: last, known: true };
  }
  function usable(tid) {
    const tk = tank(tid), lv = levelNow(tid);
    const dead = unusableL(tk);
    const reserve = 0;   // reserve feature removed: usable = everything above the suction pipe
    return { L: lv.L, dead, reserve, usable: Math.max(0, lv.L - dead - reserve), known: lv.known };
  }
  function range(mode, kn) {
    if (!(kn >= 3)) return null;
    const eng = mode === 'both' ? ENG : [mode];
    const lf = loadFactor(S.active ? S.active.load : S.settings.lastLoad);
    const r = eng.map((e) => { const u = usable(e); const rate = lf * lphEng(e, mode, kn) / kn; return { e, known: u.known, nm: rate > 0 ? u.usable / rate : Infinity }; });
    if (r.some((x) => !x.known)) return null;
    r.sort((a, b) => a.nm - b.nm);
    const lp = lf * lpnm(mode, kn);
    const out = { oneWay: r[0].nm, round: r[0].nm / 2, limit: r[0].e, lpnm: lp };
    if (r.length > 1) out.otherNm = r[1].nm;
    return out;
  }

  // ---------- economy proposals ----------
  function economy() {
    const f = S.fit; if (!f) return null;
    const minKn = S.settings.minCruiseKn, margin = S.settings.effMarginPct / 100;
    let cands = [];
    for (let b = 1; b < NB - 1; b++) if (bandMid(b) >= minKn) cands.push(b);
    const withData = cands.filter((b) => f.loggedH.both[b] >= 0.3);
    const useData = f.nIntervals > 0 && withData.length >= 1;
    if (useData) cands = withData;
    if (!cands.length) return null;
    const lp = (b) => ENG.reduce((t, e) => t + f.x[e].both[b], 0) / bandMid(b);
    let best = cands[0]; cands.forEach((b) => { if (lp(b) < lp(best)) best = b; });
    let eff = best; cands.forEach((b) => { if (lp(b) <= lp(best) * (1 + margin) && bandMid(b) > bandMid(eff)) eff = b; });
    const mk = (b) => { const kn = bandMid(b); return { kn, lpnm: lp(b), sigma: lpnmSigma('both', kn), rpm: NaN, rpmSource: 'none' }; };
    return { best: mk(best), efficient: mk(eff), fromData: useData };
  }

  // ---------- events ----------
  function logAccuracy(tid, mm, t, rough) {
    const ev = eventsFor(tid).filter((e) => e.t < t); if (!ev.length) return;   // entries can be dated back
    const last = ev[ev.length - 1];
    const trips = S.trips.filter((tr) => tr.end > last.t && tr.end <= t);
    if (!trips.length) return;
    const pred = trips.reduce((s, tr) => s + tripFuel(tr, tid), 0);
    const meas = levelAfter(last) - litres(tid, mm);
    if (pred < 0.5) return;
    S.accuracy = S.accuracy || [];
    S.accuracy.push({ t, tank: tid, pred: +pred.toFixed(1), meas: +meas.toFixed(1), trips: trips.length, rough: !!rough });
  }
  // kind: 'after' (after a trip) | 'before' (before a trip) | 'check' (separate dip)
  function addDip(tid, mm, rough, t, kind) {
    logAccuracy(tid, mm, t || Date.now(), rough);
    const e = { id: uid(), t: t || Date.now(), type: 'dip', tank: tid, mm, rough: !!rough, kind: kind || 'check' };
    S.events.push(e); refit(); save(); return e;
  }
  // rows: [{tank, beforeMm, pumped, afterMm, brim}] ; one pump total for groups is already split by caller
  // src: { type: 'station' | 'canister', name }
  function addRefuel(rows, price, rough, t, src) {
    const tt = t || Date.now(), group = rows.length > 1 ? uid() : null;
    rows.forEach((r) => logAccuracy(r.tank, r.beforeMm, tt, rough));
    rows.forEach((r) => S.events.push({ id: uid(), t: tt, type: 'refuel', tank: r.tank, mm: r.beforeMm, pumped: r.pumped, afterMm: r.afterMm, brim: !!r.brim, rough: !!rough, group, price, src: src || null }));
    refit(); save(); return null;
  }
  function addStationPrice(id, price, src, litres, t) {
    S.stationPrices = S.stationPrices || {};
    (S.stationPrices[id] = S.stationPrices[id] || []).push({ t: t || Date.now(), price, src, litres: litres || null });
    save();
  }
  function addUserStation(lat, lon, name) {
    S.userStations = S.userStations || [];
    const st = { id: 'user:' + uid(), lat: +lat.toFixed(6), lon: +lon.toFixed(6), name: name || 'My fuel station', operator: '', fuels: [], hours: '', user: true };
    S.userStations.push(st); save(); return st;
  }
  function deleteUserStation(id) { S.userStations = (S.userStations || []).filter((s) => s.id !== id); save(); }
  // dips made before this app version have no kind: a dip after a trip ended (within 6 h, first dip of that tank since) counts as "after"
  function dipKind(e) {
    if (e.kind) return e.kind;
    const prev = S.trips.filter((tr) => !tr.idle && tr.end <= e.t).sort((a, b) => b.end - a.end)[0];
    if (!prev || e.t - prev.end > 6 * 3600000) return 'check';
    const earlier = S.events.some((x) => x.tank === e.tank && x.id !== e.id && x.t > prev.end && x.t < e.t);
    return earlier ? 'check' : 'after';
  }
  // true when a tank has had no dip or refuel since the last trip ended
  function needsPreDip() {
    const lastEnd = S.trips.filter((tr) => !tr.idle).reduce((m, tr) => Math.max(m, tr.end || 0), 0);
    return ENG.some((e) => { const ev = eventsFor(e); return !ev.length || ev[ev.length - 1].t < lastEnd; });
  }
  // distance per engine: hours × band speed per mode, scaled to the trip distance
  const tripEngineNm = (tr) => ({ bat: tr.distNm });
  const tripEngineH = (tr) => ({ bat: tr.hours });
  // fuel per trip and engine: measured tank intervals are shared among their trips by the model's estimate; other trips use the estimate
  function tripFuelSplit() {
    const out = {};
    S.trips.forEach((tr) => { out[tr.id] = {}; ENG.forEach((e) => { out[tr.id][e] = { L: tripFuel(tr, e), est: true }; }); });
    intervals().forEach((iv) => {
      const model = iv.trips.reduce((s, id) => s + (out[id] ? tripFuel(S.trips.find((t) => t.id === id), iv.tank) : 0), 0);
      iv.trips.forEach((id) => {
        const tr = S.trips.find((t) => t.id === id); if (!tr) return;
        const share = model > 0 ? tripFuel(tr, iv.tank) / model : 1 / iv.trips.length;
        out[id][iv.tank] = { L: Math.max(0, iv.used) * share, est: false };
      });
    });
    return out;
  }
  function summary(from, to) {
    const z = () => ({ nm: 0, h: 0, L: 0, Lest: 0, eur: 0, bought: 0 });
    const r = { idleH: 0, boat: z(), trips: 0 }; ENG.forEach((e) => { r[e] = z(); });
    const split = tripFuelSplit();
    S.trips.filter((tr) => tr.start >= from && tr.start < to).forEach((tr) => {
      if (tr.idle) r.idleH += tr.hours; else r.trips++;
      const nm = tripEngineNm(tr), h = tripEngineH(tr);
      r.boat.nm += tr.distNm; r.boat.h += tr.hours;
      ENG.forEach((e) => {
        const fu = split[tr.id][e];
        r[e].nm += nm[e]; r[e].h += h[e]; r[e].L += fu.L; if (fu.est) r[e].Lest += fu.L;
        r.boat.L += fu.L; if (fu.est) r.boat.Lest += fu.L;
      });
    });
    S.events.filter((ev) => ev.type === 'refuel' && ev.t >= from && ev.t < to).forEach((ev) => {
      const L = ev.pumped || 0, eur = isFinite(ev.price) && ev.price > 0 ? L * ev.price : 0;
      r[ev.tank].bought += L; r[ev.tank].eur += eur; r.boat.bought += L; r.boat.eur += eur;
    });
    return r;
  }
  function seasons() {
    const ys = new Set([new Date().getFullYear()]);
    S.trips.forEach((tr) => ys.add(new Date(tr.start).getFullYear()));
    S.events.forEach((e) => ys.add(new Date(e.t).getFullYear()));
    return [...ys].sort((a, b) => b - a);
  }
  function deleteEvent(id) { S.events = S.events.filter((e) => e.id !== id); refit(); save(); }
  // =====================================================================
  // GPS trip tracking
  // =====================================================================
  let watchId = null, wake = null, buf = [], lastPersist = 0;
  const listeners = new Set();
  const live = { fix: null, sogKn: 0, sogAvg: 0, acc: null, gap: false, error: null };
  const emit = () => listeners.forEach((f) => f());

  async function keepAwake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* ignore */ } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S && S.active) keepAwake(); });
  function startWatch() {
    if (watchId !== null || !('geolocation' in navigator)) return;
    watchId = navigator.geolocation.watchPosition(onFix, (err) => { live.error = err.message || 'GPS error'; emit(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  function stopWatch() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; }

  // ---------- idle runs (engine running / car on while standing, no GPS) ----------
  const idleBands = (hours, mode) => { const bb = emptyBands(); bb[mode || 'both'][0] = hours; return bb; };
  const idleTrip = (start, hours, mode) => ({ start, end: start + hours * 3600000, distNm: 0, bandsBy: idleBands(hours, mode), hours, gaps: 0, idle: true, manual: { mode: mode || 'both' },
    samples: [], modeLog: [[start, mode || 'both']], rpmLog: [], load: 'normal', wind: { status: 'none', reason: 'idle' } });
  function idleNow() { const r = S.idleRun; if (!r) return null; const h = Math.max(0, (Date.now() - r.start) / 3600000); return idleTrip(r.start, h, r.mode); }
  function addIdle(o) { const tr = Object.assign({ id: uid(), name: 'Idle' }, idleTrip(o.start, o.hours, o.mode)); S.trips.push(tr); refit(); save(); return tr; }
  function updateIdle(id, o) {
    const i = S.trips.findIndex((t) => t.id === id && t.idle); if (i < 0) return null;
    S.trips[i] = Object.assign({ id, name: S.trips[i].name }, idleTrip(o.start, o.hours, o.mode)); refit(); save(); return S.trips[i];
  }
  function startIdle(mode) { if (S.active || S.idleRun) return; S.idleRun = { start: Date.now(), mode: mode || 'both' }; save(); emit(); }
  function stopIdle() {
    const r = S.idleRun; if (!r) return null;
    S.idleRun = null;
    const h = (Date.now() - r.start) / 3600000;
    if (h < 1 / 60) { save(); emit(); return null; }   // under a minute: not worth a log entry
    const tr = addIdle({ start: r.start, hours: h, mode: r.mode }); emit(); return tr;
  }

  async function startTrip(mode, load) {
    if (S.active) return S.active;
    if (S.idleRun) stopIdle();
    const t = Date.now();
    S.settings.lastLoad = load || S.settings.lastLoad || 'normal';
    S.active = { id: uid(), start: t, end: null, distNm: 0, bandsBy: emptyBands(), last: null, paused: false, gaps: 0, name: '', load: S.settings.lastLoad,
      mode: mode || 'both', rpm: null, modeLog: [[t, mode || 'both']], rpmLog: [], samples: [], stretch: null };
    buf = [];
    await trackSet(S.active.id, []);
    await saveNow();
    startWatch(); keepAwake(); emit();
    return S.active;
  }
  function resumeIfActive() { if (S.active) { startWatch(); keepAwake(); } }
  function setPaused(p) { if (S.active) { closeStretch(); S.active.paused = p; S.active.last = null; save(); emit(); } }
  function setMode(m) { const A = S.active; if (!A || A.mode === m) return; closeStretch(); A.mode = m; A.modeLog.push([Date.now(), m]); save(); emit(); }
  function setRpm(r) { const A = S.active; if (!A) return; closeStretch(); A.rpm = r; A.rpmLog.push([Date.now(), r]); save(); emit(); }

  // steady stretches: same RPM + mode, stable speed for >= 3 min
  function closeStretch() {
    const A = S.active; if (!A || !A.stretch) return;
    const st = A.stretch; A.stretch = null;
    const dur = (st.tl - st.t0) / 1000;
    if (st.rpm && dur >= 180 && st.n >= 5) {
      const mean = st.sum / st.n, sd = Math.sqrt(Math.max(0, st.sq / st.n - mean * mean));
      if (sd <= 0.5) A.samples.push({ t: Math.round((st.t0 + st.tl) / 2), rpm: st.rpm, mode: st.mode, kn: +mean.toFixed(2), dur: Math.round(dur) });
    }
  }
  function feedStretch(t, kn) {
    const A = S.active;
    let st = A.stretch;
    if (st && (st.rpm !== A.rpm || st.mode !== A.mode)) { closeStretch(); st = null; }
    if (st && st.n >= 5 && Math.abs(kn - st.sum / st.n) > 0.8) { closeStretch(); st = null; }
    if (st && t - st.t0 > 600000) { closeStretch(); st = null; }
    if (!st) { A.stretch = { t0: t, tl: t, rpm: A.rpm, mode: A.mode, n: 0, sum: 0, sq: 0 }; st = A.stretch; }
    st.n++; st.sum += kn; st.sq += kn * kn; st.tl = t;
  }

  function onFix(pos) {
    const c = pos.coords, t = pos.timestamp || Date.now();
    live.acc = c.accuracy; live.error = null;
    const p = [c.latitude, c.longitude];
    const gpsKn = (c.speed !== null && c.speed >= 0) ? c.speed * KN : null;
    live.fix = { lat: p[0], lon: p[1], t, heading: c.heading };
    const A = S.active;
    if (!A || A.paused) { live.sogKn = gpsKn || 0; emit(); return; }
    if (c.accuracy > 60) { emit(); return; }
    if (A.last) {
      const dt = (t - A.last.t) / 1000;
      if (dt <= 0) return;
      const d = haversine(A.last.p, p);
      let kn = gpsKn !== null ? gpsKn : (d / dt) * KN;
      let gap = false;
      if (dt > 120) { kn = (d / dt) * KN; A.gaps++; live.gap = true; gap = true; closeStretch(); }
      const moving = kn >= 2 || d > Math.max(15, c.accuracy);
      if (moving) A.distNm += d / NM;
      A.bandsBy[A.mode][bandOf(moving ? kn : 0)] += dt / 3600;
      live.sogKn = kn;
      live.sogAvg = live.sogAvg ? live.sogAvg * 0.9 + kn * 0.1 : kn;
      if (!gap) feedStretch(t, kn);
      if (moving || dt > 15) buf.push([+p[0].toFixed(6), +p[1].toFixed(6), t, +kn.toFixed(1)]);
    } else buf.push([+p[0].toFixed(6), +p[1].toFixed(6), t, 0]);
    A.last = { p, t };
    if (Date.now() - lastPersist > 20000 || buf.length > 30) persistTrack();
    save(); emit();
  }
  let persistChain = Promise.resolve();
  function persistTrack() {   // serialised: concurrent read-modify-write would lose points
    if (!S.active || !buf.length) return persistChain;
    lastPersist = Date.now();
    const id = S.active.id, add = buf; buf = [];
    persistChain = persistChain.then(async () => {
      const pts = (await trackGet(id)) || [];
      await trackSet(id, pts.concat(add));
    }).catch(() => {});
    return persistChain;
  }
  async function activeTrack() { if (!S.active) return []; await persistChain; const pts = (await trackGet(S.active.id)) || []; return pts.concat(buf); }
  async function stopTrip() {
    if (!S.active) return null;
    closeStretch();
    await persistTrack();
    stopWatch();
    try { if (wake) await wake.release(); } catch (e) { /* ignore */ }
    const A = S.active;
    const pts = (await trackGet(A.id)) || [];
    let hours = 0; MODES.forEach((m) => A.bandsBy[m].forEach((h) => { hours += h; }));
    const tr = { id: A.id, start: A.start, end: Date.now(), distNm: A.distNm, bandsBy: A.bandsBy, hours, gaps: A.gaps, name: A.name || autoName(pts), samples: A.samples, modeLog: A.modeLog, rpmLog: A.rpmLog, load: A.load || 'normal', wind: { status: 'pending', tries: 0 } };
    S.trips.push(tr);
    S.active = null; live.gap = false;
    refit(); await saveNow(); emit();
    return tr;
  }
  const tripWord = () => (typeof I18N !== 'undefined' && I18N.lang === 'fi' ? 'Ajo' : 'Drive');
  function autoName(pts) { if (!pts.length) return tripWord(); return tripWord() + ' ' + new Date(pts[0][2]).toLocaleDateString('fi-FI'); }
  // trips entered by hand (no GPS track): the time goes to the speed band of the average speed
  function manualBands(hours, distNm, mode) {
    const bb = emptyBands(), kn = hours > 0 ? distNm / hours : 0;
    bb[mode || 'both'][bandOf(kn)] = hours;
    return bb;
  }
  function addManualTrip(o) {
    const id = uid(), start = o.start || Date.now();
    const tr = { id, start, end: start + o.hours * 3600000, distNm: o.distNm, bandsBy: manualBands(o.hours, o.distNm, o.mode), hours: o.hours, gaps: 0,
      name: o.name || tripWord() + ' ' + new Date(start).toLocaleDateString('fi-FI'), samples: [], modeLog: [[start, o.mode || 'both']], rpmLog: [], load: o.load || 'normal',
      wind: { status: 'none', reason: 'entered by hand' }, manual: { mode: o.mode || 'both' } };
    S.trips.push(tr); refit(); save(); return tr;
  }
  function updateManualTrip(id, o) {
    const tr = S.trips.find((t) => t.id === id); if (!tr || !tr.manual) return null;
    tr.start = o.start; tr.hours = o.hours; tr.end = o.start + o.hours * 3600000; tr.distNm = o.distNm; tr.load = o.load || tr.load;
    tr.manual.mode = o.mode || 'both'; tr.bandsBy = manualBands(o.hours, o.distNm, tr.manual.mode); tr.modeLog = [[o.start, tr.manual.mode]];
    if (o.name) tr.name = o.name;
    refit(); save(); return tr;
  }
  function setTripLoad(id, load) { const tr = S.trips.find((t) => t.id === id); if (tr) { tr.load = load; refit(); save(); } }
  function setTripWind(id, wind) { const tr = S.trips.find((t) => t.id === id); if (tr) { tr.wind = wind; if (wind.status === 'ok') refit(); save(); } }
  async function deleteTrip(id) { S.trips = S.trips.filter((t) => t.id !== id); await trackDel(id); refit(); save(); }

  // ---------- backup ----------
  async function exportAll() { return { app: 'ev-log', exported: new Date().toISOString(), state: S, tracks: await trackAll() }; }
  async function importAll(obj) {
    if (!obj || obj.app !== 'ev-log' || !obj.state) throw new Error('Not an EV log backup file');
    S = migrate(obj.state);
    for (const [k, v] of Object.entries(obj.tracks || {})) await trackSet(k, v);
    refit(); await saveNow(); emit();
  }

  return {
    NB, MAX_KN, ENG, MODES, bandOf, bandMid, bandLabel, num, haversine, uid, polyEval, median, tripBands,
    init, get state() { return S; }, save, saveNow, live, on: (f) => listeners.add(f),
    tank, litres, unusableL, chargeStats, levelNow, usable, eventsFor, levelAfter, intervals, refit,
    lphEng, lphTotal, lpnm, lphSigma, lpnmSigma, lphX, baseLph, consSuggestions, cfEval, acceptCons, rejectCons, setConsBase, setConsIdle, floorOf, restoreCons, addConsPoint, updateConsPoint, deleteConsPoint, findConsPoint, economy, range, tripFuel, tripFuelTotal, tripMeasured,
    addDip, addRefuel, deleteEvent, dipKind, needsPreDip, summary, seasons,
    startTrip, stopTrip, startIdle, stopIdle, idleNow, addIdle, updateIdle, setPaused, setMode, setRpm, resumeIfActive, activeTrack, trackGet, deleteTrip,
    exportAll, importAll, addManualTrip, updateManualTrip, kvGet, kvSet, addStationPrice, addUserStation, deleteUserStation, setTripLoad, setTripWind, condFactor, loadFactor, _onFix: (p) => onFix(p)
  };
})();

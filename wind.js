/* Wind for finished trips from the Finnish Meteorological Institute open data (CC BY 4.0).
   For each moving stretch of the GPS track: nearest coastal station, nearest 10-min observation,
   head-wind component = wind speed * cos(wind-from direction - boat heading). */
'use strict';

const Wind = (() => {
  const FMI = 'https://opendata.fmi.fi/wfs';
  let busy = false;
  const iso = (t) => new Date(t).toISOString().slice(0, 19) + 'Z';
  const rad = (d) => (d * Math.PI) / 180;
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  async function query(bbox, t0, t1) {
    const url = `${FMI}?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::weather::simple` +
      `&bbox=${bbox.join(',')}&starttime=${iso(t0)}&endtime=${iso(t1)}&parameters=ws_10min,wd_10min&timestep=10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('FMI HTTP ' + res.status);
    const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const els = xml.getElementsByTagNameNS('*', 'BsWfsElement');
    const st = new Map();   // "lat lon" -> Map(time -> {ws, wd})
    for (const el of els) {
      const pos = (el.getElementsByTagNameNS('*', 'pos')[0] || {}).textContent;
      const tt = Date.parse((el.getElementsByTagNameNS('*', 'Time')[0] || {}).textContent);
      const name = (el.getElementsByTagNameNS('*', 'ParameterName')[0] || {}).textContent;
      const val = parseFloat((el.getElementsByTagNameNS('*', 'ParameterValue')[0] || {}).textContent);
      if (!pos || !isFinite(tt) || !isFinite(val)) continue;
      const k = pos.trim();
      if (!st.has(k)) st.set(k, new Map());
      const m = st.get(k); const o = m.get(tt) || {}; o[name === 'wd_10min' ? 'wd' : 'ws'] = val; m.set(tt, o);
    }
    const stations = [];
    st.forEach((m, k) => {
      const [a, b] = k.split(/\s+/).map(Number);
      const obs = [...m.entries()].filter(([, o]) => isFinite(o.ws) && isFinite(o.wd)).map(([t, o]) => ({ t, ws: o.ws, wd: o.wd })).sort((x, y) => x.t - y.t);
      if (obs.length) stations.push({ lat: a, lon: b, obs });
    });
    return stations;
  }

  function evaluate(pts, stations) {
    // stations may have lat/lon swapped depending on the service axis order: pick the reading closest to the track
    const midLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    stations.forEach((s) => { if (Math.abs(s.lat - midLat) > 5 && Math.abs(s.lon - midLat) < 5) { const t = s.lat; s.lat = s.lon; s.lon = t; } });
    let sumH = 0, sumW = 0, sumT = 0;
    const used = new Set();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dt = (b[2] - a[2]) / 1000;
      if (dt <= 0 || dt > 900 || b[3] < 2) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], tm = (a[2] + b[2]) / 2;
      let best = null, bd = Infinity;
      for (const s of stations) { const d = (s.lat - mid[0]) ** 2 + ((s.lon - mid[1]) * Math.cos(rad(mid[0]))) ** 2; if (d < bd) { bd = d; best = s; } }
      if (!best) continue;
      let o = null, od = Infinity;
      for (const x of best.obs) { const d = Math.abs(x.t - tm); if (d < od) { od = d; o = x; } }
      if (!o || od > 45 * 60000) continue;
      const hdg = bearing(a, b);
      sumH += o.ws * Math.cos(rad(o.wd - hdg)) * dt; sumW += o.ws * dt; sumT += dt;
      used.add(best.lat + ',' + best.lon);
    }
    if (!sumT) return null;
    return { status: 'ok', head: +(sumH / sumT).toFixed(2), ws: +(sumW / sumT).toFixed(2), stations: used.size, fetched: Date.now() };
  }

  async function forTrip(tr) {
    const pts = (await Core.trackGet(tr.id)) || [];
    if (pts.length < 2) return { status: 'none', reason: 'no track' };
    let lat0 = 90, lat1 = -90, lon0 = 180, lon1 = -180;
    pts.forEach((p) => { lat0 = Math.min(lat0, p[0]); lat1 = Math.max(lat1, p[0]); lon0 = Math.min(lon0, p[1]); lon1 = Math.max(lon1, p[1]); });
    const pad = 0.35, t0 = tr.start - 1800000, t1 = tr.end + 1800000;
    let stations = await query([lon0 - pad, lat0 - pad / 2, lon1 + pad, lat1 + pad / 2].map((v) => v.toFixed(3)), t0, t1);
    if (!stations.length) stations = await query([lat0 - pad / 2, lon0 - pad, lat1 + pad / 2, lon1 + pad].map((v) => v.toFixed(3)), t0, t1); // other axis order
    if (!stations.length) return { status: 'none', reason: 'no stations' };
    return evaluate(pts, stations) || { status: 'none', reason: 'no moving stretches' };
  }

  async function processPending(onDone) {
    if (busy || !navigator.onLine) return;
    busy = true;
    try {
      const S = Core.state;
      const todo = S.trips.filter((t) => t.wind && t.wind.status === 'pending' && Date.now() - t.end < 1000 * 86400 * 365);
      let changed = 0;
      for (const tr of todo) {
        try {
          const w = await forTrip(tr);
          Core.setTripWind(tr.id, w); changed++;
        } catch (e) {
          const tries = (tr.wind.tries || 0) + 1;
          Core.setTripWind(tr.id, tries >= 5 ? { status: 'none', reason: String(e.message || e) } : { status: 'pending', tries });
          if (e instanceof TypeError) break;   // offline / blocked: try again later
        }
      }
      if (changed && onDone) onDone();
    } finally { busy = false; }
  }
  return { processPending, forTrip, evaluate };
})();

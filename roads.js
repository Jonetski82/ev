/* Road data for EV-loki: download from roads/ (built by the "Build road data" workflow), offline storage, worker calls. */
'use strict';

const Roads = (() => {
  let worker = null, seq = 0, meta = null, loading = null;
  const pending = new Map();
  function call(cmd, args = {}, transfer = []) {
    if (!worker) {
      worker = new Worker('roads-worker.js');
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.res); };
      worker.onerror = (e) => { pending.forEach((p) => p.rej(new Error(e.message || 'worker error'))); pending.clear(); };
    }
    const id = ++seq;
    return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, cmd, ...args }, transfer); });
  }
  async function gunzip(buf) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
    const ds = new DecompressionStream('gzip');
    return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function loadFromStore() {
    const m = await Core.kvGet('roads-meta'), g = await Core.kvGet('roads-bin');
    if (!m || !g) return false;
    const bin = await gunzip(g);
    const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
    await call('load', { meta: m, buf }, [buf]);
    meta = m; return true;
  }
  function init() { if (!loading) loading = loadFromStore().catch((e) => { console.warn('road data', e); return false; }); return loading; }
  async function download(onStep) {
    const u = (n) => 'roads/' + n + '?t=' + Date.now();
    onStep && onStep('Downloading road data…');
    const mr = await fetch(u('meta.json'));
    if (!mr.ok) throw new Error('road data not found (HTTP ' + mr.status + ') — run the "Build road data" workflow in GitHub first.');
    const m = await mr.json();
    const r = await fetch(u('roads.bin.gz')); if (!r.ok) throw new Error('roads.bin.gz: HTTP ' + r.status);
    const gb = await r.arrayBuffer();
    m.downloaded = Date.now(); m.bytes = gb.byteLength;
    await Core.kvSet('roads-bin', gb); await Core.kvSet('roads-meta', m);
    onStep && onStep('Preparing…');
    loading = null; meta = null;
    if (!(await init())) throw new Error('could not load the downloaded road data');
    return meta;
  }
  // range along roads: budget kWh, kwhKm[speed] table; returns { maxOne, maxRound, zones: { half, one } }
  async function compute(lat, lon, budget, kwhKm, winter) {
    await init(); if (!meta) return { error: 'nodata' };
    const s = await call('search', { lat, lon, budget, kwhKm, winter });
    if (s.error) return s;
    s.zones = await call('zones');
    return s;
  }
  return {
    init, download, compute,
    route: (lat, lon) => call('route', { lat, lon }),
    stations: (list) => call('stations', { list }),
    get meta() { return meta; }
  };
})();

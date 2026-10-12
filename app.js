/* EV-loki — screens. Test version of the Popcorn Fuel Log for an electric car.
   Core keeps the boat names: kn = km/h, distNm = km, L/litres = kWh, mm = charge %, refuel = charge, dip = charge reading. */
'use strict';

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dec = (s) => (typeof I18N !== 'undefined' && I18N.lang === 'fi' ? s.replace('.', ',') : s);   // Finnish decimal comma
  const f = (x, d = 1) => (isFinite(x) ? dec(Number(x).toFixed(d)) : '–');
  const dv = (x) => (x !== null && x !== undefined && isFinite(x) ? dec(String(x)) : '');   // number into an input
  const fi = (x) => (isFinite(x) ? Math.round(x).toString() : '–');
  const pm = (x, d = 0) => (isFinite(x) ? (x >= 0 ? '+' : '−') + dec(Math.abs(x).toFixed(d)) : '–');
  const per100 = (kwhPerKm) => f(kwhPerKm * 100);   // kWh/km -> "kWh/100 km" number
  const dur = (h) => { if (!isFinite(h)) return '–'; const m = Math.round(h * 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
  const clock = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
  const FIL = () => I18N.lang === 'fi';
  const dstr = (t) => new Date(t).toLocaleDateString(I18N.locale, FIL() ? { day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'short' });
  const dtstr = (t) => new Date(t).toLocaleString(I18N.locale, { day: 'numeric', month: FIL() ? 'numeric' : 'short', hour: '2-digit', minute: '2-digit' });
  const tstr = (t) => new Date(t).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });
  const S = () => Core.state;
  const BAT = () => S().tanks[0];
  const pctOf = (kwh) => (kwh / BAT().capacity) * 100;
  const p2 = (n) => String(n).padStart(2, '0');
  const localInput = (t) => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  // an untouched date field means "now" to the second, so entries made within the same minute keep their order
  const readWhen = (id) => { const el = document.getElementById(id); if (!el || !el.value || el.value === el.dataset.def) return Date.now(); const t = new Date(el.value).getTime(); return isFinite(t) ? t : Date.now(); };
  const whenField = (id, t) => `<div class="field"><label for="${id}">When<small>change if you log it afterwards</small></label><div class="inbox wide" style="width:58%"><input type="datetime-local" id="${id}" value="${localInput(t || Date.now())}" data-def="${t ? '' : localInput(Date.now())}"></div></div>`;
  const LOAD_LABEL = { light: 'Light', normal: 'Normal', full: 'Full' };
  const LOAD_HINT = { light: 'Driver only, little luggage', normal: '2–3 people, usual luggage', full: 'Full car, luggage or a trailer' };
  const KIND_LABEL = { before: 'before drive', after: 'after drive', check: 'separate' };

  const IC = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    center: '<svg viewBox="0 0 24 24" fill="none" stroke="#13212F" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="#13212F" stroke-width="2" stroke-linejoin="round"><path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 16 10 5 10-5"/></svg>',
    ring: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="3 3"><circle cx="12" cy="12" r="9"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#4F5B66" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  // ---------- toast & sheet ----------
  let toastT = null;
  function toast(msg, ms = 2800) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }
  function sheet(html) { $('#sheet-panel').innerHTML = html; $('#sheet').classList.add('show'); }
  function closeSheet() { $('#sheet').classList.remove('show'); }
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  let confirmFn = null;
  function confirmSheet(title, text, okLabel, fn) {
    confirmFn = fn;
    sheet(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="btnrow"><button class="btn grow" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="confirm-ok">${esc(okLabel)}</button></div>`);
  }

  // ---------- maps ----------
  function baseLayerList() {
    const s = S().settings;
    if (s.base === 'nls' && s.nlsKey) return [L.tileLayer('https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/taustakartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=' + encodeURIComponent(s.nlsKey), { maxZoom: 17, maxNativeZoom: 16, attribution: '© Maanmittauslaitos' })];
    return [L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' })];
  }
  const maps = {};
  function getMap(key) {
    if (maps[key]) return maps[key];
    const m = L.map('map-' + key, { zoomControl: false }).setView([60.17, 24.94], 11);
    m._base = baseLayerList(); m._base.forEach((l) => l.addTo(m));
    m._over = L.layerGroup().addTo(m);
    maps[key] = m;
    return m;
  }
  function refreshBaseLayers() { Object.values(maps).forEach((m) => { m._base.forEach((l) => m.removeLayer(l)); m._base = baseLayerList(); m._base.forEach((l) => l.addTo(m)); }); }
  const carIcon = (deg) => L.divIcon({ className: 'boat-icon', iconSize: [26, 26], iconAnchor: [13, 13], html: `<svg width="26" height="26" viewBox="-13 -13 26 26"><g transform="rotate(${deg || 0})"><path d="M0 -11 L8 9 L0 4 L-8 9 Z" fill="#B8470F" stroke="#fff" stroke-width="1.6"/></g></svg>` });
  const RAMP = ['#E9B44C', '#D9822B', '#B8470F', '#7A2608'];
  function breaks(vals) { const v = vals.filter(isFinite).sort((a, b) => a - b); if (v.length < 4) return [0.14, 0.17, 0.2]; const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]; return [q(0.25), q(0.5), q(0.75)]; }
  const rampColor = (x, br) => (x < br[0] ? RAMP[0] : x < br[1] ? RAMP[1] : x < br[2] ? RAMP[2] : RAMP[3]);

  // ---------- navigation ----------
  let current = 'helm', params = {};
  const NAV_OF = { helm: 'helm', tripend: 'helm', predip: 'helm', range: 'helm', log: 'log', trips: 'trips', trip: 'trips', tripform: 'trips', curve: 'curve', tanks: 'tanks', refuel: 'tanks', more: 'more' };
  let backOf = {};
  function go(v, p = {}) {
    if ((v === 'refuel' || v === 'tripform') && current !== v) backOf[v] = current;
    current = v; params = p;
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'v-' + v));
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === (v === 'refuel' && backOf.refuel === 'log' ? 'log' : NAV_OF[v])));
    try { const r = (R[v] || (() => {}))(); if (r && r.catch) r.catch(showViewError); } catch (e) { showViewError(e); }
    $('#v-' + v).scrollTop = 0;
    Object.values(maps).forEach((m) => setTimeout(() => m.invalidateSize(), 50));
  }
  function showViewError(e) {
    console.error(e);
    const el = $('#v-' + current); if (!el) return;
    el.insertAdjacentHTML('afterbegin', `<div class="warn" style="margin-top:16px"><b>This screen could not be shown.</b> ${esc(e && e.message || e)}. Upload all app files to GitHub again (the full zip), then Settings → Check for app update.</div>`);
  }

  // ---------- shared fragments ----------
  function batBar() {
    const t = BAT(), u = Core.usable(t.id);
    const pct = (x) => Math.max(0, Math.min(100, pctOf(x))).toFixed(1);
    return `<div class="tankrow"><div class="name" style="color:${t.color};width:auto">${fi(pctOf(u.L))} %</div>
      <div class="bar" style="position:relative;overflow:visible">
        <div style="width:${pct(u.L)}%;background:${t.color};border-radius:6px"></div>
        <div title="reserve" style="position:absolute;left:0;top:0;height:12px;border-radius:6px 0 0 6px;width:${pct(u.dead)}%;background:repeating-linear-gradient(135deg,rgba(19,33,47,.6) 0 3px,rgba(255,255,255,.3) 3px 6px)"></div>
      </div><div class="amt num" style="width:auto;white-space:nowrap">${f(u.L)} kWh</div></div>`;
  }
  function batteryCard() {
    const lv = Core.levelNow('bat');
    if (!lv.known) return `<div class="card"><div class="cardhead"><div class="h">Battery</div></div><div class="sub">No charge reading yet. Log the charge % once (Battery → Log charge) so the app can follow the battery.</div><button class="btn small" data-act="go" data-v="tanks">Go to Battery</button></div>`;
    return `<div class="card"><div class="cardhead"><div class="h">Battery, estimated</div><div class="sub">Last reading ${dstr(lv.since.t)}</div></div>
      ${batBar()}
      <div class="sub">Hatched = below the lowest charge for range (${fi(BAT().pipeMm)} %)</div>
      <div class="sub" id="helm-range"></div>
      <button class="btn small dark" data-act="go" data-v="range">${IC.ring} Range &amp; charging stations</button></div>`;
  }
  function bandsHtml(bb) {
    const rows = []; let max = 0;
    const tot = new Array(Core.NB).fill(0);
    Core.MODES.forEach((m) => bb[m].forEach((h, b) => { tot[b] += h; }));
    tot.forEach((h, b) => { if (h > 0.005) { rows.push([b, h]); max = Math.max(max, h); } });
    if (!rows.length) return '<div class="sub">No time logged.</div>';
    return rows.map(([b, h]) => `<div class="bandrow"><div class="l">${Core.bandLabel(b)}</div><div class="b"><div style="width:${((h / max) * 100).toFixed(0)}%"></div></div><div class="r">${dur(h)}</div></div>`).join('');
  }
  function ecoHtml(compact) {
    const e = Core.economy(); if (!e) return '';
    if (compact) return `<div class="sub">Most economical <b style="color:#13212F">${fi(e.best.kn)} km/h</b> · ${per100(e.best.lpnm)} kWh/100 km</div><div class="sub">Efficient <b style="color:#13212F">${fi(e.efficient.kn)} km/h</b> · ${per100(e.efficient.lpnm)} kWh/100 km${e.fromData ? '' : ' · starting guess'}</div>`;
    return `<div class="grid2" style="padding-top:10px">
      <div class="tile dark"><div class="lbl">Most economical</div><div class="num mid">${fi(e.best.kn)} km/h</div><div class="hint">${per100(e.best.lpnm)} kWh/100 km</div></div>
      <div class="tile"><div class="lbl">Efficient speed</div><div class="num mid">${fi(e.efficient.kn)} km/h</div><div class="hint">${e.efficient.kn === e.best.kn ? 'same — every faster speed costs over +' + S().settings.effMarginPct + ' % per km' : per100(e.efficient.lpnm) + ' kWh/100 km (≤ +' + S().settings.effMarginPct + ' %)'}</div></div></div>
      <div class="note">${e.fromData ? 'From your logged drives' : 'Starting guess until you have drives with charge readings'} · driving from ${fi(S().settings.minCruiseKn)} km/h.</div>`;
  }
  const roughBox = (id) => `<div class="check"><input type="checkbox" id="${id}"><label for="${id}">Uncertain reading (display rounded, battery cold) — counts less</label></div>`;
  const segOn = (el) => el.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));

  // ---------- screens ----------
  const R = {};

  // DRIVE (helm)
  let helmBuilt = false, helmTrack = null, helmCar = null, follow = true, trackCache = [];
  R.helm = () => {
    const v = $('#v-helm');
    if (!helmBuilt) {
      v.innerHTML = `
      <div class="top"><div><div class="title">EV log</div><div class="sub" id="helm-sub">Ready</div></div><div class="pill" id="helm-pill"><span class="dot"></span>GPS idle</div></div>
      <div class="mapbox" style="height:32vh;min-height:200px"><div id="map-helm" class="map"></div>
        <div class="mapbtns"><button class="mapbtn" aria-label="Centre on car" data-act="center">${IC.center}</button><button class="mapbtn" aria-label="Map layers" data-act="go" data-v="more">${IC.layers}</button></div>
      </div>
      <div id="helm-dyn"></div>`;
      const m = getMap('helm');
      helmTrack = L.polyline([], { color: '#1F5675', weight: 4 }).addTo(m._over);
      helmCar = L.marker([60.17, 24.94], { icon: carIcon(0), interactive: false });
      m.on('dragstart', () => { follow = false; });
      helmBuilt = true;
    }
    renderHelmDyn();
    if (S().active) Core.activeTrack().then((pts) => { trackCache = pts.map((p) => [p[0], p[1]]); helmTrack.setLatLngs(trackCache); });
  };
  function renderHelmDyn() {
    const s = S(), A = s.active, lv = Core.live;
    const kmh = lv.sogKn || 0;
    const warn = `${lv.error ? `<div class="warn">GPS: ${esc(lv.error)}. Allow location for this app in the phone settings.</div>` : ''}
      ${A && lv.gap ? '<div class="warn">GPS paused while the screen was off. The gap was filled with a straight line.</div>' : ''}`;
    const tiles = `<div class="grid2">
        <div class="tile"><div class="lbl">Speed</div><div class="val"><span class="num big" id="h-sog">${fi(kmh)}</span><span class="unit">km/h</span></div><div class="hint" id="h-sogavg">avg ${fi(lv.sogAvg)} km/h</div></div>
        <div class="tile dark"><div class="lbl">Use now</div><div class="val"><span class="num big" id="h-lpnm">${kmh >= 3 ? per100(Core.lpnm('both', kmh)) : '–'}</span><span class="unit">kWh/100 km</span></div><div class="hint" id="h-lpnm-h"></div></div>
        <div class="tile"><div class="lbl">Distance</div><div class="val"><span class="num mid" id="h-dist">${A ? f(A.distNm) : '–'}</span><span class="unit">km</span></div></div>
        <div class="tile"><div class="lbl">Used, est.</div><div class="val"><span class="num mid" id="h-used">${A ? f(Core.tripFuelTotal(A)) : '–'}</span><span class="unit">kWh</span></div><div class="hint" id="h-used-split"></div></div>
      </div>`;
    $('#helm-dyn').innerHTML = A ? `${warn}
      <div class="ctl3" style="grid-template-columns:1fr"><button class="ctl" data-act="load-sheet"><span>Load</span><b>${LOAD_LABEL[A.load || 'normal']}</b></button></div>
      ${tiles}
      <div class="card" style="gap:4px">${ecoHtml(true)}</div>
      ${batteryCard()}
      <div class="btnrow"><button class="btn" data-act="pause">${A.paused ? 'Resume' : 'Pause'}</button><button class="btn primary" data-act="end-trip">End drive &amp; log charge</button></div>
      <div class="note">Keep the app open on screen while driving: the phone pauses GPS for web apps when the screen is off.</div>`
    : `${warn}
      <div class="btnrow" style="padding-top:10px"><button class="btn primary" data-act="start-trip">Start drive</button></div>
      ${batteryCard()}
      <div class="card" style="gap:4px">${ecoHtml(true)}</div>
      <div class="sub" style="padding:4px 16px">Drives without GPS (logged afterwards) can be added on the Drives tab.</div>`;
    updateHelmLive();
  }
  function updateHelmLive() {
    if (current !== 'helm' || !helmBuilt) return;
    const s = S(), A = s.active, lv = Core.live;
    const kmh = lv.sogKn || 0;
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    set('h-sog', fi(kmh)); set('h-sogavg', 'avg ' + fi(lv.sogAvg) + ' km/h');
    set('h-lpnm', kmh >= 3 ? per100(Core.lpnm('both', kmh)) : '–');
    set('h-lpnm-h', kmh >= 3 ? '±' + per100(Core.lpnmSigma('both', kmh)) : 'under 3 km/h');
    if (A) { set('h-dist', f(A.distNm)); const u = Core.tripFuelTotal(A); set('h-used', f(u)); set('h-used-split', fi(pctOf(u)) + ' % of the battery'); }
    $('#helm-sub').textContent = A ? 'Drive ' + clock(Date.now() - A.start) + (A.paused ? ' · paused' : '') : 'Ready — start a drive to log it';
    $('#helm-pill').innerHTML = A ? (A.paused ? '<span class="dot"></span>Paused' : '<span class="dot rec"></span>Recording') : (lv.fix ? '<span class="dot"></span>GPS ' + fi(lv.acc) + ' m' : '<span class="dot"></span>GPS idle');
    const e = Core.economy();
    const rk = kmh >= 20 ? kmh : (e ? e.best.kn : 50);
    const rg = Core.range('both', rk);
    const el = document.getElementById('helm-range');
    if (el) el.innerHTML = rg ? `Range at ${fi(rk)} km/h: <b style="color:#13212F">${fi(rg.oneWay)} km</b> one way · ${fi(rg.round)} km out &amp; back` : '';
    if (lv.fix) {
      const m = maps.helm, ll = [lv.fix.lat, lv.fix.lon];
      if (!m.hasLayer(helmCar)) helmCar.addTo(m);
      helmCar.setLatLng(ll); helmCar.setIcon(carIcon(lv.fix.heading || 0));
      if (A && !A.paused) { trackCache.push(ll); helmTrack.setLatLngs(trackCache); }
      if (follow) m.setView(ll, Math.max(m.getZoom(), 12), { animate: false });
    }
  }
  let liveTick = 0;
  Core.on(() => { const now = Date.now(); if (now - liveTick > 900) { liveTick = now; updateHelmLive(); } });
  setInterval(() => { const A = S() && S().active; if (A && current === 'helm') $('#helm-sub').textContent = 'Drive ' + clock(Date.now() - A.start) + (A.paused ? ' · paused' : ''); }, 1000);

  // charge-reading input, shared by end of drive and before a drive
  const readingCard = (title) => `<div class="card"><div class="cardhead"><div class="h">${title}</div></div>
      <div class="field"><label for="dip-bat" style="font-weight:600">Charge</label>
        <div class="inbox"><input id="dip-bat" inputmode="decimal" data-dip="bat"><span>%</span></div>
        <div style="flex:1;text-align:right"><div class="num" style="font-size:20px" id="dipL-bat">– kWh</div><div class="sub" id="dipU-bat"></div></div></div>
      ${roughBox('dip-rough')}
      <div id="dip-sum"></div></div>`;

  // END OF DRIVE
  R.tripend = () => {
    const tr = S().trips.find((t) => t.id === params.id);
    if (!tr) return go('helm');
    const bb = Core.tripBands(tr), moving = tr.hours - bb.both[0];
    $('#v-predip').innerHTML = '';
    $('#v-tripend').innerHTML = `
      <div class="top back"><button class="iconbtn" aria-label="Back" data-act="go" data-v="helm">${IC.back}</button><div><div class="title">Drive complete</div><div class="sub">${dstr(tr.start)} · ${tstr(tr.start)}–${tstr(tr.end)}</div></div></div>
      <div class="grid3" style="padding-top:0">
        <div class="tile"><div class="lbl">Distance</div><div class="num mid">${f(tr.distNm)} <span class="unit">km</span></div></div>
        <div class="tile"><div class="lbl">Drive time</div><div class="num mid">${f(tr.hours)} <span class="unit">h</span></div></div>
        <div class="tile"><div class="lbl">Avg speed</div><div class="num mid">${fi(tr.distNm / Math.max(0.01, moving))} <span class="unit">km/h</span></div></div>
      </div>
      <div class="card"><div class="cardhead"><div class="h">Time at speed</div><div class="sub">est. ${f(Core.tripFuelTotal(tr))} kWh</div></div>${bandsHtml(bb)}</div>
      ${readingCard('Charge reading from the car')}
      <div class="btnrow"><button class="btn" data-act="go" data-v="trips">Skip</button><button class="btn primary" data-act="save-dips" data-id="${tr.id}">Save</button></div>
      <div class="note">No reading now? The drive still counts: the next reading measures all drives since the previous one together.</div>`;
  };
  // READING BEFORE A DRIVE
  R.predip = () => {
    $('#v-tripend').innerHTML = '';
    $('#v-predip').innerHTML = `
      <div class="top back"><button class="iconbtn" aria-label="Back" data-act="go" data-v="helm">${IC.back}</button><div><div class="title">Charge before the drive</div><div class="sub">${dtstr(Date.now())}</div></div></div>
      ${readingCard('Charge reading from the car')}
      <div class="btnrow"><button class="btn" data-act="predip-skip">Skip</button><button class="btn primary" data-act="save-predip">Save &amp; start drive</button></div>
      <div class="note">Marked "before drive" in the log. Then choose the load and the drive starts.</div>`;
  };
  function dipPreview() {
    const pct = Core.num($('#dip-bat')?.value), kwh = Core.litres('bat', pct), lv = Core.levelNow('bat');
    $('#dipL-bat').textContent = isFinite(kwh) ? f(kwh) + ' kWh' : '– kWh';
    let msg = '';
    if (isFinite(kwh) && lv.known) { const ev = Core.eventsFor('bat'), last = ev[ev.length - 1]; msg = 'used ' + f(Core.levelAfter(last) - kwh) + ' kWh since ' + dstr(last.t); }
    else if (!lv.known) msg = 'first reading';
    $('#dipU-bat').textContent = msg;
    const tr = S().trips.find((t) => t.id === params.id);
    if (isFinite(kwh) && lv.known && tr) {
      const ev = Core.eventsFor('bat'), last = ev[ev.length - 1], used = Core.levelAfter(last) - kwh, est = Core.tripFuelTotal(tr);
      $('#dip-sum').innerHTML = `<div class="card dark" style="margin:0"><div class="cardhead"><div><div class="sub">Measured since last reading</div><div class="num" style="font-size:24px">${f(used)} kWh</div></div><div style="text-align:right"><div class="sub">Model predicted this drive</div><div class="num" style="font-size:18px">${f(est)} kWh · ${per100(est / Math.max(0.1, tr.distNm))} kWh/100 km</div></div></div></div>`;
    } else $('#dip-sum').innerHTML = '';
  }

  // DRIVES
  let tripsBuilt = false;
  const tripRate = (t) => { const m = Core.tripMeasured(t); return m ? m.lpnm : Core.tripFuelTotal(t) / Math.max(0.1, t.distNm); };
  R.trips = async () => {
    const v = $('#v-trips'), s = S();
    if (!tripsBuilt) {
      v.innerHTML = `<div class="top"><div><div class="title">Drives</div><div class="sub" id="trips-sub"></div></div><button class="btn small" data-act="manual-new">Add drive by hand</button></div>
        <div class="mapbox" style="height:38vh;min-height:220px"><div id="map-trips" class="map"></div><div class="maplegend" id="trips-legend" style="top:10px;bottom:auto"></div></div>
        <div id="trips-dyn"></div>`;
      getMap('trips'); tripsBuilt = true;
    }
    const trips = s.trips.slice().sort((a, b) => b.start - a.start);
    const vals = trips.map(tripRate), br = breaks(vals);
    const totKm = trips.reduce((a, t) => a + t.distNm, 0), totE = trips.reduce((a, t) => a + Core.tripFuelTotal(t), 0);
    $('#trips-sub').textContent = `${trips.length} drives · ${fi(totKm)} km · ~${fi(totE)} kWh`;
    $('#trips-legend').innerHTML = `<div style="font-weight:600;color:#4F5B66">kWh/100 km</div><div class="row"><span class="sw" style="background:${RAMP[0]}"></span>&lt;${per100(br[0])}<span class="sw" style="background:${RAMP[1]}"></span>–${per100(br[1])}<span class="sw" style="background:${RAMP[2]}"></span>–${per100(br[2])}<span class="sw" style="background:${RAMP[3]}"></span>&gt;${per100(br[2])}</div>`;
    $('#trips-dyn').innerHTML = trips.length ? `<div class="list">${trips.map((t, i) => {
      const m = Core.tripMeasured(t);
      return `<button class="item" data-act="open-trip" data-id="${t.id}"><span class="stripe" style="background:${rampColor(vals[i], br)}"></span>
        <span class="main"><b>${esc(t.name)}</b><span>${dstr(t.start)} · ${f(t.distNm)} km · ${dur(t.hours)}</span></span>
        <span class="right"><span class="num">${per100(vals[i])} kWh/100 km</span><span>${t.manual ? 'by hand' : ''}${t.manual && m ? ' · ' : ''}${m ? (m.shared ? 'shared reading' : 'measured') : t.manual ? '' : 'estimate'}</span></span></button>`;
    }).join('')}</div>` : '<div class="empty">No drives yet. Start one from the Drive screen, or add a drive by hand.</div>';
    const m = maps.trips; m._over.clearLayers();
    const all = [];
    for (let i = 0; i < trips.length; i++) {
      const pts = ((await Core.trackGet(trips[i].id)) || []).map((p) => [p[0], p[1]]);
      if (pts.length > 1) { L.polyline(pts, { color: rampColor(vals[i], br), weight: 3.5 }).on('click', () => go('trip', { id: trips[i].id })).addTo(m._over); all.push(...pts); }
    }
    m.invalidateSize(); if (all.length) m.fitBounds(L.latLngBounds(all), { padding: [20, 20] });
  };

  // ONE DRIVE
  let tripBuilt = false;
  R.trip = async () => {
    const tr = S().trips.find((t) => t.id === params.id); if (!tr) return go('trips');
    const v = $('#v-trip');
    if (!tripBuilt) {
      v.innerHTML = `<div class="top back"><button class="iconbtn" aria-label="Back" data-act="go" data-v="trips">${IC.back}</button><div><div class="title" id="trip-title"></div><div class="sub" id="trip-sub"></div></div></div>
        <div class="mapbox" id="trip-mapbox" style="height:30vh;min-height:200px"><div id="map-trip" class="map"></div></div><div id="trip-dyn"></div>`;
      getMap('trip'); tripBuilt = true;
    }
    const est = Core.tripFuelTotal(tr), meas = Core.tripMeasured(tr), bb = Core.tripBands(tr);
    $('#trip-mapbox').style.display = tr.manual ? 'none' : '';
    $('#trip-title').textContent = tr.name; $('#trip-sub').textContent = dtstr(tr.start) + '–' + tstr(tr.end);
    $('#trip-dyn').innerHTML = `
      ${tr.manual ? `<div class="card"><div class="cardhead"><div><div class="h">Entered by hand</div><div class="sub">average ${fi(tr.distNm / Math.max(0.01, tr.hours))} km/h · no GPS track</div></div><button class="btn small" data-act="manual-edit" data-id="${tr.id}">Edit</button></div></div>` : ''}
      <div class="grid3">
        <div class="tile"><div class="lbl">Distance</div><div class="num mid">${f(tr.distNm)}</div><div class="hint">km</div></div>
        <div class="tile"><div class="lbl">Drive time</div><div class="num mid">${f(tr.hours)}</div><div class="hint">h</div></div>
        <div class="tile dark"><div class="lbl">${meas ? 'Measured' : 'Estimated'}</div><div class="num mid">${per100(meas ? meas.lpnm : est / Math.max(0.1, tr.distNm))}</div><div class="hint">kWh/100 km${meas && meas.shared ? ' · shared reading' : ''}</div></div>
      </div>
      <div class="card"><div class="cardhead"><div class="h">Time at speed</div><div class="sub">est. ${f(est)} kWh</div></div>${bandsHtml(bb)}</div>
      ${tr.gaps ? `<div class="warn">${tr.gaps} GPS gap(s) in this drive were filled with straight lines.</div>` : ''}
      <div class="card"><div class="cardhead"><div class="h">Conditions</div><div class="sub">factor ×${f(Core.condFactor(tr), 2)}</div></div>
        <div class="sub">${!tr.wind ? 'Wind: not recorded' : tr.wind.status === 'ok' ? `Wind ${f(tr.wind.ws)} m/s average · ${tr.wind.head >= 0 ? 'head' : 'tail'} wind ${f(Math.abs(tr.wind.head))} m/s along the route · ${tr.wind.stations} FMI station${tr.wind.stations > 1 ? 's' : ''}` : tr.wind.status === 'pending' ? 'Wind: fetched from FMI when the phone is online' : 'Wind: not available (' + esc(tr.wind.reason || 'no data') + ')'}</div>
        <div class="seg" style="margin:0">${['light', 'normal', 'full'].map((l) => `<button class="${(tr.load || 'normal') === l ? 'on' : ''}" data-act="trip-load" data-id="${tr.id}" data-l="${l}">${LOAD_LABEL[l]} load</button>`).join('')}</div></div>
      <div class="card"><div class="field"><label for="trip-name">Name</label><div class="inbox wide" style="width:60%"><input id="trip-name" value="${esc(tr.name)}"></div></div></div>
      <div class="btnrow"><button class="btn" data-act="del-trip" data-id="${tr.id}">Delete drive</button><button class="btn primary" data-act="rename-trip" data-id="${tr.id}">Save name</button></div>`;
    const m = maps.trip; m._over.clearLayers();
    const pts = (await Core.trackGet(tr.id)) || [];
    if (!tr.manual && pts.length > 1) {
      for (let i = 1; i < pts.length; i++) {
        const v2 = pts[i][3];
        L.polyline([[pts[i - 1][0], pts[i - 1][1]], [pts[i][0], pts[i][1]]], { color: v2 < 30 ? '#9CC3D5' : v2 < 60 ? '#4F8FB0' : v2 < 90 ? '#1F5675' : '#B8470F', weight: 4 }).addTo(m._over);
      }
      m.invalidateSize(); m.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]])), { padding: [20, 20] });
    }
  };

  // DRIVE ENTERED BY HAND
  let mtLoad = 'normal';
  R.tripform = () => {
    const tr = params.id ? S().trips.find((t) => t.id === params.id) : null;
    mtLoad = tr ? tr.load || 'normal' : S().settings.lastLoad || 'normal';
    const h = tr ? Math.floor(tr.hours) : '', mi = tr ? Math.round((tr.hours - Math.floor(tr.hours)) * 60) : '';
    $('#v-tripform').innerHTML = `
      <div class="top back"><button class="iconbtn" aria-label="Back" data-act="go" data-v="${backOf.tripform || 'trips'}">${IC.back}</button><div><div class="title">${tr ? 'Edit drive' : 'Add drive by hand'}</div><div class="sub">For drives logged without GPS</div></div></div>
      <div class="card">
        <div class="field"><label for="mt-start">Start<small>date and time</small></label><div class="inbox wide" style="width:58%"><input type="datetime-local" id="mt-start" data-mt="1" value="${localInput(tr ? tr.start : Date.now() - 3600000)}"></div></div>
        <div class="field"><label for="mt-nm">Distance</label><div class="inbox"><input id="mt-nm" inputmode="decimal" data-mt="1" value="${tr ? dv(+tr.distNm.toFixed(1)) : ''}"><span>km</span></div></div>
        <div class="field"><label for="mt-h">Drive time<small>hours and minutes</small></label><div style="display:flex;gap:6px"><div class="inbox" style="width:76px"><input id="mt-h" inputmode="numeric" data-mt="1" value="${h}"><span>h</span></div><div class="inbox" style="width:84px"><input id="mt-min" inputmode="numeric" data-mt="1" value="${mi}"><span>min</span></div></div></div>
        <div class="sub" id="mt-avg"> </div>
      </div>
      <div class="card"><div class="cardhead"><div class="h">Load</div></div>
        <div class="seg" style="margin:0">${['light', 'normal', 'full'].map((l) => `<button class="${mtLoad === l ? 'on' : ''}" data-act="mt-load" data-l="${l}">${LOAD_LABEL[l]}</button>`).join('')}</div>
      </div>
      <div class="card"><div class="field"><label for="mt-name">Name<small>optional</small></label><div class="inbox wide" style="width:60%"><input id="mt-name" value="${esc(tr ? tr.name : '')}"></div></div></div>
      <div class="btnrow"><button class="btn" data-act="go" data-v="${backOf.tripform || 'trips'}">Cancel</button><button class="btn primary" data-act="mt-save" data-id="${tr ? tr.id : ''}">${tr ? 'Save changes' : 'Add drive'}</button></div>
      <div class="note">The time counts as driving at the average speed. The drive is included in the totals and, when there are charge readings before and after, in the consumption measurement.</div>`;
    mtCalc();
  };
  function mtCalc() {
    const km = Core.num($('#mt-nm').value), h = (Core.num($('#mt-h').value) || 0) + (Core.num($('#mt-min').value) || 0) / 60;
    const ok = km >= 0 && h > 0;
    const bb = { both: new Array(Core.NB).fill(0), bat: new Array(Core.NB).fill(0) }; if (ok) bb.both[Core.bandOf(km / h)] = h;
    $('#mt-avg').textContent = ok ? 'Average speed ' + fi(km / h) + ' km/h · estimated ' + f(Core.tripFuelTotal({ bandsBy: bb, load: mtLoad })) + ' kWh' : ' ';
    return { km, h, ok };
  }

  // CHART helper
  function lineChart(series, opt) {
    const W = 340, H = 230, x0 = 40, x1 = 332, y0 = 200, y1 = 10;
    const X = (v) => x0 + ((v - opt.xMin) / (opt.xMax - opt.xMin)) * (x1 - x0);
    const Y = (v) => y0 - ((Math.min(Math.max(v, opt.yMin), opt.yMax) - opt.yMin) / (opt.yMax - opt.yMin)) * (y0 - y1);
    const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.label)}">
      ${opt.yTicks.map((t) => `<line x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}" stroke="#ECE8DC"/><text x="${x0 - 6}" y="${Y(t) + 4}" font-size="11" fill="#4F5B66" text-anchor="end">${opt.yFmt(t)}</text>`).join('')}
      ${opt.xTicks.map((t) => `<text x="${X(t)}" y="216" font-size="11" fill="#4F5B66" text-anchor="middle">${opt.xFmt(t)}</text>`).join('')}
      <text x="${x1}" y="228" font-size="11" fill="#4F5B66" text-anchor="end">${esc(opt.xUnit)}</text>
      <line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" stroke="#4F5B66"/>
      ${(opt.vlines || []).map((v) => `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${y1}" y2="${y0}" stroke="${v.color}" stroke-width="2" stroke-dasharray="4 3"/>`).join('')}
      ${series.map((s) => (s.band ? `<path d="${s.band.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[2]).toFixed(1)).join(' ')} ${s.band.slice().reverse().map((p) => 'L' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ')} Z" fill="${s.color}" opacity="0.16"/>` : '')).join('')}
      ${series.map((s) => (s.pts && s.pts.length ? `<path d="${path(s.pts)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>` : '')).join('')}
      ${series.map((s) => (s.dots || []).map((d) => `<circle cx="${X(d[0]).toFixed(1)}" cy="${Y(d[1]).toFixed(1)}" r="${d[2] || 4}" fill="${s.dotFill || s.color}" stroke="${s.dotStroke || '#fff'}" stroke-width="1.5"/>`).join('')).join('')}
    </svg>`;
  }
  const niceMax = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v || 1))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
  const SPX = [10, 30, 50, 70, 90, 110, 130, 150];
  const ticks = (yMax) => { const st = [1, 2, 5, 10, 20, 50].find((x) => yMax / x <= 6) || 100; const out = []; for (let v = 0; v <= yMax + 1e-9; v += st) out.push(v); return out; };

  // CONSUMPTION
  let curveMetric = 'km', cpChart = false, consHistOpen = false, cpEdit = null;
  const CF_LABEL = { power: 'Power curve', spline: 'Smooth curve', poly2: 'Polynomial 2', linear: 'Straight lines' };
  const baseLabel = () => { const md = S().cons.base.both; return md ? CF_LABEL[md.m] : 'default formula'; };
  const yval = (kw, v) => (curveMetric === 'km' ? (kw / v) * 100 : kw);   // kWh/100 km or kW
  const yUnit = () => (curveMetric === 'km' ? 'kWh/100 km' : 'kW');
  R.curve = () => {
    const fit = S().fit, C = S().cons;
    const sp = []; for (let b = 2; b <= 15; b++) sp.push(Core.bandMid(b));
    const band = sp.map((v) => { const y = yval(Core.lphTotal('both', v), v), e = yval(Core.lphSigma('both', v), v); return [v, Math.max(0, y - e), y + e]; });
    const hrs = fit.loggedH.both;
    const series = [
      { pts: sp.map((v) => [v, yval(Core.baseLph('both', v), v)]), color: '#9AA5AE', width: 1.5, dash: '5 4' },
      { pts: sp.map((v) => [v, yval(Core.lphTotal('both', v), v)]), color: '#13212F', band,
        dots: sp.map((v) => { const b = Core.bandOf(v); return hrs[b] > 0.02 ? [v, yval(Core.lphTotal('both', v), v), 3 + Math.sqrt(hrs[b]) * 1.5] : null; }).filter(Boolean) }];
    if (C.pts.both.length) series.push({ color: '#13212F', dots: C.pts.both.map((q) => [q.kn, curveMetric === 'km' ? q.lpnm * 100 : q.lpnm * q.kn, 4.5]), dotFill: '#E9B44C', dotStroke: '#13212F' });
    const yMax = niceMax(Math.max(...band.map((p) => p[2])) * 1.05);
    const kmh = Core.live.sogKn;
    const chart = lineChart(series, { label: 'Energy use against speed', xMin: 0, xMax: 150, yMin: 0, yMax, xTicks: SPX, yTicks: ticks(yMax), xFmt: (v) => v, yFmt: (v) => fi(v), xUnit: 'km/h',
      vlines: [{ x: S().settings.minCruiseKn, color: '#C9C1AA' }].concat(kmh >= 3 && kmh <= 150 ? [{ x: kmh, color: '#B8470F' }] : []) });
    const rows = []; for (let b = 1; b < Core.NB - 1; b++) if (hrs[b] > 0.02 || (b >= 2 && b <= 13)) rows.push(b);
    const x = fit.x.bat.both, cols = 'grid-template-columns:1.4fr 1.2fr 1fr .8fr';
    $('#v-curve').innerHTML = `
      <div class="top"><div><div class="title">Consumption</div><div class="sub">${fit.nTrips} drives · ${fit.nIntervals} measured intervals</div></div></div>
      <div class="seg"><button class="${curveMetric === 'km' ? 'on' : ''}" data-act="metric" data-m="km">kWh per 100 km</button><button class="${curveMetric === 'kw' ? 'on' : ''}" data-act="metric" data-m="kw">Power, kW</button></div>
      ${consProposalCard()}
      ${fit.nIntervals === 0 ? '<div class="warn">This is a starting guess, not your car yet. It becomes your curve after a few drives with charge readings before and after.</div>' : ''}
      <div class="card" style="padding:12px 6px 8px 2px">${chart}
        <div class="sub" style="padding-left:30px">grey dashed = base curve · shaded = uncertainty · dot size = hours${C.pts.both.length ? ' · yellow = your estimate points' : ''} · grey line = driving from ${fi(S().settings.minCruiseKn)} km/h</div>
      </div>
      ${consPointsCard()}
      ${ecoHtml(false)}
      ${condHtml()}${accuracyHtml()}
      <div class="card" style="gap:0"><div class="table">
        <div class="tr head" style="${cols}"><div>Speed</div><div>kWh/100 km</div><div>kW</div><div>h</div></div>
        ${rows.map((b) => { const v = Core.bandMid(b); return `<div class="tr ${hrs[b] < 0.1 ? 'dim' : ''}" style="${cols}"><div>${Core.bandLabel(b)}</div><div><b>${f((x[b] / v) * 100)}</b></div><div>${f(x[b])}</div><div>${f(hrs[b])}</div></div>`; }).join('')}
      </div></div>
      ${consHistoryCard()}
      <div class="note">Every pair of charge readings measures the energy used by the drives in between. Grey rows have little data. Uncertain readings count less.</div>`;
  };
  function consPointsCard() {
    const C = S().cons, list = C.pts.both;
    const rows = list.map((q) => `<button class="item" data-act="cp-edit" data-id="${q.id}" style="padding:8px 12px;min-height:0"><span class="main"><b>${fi(q.kn)} km/h = ${f(q.lpnm * 100)} kWh/100 km</b></span><span class="right"><span class="sub">${f(q.lpnm * q.kn)} kW</span></span></button>`).join('');
    const sg = Core.consSuggestions('both');
    let sug = '';
    if (sg.list.length) {
      const best = sg.list[0];
      const sp = []; for (let v = 5; v <= 150; v += 5) sp.push(v);
      const yMax = niceMax(Math.max(...sp.map((v) => Math.max(yval(Core.baseLph('both', v), v), yval(Math.max(Core.floorOf('both'), Core.cfEval(best.model, v)), v)))) * 1.05);
      const chart = lineChart([
        { pts: sp.map((v) => [v, yval(Core.baseLph('both', v), v)]), color: '#9AA5AE', width: 2 },
        { pts: sp.map((v) => [v, yval(Math.max(Core.floorOf('both'), Core.cfEval(best.model, v)), v)]), color: '#E07A2E', width: 2.5 },
        { color: '#13212F', dots: list.map((q) => [q.kn, curveMetric === 'km' ? q.lpnm * 100 : q.lpnm * q.kn, 4]), dotFill: '#E9B44C', dotStroke: '#13212F' }],
        { label: 'Suggested fit', xMin: 0, xMax: 150, yMin: 0, yMax, xTicks: SPX, yTicks: ticks(yMax), xFmt: (v) => v, yFmt: (v) => fi(v), xUnit: 'km/h' });
      sug = `<div class="cardhead" style="padding-top:10px"><div class="h">Suggested fits</div><div class="sub">${sg.loo ? 'error when a point is left out' : 'error at your points'}</div></div>
        ${sg.loo ? '' : '<div class="sub">With 2–3 points the fits cannot be compared reliably yet; the first is the most natural shape for energy use. Add points to compare them by error.</div>'}
        ${sg.list.map((x, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #ECE8DC"><div><b>${CF_LABEL[x.m]}${i === 0 ? ' ★' : ''}</b><div class="sub">${x.m === 'power' ? 'exponent ' + f(x.model.n, 2) + ' · ' : ''}±${f(x.rms * 100)} kWh/100 km</div></div><button class="btn small ${i === 0 ? 'primary' : ''}" data-act="cp-use" data-i="${i}">Use</button></div>`).join('')}
        ${cpChart ? `<div style="padding:6px 0 0 0">${chart}</div><div class="sub" style="padding-left:30px"><b style="color:#E07A2E">orange = best suggestion</b> · grey = base in use · dots = your points</div>` : ''}
        <div class="btnrow" style="padding:6px 0 0 0"><button class="btn small grow" data-act="cp-chart">${cpChart ? 'Hide chart' : 'Show chart'}</button></div>`;
    } else if (list.length < 2) sug = '<div class="sub" style="padding-top:8px">Add at least two points to get suggested fits.</div>';
    return `<div class="card" id="cp-card" style="gap:0"><div class="cardhead"><div class="h">Estimate points</div><div class="sub">whole car</div></div>
      <div class="sub" style="padding-bottom:4px">Your estimate of energy use at a few speeds. The fit you choose is the base curve; measured drives correct it. Tap a point to correct or delete it.</div>
      <div class="cardhead" style="padding-top:4px"><div class="h" style="font-size:14px">Auxiliary load</div><div class="sub">heating, electronics — also when standing</div></div>
      <div class="field" style="padding:4px 0"><label for="idle-bat">Power</label><div class="inbox"><input id="idle-bat" inputmode="decimal" value="${dv(C.idle.bat)}"><span>kW</span></div></div>
      <div class="btnrow" style="padding:4px 0 10px 0"><button class="btn small grow" data-act="idle-save">Save auxiliary load</button></div>
      <div class="cardhead" style="padding-bottom:4px"><div class="h" style="font-size:14px">Points</div></div>
      ${rows || '<div class="sub">No estimate points yet.</div>'}
      <div class="btnrow" style="padding:6px 0 0 0"><button class="btn small grow dark" data-act="cp-add">Add point</button></div>
      <div class="cardhead" style="padding-top:10px;align-items:center"><div class="sub">Base: <b style="color:#13212F">${baseLabel()}</b></div>${C.base.both ? '<button class="btn small" data-act="cp-default">Use default formula</button>' : ''}</div>
      ${sug}</div>`;
  }
  function consHistoryCard() {
    const h = S().cons.history; if (!h.length) return '';
    return `<div class="card" style="gap:0"><button class="cardhead fold" data-act="cons-hist"><span class="h">Earlier consumption curves</span><span class="sub">${consHistOpen ? 'Hide' : 'Show ' + h.length}</span></button>${consHistOpen ? h.map((x, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #ECE8DC;gap:8px"><span class="sub">${dtstr(x.t)} · ${esc(x.note || '')}</span><button class="btn small" data-act="cons-restore" data-i="${i}">Restore</button></div>`).join('') : ''}</div>`;
  }
  function consProposalCard() {
    const p = S().cons.pending; if (!p) return '';
    return `<div class="card dark"><div class="cardhead"><div><div class="h">Improved consumption curve available</div><div class="sub">From ${p.n} measured intervals · error ${f(p.errBefore)} → ${f(p.errAfter)} kWh</div></div><button class="btn small" style="background:#fff;color:#13212F" data-act="cons-review">Review</button></div></div>`;
  }
  function consProposalSheet() {
    const C = S().cons, p = C.pending; if (!p) return;
    const a = C.active, kms = [50, 80, 100, 120];
    const tot = (x, v) => Core.lphX(x, 'bat', 'both', v);
    const pc = (v) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(0) + ' %';
    const cRow = (label, u, v) => `<div class="tr" style="grid-template-columns:2fr 1fr 1fr"><div>${label}</div><div>${pc(u)}</div><div><b>${pc(v)}</b></div></div>`;
    const sp = []; for (let v = 10; v <= 150; v += 5) sp.push(v);
    const yMax = niceMax(Math.max(...sp.map((v) => Math.max(tot(a.x, v), tot(p.x, v)) / v * 100)) * 1.05);
    const chart = lineChart([
      { pts: sp.map((v) => [v, Core.baseLph('both', v) / v * 100]), color: '#9AA5AE', width: 1.5, dash: '5 4' },
      { pts: sp.map((v) => [v, tot(a.x, v) / v * 100]), color: '#13212F' },
      { pts: sp.map((v) => [v, tot(p.x, v) / v * 100]), color: '#E07A2E', width: 2.5, dash: '7 4' }],
      { label: 'Current and proposed consumption curve', xMin: 0, xMax: 150, yMin: 0, yMax, xTicks: SPX, yTicks: ticks(yMax), xFmt: (v) => v, yFmt: (v) => fi(v), xUnit: 'km/h' });
    sheet(`<h3>Improved consumption curve</h3><p>Fitted to ${p.n} measured intervals. Nothing changes until you accept it.</p>
      <div class="card" style="gap:6px"><div class="cardhead"><div class="sub">Error vs measured intervals</div><div class="num" style="font-size:20px">${f(p.errBefore)} → ${f(p.errAfter)} kWh</div></div>
        <div class="table"><div class="tr head" style="grid-template-columns:1.2fr repeat(4,1fr)"><div>kWh/100 km</div>${kms.map((v) => `<div>${v} km/h</div>`).join('')}</div>
        <div class="tr" style="grid-template-columns:1.2fr repeat(4,1fr)"><div>Now</div>${kms.map((v) => `<div>${f(tot(a.x, v) / v * 100)}</div>`).join('')}</div>
        <div class="tr" style="grid-template-columns:1.2fr repeat(4,1fr)"><div>New</div>${kms.map((v) => `<div><b>${f(tot(p.x, v) / v * 100)}</b></div>`).join('')}</div></div>
        <div class="table" style="padding-top:6px"><div class="tr head" style="grid-template-columns:2fr 1fr 1fr"><div>Conditions effect</div><div>Now</div><div>New</div></div>
        ${cRow('Head wind 5 m/s', a.cond.a * 5, p.cond.a * 5)}${cRow('Light load', a.cond.bL, p.cond.bL)}${cRow('Full load', a.cond.bF, p.cond.bF)}</div>
        <div class="table" style="padding-top:6px"><div class="tr" style="grid-template-columns:2fr 1fr 1fr"><div>Auxiliary load, kW</div><div>${f(a.x.bat.both[0])}</div><div><b>${f(p.x.bat.both[0])}</b></div></div></div>
      </div>
      <div class="card" style="padding:8px 4px 4px 0"><div class="sub" style="padding-left:12px">kWh/100 km: solid = current · orange dashed = proposed · grey dashed = base</div>${chart}</div>
      <div class="btnrow"><button class="btn grow" data-act="cons-reject">Keep current</button><button class="btn primary" data-act="cons-accept">Use new curve</button></div>`);
  }
  function consPointSheet(q) {
    sheet(`<h3>Estimate point</h3><p>Your estimate of energy use at one speed.</p>
      <div class="card"><div class="field"><label for="cp-kn">Speed</label><div class="inbox"><input id="cp-kn" inputmode="decimal" value="${q ? dv(q.kn) : ''}"><span>km/h</span></div></div>
      <div class="field"><label for="cp-l">Energy use</label><div class="inbox"><input id="cp-l" inputmode="decimal" value="${q ? dv(+(q.lpnm * 100).toFixed(2)) : ''}"><span>kWh/100 km</span></div></div></div>
      <div class="btnrow"><button class="btn grow" data-act="sheet-close">Cancel</button>${q ? '<button class="btn" data-act="cp-del">Delete</button>' : ''}<button class="btn primary" data-act="cp-save">${q ? 'Save' : 'Add'}</button></div>`);
    if (!q) setTimeout(() => { const i = $('#cp-kn'); if (i) i.focus(); }, 100);
  }
  function condHtml() {
    const fit = S().fit, k = fit.cond || {}, sd = fit.condSd || [], n = fit.condN || { wind: 0, light: 0, full: 0 };
    const pc = (v) => (isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(0) + ' %' : '–');
    const row = (label, v, e, cnt) => `<div class="tr" style="grid-template-columns:2fr 1fr 1fr"><div>${label}</div><div style="text-align:right"><b>${cnt ? pc(v) : '–'}</b></div><div style="text-align:right" class="sub">${cnt ? '±' + Math.abs(e * 100).toFixed(0) + ' %' : 'no data yet'}</div></div>`;
    return `<div class="card" style="gap:0"><div class="cardhead"><div class="h">Conditions effect</div><div class="sub">learned from your drives</div></div><div class="table">
      ${row('Head wind 5 m/s', (k.a || 0) * 5, (sd[0] || 0) * 5, n.wind)}
      ${row('Wind 10 m/s', (k.c || 0) * 6, (sd[1] || 0) * 6, n.wind)}
      ${row('Light load', k.bL || 0, sd[2] || 0, n.light)}
      ${row('Full load', k.bF || 0, sd[3] || 0, n.full)}
    </div><div class="sub" style="padding-top:6px">vs calm weather and normal load · ${n.wind} measured intervals with FMI wind</div></div>`;
  }
  function accuracyHtml() {
    const acc = (S().accuracy || []).slice().sort((a, b) => a.t - b.t);
    if (!acc.length) return '<div class="card"><div class="cardhead"><div class="h">Prediction accuracy</div></div><div class="sub">Each charge reading is compared with what the app predicted before it. The first comparison appears after your second reading with drives in between.</div></div>';
    const err = (a) => ((a.pred - a.meas) / Math.max(0.5, Math.abs(a.meas))) * 100;
    const recent = acc.slice(-8).filter((a) => !a.rough).map((a) => Math.abs(err(a)));
    const typ = recent.length ? Core.median(recent) : NaN;
    const tMin = acc[0].t, tMax = Math.max(acc[acc.length - 1].t, tMin + 86400000);
    const yMax = Math.max(10, niceMax(Math.max(...acc.map((a) => Math.abs(err(a)))) * 1.1));
    const chart = lineChart([{ color: '#1F5675', dots: acc.map((a) => [a.t, err(a), 4]), dotFill: '#1F5675' }],
      { label: 'Prediction error over time', xMin: tMin, xMax: tMax, yMin: -yMax, yMax, xTicks: [tMin, tMax], yTicks: [-yMax, -yMax / 2, 0, yMax / 2, yMax], xFmt: (v) => dstr(v), yFmt: (v) => fi(v) + '%', xUnit: '' });
    return `<div class="card" style="padding:12px 6px 8px 2px"><div class="cardhead" style="padding-left:10px"><div><div class="h">Prediction accuracy</div><div class="sub">predicted before each reading vs measured</div></div><div style="text-align:right;padding-right:6px"><div class="num" style="font-size:22px">${isFinite(typ) ? '±' + fi(typ) + ' %' : '–'}</div><div class="sub">typical now</div></div></div>
      ${chart}<div class="sub" style="padding-left:30px">above 0 = app predicted too much</div>
      <div class="table" style="padding:6px 6px 0 10px"><div class="tr head" style="grid-template-columns:1fr 1fr 1fr .8fr"><div>Date</div><div>Predicted</div><div>Measured</div><div>Diff</div></div>
      ${acc.slice(-6).reverse().map((a) => `<div class="tr" style="grid-template-columns:1fr 1fr 1fr .8fr"><div>${dstr(a.t)}</div><div>${f(a.pred)} kWh</div><div>${f(a.meas)} kWh</div><div>${pm(err(a))}%</div></div>`).join('')}</div></div>`;
  }

  // LOG
  let logPeriod = new Date().getFullYear();
  const LOG_N = 10;
  let logAll = { refuel: false, dip: false };
  function logRange() { return logPeriod === 'all' ? [0, Infinity] : [new Date(logPeriod, 0, 1).getTime(), new Date(logPeriod + 1, 0, 1).getTime()]; }
  const srcText = (src) => (!src ? '' : src.type === 'home' ? 'Home' : (src.name || 'Charging station'));
  R.log = () => {
    const [from, to] = logRange(), s = S(), sm = Core.summary(from, to);
    const years = Core.seasons(), thisYear = new Date().getFullYear();
    const charges = s.events.filter((e) => e.type === 'refuel' && e.t >= from && e.t < to).sort((a, b) => b.t - a.t);
    const reads = s.events.filter((e) => e.type === 'dip' && e.t >= from && e.t < to).sort((a, b) => b.t - a.t);
    const cols = 'grid-template-columns:1.2fr 1fr 1fr 1fr 1fr';
    $('#v-log').innerHTML = `
      <div class="top"><div><div class="title">Log</div><div class="sub">${logPeriod === 'all' ? 'All years' : 'Year ' + logPeriod}</div></div></div>
      <div class="chips">${years.map((y) => `<button class="chip ${logPeriod === y ? 'on' : ''}" data-act="log-period" data-p="${y}">${y === thisYear ? 'This year' : y}</button>`).join('')}<button class="chip ${logPeriod === 'all' ? 'on' : ''}" data-act="log-period" data-p="all">All</button></div>
      <div class="card" style="gap:0"><div class="cardhead"><div class="h">Summary</div><div class="sub">${sm.trips} drives</div></div>
        <div class="table">
          <div class="tr head" style="${cols}"><div></div><div>km</div><div>h</div><div>kWh</div><div>€</div></div>
          <div class="tr" style="${cols}"><div><b>Car</b></div><div>${fi(sm.boat.nm)}</div><div>${f(sm.boat.h)}</div><div>${sm.boat.Lest > 0.5 ? '~' : ''}${fi(sm.boat.L)}</div><div>${fi(sm.boat.eur)}</div></div>
          <div class="tr" style="${cols}"><div>per 100 km</div><div></div><div></div><div>${sm.boat.nm > 0 ? f((sm.boat.L / sm.boat.nm) * 100) : '–'}</div><div>${sm.boat.nm > 0 ? f((sm.boat.eur / sm.boat.nm) * 100, 2) : '–'}</div></div>
        </div>
        <div class="sub" style="padding-top:6px">kWh = energy used from the battery · € = charging costs in the period (energy from the charger)</div>
        ${sm.boat.Lest > 0.5 ? `<div class="sub">~ includes ${f(sm.boat.Lest)} kWh estimated from the consumption model (drives without readings).</div>` : ''}
        <div class="btnrow" style="padding:8px 0 0 0"><button class="btn small grow" data-act="go" data-v="trips">Drives</button><button class="btn small grow" data-act="manual-new">Add drive by hand</button></div>
      </div>
      <div class="card" style="gap:0"><div class="cardhead"><div class="h">Charging log</div><div class="sub">${charges.length} charges</div></div>
        <div class="sub" style="padding-bottom:6px">${f(sm.boat.bought)} kWh from the charger · ${f(sm.boat.eur, 2)} €</div>
        ${charges.length ? (logAll.refuel ? charges : charges.slice(0, LOG_N)).map((e) => { const pr = isFinite(e.price) && e.price > 0, kwh = e.pumped; return `<div class="logrow"><div class="main"><b>${dstr(e.t)}${srcText(e.src) ? ' · ' + esc(srcText(e.src)) : ''}</b><span>${fi(e.mm)} → ${fi(e.afterMm)} %${pr ? ' · ' + f(e.price, 3) + ' €/kWh' : ''}</span></div><div class="right"><span class="num">${isFinite(kwh) && kwh > 0 ? f(kwh) + ' kWh' : '–'}</span><span>${pr && kwh > 0 ? f(kwh * e.price, 2) + ' €' : 'no price'}</span></div><button class="iconbtn" aria-label="Delete charge" data-act="del-event" data-id="${e.id}">${IC.x}</button></div>`; }).join('') : '<div class="sub">No charges in this period.</div>'}
        ${charges.length > LOG_N ? `<div class="btnrow" style="padding:6px 0 0 0"><button class="btn small grow" data-act="log-all" data-k="refuel">${logAll.refuel ? 'Show fewer' : 'Show all ' + charges.length}</button></div>` : ''}
        <div class="btnrow" style="padding:8px 0 0 0"><button class="btn small grow primary" data-act="go" data-v="refuel">Log charging</button></div>
      </div>
      <div class="card" style="gap:0"><div class="cardhead"><div class="h">Charge readings</div><div class="sub">${reads.length} readings</div></div>
        ${reads.length ? (logAll.dip ? reads : reads.slice(0, LOG_N)).map((e) => `<div class="logrow"><div class="main"><b>${dtstr(e.t)}</b><span>${KIND_LABEL[Core.dipKind(e)]}${e.rough ? ' · uncertain' : ''}</span></div><div class="right"><span class="num">${f(e.mm, 0)} %</span><span>${f(Core.litres('bat', e.mm))} kWh</span></div><button class="iconbtn" aria-label="Delete reading" data-act="del-event" data-id="${e.id}">${IC.x}</button></div>`).join('') : '<div class="sub">No readings in this period.</div>'}
        ${reads.length > LOG_N ? `<div class="btnrow" style="padding:6px 0 0 0"><button class="btn small grow" data-act="log-all" data-k="dip">${logAll.dip ? 'Show fewer' : 'Show all ' + reads.length}</button></div>` : ''}
        <div class="btnrow" style="padding:8px 0 0 0"><button class="btn small grow dark" data-act="dip-sheet">Log charge</button></div>
      </div>`;
  };

  // BATTERY
  R.tanks = () => {
    const t = BAT(), u = Core.usable('bat'), lv = Core.levelNow('bat'), cs = Core.chargeStats();
    $('#v-tanks').innerHTML = `
      <div class="top"><div><div class="title">Battery</div><div class="sub">Charge % → kWh</div></div><button class="btn small" data-act="edit-tank">Edit battery</button></div>
      <div class="grid3">
        <div class="tile"><div class="lbl">Now, est.</div><div class="num mid">${lv.known ? fi(pctOf(u.L)) : '–'} <span class="unit">%</span></div><div class="hint">${lv.known ? 'reading ' + fi(lv.since.type === 'refuel' ? lv.since.afterMm : lv.since.mm) + ' % · ' + dstr(lv.since.t) : 'no reading'}</div></div>
        <div class="tile dark"><div class="lbl">Energy</div><div class="num mid">${lv.known ? fi(u.L) : '–'} <span class="unit">kWh</span></div><div class="hint">of ${f(t.capacity)} kWh usable</div></div>
        <div class="tile"><div class="lbl">For range</div><div class="num mid">${lv.known ? fi(u.usable) : '–'} <span class="unit">kWh</span></div><div class="hint">above ${fi(t.pipeMm)} %</div></div>
      </div>
      ${lv.known ? `<div class="card" style="gap:6px">${batBar()}</div>` : ''}
      <div class="btnrow"><button class="btn dark grow" data-act="dip-sheet">Log charge</button><button class="btn primary" data-act="go" data-v="refuel">Log charging</button></div>
      <div class="card"><div class="cardhead"><div class="h">Charging losses</div><div class="sub">${cs.n ? cs.n + ' charges' : 'no data yet'}</div></div>
        ${cs.n ? `<div class="cardhead"><div class="num" style="font-size:28px">${f(cs.loss * 100)} %</div><div class="sub" style="text-align:right">${f(cs.fromCharger)} kWh from the charger<br>${f(cs.intoBattery)} kWh into the battery</div></div>` : ''}
        <div class="sub">Energy from the charger compared with the charge % change × capacity. Charges of at least 10 % with the charger kWh count. A loss near 0 % or negative suggests the capacity is set too high.</div></div>
      <div class="btnrow"><button class="btn small grow" data-act="go" data-v="log">Charging log and readings</button></div>`;
  };

  // CHARGING
  let refuelSrc = 'home', refuelStName = '';
  function stationNames() {
    const fx = Core.live.fix, list = allStations().map((st) => ({ n: st.name, d: fx ? Core.haversine([fx.lat, fx.lon], [st.lat, st.lon]) : 0 }));
    list.sort((x, y) => x.d - y.d || x.n.localeCompare(y.n));
    const used = S().events.filter((e) => e.src && e.src.name).sort((x, y) => y.t - x.t).map((e) => e.src.name);
    return [...new Set(used.slice(0, 5).concat(list.slice(0, 40).map((x) => x.n)))].filter(Boolean);
  }
  R.refuel = () => {
    const s = S();
    const price = refuelSrc === 'home' ? s.settings.homePrice : s.settings.price;
    $('#v-refuel').innerHTML = `
      <div class="top back"><button class="iconbtn" aria-label="Back" data-act="go" data-v="${backOf.refuel || 'tanks'}">${IC.back}</button><div><div class="title">Log charging</div><div class="sub">Charge before and after, energy and price</div></div></div>
      <div class="card">
        <div class="field"><label for="rb">Charge before<small id="rbL">from the car</small></label><div class="inbox"><input id="rb" inputmode="decimal" data-rf="1"><span>%</span></div></div>
        <div class="field"><label for="ra">Charge after<small id="raL">from the car</small></label><div class="inbox"><input id="ra" inputmode="decimal" data-rf="1"><span>%</span></div></div>
        <div class="field"><label for="rp">Energy from the charger<small>from the charger or the app; optional</small></label><div class="inbox"><input id="rp" inputmode="decimal" data-rf="1"><span>kWh</span></div></div>
        ${roughBox('rf-rough')}
      </div>
      <div class="card" id="rf-check"><div class="sub">Enter the charge before and after.</div></div>
      <div class="card"><div class="cardhead"><div class="h">Where</div></div>
        <div class="seg" style="margin:0"><button class="${refuelSrc === 'home' ? 'on' : ''}" data-act="refuel-src" data-s="home">Home</button><button class="${refuelSrc === 'station' ? 'on' : ''}" data-act="refuel-src" data-s="station">Charging station</button></div>
        ${refuelSrc === 'station' ? `<div class="field"><label for="rst">Station<small>optional — pick or type</small></label><div class="inbox wide" style="width:60%"><input id="rst" list="rst-list" value="${esc(refuelStName)}" autocomplete="off"></div></div>
        <datalist id="rst-list">${stationNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>` : ''}
      </div>
      <div class="card"><div class="field"><label for="rprice">Price<small>${refuelSrc === 'home' ? 'electricity incl. transfer' : 'paid at the station'}</small></label><div class="inbox"><input id="rprice" inputmode="decimal" value="${esc(dv(Core.num(price)))}" data-rf="1"><span>€/kWh</span></div></div><div class="sub" id="rtotal"></div>
        ${whenField('rwhen')}</div>
      <div class="btnrow"><button class="btn primary" data-act="save-refuel">Save charging</button></div>`;
  };
  function refuelCalc() {
    const b = Core.num($('#rb').value), a = Core.num($('#ra').value), kwh = Core.num($('#rp').value);
    const bE = Core.litres('bat', b), aE = Core.litres('bat', a);
    $('#rbL').textContent = isFinite(bE) ? '= ' + f(bE) + ' kWh' : 'from the car';
    $('#raL').textContent = isFinite(aE) ? '= ' + f(aE) + ' kWh' : 'from the car';
    const ok = b >= 0 && b <= 100 && a > b && a <= 100;
    if (ok) {
      const into = aE - bE;
      $('#rf-check').innerHTML = `<div class="cardhead"><div><div class="sub">Into the battery</div><div class="num" style="font-size:22px">${f(into)} kWh</div></div><div><div class="sub">From the charger</div><div class="num" style="font-size:22px">${isFinite(kwh) ? f(kwh) + ' kWh' : '–'}</div></div><div style="text-align:right"><div class="sub">Loss</div><div class="num" style="font-size:22px">${isFinite(kwh) && into > 0 ? f((kwh / into - 1) * 100) + ' %' : '–'}</div></div></div>`;
    } else $('#rf-check').innerHTML = '<div class="sub">Enter the charge before and after.</div>';
    const price = Core.num($('#rprice').value);
    $('#rtotal').textContent = isFinite(price) && isFinite(kwh) ? 'Total ' + f(price * kwh, 2) + ' €' : '';
    return { b, a, kwh, price, ok };
  }

  // RANGE & CHARGING STATIONS
  let rangeBuilt = false, rangeMode = 'round', rangeSpeed = 'now', rangeCtx = null, lastTap = null, openStation = null, stationLayer = null;
  R.range = () => {
    const v = $('#v-range');
    if (!rangeBuilt) {
      v.innerHTML = `<div class="top back"><button class="iconbtn" aria-label="Back" data-act="go" data-v="helm">${IC.back}</button><div><div class="title">Range &amp; charging stations</div><div class="sub" id="range-sub"></div></div></div>
        <div id="range-dyn"></div>
        <div class="mapbox" style="height:40vh;min-height:240px;margin-top:10px"><div id="map-range" class="map"></div></div>
        <div class="note" id="range-status"></div>
        <div id="range-route"></div>
        <div class="card" id="range-opts" style="gap:10px"><div class="cardhead"><div class="h">Settings</div></div>
          <div class="optrow"><span class="lbl">Speed</span><div class="chips" id="range-spd"></div></div>
          <div class="optrow"><span class="lbl">Distance</span><div class="chips" id="range-seg"></div></div>
          <div class="optrow"><span class="lbl">Start</span><div class="chips" id="range-start"></div></div>
        </div>
        <div class="card"><div class="cardhead"><div class="h">Charging stations</div><div class="sub" id="ch-count"></div></div>
          <div class="sub">From OpenStreetMap, within 100 km of the start point. Tap a pin for the distance and the energy needed.</div>
          <button class="btn small dark" data-act="fuel-update">Load charging stations</button><div class="sub" id="fuel-out"></div></div>
        <div class="note" id="range-note"></div>`;
      getMap('range').on('click', rangeTap).on('contextmenu', (ev) => setRangeStart(ev.latlng.lat, ev.latlng.lng)); rangeBuilt = true;
    }
    renderRange();
  };
  function renderRange() {
    const s = S(), lv = Core.live, eco = Core.economy();
    const nowK = lv.sogAvg >= 20 && lv.sogAvg <= 160 ? lv.sogAvg : 80;
    const ecoK = eco ? eco.best.kn : 50;
    const kmh = rangeSpeed === 'eco' ? ecoK : nowK, alt = rangeSpeed === 'eco' ? nowK : ecoK;
    const r = Core.range('both', kmh), r2 = Core.range('both', alt);
    const u = Core.usable('bat');
    $('#range-sub').textContent = u.known ? f(u.usable) + ' kWh above ' + fi(BAT().pipeMm) + ' %' : 'no charge reading yet';
    const nmv = (x) => (x ? (rangeMode === 'round' ? x.round : x.oneWay) : NaN);
    $('#range-seg').innerHTML = `<button class="chip ${rangeMode === 'round' ? 'on' : ''}" data-act="range-mode" data-m="round">Out &amp; back</button><button class="chip ${rangeMode === 'one' ? 'on' : ''}" data-act="range-mode" data-m="one">One way</button>`;
    $('#range-spd').innerHTML = `<button class="chip ${rangeSpeed === 'now' ? 'on' : ''}" data-act="range-speed" data-s="now">${fi(nowK)} km/h ${lv.sogAvg >= 20 ? '(now)' : ''}</button><button class="chip ${rangeSpeed === 'eco' ? 'on' : ''}" data-act="range-speed" data-s="eco">${fi(ecoK)} km/h (economy)</button>`;
    $('#range-dyn').innerHTML = !r ? '<div class="warn">Log the charge % once (Battery → Log charge) to see the range.</div>' : `
      <div class="card dark" style="margin-top:4px"><div class="cardhead"><div><div class="sub">${rangeMode === 'round' ? 'Turn back before' : 'Reach'}</div><div class="num" style="font-size:30px">${fi(nmv(r))} km</div><div class="sub">${per100(r.lpnm)} kWh/100 km at ${fi(kmh)} km/h</div></div><div style="text-align:right;max-width:170px" class="sub">down to ${fi(BAT().pipeMm)} % charge<br>Dashed: ${fi(nmv(r2))} km at ${fi(alt)} km/h</div></div></div>`;
    $('#range-note').textContent = 'Range is shown as a straight-line circle; roads are longer, typically by 20–40 %. Planning aid only — cold, wind, hills and heating add to consumption.';
    const m = maps.range; m._over.clearLayers(); clearRoute();
    const man = s.settings.rangeStart;
    const c = man ? [man.lat, man.lon] : lv.fix ? [lv.fix.lat, lv.fix.lon] : null;
    $('#range-start').innerHTML = `<button class="chip ${man ? '' : 'on'}" data-act="range-start-gps">${lv.fix ? 'Car (GPS)' : 'GPS – no position'}</button>
      ${man ? '<button class="chip on" data-act="range-start-gps">Chosen point ✕</button>' : '<span class="sub" style="align-self:center">or long-press the map</span>'}`;
    rangeCtx = { r, kmh, c };
    drawStations();
    $('#ch-count').textContent = allStations().length + ' on the map';
    if (!r) return;
    if (!c) { setRangeStatus('No GPS position. Long-press the map (or tap it and choose "Start from here") to set a start point.'); return; }
    L.marker(c, { icon: man ? startIcon() : carIcon(lv.fix ? lv.fix.heading || 0 : 0), interactive: false, zIndexOffset: 1000 }).addTo(m._over);
    L.circle(c, { radius: nmv(r) * 1000, color: '#1F5675', weight: 2, fillColor: '#1F5675', fillOpacity: 0.14, interactive: false }).addTo(m._over);
    if (r2) L.circle(c, { radius: nmv(r2) * 1000, color: '#1F5675', weight: 2, dashArray: '6 5', fill: false, interactive: false }).addTo(m._over);
    m.invalidateSize(); m.fitBounds(L.latLng(c).toBounds(Math.max(nmv(r), nmv(r2) || 0) * 1000 * 2.1));
    setRangeStatus('Straight-line range. Tap a charging station for the distance.');
  }
  // charging stations: OpenStreetMap (fetched on this phone) + your own
  let chargers = [];
  const allStations = () => chargers.concat(S().userStations || []);
  const lastPrice = (id) => { const p = (S().stationPrices || {})[id]; return p && p.length ? p[p.length - 1] : null; };
  const ageTxt = (t) => { const d = (Date.now() - t) / 86400000; return d < 1 ? 'today' : d < 14 ? Math.round(d) + ' d ago' : d < 60 ? Math.round(d / 7) + ' wk ago' : Math.round(d / 30) + ' mo ago'; };
  const PLUG = '<path d="M9 3v4M15 3v4M7 7h10v3a5 5 0 0 1-10 0V7ZM12 15v3a3 3 0 0 0 3 3h1" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  function plugIcon(st, zoom) {
    const fill = st.user ? '#1F5675' : '#0E6B3A';
    if (zoom < 11) return L.divIcon({ className: 'fuel-pin', iconSize: [22, 22], iconAnchor: [11, 11], html: `<svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))"><circle cx="12" cy="12" r="10.5" fill="${fill}" stroke="#fff" stroke-width="2"/><g transform="translate(3.6 3.4) scale(.7)">${PLUG}</g></svg>` });
    const lp = lastPrice(st.id), w = 64, h = lp ? 66 : 46;
    const tag = lp ? `<div style="margin-bottom:1px;padding:1px 6px;border-radius:9px;background:#fff;border:1.5px solid ${fill};color:${fill};font:700 12px 'Barlow Semi Condensed',Barlow,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">${f(lp.price, 2)} €</div>` : '';
    return L.divIcon({ className: 'fuel-pin', iconSize: [w, h], iconAnchor: [w / 2, h - 1], html: `<div style="display:flex;flex-direction:column;align-items:center;width:${w}px">${tag}
      <svg width="36" height="46" viewBox="0 0 36 46" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M18 45C18 45 3 28.5 3 17.5a15 15 0 0 1 30 0C33 28.5 18 45 18 45Z" fill="${fill}" stroke="#fff" stroke-width="2.5"/><g transform="translate(6.5 5)">${PLUG}</g></svg></div>` });
  }
  function drawStations() {
    const m = maps.range; if (!m) return;
    if (stationLayer) m.removeLayer(stationLayer);
    stationLayer = L.layerGroup().addTo(m);
    const z = m.getZoom();
    allStations().forEach((st) => { const mk = L.marker([st.lat, st.lon], { icon: plugIcon(st, z), title: st.name, zIndexOffset: 500 }).on('click', () => stationCard(st)).addTo(stationLayer); mk._st = st; });
    if (!m._fuelZoom) { m._fuelZoom = true; m.on('zoomend', () => { if (!stationLayer) return; const zz = m.getZoom(); stationLayer.eachLayer((mk) => mk._st && mk.setIcon(plugIcon(mk._st, zz))); }); }
  }
  function stationCard(st) {
    openStation = st; clearRoute();
    const lp = lastPrice(st.id);
    const info = [st.operator && st.operator !== st.name ? esc(st.operator) : '', st.sockets ? esc(st.sockets) : '', st.capacity ? esc(st.capacity) + ' places' : ''].filter(Boolean).join(' · ');
    const ctx = rangeCtx;
    let dist = '';
    if (ctx && ctx.c) {
      const km = Core.haversine(ctx.c, [st.lat, st.lon]) / 1000;
      const ok = ctx.r && km <= ctx.r.oneWay;
      dist = `<div class="sub">${f(km)} km straight line${ctx.r ? ` · ${f(km * ctx.r.lpnm)} kWh at ${fi(ctx.kmh)} km/h · <b style="color:${ok ? '#1F6E5A' : '#A63A2A'}">${ok ? 'reachable' : 'beyond range'}</b>` : ''}</div>`;
    }
    $('#range-route').innerHTML = `<div class="card"><div class="cardhead"><div><div class="h">${esc(st.name)}</div><div class="sub">${info || (st.user ? 'your own station' : 'OpenStreetMap')}</div></div>
      <div style="text-align:right"><div class="num" style="font-size:20px">${lp ? f(lp.price, 3) + ' €/kWh' : '–'}</div><div class="sub">${lp ? (lp.src === 'refuel' ? 'you paid ' : 'seen ') + ageTxt(lp.t) : 'no price yet'}</div></div></div>
      ${dist}<div class="btnrow" style="padding:0"><button class="btn small grow" data-act="price-seen">Log price seen</button>${st.user ? '<button class="btn small" data-act="del-station">Delete</button>' : ''}</div></div>`;
  }
  const startIcon = () => L.divIcon({ className: 'boat-icon', iconSize: [22, 22], iconAnchor: [11, 11], html: '<svg width="22" height="22" viewBox="-11 -11 22 22"><circle r="8" fill="#B8470F" stroke="#fff" stroke-width="3"/><circle r="2.5" fill="#fff"/></svg>' });
  function setRangeStart(lat, lon) { S().settings.rangeStart = { lat: +lat.toFixed(5), lon: +lon.toFixed(5) }; Core.save(); toast('Start point set'); renderRange(); }
  function setRangeStatus(t) { const el = $('#range-status'); if (el) el.textContent = t; }
  function clearRoute() { const el = $('#range-route'); if (el) el.innerHTML = ''; }
  function rangeTap(ev) {
    lastTap = ev.latlng; openStation = null;
    const ctx = rangeCtx;
    const km = ctx && ctx.c ? Core.haversine(ctx.c, [ev.latlng.lat, ev.latlng.lng]) / 1000 : NaN;
    $('#range-route').innerHTML = `<div class="card">${isFinite(km) ? `<div class="sub">${f(km)} km straight line from the start${ctx.r ? ' · ' + f(km * ctx.r.lpnm) + ' kWh' : ''}</div>` : ''}
      <div class="btnrow" style="padding:0"><button class="btn small grow" data-act="range-start-here">Start from here</button><button class="btn small grow" data-act="add-station">Add charging station here</button></div></div>`;
  }
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  async function fetchChargers(lat, lon, onStep) {
    const q = `[out:json][timeout:60];(node["amenity"="charging_station"](around:100000,${lat.toFixed(4)},${lon.toFixed(4)});way["amenity"="charging_station"](around:100000,${lat.toFixed(4)},${lon.toFixed(4)}););out center tags;`;
    let lastErr = null;
    for (const u of OVERPASS) {
      try {
        onStep && onStep('Asking OpenStreetMap…');
        const r = await fetch(u, { method: 'POST', body: new URLSearchParams({ data: q }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const list = (j.elements || []).map((e) => {
          const t = e.tags || {}, la = e.lat ?? (e.center && e.center.lat), lo = e.lon ?? (e.center && e.center.lon);
          if (!isFinite(la) || !isFinite(lo)) return null;
          const sockets = Object.keys(t).filter((k) => /^socket:[^:]+$/.test(k) && t[k] !== 'no' && t[k] !== '0').map((k) => k.slice(7).replace(/_/g, ' ') + (/^\d+$/.test(t[k]) ? ' ×' + t[k] : '')).join(', ');
          return { id: 'osm:' + e.type[0] + e.id, lat: +la.toFixed(6), lon: +lo.toFixed(6), name: t.name || t.operator || t.brand || 'Charging station', operator: t.operator || t.brand || '', sockets, capacity: t.capacity || '' };
        }).filter(Boolean);
        await Core.kvSet('chargers', { built: new Date().toISOString(), center: [lat, lon], source: 'OpenStreetMap contributors (ODbL)', list });
        return list;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no answer');
  }

  // SETTINGS
  R.more = () => {
    const s = S().settings;
    $('#v-more').innerHTML = `
      <div class="top"><div><div class="title">Settings</div><div class="sub">Maps, consumption, backup</div></div></div>
      <div class="card" data-noi18n><div class="cardhead"><div class="h">Kieli / Language</div></div>
        <div class="seg" style="margin:0"><button class="${I18N.lang === 'fi' ? 'on' : ''}" data-act="lang" data-l="fi">Suomi</button><button class="${I18N.lang === 'en' ? 'on' : ''}" data-act="lang" data-l="en">English</button></div></div>
      <div class="card"><div class="cardhead"><div class="h">Base map</div></div>
        <div class="seg" style="margin:0"><button class="${s.base !== 'nls' ? 'on' : ''}" data-act="base" data-b="osm">OSM</button><button class="${s.base === 'nls' ? 'on' : ''}" data-act="base" data-b="nls">NLS</button></div>
        <div class="field"><label for="nlskey">NLS API key<small>free from Maanmittauslaitos; needed for the NLS map</small></label></div>
        <div class="inbox wide"><input id="nlskey" value="${esc(s.nlsKey)}" placeholder="paste key" data-act="nlskey"></div>
      </div>
      <div class="card"><div class="cardhead"><div class="h">Battery</div></div>
        <div class="field"><label for="cap">Usable capacity</label><div class="inbox"><input id="cap" inputmode="decimal" value="${dv(BAT().capacity)}" data-act="setbat" data-k="capacity"><span>kWh</span></div></div>
        <div class="field"><label for="minsoc">Lowest charge for range<small>range is counted down to this</small></label><div class="inbox"><input id="minsoc" inputmode="decimal" value="${dv(BAT().pipeMm)}" data-act="setbat" data-k="pipeMm"><span>%</span></div></div>
      </div>
      <div class="card"><div class="cardhead"><div class="h">Economy</div></div>
        <div class="field"><label for="mincruise">Driving from<small>slower = town traffic, never proposed</small></label><div class="inbox"><input id="mincruise" inputmode="decimal" value="${dv(s.minCruiseKn)}" data-act="setnum" data-k="minCruiseKn"><span>km/h</span></div></div>
        <div class="field"><label for="effm">Efficient speed margin<small>max extra energy per km vs the best</small></label><div class="inbox"><input id="effm" inputmode="decimal" value="${dv(s.effMarginPct)}" data-act="setnum" data-k="effMarginPct"><span>%</span></div></div>
      </div>
      <div class="card"><div class="cardhead"><div class="h">Charging stations</div><div class="sub">${allStations().length} on the map${(S().userStations || []).length ? ' (' + S().userStations.length + ' your own)' : ''}</div></div>
        <div class="sub">Fetched from OpenStreetMap on this phone, within 100 km of your position (or the range start point).</div>
        <button class="btn small" data-act="fuel-update">Load charging stations</button><div class="sub" id="fuel-out"></div>
      </div>
      <div class="card"><div class="cardhead"><div class="h">Backup</div></div>
        <div class="sub">All data lives on this phone only. Export a backup now and then.</div>
        <div class="btnrow" style="padding:0"><button class="btn small grow" data-act="export">Export backup</button><label class="btn small grow" for="importf">Import backup</label><input type="file" id="importf" accept="application/json,.json" style="display:none" data-act="import"></div>
      </div>
      <div class="btnrow"><button class="btn small grow" data-act="check-update">Check for app update</button></div>
      <div class="note">EV log 1.0.1 — test version of the Popcorn Fuel Log · Charging stations © OpenStreetMap contributors · Wind data © Finnish Meteorological Institute (CC BY 4.0) · map © OpenStreetMap contributors, background map © Maanmittauslaitos.</div>`;
  };

  function loadSheet() {
    const last = S().settings.lastLoad || 'normal';
    sheet(`<h3>Load</h3><p>Helps the app learn how load changes consumption.</p><div class="list">${['light', 'normal', 'full'].map((l) => `<button class="item" data-act="start-with-load" data-l="${l}"><span class="main"><b>${LOAD_LABEL[l]}</b><span>${LOAD_HINT[l]}</span></span>${l === last ? '<span class="right"><span class="sub">last used</span></span>' : ''}</button>`).join('')}</div>`);
  }

  // ---------- actions ----------
  let dipKindSel = 'check';
  const readingPct = (id) => { const v = Core.num($('#' + id).value); return v >= 0 && v <= 100 ? v : NaN; };
  const A = {
    'go': (el) => go(el.dataset.v),
    'sheet-close': closeSheet,
    'confirm-ok': () => { closeSheet(); if (confirmFn) confirmFn(); confirmFn = null; },
    'center': () => { follow = true; const lv = Core.live; if (lv.fix) maps.helm.setView([lv.fix.lat, lv.fix.lon], Math.max(maps.helm.getZoom(), 13)); else toast('Waiting for GPS…'); },
    'start-trip': () => {
      if (!('geolocation' in navigator)) return toast('This browser has no GPS access.');
      if (Core.needsPreDip()) {
        const first = !S().events.length;
        sheet(`<h3>Log the charge before the drive?</h3><p>${first ? 'No charge reading yet. A reading before the drive lets the app follow the battery and measure consumption.' : 'No charge reading since the last drive. A reading now makes the next consumption measurement exact.'}</p>
          <div class="btnrow"><button class="btn grow" data-act="predip-skip">Skip</button><button class="btn primary" data-act="predip">Log charge</button></div>`);
        return;
      }
      loadSheet();
    },
    'predip-skip': () => { if (current !== 'helm') go('helm'); loadSheet(); },
    'predip': () => { closeSheet(); go('predip'); },
    'start-with-load': async (el) => {
      closeSheet();
      if (current !== 'helm') go('helm');
      await Core.startTrip('both', el.dataset.l); follow = true; trackCache = []; helmTrack.setLatLngs([]); renderHelmDyn(); toast('Drive started');
    },
    'load-sheet': () => sheet(`<h3>Load</h3><div class="list">${['light', 'normal', 'full'].map((l) => `<button class="item" data-act="set-load" data-l="${l}"><span class="main"><b>${LOAD_LABEL[l]}</b><span>${LOAD_HINT[l]}</span></span>${S().active && S().active.load === l ? '<span class="right"><span class="num">✓</span></span>' : ''}</button>`).join('')}</div>`),
    'set-load': (el) => { if (S().active) { S().active.load = el.dataset.l; S().settings.lastLoad = el.dataset.l; Core.save(); } closeSheet(); renderHelmDyn(); },
    'trip-load': (el) => { Core.setTripLoad(el.dataset.id, el.dataset.l); toast('Load updated'); R.trip(); },
    'pause': () => { Core.setPaused(!S().active.paused); renderHelmDyn(); },
    'end-trip': () => confirmSheet('End this drive?', 'The drive is saved and you can log the charge next.', 'End drive', async () => { const tr = await Core.stopTrip(); go('tripend', { id: tr.id }); setTimeout(() => Wind.processPending(windDone), 2000); }),
    'save-dips': () => {
      const p = readingPct('dip-bat');
      if (isFinite(p)) Core.addDip('bat', p, $('#dip-rough').checked, undefined, 'after');
      toast(isFinite(p) ? 'Reading saved. Consumption updated.' : 'Drive saved without a reading.');
      go('trips');
    },
    'save-predip': () => {
      const p = readingPct('dip-bat');
      if (!isFinite(p)) return toast('Enter the charge % (0–100), or skip');
      Core.addDip('bat', p, $('#dip-rough').checked, undefined, 'before');
      toast('Reading saved'); go('helm'); loadSheet();
    },
    'manual-new': () => go('tripform', {}),
    'manual-edit': (el) => go('tripform', { id: el.dataset.id }),
    'mt-load': (el) => { mtLoad = el.dataset.l; segOn(el); mtCalc(); },
    'mt-save': (el) => {
      const c = mtCalc(), start = readWhen('mt-start');
      if (!c.ok || !(c.km <= 2000) || c.h > 48) return toast('Enter the distance and the drive time');
      if (c.km / c.h > 200) return toast('Average speed over 200 km/h — check the values');
      if (start + c.h * 3600000 > Date.now() + 300000) return toast('The drive cannot end in the future');
      const o = { start, hours: c.h, distNm: c.km, mode: 'both', load: mtLoad, name: $('#mt-name').value.trim() };
      const tr = el.dataset.id ? Core.updateManualTrip(el.dataset.id, o) : Core.addManualTrip(o);
      toast(el.dataset.id ? 'Saved' : 'Drive added');
      go('trip', { id: tr.id });
    },
    'open-trip': (el) => go('trip', { id: el.dataset.id }),
    'rename-trip': (el) => { const tr = S().trips.find((t) => t.id === el.dataset.id); tr.name = $('#trip-name').value.trim() || tr.name; Core.save(); toast('Saved'); R.trip(); },
    'del-trip': (el) => confirmSheet('Delete this drive?', 'Its track and speed log are removed. This cannot be undone.', 'Delete', async () => { await Core.deleteTrip(el.dataset.id); go('trips'); }),
    'cp-add': () => { cpEdit = null; consPointSheet(null); },
    'cp-edit': (el) => { const fq = Core.findConsPoint(el.dataset.id); if (!fq) return; cpEdit = fq.q.id; consPointSheet(fq.q); },
    'cp-save': () => {
      const v = Core.num($('#cp-kn').value), e = Core.num($('#cp-l').value);
      if (!(v >= 5 && v <= 160)) return toast('Enter a speed between 5 and 160 km/h');
      if (!(e >= 5 && e <= 60)) return toast('Enter the energy use in kWh/100 km (5–60)');
      if (S().cons.pts.both.some((q) => q.id !== cpEdit && Math.abs(q.kn - v) < 0.5)) return toast('There is already a point at this speed');
      if (cpEdit) Core.updateConsPoint(cpEdit, v, e / 100); else Core.addConsPoint('both', v, e / 100);
      closeSheet(); R.curve();
    },
    'cp-del': () => confirmSheet('Delete this point?', 'Suggested fits are recalculated without it. The curve in use does not change until you use a new fit.', 'Delete', () => { Core.deleteConsPoint(cpEdit); R.curve(); }),
    'cp-use': (el) => { const x = Core.consSuggestions('both').list[+el.dataset.i]; if (!x) return; Core.setConsBase('both', x.model); toast('Base curve updated'); R.curve(); },
    'cp-default': () => confirmSheet('Use the default formula?', 'The base curve goes back to the default formula. Your points stay in the list.', 'Use default', () => { Core.setConsBase('both', null); R.curve(); }),
    'idle-save': () => {
      const v = Core.num($('#idle-bat').value);
      if (!(v >= 0.1 && v <= 8)) return toast('Enter the auxiliary load between 0.1 and 8 kW');
      if (Math.abs(v - S().cons.idle.bat) < 1e-9) return toast('No change');
      Core.setConsIdle({ bat: v }); toast('Auxiliary load saved'); R.curve();
    },
    'cp-chart': () => { cpChart = !cpChart; R.curve(); },
    'cons-review': () => consProposalSheet(),
    'cons-accept': () => { if (Core.acceptCons()) toast('New consumption curve in use'); closeSheet(); R.curve(); },
    'cons-reject': () => { Core.rejectCons(); closeSheet(); toast('Kept the current curve'); R.curve(); },
    'cons-hist': () => { consHistOpen = !consHistOpen; R.curve(); },
    'cons-restore': (el) => confirmSheet('Restore this curve?', 'The current curve is kept in the list so you can switch back.', 'Restore', () => { Core.restoreCons(+el.dataset.i); R.curve(); }),
    'metric': (el) => { curveMetric = el.dataset.m; R.curve(); },
    'dip-sheet': () => {
      const lastEnd = S().trips.reduce((m, tr) => Math.max(m, tr.end || 0), 0);
      dipKindSel = Date.now() - lastEnd < 6 * 3600000 && Core.needsPreDip() ? 'after' : 'check';
      sheet(`<h3>Log charge</h3><p>Charge % from the car's display.</p>
        <div class="card"><div class="field"><label for="sd-bat" style="font-weight:600">Charge<small id="sdL-bat"> </small></label><div class="inbox"><input id="sd-bat" inputmode="decimal" data-sdip="bat"><span>%</span></div></div>
        ${roughBox('sd-rough')}
        <div class="seg" style="margin:0">${[['after', 'After drive'], ['before', 'Before drive'], ['check', 'Separate']].map(([k, l]) => `<button class="${dipKindSel === k ? 'on' : ''}" data-act="sd-kind" data-k="${k}">${l}</button>`).join('')}</div>
        ${whenField('sd-when')}</div>
        <div class="btnrow"><button class="btn grow" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="save-dip">Save reading</button></div>`);
      setTimeout(() => { const i = $('#sd-bat'); if (i) i.focus(); }, 100);
    },
    'sd-kind': (el) => { dipKindSel = el.dataset.k; segOn(el); },
    'save-dip': () => {
      const t0 = readWhen('sd-when');
      if (t0 > Date.now() + 300000) return toast('The time is in the future');
      const p = readingPct('sd-bat'); if (!isFinite(p)) return toast('Enter the charge % (0–100)');
      Core.addDip('bat', p, $('#sd-rough').checked, t0, dipKindSel);
      closeSheet(); toast('Reading saved');
      (R[current] || R.tanks)();
    },
    'edit-tank': () => {
      const t = BAT();
      sheet(`<h3>Battery</h3>
        <div class="card">
          <div class="field"><label for="et-cap">Usable capacity<small>kWh between 0 and 100 %</small></label><div class="inbox"><input id="et-cap" inputmode="decimal" value="${dv(t.capacity)}"><span>kWh</span></div></div>
          <div class="field"><label for="et-min">Lowest charge for range</label><div class="inbox"><input id="et-min" inputmode="decimal" value="${dv(t.pipeMm)}"><span>%</span></div></div>
        </div>
        <div class="btnrow"><button class="btn grow" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="save-tank">Save</button></div>`);
    },
    'save-tank': () => {
      const t = BAT(), cap = Core.num($('#et-cap').value), mn = Core.num($('#et-min').value);
      if (!(cap >= 5 && cap <= 250)) return toast('Enter the capacity in kWh (5–250)');
      if (!(mn >= 0 && mn <= 50)) return toast('Enter the lowest charge in % (0–50)');
      t.capacity = cap; t.pipeMm = mn; Core.refit(); Core.save(); closeSheet(); toast('Battery saved'); R.tanks();
    },
    'del-event': (el) => confirmSheet('Delete this entry?', 'Battery level and consumption are recalculated without it.', 'Delete', () => { Core.deleteEvent(el.dataset.id); (R[current] || R.tanks)(); }),
    'log-all': (el) => { logAll[el.dataset.k] = !logAll[el.dataset.k]; R.log(); },
    'log-period': (el) => { logPeriod = el.dataset.p === 'all' ? 'all' : +el.dataset.p; R.log(); },
    'refuel-src': (el) => {
      const i = $('#rst'); if (i) refuelStName = i.value;
      const keep = {}; document.querySelectorAll('#v-refuel input').forEach((x) => { if (x.id !== 'rprice') keep[x.id] = x.type === 'checkbox' ? x.checked : x.value; });
      refuelSrc = el.dataset.s; R.refuel();
      Object.entries(keep).forEach(([k, v]) => { const x = document.getElementById(k); if (x) { if (x.type === 'checkbox') x.checked = v; else x.value = v; } });
      refuelCalc();
    },
    'save-refuel': () => {
      const c = refuelCalc();
      if (!c.ok) return toast('Enter the charge before and after (after must be higher)');
      const stName = refuelSrc === 'station' && $('#rst') ? $('#rst').value.trim() : '';
      const tw = readWhen('rwhen'); if (tw > Date.now() + 300000) return toast('The time is in the future');
      Core.addRefuel([{ tank: 'bat', beforeMm: c.b, pumped: isFinite(c.kwh) ? c.kwh : 0, afterMm: c.a, brim: false }], c.price, $('#rf-rough').checked, tw, { type: refuelSrc, name: stName });
      refuelStName = stName;
      if (isFinite(c.price)) {
        S().settings[refuelSrc === 'home' ? 'homePrice' : 'price'] = String(c.price); Core.save();
        const st = stName && allStations().find((x) => x.name.toLowerCase() === stName.toLowerCase());
        if (st) Core.addStationPrice(st.id, c.price, 'refuel', c.kwh, tw);
      }
      go(backOf.refuel || 'tanks'); toast('Charging saved');
    },
    'range-mode': (el) => { rangeMode = el.dataset.m; renderRange(); },
    'range-speed': (el) => { rangeSpeed = el.dataset.s; renderRange(); },
    'range-start-here': () => { if (lastTap) setRangeStart(lastTap.lat, lastTap.lng); },
    'range-start-gps': () => { S().settings.rangeStart = null; Core.save(); toast('Start from the car GPS position'); renderRange(); },
    'check-update': async () => {
      try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); toast('Checking… the app reloads if a new version is found'); setTimeout(() => location.reload(), 2500); }
      catch (e) { toast('Update check failed: ' + e.message); }
    },
    'price-seen': () => {
      const st = openStation; if (!st) return;
      sheet(`<h3>Price at ${esc(st.name)}</h3><p>Charging price you saw, for example in the operator's app.</p><div class="card"><div class="field"><label for="ps-p">Price</label><div class="inbox"><input id="ps-p" inputmode="decimal"><span>€/kWh</span></div></div></div><div class="btnrow"><button class="btn grow" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="save-price-seen">Save</button></div>`);
      setTimeout(() => $('#ps-p').focus(), 100);
    },
    'save-price-seen': () => { const p = Core.num($('#ps-p').value); if (!(p > 0 && p < 3)) return toast('Enter the price in €/kWh'); Core.addStationPrice(openStation.id, p, 'seen'); closeSheet(); toast('Price saved'); drawStations(); stationCard(openStation); },
    'add-station': () => {
      if (!lastTap) return;
      sheet(`<h3>Add charging station</h3><p>A charging station missing from the map, at the point you tapped.</p><div class="card"><div class="field"><label for="ns-n">Name</label><div class="inbox wide" style="width:60%"><input id="ns-n" placeholder="e.g. Work garage"></div></div></div><div class="btnrow"><button class="btn grow" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="save-station">Add</button></div>`);
    },
    'save-station': () => { const st = Core.addUserStation(lastTap.lat, lastTap.lng, $('#ns-n').value.trim() || 'My charging station'); closeSheet(); toast('Charging station added'); drawStations(); stationCard(st); },
    'del-station': () => confirmSheet('Delete this station?', 'Its price history is kept in backups but the marker is removed.', 'Delete', () => { Core.deleteUserStation(openStation.id); openStation = null; clearRoute(); drawStations(); }),
    'fuel-update': async () => {
      const man = S().settings.rangeStart, fx = Core.live.fix;
      const c = man ? [man.lat, man.lon] : fx ? [fx.lat, fx.lon] : null;
      const out = $('#fuel-out'), btns = document.querySelectorAll('[data-act=fuel-update]');
      if (!c) { if (out) out.textContent = 'No position yet: allow GPS or set a start point on the range map.'; return; }
      btns.forEach((b) => { b.disabled = true; });
      try {
        chargers = await fetchChargers(c[0], c[1], (t) => { if (out) out.textContent = t; });
        const msg = chargers.length + ' charging stations within 100 km';
        if (out) out.textContent = msg; toast(msg, 4000);
        if (current === 'range') renderRange(); else if (current === 'more') R.more();
      } catch (e) { if (out) out.textContent = 'Could not reach OpenStreetMap (' + e.message + '). Try again later.'; }
      btns.forEach((b) => { b.disabled = false; });
    },
    'lang': (el) => { if (el.dataset.l === I18N.lang) return; I18N.setLang(el.dataset.l); setTimeout(() => location.reload(), 150); },
    'base': (el) => { S().settings.base = el.dataset.b; if (el.dataset.b === 'nls' && !S().settings.nlsKey) toast('Add your NLS API key below; until then OSM is shown.'); Core.save(); refreshBaseLayers(); R.more(); },
    'export': async () => {
      const data = await Core.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'ev-log-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('#nav button'); if (nav) return go(nav.dataset.go);
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.dip) dipPreview();
    if (el.dataset.rf) refuelCalc();
    if (el.dataset.mt) mtCalc();
    if (el.dataset.sdip) { const v = Core.num(el.value), kwh = Core.litres('bat', v); $('#sdL-bat').textContent = isFinite(kwh) && v <= 100 ? '= ' + f(kwh) + ' kWh' : ' '; }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target, act = el.dataset.act, s = S().settings;
    if (el.dataset.rf) refuelCalc();
    if (act === 'nlskey') { s.nlsKey = el.value.trim(); Core.save(); refreshBaseLayers(); }
    if (act === 'setnum') {
      const v = Core.num(el.value), k = el.dataset.k;
      const ok = { minCruiseKn: v >= 5 && v <= 120, effMarginPct: v >= 0 && v <= 100 }[k];
      if (ok) { s[k] = v; Core.save(); toast('Saved'); } else { toast('Value out of range'); el.value = dv(s[k]); }
    }
    if (act === 'setbat') {
      const v = Core.num(el.value), k = el.dataset.k, t = BAT();
      const ok = { capacity: v >= 5 && v <= 250, pipeMm: v >= 0 && v <= 50 }[k];
      if (ok) { t[k] = v; Core.refit(); Core.save(); toast('Saved'); } else { toast('Value out of range'); el.value = dv(t[k]); }
    }
    if (act === 'import' && el.files[0]) {
      try { await Core.importAll(JSON.parse(await el.files[0].text())); toast('Backup imported'); go('helm'); }
      catch (err) { toast('Import failed: ' + err.message); }
    }
  });

  // ---------- start ----------
  const windDone = () => { if (current === 'trip' || current === 'curve' || current === 'trips') R[current](); };
  window.addEventListener('online', () => Wind.processPending(windDone));
  Core.init().then(async () => {
    try { const c = await Core.kvGet('chargers'); if (c && c.list) chargers = c.list; } catch (e) { /* none yet */ }
    setTimeout(() => Wind.processPending(windDone), 3000);
    go('helm');
    Core.resumeIfActive();
    if (!S().active && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((p) => { Core.live.fix = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now(), heading: 0 }; Core.live.acc = p.coords.accuracy; updateHelmLive(); }, () => {}, { enableHighAccuracy: true, timeout: 20000 });
    }
  });
  if ('serviceWorker' in navigator) {
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !(S() && S().active)) { reloaded = true; location.reload(); } });
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {}));
  }
  window.FuelLogDebug = { go, Core, Wind, consProposalSheet, maps };
})();

// site.js — one site in detail: status now, skyline, 30-day timeline, windows, ECO-PATH, months.
import {
  initShell, onTime, setTime, state, $, $$, esc, href, siteParams, siteKey, siteFromKey, store, toast, addCompare, loadSites,
  fmtLat, fmtLon, fmtCoords, fmtNum, fmtPct, fmtLong, fmtDur, fmtDeg, fmtDate, fmtDayHM, fmtDay, MONTHS, DAY,
  yearSummary, shortName, timelineSVG, timelinePick, refreshNav, dirWord,
} from './ui.js';
import { statusAt, series, summarize, earthWindows, yearStats, nearestEarthSpot, VISIBLE } from './engine.js';
import { angularRadius, compass, R_EARTH_KM } from './geo.js';
import { HOUR } from './data.js';

await initShell('site');

// ------------------------------------------------------------------ which site
const q = new URLSearchParams(location.search);
const last = store.get('lastSite', null);
let key = q.get('id') ?? (q.get('lat') && q.get('lon') ? `custom:${(+q.get('lat')).toFixed(4)},${(+q.get('lon')).toFixed(4)}` : null);
if (!key && last) key = last.id ?? `custom:${(+last.lat).toFixed(4)},${(+last.lon).toFixed(4)}`;
key ??= 'shackleton_rim_sr1';
const site = await siteFromKey(key);
if (!site) { $('#title').textContent = 'Site not found'; throw new Error('no site'); }
store.set('lastSite', siteParams(site)); refreshNav();
document.title = `${shortName(site)} · LUMINALUNA`;
$('#title').textContent = site.custom ? 'Custom point' : shortName(site);
$('#subtitle').innerHTML = `${fmtCoords(site)}${site.terrain ? ` · ground ${fmtNum(site.ground_m)} m` : ' · flat horizon (no terrain data here)'}${site.custom ? ' · <span class="earth">240 m terrain</span>' : ''}`;

const all = await loadSites();
const groups = [['artemis3', 'Artemis III candidates'], ['reference', 'Reference points'], ['china', 'China'], ['clps', 'NASA CLPS'], ['india', 'India'], ['japan', 'Japan'], ['apollo', 'Apollo']];
$('#pick').innerHTML = (site.custom ? `<option value="" selected>Custom point</option>` : '') + groups.map(([g, l]) =>
  `<optgroup label="${l}">${all.filter(s => s.group === g).map(s => `<option value="${s.id}" ${s.id === site.id ? 'selected' : ''}>${esc(shortName(s))}</option>`).join('')}</optgroup>`).join('');
$('#pick').onchange = e => { if (e.target.value) location.href = href('site', { id: e.target.value }); };
$('#addcmp').onclick = () => { const l = addCompare(siteKey(site)); toast(`Added. Compare has ${l.length} site${l.length > 1 ? 's' : ''}. <a href="${href('compare')}" style="color:var(--earth);text-decoration:underline">Open compare →</a>`, 3500); };

// ------------------------------------------------------------------ status cards
function statusCard(isSun, b) {
  const col = isSun ? 'var(--sun)' : 'var(--earth)';
  const word = isSun ? (b.visible ? 'Sunlit' : 'In shadow') : (b.visible ? 'Earth in view' : 'Earth hidden');
  const nextWord = isSun ? (b.visible ? 'Sunset' : 'Sunrise') : (b.visible ? 'Earthset' : 'Earthrise');
  const rad = isSun ? 0.267 : 0.95;
  const body = isSun ? 'The Sun' : 'Earth';
  const plain = b.margin > rad ? `${body} is ${b.margin.toFixed(1)}° above the hills.`
    : b.margin < -rad ? `${body} is ${(-b.margin).toFixed(1)}° behind the hills${b.el < 0 ? ' (below the horizon)' : ''}.`
      : `${body} is grazing the hilltops: ${Math.round(b.frac * 100)}% of its disk shows.`;
  const why = isSun ? (b.visible ? 'Solar panels are producing power.' : 'No solar power: batteries only.')
    : (b.visible ? 'Direct radio link to Earth is possible.' : 'No direct radio link: a relay satellite is needed.');
  const count = b.nextChange ? `${nextWord} in <span>${fmtDur(b.nextChange - state.t)}</span>` : `No ${nextWord.toLowerCase()} before the data ends`;
  return `
    <div class="status">
      <div class="dot" style="background:${b.visible ? col : 'transparent'};border:2px solid ${col};opacity:${b.visible ? 1 : .7}">${b.visible ? '' : `<span class="ms" style="font-size:20px;color:${col}">${isSun ? 'dark_mode' : 'public'}</span>`}</div>
      <div style="flex:1;min-width:0">
        <div class="big" style="color:${b.visible ? col : 'var(--text)'}">${word}</div>
        <div class="count">${count}</div>
        <div class="muted mono" style="font-size:12px">${b.nextChange ? fmtDate(b.nextChange) : ''}</div>
        <p style="margin:12px 0 0">${plain} <span class="muted">${why}</span></p>
        <div class="x-only" style="margin-top:12px">
          <div class="kv"><span>Elevation / azimuth</span><span>${fmtDeg(b.el)} / ${b.az.toFixed(1)}° (${compass(b.az)})</span></div>
          <div class="kv"><span>Skyline at that azimuth</span><span>${fmtDeg(b.hz)}</span></div>
          <div class="kv"><span>Margin above skyline</span><span class="${b.margin > 0 ? 'ok' : 'bad'}">${fmtDeg(b.margin)}</span></div>
          <div class="kv"><span>Disk visible (radius ${rad}°)</span><span>${(b.frac * 100).toFixed(0)}%</span></div>
          ${isSun ? `<div class="kv"><span>Power, 1 m² tracking panel</span><span>${fmtNum(now?.power ?? 0)} W</span></div>` : ''}
        </div>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ skyline panorama
function drawPanorama(st, win) {
  const el = $('#pano'), W = Math.max(500, el.clientWidth), H = state.expert ? 300 : 260;
  const L = 34, R = 22, T = 12, B = 26;
  const sky = site.skyline;
  // elevation range: skyline + paths
  let lo = Infinity, hi = -Infinity;
  for (const v of sky) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let k = 0; k < win.n; k++) if (win.valid[k]) {
    hi = Math.max(hi, win.sunEl[k], win.earthEl[k]); lo = Math.min(lo, Math.max(win.sunEl[k], hi - 30), Math.max(win.earthEl[k], hi - 30));
  }
  hi = Math.min(hi, 25) + 1.2; lo = Math.max(lo, -12) - 1;
  const X = az => L + az / 360 * (W - L - R), Y = e => T + (hi - e) / (hi - lo) * (H - T - B);
  const pxDeg = (H - T - B) / (hi - lo);
  let g = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="#070E1B"/>`;
  // grid
  const stepE = hi - lo > 12 ? 5 : hi - lo > 5 ? 2 : 1;
  for (let e = Math.ceil(lo / stepE) * stepE; e <= hi; e += stepE)
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(e)}" y2="${Y(e)}" stroke="${e === 0 ? '#2F415C' : '#162234'}" ${e === 0 ? '' : 'stroke-dasharray="2 4"'}/><text x="${L - 6}" y="${Y(e) + 3}" fill="#5E6E85" font-size="10" font-family="IBM Plex Mono" text-anchor="end">${e}°</text>`;
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].forEach((c, i) => {
    g += `<line x1="${X(i * 45)}" x2="${X(i * 45)}" y1="${T}" y2="${H - B}" stroke="#162234"/><text x="${X(i * 45)}" y="${H - 8}" fill="#94A3B8" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">${c}${state.expert ? ' ' + i * 45 + '°' : ''}</text>`;
  });
  // paths (every 2 h), split at the 0/360 wrap
  const path = (azA, elA, visA, color) => {
    let d = '', prev = null, dots = '';
    for (let k = 0; k < win.n; k += 2) {
      if (!win.valid[k]) { prev = null; continue; }
      const x = X(azA[k]), y = Y(elA[k]);
      d += (prev == null || Math.abs(azA[k] - prev) > 180) ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`;
      prev = azA[k];
      if (k % 12 === 0) dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="${visA[k] >= VISIBLE ? color : '#070E1B'}" stroke="${color}" stroke-width=".8"/>`;
    }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="1.2"/>${dots}`;
  };
  g += path(win.sunAz, win.sunEl, win.sunFrac, '#F2B544') + path(win.earthAz, win.earthEl, win.earthFrac, '#57B8E8');
  // bodies now (drawn before terrain so the hills hide them)
  const disk = (b, rDeg, color, label) => {
    const r = Math.max(4, rDeg * pxDeg);
    return `<circle cx="${X(b.az)}" cy="${Y(b.el)}" r="${r}" fill="${color}"/><circle cx="${X(b.az)}" cy="${Y(b.el)}" r="${r + 5}" fill="none" stroke="${color}" stroke-opacity=".35"/>
      <text x="${X(b.az) + r + 7}" y="${Y(b.el) - 6}" fill="${color}" font-size="11" font-family="IBM Plex Mono">${label}</text>`;
  // (hidden bodies get their label later, on top of the terrain)
  };
  g += disk(st.earth, angularRadius(R_EARTH_KM, 384400), '#57B8E8', st.earth.visible ? 'Earth' : '') + disk(st.sun, 0.267, '#F2B544', st.sun.visible ? 'Sun' : '');
  // terrain
  let t = `M${L},${H - B}`;
  for (let i = 0; i <= sky.length; i++) t += `L${X(i * 0.5).toFixed(1)},${Y(Math.max(lo, sky[i % sky.length])).toFixed(1)}`;
  t += `L${W - R},${H - B}Z`;
  g += `<defs><linearGradient id="terr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A3A52"/><stop offset="1" stop-color="#111B2B"/></linearGradient></defs>
    <path d="${t}" fill="url(#terr)" stroke="#57B8E8" stroke-opacity=".7" stroke-width="1"/>`;
  // a body hidden behind the hills: dashed outline on top of the terrain
  for (const [b, rDeg, c, name] of [[st.sun, 0.267, '#F2B544', 'Sun'], [st.earth, angularRadius(R_EARTH_KM, 384400), '#57B8E8', 'Earth']])
    if (!b.visible && b.el >= lo) g += `<circle cx="${X(b.az)}" cy="${Y(b.el)}" r="${Math.max(4, rDeg * pxDeg)}" fill="none" stroke="${c}" stroke-dasharray="3 3" stroke-width="1.4"/>
      <text x="${X(b.az) + Math.max(4, rDeg * pxDeg) + 7}" y="${Y(b.el) + 4}" fill="${c}" font-size="11" font-family="IBM Plex Mono">${name} (hidden)</text>`;
  // horizon tick under each body
  for (const [b, c] of [[st.sun, '#F2B544'], [st.earth, '#57B8E8']])
    g += `<line x1="${X(b.az)}" x2="${X(b.az)}" y1="${Y(b.hz)}" y2="${H - B}" stroke="${c}" stroke-opacity=".5" stroke-dasharray="2 3"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
  $('#panoNote').textContent = `Skyline from ${site.custom ? 'NASA LOLA terrain at 240 m per pixel, computed in your browser' : 'NASA LOLA terrain at 80 m per pixel'}, 720 directions, terrain up to 300 km away, observer 2 m above ground. Vertical scale is stretched: 1° up = ${(pxDeg / ((W - L - R) / 360)).toFixed(0)}× 1° across.`;
}

// ------------------------------------------------------------------ timeline, windows, months, stats
const WIN_DAYS = 30;
const winStart = t => Math.max(state.range.startMs, Math.min(state.range.endMs - WIN_DAYS * DAY, Math.floor(t / DAY) * DAY - 14 * DAY));
let now = null;

function drawTimeline(win) {
  const el = $('#tl');
  const m = summarize(win);
  el.innerHTML = timelineSVG([{ bandLabels: [`Sunlight ${fmtPct(m.sunPct, 0)}`, `Earth ${fmtPct(m.earthPct, 0)}`], series: win }],
    { t0: win.t0, hours: win.n, now: state.t, width: el.clientWidth, labelW: 110, showPower: state.expert });
  const svg = el.firstElementChild;
  svg.onclick = ev => { const t = timelinePick(svg, ev, win.t0, win.n); if (t != null) { stop(); setTime(t); } };
  $('#tlRange').textContent = `(${fmtDay(win.t0)} – ${fmtDay(win.t0 + (win.n - 1) * HOUR)} ${new Date(win.t0 + (win.n - 1) * HOUR).getUTCFullYear()})`;
}

function drawWindows(st) {
  const w = earthWindows(st.series).filter(x => x.end > state.t).slice(0, 4);
  const horizonDays = Math.round(st.series.n / 24);
  if (!w.length) { $('#windows').innerHTML = `<p class="muted">Earth never rises above the skyline in the next ${horizonDays} days${site.lat > -60 && site.lon ? ' — this site is on the far side.' : '.'} A relay satellite is required.</p>`; return; }
  if (w.length === 1 && w[0].start <= state.t && w[0].end >= st.series.t0 + (st.series.n - 3) * HOUR) {
    $('#windows').innerHTML = `<div class="win now"><span class="earth">Continuous</span><span>Earth stays in view for the next ${horizonDays} days</span></div><p class="note" style="margin-top:10px">Direct-to-Earth radio is always possible here. Great for operations; check the sunlight though.</p>`; return;
  }
  $('#windows').innerHTML = w.map((x, i) => {
    const cur = x.start <= state.t, open = x.end >= st.series.t0 + (st.series.n - 3) * HOUR;
    return `<div class="win ${cur ? 'now' : ''}">
      <div><div style="color:var(--text)">${cur ? 'Now' : fmtDayHM(x.start)} → ${open ? 'beyond ' + fmtDay(x.end) + ' ' + new Date(x.end).getUTCFullYear() : fmtDayHM(x.end)}</div><div class="muted" style="font-size:11px;margin-top:2px">${open ? 'lasts more than' : 'lasts'} ${fmtDur(x.end - x.start)}</div></div>
      <span class="${cur ? 'earth' : 'muted'}" style="text-align:right">${cur ? `${open ? 'ends in more than' : 'ends in'} ${fmtDur(x.end - state.t)}` : `starts in ${fmtDur(x.start - state.t)}`}</span></div>`;
  }).join('') + `<p class="note" style="margin-top:10px">Times are UTC. A window opens when at least half of Earth's disk clears the skyline.</p>`;
}

let yearCache = null;
async function drawYear() {
  const y = new Date(state.t).getUTCFullYear();
  if (yearCache?.y === y) return;
  const ys = await yearStats(site, y);
  yearCache = { y, ys };
  const cm = new Date(state.t).getUTCMonth();
  $('#yr').textContent = `(${y})`;
  $('#months').innerHTML = ys.months.map((m, i) => `<div class="${i === cm ? 'on' : ''}" title="${MONTHS[i]} ${y}: sunlight ${fmtPct(m.sunPct)}, Earth ${fmtPct(m.earthPct)}">
    <div>${MONTHS[i]}</div><div class="cols"><i style="height:${(m.sunPct || 0) * .54}px;background:var(--sun)"></i><i style="height:${(m.earthPct || 0) * .54}px;background:var(--earth)"></i></div>
    <div class="sun">${Number.isFinite(m.sunPct) ? Math.round(m.sunPct) : '–'}</div><div class="earth">${Number.isFinite(m.earthPct) ? Math.round(m.earthPct) : '–'}</div></div>`).join('');
  const s = yearSummary(site, y) ?? ys;
  const battery = 100 * s.nightH / 1000;   // kWh for a 100 W load through the longest night
  $('#stats').innerHTML = `
    <div class="stat"><div class="v sun">${fmtPct(s.sunPct)}</div><div class="l">time in sunlight in ${y}</div></div>
    <div class="stat"><div class="v">${fmtLong(s.nightH)}</div><div class="l">longest night <span class="x-only">(${s.nightH} h)</span><br><span class="faint">a 100 W rover needs ${fmtNum(battery, 1)} kWh of battery to survive it</span></div></div>
    <div class="stat"><div class="v earth">${fmtPct(s.earthPct)}</div><div class="l">time Earth is in view<br><span class="faint">longest gap ${fmtLong(s.noEarthH)}</span></div></div>
    <div class="stat"><div class="v">${fmtNum(s.energyWhDay)} Wh</div><div class="l">energy per day from a 1 m² panel <span class="x-only">(30 % efficient, vertical, tracking the Sun)</span></div></div>`;
}

// ------------------------------------------------------------------ ECO-PATH
function ecoIntro() {
  const b = $('#ecoBody');
  if (!site.terrain || site.lat > -60) { b.innerHTML = `<p class="muted">Available for points south of 60° S, where we have terrain data.</p>`; return; }
  b.innerHTML = `<p style="margin-top:0">Earth hidden too often? We search every point within <b>5 km</b> for the closest one that sees Earth clearly more over the <b>next 30 days</b>.</p>
    <button class="btn primary" id="ecoGo"><span class="ms">route</span> Find it</button>
    <div class="progress hidden" id="ecoProg" style="margin-top:14px"><i></i></div>`;
  $('#ecoGo').onclick = runEco;
}
async function runEco() {
  $('#ecoGo').disabled = true; $('#ecoProg').classList.remove('hidden');
  const t0 = state.t;
  const r = await nearestEarthSpot(site, t0, { days: 30, radiusM: 5000, onProgress: p => { $('#ecoProg i').style.width = `${Math.round(p * 100)}%`; } });
  const b = $('#ecoBody');
  if (!r) { b.innerHTML = '<p class="muted">No terrain data here.</p>'; return; }
  const here = r.here.earthPct;
  if (!r.best) {
    b.innerHTML = `<p style="margin-top:0"><b>No better spot within 5 km.</b> From ${fmtDay(t0)}, Earth is in view ${fmtPct(here, 0)} of the next 30 days here; no point within 5 km reaches ${fmtPct(Math.min(100, Math.max(here + 20, 50)), 0)}.</p>
      <p class="muted">${here >= 80 ? 'This site already has good contact with Earth.' : 'The hills around this site block Earth in every nearby direction. Plan a relay satellite, or look at other sites.'}</p>
      <button class="btn sm ghost" id="ecoAgain">Search again</button>`;
    $('#ecoAgain').onclick = ecoIntro; return;
  }
  const x = r.best, easy = x.maxSlope < 15;
  b.innerHTML = `
    <div style="display:flex;gap:16px;align-items:center">
      <svg width="64" height="64" viewBox="-32 -32 64 64"><circle r="29" fill="#0E1726" stroke="#223147"/><text y="-19" font-size="9" fill="#94A3B8" text-anchor="middle" font-family="IBM Plex Mono">N</text>
        <g transform="rotate(${x.bearing})"><path d="M0 -22 L6 4 L0 0 L-6 4Z" fill="#57B8E8"/></g><circle r="2.5" fill="#E8EDF4"/></svg>
      <div><div style="font:italic 30px/1.1 var(--serif)">${x.dist >= 1000 ? (x.dist / 1000).toFixed(1) + ' km' : Math.round(x.dist) + ' m'} ${dirWord(compass(x.bearing))}</div>
        <div class="muted mono" style="font-size:12px">${fmtLat(x.lat)}, ${fmtLon(x.lon)}</div></div>
    </div>
    <div style="margin:14px 0">
      <div class="kv"><span>Earth in view, next 30 days</span><span><span class="muted">${fmtPct(here, 0)} here →</span> <span class="earth">${fmtPct(x.earthPct, 0)} there</span></span></div>
      <div class="kv"><span>Height change</span><span>${x.climb >= 0 ? 'climb' : 'descend'} ${fmtNum(Math.abs(x.climb))} m</span></div>
      <div class="kv"><span>Steepest part of a straight drive</span><span class="${easy ? 'ok' : 'sun'}">${x.maxSlope.toFixed(0)}°</span></div>
    </div>
    <p class="note">${easy ? 'Gentle enough for a rover on a straight line (under 15°).' : 'A straight line crosses steep ground: a rover would need a detour.'} Both points use 240 m terrain so they are compared fairly.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <a class="btn sm" href="${href('site', { lat: x.lat.toFixed(4), lon: x.lon.toFixed(4) })}">Open this spot <span class="ms" style="font-size:16px">arrow_forward</span></a>
      <a class="btn sm ghost" href="${href('explore', { lat: x.lat.toFixed(4), lon: x.lon.toFixed(4) })}"><span class="ms" style="font-size:16px">pin_drop</span> Show on map</a>
    </div>`;
}

// ------------------------------------------------------------------ render loop
let busy = false, pending = false;
async function render() {
  if (busy) { pending = true; return; }
  busy = true;
  try {
    const st = await statusAt(site, state.t, 400);
    if (!st) { $('#sunCard').innerHTML = $('#earthCard').innerHTML = '<div class="loading">Outside the data range (2025–2030).</div>'; return; }
    const win = await series(site, winStart(state.t), WIN_DAYS * 24);
    const k = Math.floor((state.t - win.t0) / HOUR);
    now = { power: win.valid[k] ? win.power[k] : 0 };
    $('#sunCard').innerHTML = statusCard(true, st.sun);
    $('#earthCard').innerHTML = statusCard(false, st.earth);
    drawPanorama(st, await series(site, state.t, WIN_DAYS * 24));
    drawTimeline(win);
    drawWindows(st);
    await drawYear();
  } finally {
    busy = false;
    if (pending) { pending = false; render(); }
  }
}

// play: move time forward through the data
let timer = null, step = 1;
function stop() { if (timer) { clearInterval(timer); timer = null; $('#play').innerHTML = `<span class="ms">play_arrow</span> Play`; } }
$('#play').onclick = () => {
  if (timer) return stop();
  $('#play').innerHTML = `<span class="ms">pause</span> Pause`;
  timer = setInterval(() => {
    if (state.t + step * HOUR > state.range.endMs) return stop();
    setTime(state.t + step * HOUR);
  }, 90);
};
$$('#speed button').forEach(b => b.onclick = () => { step = +b.dataset.s; $$('#speed button').forEach(x => x.classList.toggle('on', x === b)); });

onTime(() => render());
document.addEventListener('modechange', () => render());
new ResizeObserver(() => { if (!busy) render(); }).observe($('#pano'));
ecoIntro();
await render();

// site.js — one site in detail: status now, skyline, 30-day timeline, windows, ECO-PATH, months.
import {
  initShell, onTime, setTime, state, $, $$, esc, href, siteParams, siteKey, siteFromKey, store, toast, addCompare, loadSites,
  fmtLat, fmtLon, fmtCoords, fmtNum, fmtPct, fmtLong, fmtDur, fmtDeg, fmtDate, fmtDayHM, fmtDay, MONTHS, DAY,
  yearSummary, shortName, timelineSVG, timelinePick, refreshNav, dirWord, thumbUrl, countUp,
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
if (!site) { $('#subtitle').textContent = 'Site not found'; throw new Error('no site'); }
store.set('lastSite', siteParams(site)); refreshNav();
const NAME = site.custom ? 'Custom point' : shortName(site);
document.title = `${NAME} · LUMINALUNA`;
$('#thumb').style.backgroundImage = `url(${thumbUrl(site)})`;
$('#subtitle').innerHTML = `${fmtCoords(site)} · ${site.terrain ? `Elevation ${fmtNum(site.ground_m)} m` : 'flat horizon (no terrain data here)'}${site.custom ? ' · <span class="earth">240 m terrain</span>' : ''}`;

const all = await loadSites();
const groups = [['artemis3', 'Artemis III candidates'], ['reference', 'Reference points'], ['china', 'China'], ['clps', 'NASA CLPS'], ['india', 'India'], ['japan', 'Japan'], ['apollo', 'Apollo']];
$('#pick').innerHTML = (site.custom ? `<option value="" selected>Custom point</option>` : '') + groups.map(([g, l]) =>
  `<optgroup label="${l}">${all.filter(s => s.group === g).map(s => `<option value="${s.id}" ${s.id === site.id ? 'selected' : ''}>${esc(shortName(s))}</option>`).join('')}</optgroup>`).join('');
$('#pick').onchange = e => { if (e.target.value) location.href = href('site', { id: e.target.value }); };
$('#addcmp').onclick = () => { const l = addCompare(siteKey(site)); toast(`Added. Compare has ${l.length} site${l.length > 1 ? 's' : ''}. <a href="${href('compare')}" style="color:var(--earth);text-decoration:underline">Open compare →</a>`, 3500); };

// ------------------------------------------------------------------ status cards
let nowPower = 0;
function statusCard(isSun, b) {
  const col = isSun ? 'var(--sun)' : 'var(--earth)';
  const label = isSun ? (b.visible ? 'Sunlit' : 'In shadow') : (b.visible ? 'Earth in view' : 'Earth hidden');
  const [setW, riseW] = isSun ? ['sunset', 'Sunrise'] : ['Earthset', 'Earthrise'];
  const dur = b.nextChange ? b.nextChange - state.t : null;
  let big;
  if (b.visible) big = dur == null ? `No ${setW} before the data ends` : dur > 2 * DAY ? `No ${setW} for ${Math.floor(dur / DAY)} days` : `${setW[0].toUpperCase() + setW.slice(1)} in ${fmtDur(dur)}`;
  else big = dur == null ? `No ${riseW.toLowerCase()} before the data ends` : `${riseW} in ${fmtDur(dur)}`;
  const body = isSun ? 'Sun' : 'Earth', rad = isSun ? 0.267 : 0.95;
  const pos = b.margin > rad ? `${body} ${b.el.toFixed(1)}° high, ${b.margin.toFixed(1)}° above the skyline`
    : b.margin < -rad ? `${body} ${(-b.margin).toFixed(1)}° below the ridge` : `${body} grazing the ridge, ${Math.round(b.frac * 100)}% of the disk shows`;
  const when = b.nextChange ? (b.visible ? ` · until ${fmtDate(b.nextChange).replace(', ', ' ').replace(/ \d\d:\d\d UTC$/, '')}` : ` · ${riseW.toLowerCase().startsWith('sun') ? 'rises' : 'rises'} ${fmtDayHM(b.nextChange)} UTC`) : '';
  const why = isSun ? (b.visible ? 'Solar panels are producing power.' : 'No solar power: batteries only.')
    : (b.visible ? 'A direct radio link to Earth is possible.' : 'No direct radio link: a relay satellite is needed.');
  return `
    <div style="display:flex;justify-content:space-between;gap:12px">
      <div><div class="label" style="color:${b.visible ? col : 'var(--muted)'}"><span class="dot" style="background:${col};opacity:${b.visible ? 1 : .4}"></span>${label}</div>
        <div class="big">${big}</div></div>
      <div class="icon ${b.visible ? `live ${isSun ? '' : 'earthlive'}` : ''}" style="color:${col};opacity:${b.visible ? 1 : .55}"><span class="ms" style="font-size:22px">${isSun ? 'wb_sunny' : 'public'}</span></div>
    </div>
    <div class="foot"><span style="color:${col}">${pos}</span><span class="muted">${when}</span>
      <div class="note b-only" style="margin-top:6px">${why}</div></div>
    <div class="x-only" style="margin-top:14px">
      <div class="kv"><span>Elevation / azimuth</span><span>${fmtDeg(b.el)} / ${b.az.toFixed(1)}° (${compass(b.az)})</span></div>
      <div class="kv"><span>Skyline at that azimuth</span><span>${fmtDeg(b.hz)}</span></div>
      <div class="kv"><span>Margin · disk visible</span><span class="${b.margin > 0 ? 'ok' : 'bad'}">${fmtDeg(b.margin)} · ${(b.frac * 100).toFixed(0)}%</span></div>
      ${isSun ? `<div class="kv"><span>Power, 1 m² tracking panel</span><span>${fmtNum(nowPower)} W</span></div>` : ''}
      ${b.nextChange ? `<div class="kv"><span>Next change</span><span>${fmtDate(b.nextChange)}</span></div>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ skyline panorama
function drawPanorama(st, win) {
  const el = $('#pano'), W = Math.max(320, el.clientWidth), H = W < 600 ? 220 : 270;
  const L = 40, R = 14, T = 12, B = 26;
  const sky = site.skyline;
  let lo = Infinity, hi = -Infinity;
  for (const v of sky) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let k = 0; k < win.n; k++) if (win.valid[k]) {
    hi = Math.max(hi, win.sunEl[k], win.earthEl[k]); lo = Math.min(lo, Math.max(win.sunEl[k], hi - 30), Math.max(win.earthEl[k], hi - 30));
  }
  hi = Math.min(hi, 25) + 1.5; lo = Math.max(lo, -12) - 1;
  const X = az => L + az / 360 * (W - L - R), Y = e => T + (hi - e) / (hi - lo) * (H - T - B);
  const pxDeg = (H - T - B) / (hi - lo);
  const font = 'font-family="Inter" font-weight="600"';
  let g = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" rx="8" fill="#0A1120"/>`;
  const stepE = hi - lo > 12 ? 5 : hi - lo > 5 ? 2 : 1;
  for (let e = Math.ceil(lo / stepE) * stepE; e <= hi; e += stepE)
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(e)}" y2="${Y(e)}" stroke="${e === 0 ? '#2B3B55' : '#142033'}" ${e === 0 ? '' : 'stroke-dasharray="2 4"'}/><text x="${L - 6}" y="${Y(e) + 3}" fill="#56637A" font-size="10" ${font} text-anchor="end">${e > 0 ? '+' : ''}${e}°</text>`;
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'].forEach((c, i) => {
    if (W < 520 && i % 2) return;
    g += `<text x="${X(i * 45)}" y="${H - 8}" fill="#8C98AB" font-size="10" ${font} text-anchor="middle">${i * 45}° ${c}</text>`;
  });
  const path = (azA, elA, visA, color) => {
    let d = '', prev = null, dots = '';
    for (let k = 0; k < win.n; k += 2) {
      if (!win.valid[k]) { prev = null; continue; }
      const x = X(azA[k]), y = Y(elA[k]);
      d += (prev == null || Math.abs(azA[k] - prev) > 180) ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`;
      prev = azA[k];
      if (k % 12 === 0) dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${visA[k] >= VISIBLE ? color : '#0A1120'}" stroke="${color}" stroke-width=".7"/>`;
    }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="1.1" stroke-dasharray="3 3"/>${dots}`;
  };
  g += path(win.sunAz, win.sunEl, win.sunFrac, '#F2B544') + path(win.earthAz, win.earthEl, win.earthFrac, '#57B8E8');
  const earthR = angularRadius(R_EARTH_KM, 384400);
  const tag = (b, color, name) => {
    const x = X(b.az), y = Y(b.el), t = `${name.toUpperCase()} ${b.az.toFixed(0)}° / ${b.el > 0 ? '+' : ''}${b.el.toFixed(1)}°${b.visible ? '' : ' (hidden)'}`;
    const w = t.length * 6.2 + 14, tx = Math.min(Math.max(x - w / 2, L + 2), W - R - w - 2);
    return `<rect x="${tx}" y="${y + 12}" width="${w}" height="18" rx="5" fill="#0D1524" stroke="#1F2D44"/><text x="${tx + w / 2}" y="${y + 24.5}" fill="${color}" font-size="10" ${font} text-anchor="middle">${t}</text>`;
  };
  const disk = (b, rDeg, color) => { const r = Math.max(5, rDeg * pxDeg); return `<circle cx="${X(b.az)}" cy="${Y(b.el)}" r="${r + 7}" fill="${color}" fill-opacity=".15"/><circle cx="${X(b.az)}" cy="${Y(b.el)}" r="${r}" fill="${color}"/>`; };
  g += disk(st.earth, earthR, '#57B8E8') + disk(st.sun, 0.267, '#F2B544');
  let t = `M${L},${H - B}`;
  for (let i = 0; i <= sky.length; i++) t += `L${X(i * 0.5).toFixed(1)},${Y(Math.max(lo, sky[i % sky.length])).toFixed(1)}`;
  t += `L${W - R},${H - B}Z`;
  g += `<defs><linearGradient id="terr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22324C"/><stop offset="1" stop-color="#0D1524"/></linearGradient></defs>
    <path d="${t}" fill="url(#terr)" stroke="#57B8E8" stroke-opacity=".45" stroke-width="1"/>`;
  for (const [b, rDeg, c] of [[st.sun, 0.267, '#F2B544'], [st.earth, earthR, '#57B8E8']]) {
    if (!b.visible && b.el >= lo) g += `<circle cx="${X(b.az)}" cy="${Y(b.el)}" r="${Math.max(5, rDeg * pxDeg)}" fill="none" stroke="${c}" stroke-dasharray="3 3" stroke-width="1.4"/>`;
    g += `<line x1="${X(b.az)}" x2="${X(b.az)}" y1="${Y(b.hz)}" y2="${H - B}" stroke="${c}" stroke-opacity=".5" stroke-dasharray="2 3"/>`;
  }
  g += tag(st.earth, '#57B8E8', 'Earth') + tag(st.sun, '#F2B544', 'Sun');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
  $('#panoLegend').innerHTML = `<span><i style="background:var(--sun);border-radius:50%"></i>Sun (${st.sun.az.toFixed(0)}°, ${fmtDeg(st.sun.el, 1)})</span><span><i style="background:var(--earth);border-radius:50%"></i>Earth (${st.earth.az.toFixed(0)}°, ${fmtDeg(st.earth.el, 1)})</span>`;
  $('#panoNote').textContent = `Skyline from ${site.custom ? 'NASA LOLA terrain at 240 m per pixel, computed in your browser' : 'NASA LOLA terrain at 80 m per pixel'}: 720 directions, terrain up to 300 km away, observer 2 m above ground. Dotted lines: Sun and Earth paths over the next 30 days. Vertical scale stretched ${(pxDeg / ((W - L - R) / 360)).toFixed(0)}×.`;
}

// ------------------------------------------------------------------ timeline, windows, months, stats
const WIN_DAYS = 30;
const winStart = t => Math.max(state.range.startMs, Math.min(state.range.endMs - WIN_DAYS * DAY, Math.floor(t / DAY) * DAY - 14 * DAY));
function drawTimeline(win) {
  const el = $('#tl'), m = summarize(win);
  el.innerHTML = timelineSVG([{ bandLabels: [`SUNLIGHT ${fmtPct(m.sunPct, 0)}`, `EARTH ${fmtPct(m.earthPct, 0)}`], series: win }],
    { t0: win.t0, hours: win.n, now: state.t, width: el.clientWidth, labelW: el.clientWidth < 500 ? 84 : 110, showPower: state.expert });
  const svg = el.firstElementChild;
  svg.onclick = ev => { const t = timelinePick(svg, ev, win.t0, win.n); if (t != null) { stop(); setTime(t); } };
  const end = win.t0 + (win.n - 1) * HOUR;
  $('#tlTitle').textContent = `30-Day Timeline (${fmtDay(win.t0)} – ${fmtDay(end)} ${new Date(end).getUTCFullYear()})`;
  $('#tlSub').textContent = `${NAME}: sunlight and Earth line of sight. Click to move the time, or press play.`;
}
function drawWindows(st) {
  const w = earthWindows(st.series).filter(x => x.end > state.t).slice(0, 3);
  const days = Math.round(st.series.n / 24);
  const ys = yearCache?.ys, avail = ys ? `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--line2);margin-top:14px;padding-top:12px;font-size:12.5px"><span class="muted">Direct Earth link</span><span class="earth" style="font-weight:600">Availability ${yearCache.y}: ${fmtPct((yearSummary(site, yearCache.y) ?? ys).earthPct)}</span></div>` : '';
  if (!w.length) { $('#windows').innerHTML = `<p class="muted" style="margin:0">Earth never clears the skyline in the next ${days} days${site.lat > -60 ? ' (this site is on the far side)' : ''}. A relay satellite is required.</p>${avail}`; return; }
  const endOfSearch = st.series.t0 + (st.series.n - 3) * HOUR;
  if (w.length === 1 && w[0].start <= state.t && w[0].end >= endOfSearch) {
    $('#windows').innerHTML = `<div class="win now"><div><div class="t">Continuous contact</div><div class="s">Earth stays in view for the next ${days} days</div></div><span class="pill">Always</span></div>${avail}`; return;
  }
  $('#windows').innerHTML = w.map((x, i) => {
    const cur = x.start <= state.t, open = x.end >= endOfSearch;
    const pill = cur ? `Now · ${fmtDur(x.end - state.t)} left` : i === 0 || (i === 1 && w[0].start <= state.t) ? `In ${fmtDur(x.start - state.t)}` : new Date(x.start).getUTCFullYear() !== new Date(state.t).getUTCFullYear() ? `${MONTHS[new Date(x.start).getUTCMonth()]} ${new Date(x.start).getUTCFullYear()}` : 'Next cycle';
    return `<div class="win ${cur || i === 0 ? 'now' : ''}"><div style="display:flex;gap:10px;align-items:flex-start">
      <span class="dot" style="background:${cur || i === 0 ? 'var(--earth)' : 'var(--faint)'};margin-top:6px"></span>
      <div><div class="t">${cur ? 'Now' : fmtDayHM(x.start)} – ${open ? 'beyond ' + fmtDay(x.end) : fmtDayHM(x.end)} UTC</div><div class="s">${open ? 'more than ' : ''}${x.hours} hours continuous</div></div></div>
      <span class="pill">${pill}</span></div>`;
  }).join('') + avail;
}
let yearCache = null, statsCounted = false;
async function drawYear() {
  const y = new Date(state.t).getUTCFullYear();
  if (yearCache?.y !== y) yearCache = { y, ys: await yearStats(site, y) };
  const ys = yearCache.ys, cm = new Date(state.t).getUTCMonth();
  $('#mTitle').textContent = `Sunlight by month (${y})`;
  const sp = ys.months.map(m => m.sunPct);
  const mn = Math.min(...sp), mx = Math.max(...sp);
  const names = v => { const l = ys.months.map((m, i) => Math.round(m.sunPct) === Math.round(v) ? MONTHS[i] : null).filter(Boolean); return l.length > 2 ? `${l.length} months` : l.join(' & '); };
  $('#mLowPeak').innerHTML = `<span class="muted">Lowest: ${Math.round(mn)}% (${names(mn)}) · </span><span class="sun">Peak: ${Math.round(mx)}% (${names(mx)})</span>`;
  $('#months').innerHTML = ys.months.map((m, i) => `<div class="${i === cm ? 'on' : ''}" title="${MONTHS[i]} ${y}: sunlight ${fmtPct(m.sunPct)}, Earth ${fmtPct(m.earthPct)}">
    <div style="display:flex;justify-content:space-between"><span>${MONTHS[i].toUpperCase()}</span>${i === cm ? '<span class="earth">●</span>' : ''}</div>
    <div class="cols"><i style="height:${(m.sunPct || 0) * .46}px;background:var(--sun);opacity:${.45 + .55 * (m.sunPct || 0) / 100}"></i><i style="height:${(m.earthPct || 0) * .46}px;background:var(--earth)"></i></div>
    <div class="vals"><span class="sun">${Number.isFinite(m.sunPct) ? Math.round(m.sunPct) : '–'}%</span><span class="earth">${Number.isFinite(m.earthPct) ? Math.round(m.earthPct) : '–'}%</span></div></div>`).join('');
  const s = yearSummary(site, y) ?? ys;
  const battery = 100 * s.nightH / 1000;
  const card = (label, icon, col, v, sub) => `<div class="stat"><div class="top"><span class="label">${label}</span><span class="ms ${col}" style="font-size:18px">${icon}</span></div><div class="v ${col}">${v}</div><div class="l">${sub}</div></div>`;
  $('#stats').innerHTML =
    card('Time in sunlight', 'wb_sunny', 'sun', fmtPct(s.sunPct), `Average illumination in ${y}`) +
    card('Longest night', 'dark_mode', '', fmtLong(s.nightH), `Continuous darkness${s.nightH >= 48 ? ` (${s.nightH} h)` : ''}. A 100 W rover needs ${fmtNum(battery, 1)} kWh of battery`) +
    card('Earth visibility', 'settings_input_antenna', 'earth', fmtPct(s.earthPct), `Time Earth is in direct sight · longest gap ${fmtLong(s.noEarthH)}`) +
    card('Daily energy yield', 'bolt', 'sun', `${fmtNum(s.energyWhDay)} Wh`, 'Per day from a 1 m² panel <span class="x-only">(30 %, vertical, tracking the Sun)</span>');
  if (!statsCounted) { statsCounted = true; countUp($$('#stats .v'), 1100); }
}

// ------------------------------------------------------------------ ECO-PATH
function ecoIntro() {
  const b = $('#ecoBody');
  if (!site.terrain || site.lat > -60) { b.innerHTML = `<p class="muted" style="margin:0">Available for points south of 60° S, where we have terrain data.</p>`; return; }
  b.innerHTML = `<p style="margin:0 0 14px;color:#C4CAD6">Earth hidden too often? We test every point within <b>5 km</b> to find the closest one that sees Earth clearly more over the <b>next 30 days</b>.</p>
    <button class="btn" id="ecoGo"><span class="ms" style="font-size:16px">search</span> Find it</button>
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
    b.innerHTML = `<p style="margin:0;color:#C4CAD6">No better spot within 5 km — the hills block Earth in every nearby direction.</p>
      <p class="note">From ${fmtDay(t0)}, Earth is in view ${fmtPct(here, 0)} of the next 30 days here; nothing within 5 km reaches ${fmtPct(Math.min(100, Math.max(here + 20, 50)), 0)}.${here >= 80 ? ' This site already has good contact.' : ' Plan a relay satellite, or look at other sites.'}</p>
      <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--line2);padding-top:12px;margin-top:6px"><button class="btn sm" id="ecoAgain"><span class="ms" style="font-size:15px">search</span> Search again</button></div>`;
    $('#ecoAgain').onclick = ecoIntro; return;
  }
  const x = r.best, easy = x.maxSlope < 15;
  b.innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="ministat"><div class="label">Distance</div><div class="v earth">${x.dist >= 1000 ? (x.dist / 1000).toFixed(1) + ' km' : Math.round(x.dist) + ' m'}</div><div class="note">${dirWord(compass(x.bearing))} · ${x.climb >= 0 ? 'climb' : 'descend'} ${fmtNum(Math.abs(x.climb))} m</div></div>
      <div class="ministat"><div class="label">Max slope</div><div class="v ${easy ? 'ok' : 'sun'}">${x.maxSlope.toFixed(0)}°</div><div class="note">${easy ? 'Accessible by rover' : 'Steep: needs a detour'}</div></div>
    </div>
    <div class="kv" style="margin-top:10px"><span>Earth in view, next 30 days</span><span><span class="muted">${fmtPct(here, 0)} here →</span> <span class="earth">${fmtPct(x.earthPct, 0)} there</span></span></div>
    <p class="note">${fmtLat(x.lat)}, ${fmtLon(x.lon)}. Both points use 240 m terrain so they are compared fairly.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      <a class="btn ghost sm" href="${href('site', { lat: x.lat.toFixed(4), lon: x.lon.toFixed(4) })}">Open this spot</a>
      <a class="btn sm" href="${href('explore', { lat: x.lat.toFixed(4), lon: x.lon.toFixed(4) })}"><span class="ms" style="font-size:15px">pin_drop</span> Show on map</a>
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
    nowPower = win.valid[k] ? win.power[k] : 0;
    $('#sunCard').innerHTML = statusCard(true, st.sun);
    $('#earthCard').innerHTML = statusCard(false, st.earth);
    drawPanorama(st, await series(site, state.t, WIN_DAYS * 24));
    drawTimeline(win);
    await drawYear();
    drawWindows(st);
  } finally {
    busy = false;
    if (pending) { pending = false; render(); }
  }
}

let timer = null, step = 1;
const playIcon = on => `<span class="ms" style="font-size:16px">${on ? 'pause' : 'play_arrow'}</span>`;
function stop() { if (timer) { clearInterval(timer); timer = null; $('#play').innerHTML = playIcon(false); $('#play').classList.remove('playing'); } }
function play() {
  if (timer) return stop();
  $('#play').innerHTML = playIcon(true); $('#play').classList.add('playing');
  timer = setInterval(() => {
    if (state.t + step * HOUR > state.range.endMs) return stop();
    setTime(state.t + step * HOUR);
  }, 90);
}
$('#play').onclick = play;
$$('#speed button').forEach(b => b.onclick = () => { step = +b.dataset.s; $$('#speed button').forEach(x => x.classList.toggle('on', x === b)); });

onTime(() => render());
document.addEventListener('modechange', () => render());
new ResizeObserver(() => { if (!busy) render(); }).observe($('#pano'));
ecoIntro();
await render();
if (q.get('play') === '1') { step = 3; $$('#speed button').forEach(x => x.classList.toggle('on', x.dataset.s === '3')); play(); }

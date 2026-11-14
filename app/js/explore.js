// explore.js — site list, polar map, and the inspector panel.
import {
  initShell, onTime, state, $, $$, esc, href, siteParams, store, toast, loadSites, siteFromKey, siteKey, addCompare,
  fmtLat, fmtLon, fmtCoords, fmtNum, fmtPct, fmtLong, fmtDur, fmtDeg, yearSummary, verdict, shortName,
} from './ui.js';
import { prepareSite, yearStats, statusAt, slopeAt } from './engine.js';
import { toPolarXY, fromPolarXY } from './geo.js';
import { mapMeta, dataUrl } from './data.js';

await initShell('explore');

const FILTERS = [
  ['all', 'All', () => true],
  ['artemis3', 'Artemis III', s => s.group === 'artemis3'],
  ['reference', 'Reference', s => s.group === 'reference'],
  ['planned', 'Planned', s => /^planned/.test(s.status)],
  ['past', 'Past landings', s => /^landed/.test(s.status)],
];
let sites = (await loadSites()).map(prepareSite);
let filter = store.get('filter', 'all'), query = '';
let selected = null;           // prepared site object (catalog or custom)
const year = () => new Date(state.t).getUTCFullYear();

// ------------------------------------------------------------------ list
function renderChips() {
  $('#chips').innerHTML = FILTERS.map(([k, label, f]) =>
    `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${label} <span class="faint">${sites.filter(f).length}</span></button>`).join('');
  $$('#chips .chip').forEach(b => b.onclick = () => { filter = b.dataset.f; store.set('filter', filter); renderChips(); renderList(); });
}
function renderList() {
  const f = FILTERS.find(x => x[0] === filter)[2], y = year();
  const q = query.trim().toLowerCase();
  const list = sites.filter(f).filter(s => !q || (s.name + ' ' + (s.agency ?? '') + ' ' + s.status).toLowerCase().includes(q))
    .sort((a, b) => (b.summary[y]?.sun_pct ?? 0) - (a.summary[y]?.sun_pct ?? 0));
  $('#yearlab').textContent = `year ${y}`;
  $('#list').innerHTML = list.length ? list.map(s => {
    const m = yearSummary(s, y);
    return `<div class="item ${selected?.id === s.id ? 'on' : ''}" data-id="${s.id}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span class="n">${esc(shortName(s))}</span>
        <span class="c">${s.lat > -80 ? 'off map' : ''}</span></div>
      <div class="c">${fmtCoords(s)}${s.agency ? ' · ' + esc(s.agency.split(' / ')[0]) : ''}</div>
      <div class="pp"><span class="sun">☀ ${fmtPct(m?.sunPct)}</span><span class="earth">◉ ${fmtPct(m?.earthPct)}</span></div>
      <div class="bars"><div class="bar"><i style="width:${m?.sunPct ?? 0}%;background:var(--sun)"></i></div><div class="bar"><i style="width:${m?.earthPct ?? 0}%;background:var(--earth)"></i></div></div>
    </div>`;
  }).join('') : '<div class="loading">No site matches.</div>';
  $$('#list .item').forEach(el => el.onclick = () => select(sites.find(s => s.id === el.dataset.id), true));
}
$('#q').addEventListener('input', e => { query = e.target.value; renderList(); });

// ------------------------------------------------------------------ map
const meta = await mapMeta();
const HW = meta.half_width_m / 1000;          // km
const mapEl = $('#map');
const NS = 'http://www.w3.org/2000/svg';
let view = { cx: 0, cy: 0, w: 2 * HW };       // km, SVG y = -north
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
mapEl.prepend(svg);
const RINGS = [85, 88];
function staticLayer() {
  const ringR = lat => Math.hypot(...toPolarXY(lat, 0)) / 1000;
  let g = `<defs><clipPath id="disk"><circle r="${HW}"/></clipPath></defs>
    <g clip-path="url(#disk)">
      <image href="${dataUrl('map/relief_80S.jpg')}" x="${-HW}" y="${-HW}" width="${2 * HW}" height="${2 * HW}" preserveAspectRatio="none"/>
      <image id="slopeimg" href="${dataUrl('map/slope_80S.png')}" x="${-HW}" y="${-HW}" width="${2 * HW}" height="${2 * HW}" preserveAspectRatio="none" style="display:none"/>
    </g><g id="grid" fill="none" stroke="#57B8E8" stroke-opacity=".45" vector-effect="non-scaling-stroke">`;
  for (const lat of RINGS) g += `<circle r="${ringR(-lat)}" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>`;
  for (const lon of [0, 90, 180, 270]) { const [x, y] = toPolarXY(-80, lon); g += `<line x1="0" y1="0" x2="${x / 1000}" y2="${-y / 1000}" stroke-opacity=".25" stroke-dasharray="2 5" vector-effect="non-scaling-stroke"/>`; }
  g += `</g><g id="labels"></g><g id="marks"></g>`;
  svg.innerHTML = g;
}
staticLayer();
const toSvg = (lat, lon) => { const [x, y] = toPolarXY(lat, lon); return [x / 1000, -y / 1000]; };
function applyView() {
  view.w = Math.min(2 * HW, Math.max(4, view.w));
  const lim = HW - view.w / 2;
  view.cx = Math.max(-lim, Math.min(lim, view.cx)); view.cy = Math.max(-lim, Math.min(lim, view.cy));
  svg.setAttribute('viewBox', `${view.cx - view.w / 2} ${view.cy - view.w / 2} ${view.w} ${view.w}`);
  drawMarks();
}
function drawMarks() {
  const px = view.w / (mapEl.clientWidth || 500);          // km per screen pixel
  const zoomed = view.w < 2 * HW / 3.5;
  const ringR = lat => Math.hypot(...toPolarXY(lat, 0)) / 1000;
  const fs = 10.5 * px;
  let lab = '';
  for (const lat of RINGS) lab += `<text x="${4 * px}" y="${-ringR(-lat) - 4 * px}" font-size="${fs}" fill="#94A3B8" font-family="IBM Plex Mono">${lat}° S</text>`;
  const t0 = toSvg(-80.6, 0); lab += `<text x="${t0[0]}" y="${t0[1]}" font-size="${fs}" fill="#94A3B8" text-anchor="middle" font-family="IBM Plex Mono">0°</text>`;
  const t1 = toSvg(-80.9, 90); lab += `<text x="${t1[0]}" y="${t1[1]}" font-size="${fs}" fill="#94A3B8" text-anchor="end" font-family="IBM Plex Mono">90° E</text>`;
  const t2 = toSvg(-80.9, -90); lab += `<text x="${t2[0]}" y="${t2[1]}" font-size="${fs}" fill="#94A3B8" font-family="IBM Plex Mono">90° W</text>`;
  const t3 = toSvg(-81, 180); lab += `<text x="${t3[0]}" y="${t3[1]}" font-size="${fs}" fill="#94A3B8" text-anchor="middle" font-family="IBM Plex Mono">180°</text>`;
  lab += `<g transform="translate(0 0)"><line x1="${-6 * px}" x2="${6 * px}" y1="0" y2="0" stroke="#E8EDF4" stroke-width="${px}"/><line y1="${-6 * px}" y2="${6 * px}" x1="0" x2="0" stroke="#E8EDF4" stroke-width="${px}"/></g>`;
  $('#labels', svg).innerHTML = lab;

  const y = year(), f = FILTERS.find(x => x[0] === filter)[2];
  let m = '';
  const r = 6 * px;
  for (const s of sites) {
    if (s.lat > -80 || !f(s)) continue;
    const [x, yy] = toSvg(s.lat, s.lon), sm = s.summary[y];
    const on = selected?.id === s.id;
    m += `<g class="mk" data-id="${s.id}" transform="translate(${x} ${yy})" style="cursor:pointer">
      <circle r="${r * 2.2}" fill="transparent"/>
      ${on ? `<circle r="${r * 2}" fill="none" stroke="#57B8E8" stroke-width="${1.5 * px}"/>` : ''}
      <path d="M0 ${-r}A${r} ${r} 0 0 0 0 ${r}Z" fill="#F2B544" fill-opacity="${0.35 + 0.65 * (sm?.sun_pct ?? 0) / 100}"/>
      <path d="M0 ${-r}A${r} ${r} 0 0 1 0 ${r}Z" fill="#57B8E8" fill-opacity="${0.35 + 0.65 * (sm?.earth_pct ?? 0) / 100}"/>
      <circle r="${r}" fill="none" stroke="#fff" stroke-width="${px}"/>
      ${on || zoomed ? `<text x="${r * 1.6}" y="${r * .55}" font-size="${11 * px}" fill="#E8EDF4" font-family="IBM Plex Mono" paint-order="stroke" stroke="#070E1B" stroke-width="${3 * px}">${esc(shortName(s))}</text>` : ''}
      <title>${esc(s.name)} — sun ${sm?.sun_pct}% · Earth ${sm?.earth_pct}%</title></g>`;
  }
  if (selected?.custom) {
    const [x, yy] = toSvg(selected.lat, selected.lon);
    m += `<g transform="translate(${x} ${yy})"><path d="M0 0 L${-5 * px} ${-12 * px} A${6 * px} ${6 * px} 0 1 1 ${5 * px} ${-12 * px} Z" fill="#E8EDF4" stroke="#070E1B" stroke-width="${px}"/><circle cy="${-15 * px}" r="${2.3 * px}" fill="#070E1B"/></g>`;
  }
  $('#marks', svg).innerHTML = m;
}
// pan / zoom / click
let drag = null;
const svgPoint = ev => { const r = mapEl.getBoundingClientRect(); return [view.cx + ((ev.clientX - r.left) / r.width - .5) * view.w, view.cy + ((ev.clientY - r.top) / r.height - .5) * view.w]; };
mapEl.addEventListener('wheel', ev => {
  ev.preventDefault();
  const [px, py] = svgPoint(ev), k = ev.deltaY > 0 ? 1.25 : 0.8;
  view.cx = px + (view.cx - px) * k; view.cy = py + (view.cy - py) * k; view.w *= k; applyView();
}, { passive: false });
mapEl.addEventListener('pointerdown', ev => {
  if (ev.target.closest('.mapbtns')) return;
  drag = { x: ev.clientX, y: ev.clientY, cx: view.cx, cy: view.cy, moved: false };
  mapEl.setPointerCapture(ev.pointerId);
});
mapEl.addEventListener('pointermove', ev => {
  if (!drag) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (Math.hypot(dx, dy) > 4) { drag.moved = true; mapEl.classList.add('drag'); }
  if (drag.moved) { const k = view.w / mapEl.clientWidth; view.cx = drag.cx - dx * k; view.cy = drag.cy - dy * k; applyView(); }
});
mapEl.addEventListener('pointerup', ev => {
  const d = drag; drag = null; mapEl.classList.remove('drag');
  if (!d || d.moved) return;
  const hit = document.elementsFromPoint(ev.clientX, ev.clientY).find(e => e.closest?.('.mk'));
  if (hit) { const g = hit.closest('.mk'); select(sites.find(s => s.id === g.dataset.id)); return; }
  const [x, y] = svgPoint(ev);
  if (Math.hypot(x, y) > HW) return;
  const [lat, lon] = fromPolarXY(x * 1000, -y * 1000);
  pickCustom(lat, lon);
});
const zoomBy = k => { view.w *= k; applyView(); };
$('#zin').onclick = () => zoomBy(0.6); $('#zout').onclick = () => zoomBy(1 / 0.6);
$('#zreset').onclick = () => { view = { cx: 0, cy: 0, w: 2 * HW }; applyView(); };
$$('#layer button').forEach(b => b.onclick = () => {
  $$('#layer button').forEach(x => x.classList.toggle('on', x === b));
  const slope = b.dataset.l === 'slope';
  $('#slopeimg', svg).style.display = slope ? '' : 'none';
  $('#slopelegend').classList.toggle('hidden', !slope);
});
new ResizeObserver(() => drawMarks()).observe(mapEl);

function centerOn(s, w) {
  if (s.lat > -80) return;
  const [x, y] = toSvg(s.lat, s.lon);
  if (w) view.w = w;
  const lim = view.w / 2 * 0.7;
  if (Math.abs(x - view.cx) > lim || Math.abs(y - view.cy) > lim || w) { view.cx = x; view.cy = y; }
  applyView();
}

// ------------------------------------------------------------------ inspector
let panelToken = 0;
async function select(s, fromList = false) {
  if (!s) return;
  selected = s;
  store.set('lastSite', siteParams(s));
  const u = new URL(location.href);
  ['id', 'lat', 'lon'].forEach(k => u.searchParams.delete(k));
  for (const [k, v] of Object.entries(siteParams(s))) u.searchParams.set(k, v);
  history.replaceState(null, '', u);
  import('./ui.js').then(m => m.refreshNav());
  renderList();
  if (fromList) centerOn(s, s.lat < -88.5 ? 120 : null); else drawMarks();
  await renderPanel();
}

async function pickCustom(lat, lon) {
  const tok = ++panelToken;
  selected = { custom: true, lat, lon, name: 'Custom point' };
  drawMarks(); renderList();
  $('#panel').innerHTML = `<div class="loading">Computing the skyline at ${fmtLat(lat)}, ${fmtLon(lon)}…<br><span class="faint">720 directions × 300 km of terrain</span></div>`;
  await new Promise(r => setTimeout(r, 30));
  const s = await siteFromKey(`custom:${lat.toFixed(4)},${lon.toFixed(4)}`);
  if (tok !== panelToken) return;
  if (!s) { $('#panel').innerHTML = `<div class="loading">No terrain data here. Custom points must be south of 60° S.</div>`; return; }
  s.slope = await slopeAt(lat, lon);
  await select(s);
}

async function renderPanel() {
  const tok = ++panelToken, s = selected, y = year();
  let m = yearSummary(s, y);
  if (!m) {
    $('#panel').innerHTML = `<div class="loading">Computing ${y} statistics…</div>`;
    m = await yearStats(s, y);
    if (tok !== panelToken) return;
  }
  const st = await statusAt(s, state.t, 400);
  if (tok !== panelToken) return;
  const tagTxt = s.custom ? 'your point' : s.group === 'artemis3' ? 'Artemis III candidate' : s.status;
  const nowLine = st ? `
    <div class="inner" style="display:grid;gap:8px">
      <div class="mono muted" style="font-size:11px">AT ${esc(new Date(state.t).toISOString().slice(0, 16).replace('T', ' '))} UTC</div>
      ${statusRow('sun', st.sun)}${statusRow('earth', st.earth)}
    </div>` : '';
  $('#panel').innerHTML = `
    <div style="padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:16px">
      <span class="tag ${s.custom ? 'earth' : ''}">${esc(tagTxt)}</span>
      <h2 style="font:italic 34px/1.1 var(--serif);margin:8px 0 6px">${esc(s.custom ? 'Custom point' : shortName(s))}</h2>
      <div class="mono muted" style="font-size:13px">${fmtCoords(s)}${s.terrain ? ` · ground ${fmtNum(s.ground_m)} m` : ''}</div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
      <div class="stat"><div style="display:flex;justify-content:space-between"><span class="serif sun" style="font-size:19px">Sunlight</span><span class="ms sun">wb_sunny</span></div>
        <div class="v">${fmtPct(m.sunPct)}</div><div class="l">of ${y} in sunlight</div><div class="bar"><i style="width:${m.sunPct}%;background:var(--sun)"></i></div></div>
      <div class="stat"><div style="display:flex;justify-content:space-between"><span class="serif earth" style="font-size:19px">Earth</span><span class="ms earth">public</span></div>
        <div class="v">${fmtPct(m.earthPct)}</div><div class="l">of ${y} with Earth in view</div><div class="bar"><i style="width:${m.earthPct}%;background:var(--earth)"></i></div></div>
    </div>
    <p style="margin:16px 0">${esc(verdict(m))}</p>
    <div style="margin-bottom:16px">
      <div class="kv"><span>Longest night</span><span>${fmtLong(m.nightH)}<span class="x-only muted"> (${m.nightH} h)</span></span></div>
      <div class="kv"><span>Longest time without Earth</span><span>${fmtLong(m.noEarthH)}<span class="x-only muted"> (${m.noEarthH} h)</span></span></div>
      <div class="kv"><span>Energy per day, 1 m² panel</span><span>${fmtNum(m.energyWhDay)} Wh</span></div>
      ${s.custom ? `<div class="kv"><span>Local slope (240 m)</span><span class="${s.slope > 15 ? 'bad' : s.slope > 10 ? 'sun' : 'ok'}">${s.slope.toFixed(1)}°</span></div>` : ''}
      ${s.snapped_m ? `<div class="kv x-only"><span>Moved to flat high ground</span><span>${fmtNum(s.snapped_m)} m (slope ${s.slope_deg}°)</span></div>` : ''}
      ${!s.terrain ? `<div class="kv"><span>Horizon</span><span class="muted">flat (no polar terrain data)</span></div>` : ''}
      ${s.source ? `<div class="kv x-only"><span>Source</span><span>${s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener" style="text-decoration:underline dotted">${esc(s.source)}</a>` : esc(s.source)}</span></div>` : ''}
    </div>
    ${nowLine}
    ${s.custom ? `<p class="note" style="margin-top:12px">${esc(s.notes)}</p>` : ''}
    <div style="display:grid;gap:10px;margin-top:18px">
      <a class="btn" href="${href('site', siteParams(s))}">Open site detail <span class="ms" style="font-size:18px">arrow_forward</span></a>
      <button class="btn ghost" id="addcmp"><span class="ms muted" style="font-size:18px">add</span> Add to compare</button>
    </div>`;
  $('#addcmp').onclick = () => { const l = addCompare(siteKey(s)); toast(`Added. Compare now has ${l.length} site${l.length > 1 ? 's' : ''}. <a href="${href('compare')}" style="color:var(--earth);text-decoration:underline">Open compare →</a>`, 3500); };
}
function statusRow(body, b) {
  const isSun = body === 'sun';
  const word = isSun ? (b.visible ? 'Sunlit' : 'In shadow') : (b.visible ? 'Earth in view' : 'Earth hidden');
  const next = isSun ? (b.visible ? 'sunset' : 'sunrise') : (b.visible ? 'Earthset' : 'Earthrise');
  const when = b.nextChange ? `${next} in ${fmtDur(b.nextChange - state.t)}` : `no ${next} in the data`;
  return `<div style="font-size:13px">
    <div><span class="${isSun ? 'sun' : 'earth'}">${isSun ? '☀' : '◉'}</span> <b style="font-weight:500">${word}</b>
      <span class="x-only mono muted" style="font-size:11px"> · ${fmtDeg(b.margin)} vs skyline</span></div>
    <div class="mono muted" style="font-size:12px;padding-left:18px">${when}</div></div>`;
}

onTime(() => { renderList(); drawMarks(); if (selected) renderPanel(); });
document.addEventListener('modechange', () => {});

// ------------------------------------------------------------------ start
renderChips(); applyView();
$('#cgo').onclick = () => {
  const lat = parseFloat($('#clat').value), lon = parseFloat($('#clon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat > -60 || lat < -90) { toast('Enter a latitude between −90 and −60, and a longitude.'); return; }
  pickCustom(lat, ((lon + 540) % 360) - 180).then(() => centerOn(selected, 60));
};
const q0 = new URLSearchParams(location.search);
if (q0.get('lat') && q0.get('lon')) pickCustom(+q0.get('lat'), +q0.get('lon'));
else select(sites.find(s => s.id === (q0.get('id') || 'shackleton_rim_sr1')) ?? sites[0]);

// explore.js — site list, polar map, and the selected-site panel.
import {
  initShell, onTime, state, $, $$, esc, href, siteParams, store, toast, loadSites, siteFromKey, siteKey, addCompare, refreshNav,
  fmtLat, fmtLon, fmtCoords, fmtNum, fmtPct, fmtLong, fmtDur, fmtDeg, yearSummary, verdict, shortName, countUp,
} from './ui.js';
import { prepareSite, yearStats, statusAt, slopeAt } from './engine.js';
import { toPolarXY, fromPolarXY } from './geo.js';
import { mapMeta, dataUrl } from './data.js';

await initShell('explore');

const FILTERS = [
  ['all', 'All', () => true],
  ['artemis3', 'Artemis III', s => s.group === 'artemis3'],
  ['past', 'Past landings', s => /^landed/.test(s.status)],
  ['planned', 'Planned', s => /^planned/.test(s.status)],
  ['reference', 'Reference', s => s.group === 'reference'],
];
const sites = (await loadSites()).map(prepareSite);
let filter = store.get('filter', 'all'), query = '';
let selected = null;
const year = () => new Date(state.t).getUTCFullYear();
const SUN = '<span class="ms sun" style="font-size:13px">wb_sunny</span>', EARTH = '<span class="ms earth" style="font-size:13px">public</span>';

// ------------------------------------------------------------------ list
function renderChips() {
  $('#chips').innerHTML = FILTERS.map(([k, label, f]) =>
    `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${label} (${sites.filter(f).length})</button>`).join('');
  $$('#chips .chip').forEach(b => b.onclick = () => { filter = b.dataset.f; store.set('filter', filter); renderChips(); renderList(); drawMarks(); });
}
function renderList() {
  const f = FILTERS.find(x => x[0] === filter)[2], y = year();
  const q = query.trim().toLowerCase();
  const list = sites.filter(f).filter(s => !q || `${s.name} ${s.agency ?? ''} ${s.status}`.toLowerCase().includes(q))
    .sort((a, b) => (b.summary[y]?.sun_pct ?? 0) - (a.summary[y]?.sun_pct ?? 0));
  $('#yearlab').textContent = `by sunlight · ${y}`;
  $('#list').innerHTML = list.length ? list.map(s => {
    const m = yearSummary(s, y);
    return `<div class="item ${selected?.id === s.id ? 'on' : ''}" data-id="${s.id}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span class="n">${esc(shortName(s))}</span><span class="c">${fmtLat(s.lat)}</span></div>
      <div class="pp"><span class="sun">${SUN} ${fmtPct(m?.sunPct)} Sun</span><span class="earth">${EARTH} ${fmtPct(m?.earthPct)} Earth</span></div>
    </div>`;
  }).join('') : '<div class="loading">No site matches.</div>';
  $$('#list .item').forEach(el => el.onclick = () => select(sites.find(s => s.id === el.dataset.id), true));
  const on = $('#list .item.on'), L = $('#list');
  if (on && (on.offsetTop < L.scrollTop || on.offsetTop + on.offsetHeight > L.scrollTop + L.clientHeight)) L.scrollTop = on.offsetTop - 8;
}
$('#q').addEventListener('input', e => { query = e.target.value; renderList(); });

// ------------------------------------------------------------------ map
const meta = await mapMeta();
const HW = meta.half_width_m / 1000;
const mapEl = $('#map'), tip = $('#tip');
const NS = 'http://www.w3.org/2000/svg';
let view = { cx: 0, cy: 0, w: 2 * HW };
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
mapEl.prepend(svg);
const RINGS = [85, 88];
const ringR = lat => Math.hypot(...toPolarXY(lat, 0)) / 1000;
svg.innerHTML = `<defs><clipPath id="disk"><circle r="${HW}"/></clipPath></defs>
  <g clip-path="url(#disk)">
    <image href="${dataUrl('map/relief_80S.jpg')}" x="${-HW}" y="${-HW}" width="${2 * HW}" height="${2 * HW}" preserveAspectRatio="none"/>
    <image id="slopeimg" href="${dataUrl('map/slope_80S.png')}" x="${-HW}" y="${-HW}" width="${2 * HW}" height="${2 * HW}" preserveAspectRatio="none" style="display:none"/>
  </g>
  <g fill="none" stroke="#57B8E8" stroke-opacity=".4">
    ${RINGS.map(l => `<circle r="${ringR(-l)}" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>`).join('')}
    ${[0, 90, 180, 270].map(lon => { const [x, y] = toPolarXY(-80, lon); return `<line x2="${x / 1000}" y2="${-y / 1000}" stroke-opacity=".5" stroke-dasharray="2 5" vector-effect="non-scaling-stroke"/>`; }).join('')}
  </g><g id="labels"></g><g id="marks"></g>`;
const toSvg = (lat, lon) => { const [x, y] = toPolarXY(lat, lon); return [x / 1000, -y / 1000]; };
const kmPerPx = () => view.w / (mapEl.clientWidth || 500);

function applyView() {
  view.w = Math.min(2 * HW, Math.max(4, view.w));
  const lim = HW - view.w / 2;
  view.cx = Math.max(-lim, Math.min(lim, view.cx)); view.cy = Math.max(-lim, Math.min(lim, view.cy));
  svg.setAttribute('viewBox', `${view.cx - view.w / 2} ${view.cy - view.w / 2} ${view.w} ${view.w}`);
  drawMarks();
}
function drawMarks() {
  const px = kmPerPx(), zoomed = view.w < 2 * HW / 3.5, fs = 10.5 * px;
  const txt = (x, y, t, anchor = 'start') => `<text x="${x}" y="${y}" font-size="${fs}" fill="#B9C3D3" text-anchor="${anchor}" font-family="Inter" font-weight="600" paint-order="stroke" stroke="#05080F" stroke-width="${2.5 * px}">${t}</text>`;
  let lab = RINGS.map(l => txt(4 * px, -ringR(-l) - 4 * px, `${l}° S`)).join('');
  lab += txt(...toSvg(-80.6, 0), '0°', 'middle') + txt(...toSvg(-80.9, 90), '90° E', 'end') + txt(...toSvg(-80.9, -90), '90° W') + txt(...toSvg(-81, 180), '180°', 'middle');
  lab += `<line x1="${-6 * px}" x2="${6 * px}" stroke="#E6EAF2" stroke-width="${px}"/><line y1="${-6 * px}" y2="${6 * px}" stroke="#E6EAF2" stroke-width="${px}"/>`;
  $('#labels', svg).innerHTML = lab;
  const y = year(), f = FILTERS.find(x => x[0] === filter)[2], r = 6 * px;
  let m = '';
  for (const s of sites) {
    if (s.lat > -80 || !f(s)) continue;
    const [x, yy] = toSvg(s.lat, s.lon), on = selected?.id === s.id;
    m += `<g class="mk" data-id="${s.id}" transform="translate(${x} ${yy})" style="cursor:pointer">
      <circle r="${r * 2.4}" fill="transparent"/>
      ${on ? `<circle r="${r * 2.1}" fill="rgba(87,184,232,.15)" stroke="#57B8E8" stroke-width="${1.5 * px}"><animate attributeName="r" values="${r * 1.4};${r * 3};${r * 1.4}" dur="2.4s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="1;.1;1" dur="2.4s" repeatCount="indefinite"/></circle>` : ''}
      <circle r="${r}" fill="${on ? '#57B8E8' : '#E6EAF2'}" stroke="#05080F" stroke-width="${1.5 * px}"/>
      ${on || zoomed ? txt(r * 1.8, r * .5, esc(shortName(s))) : ''}</g>`;
  }
  if (selected?.custom) {
    const [x, yy] = toSvg(selected.lat, selected.lon);
    m += `<g transform="translate(${x} ${yy})"><path d="M0 0 L${-5 * px} ${-12 * px} A${6 * px} ${6 * px} 0 1 1 ${5 * px} ${-12 * px} Z" fill="#F2B544" stroke="#05080F" stroke-width="${px}"/><circle cy="${-15 * px}" r="${2.3 * px}" fill="#05080F"/></g>`;
  }
  $('#marks', svg).innerHTML = m;
}
let drag = null;
const svgPoint = ev => { const r = mapEl.getBoundingClientRect(); return [view.cx + ((ev.clientX - r.left) / r.width - .5) * view.w, view.cy + ((ev.clientY - r.top) / r.height - .5) * view.w]; };
mapEl.addEventListener('wheel', ev => {
  ev.preventDefault();
  const [px, py] = svgPoint(ev), k = ev.deltaY > 0 ? 1.25 : 0.8;
  view.cx = px + (view.cx - px) * k; view.cy = py + (view.cy - py) * k; view.w *= k; applyView();
}, { passive: false });
mapEl.addEventListener('pointerdown', ev => { drag = { x: ev.clientX, y: ev.clientY, cx: view.cx, cy: view.cy, moved: false }; mapEl.setPointerCapture(ev.pointerId); });
mapEl.addEventListener('pointermove', ev => {
  if (drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) { drag.moved = true; mapEl.classList.add('drag'); tip.classList.add('hidden'); }
    if (drag.moved) { const k = view.w / mapEl.clientWidth; view.cx = drag.cx - dx * k; view.cy = drag.cy - dy * k; applyView(); }
    return;
  }
  const g = document.elementsFromPoint(ev.clientX, ev.clientY).find(e => e.closest?.('.mk'))?.closest('.mk');
  if (!g) { tip.classList.add('hidden'); return; }
  const s = sites.find(x => x.id === g.dataset.id), m = yearSummary(s, year()), box = mapEl.parentElement.getBoundingClientRect();
  tip.innerHTML = `<div class="serif" style="font-weight:600;font-size:14px">${esc(shortName(s))}</div><div class="muted" style="font-size:11px">${fmtCoords(s)} · ${fmtNum(s.ground_m)} m</div>
    <div style="display:flex;gap:14px;margin-top:4px;font-weight:600"><span class="sun">${fmtPct(m.sunPct)} Sun</span><span class="earth">${fmtPct(m.earthPct)} Earth</span></div>`;
  tip.style.left = `${ev.clientX - box.left}px`; tip.style.top = `${ev.clientY - box.top}px`;
  tip.classList.remove('hidden');
});
mapEl.addEventListener('pointerleave', () => tip.classList.add('hidden'));
mapEl.addEventListener('pointerup', ev => {
  const d = drag; drag = null; mapEl.classList.remove('drag');
  if (!d || d.moved) return;
  const g = document.elementsFromPoint(ev.clientX, ev.clientY).find(e => e.closest?.('.mk'));
  if (g) { select(sites.find(s => s.id === g.closest('.mk').dataset.id)); return; }
  const [x, y] = svgPoint(ev);
  if (Math.hypot(x, y) > HW) return;
  const [lat, lon] = fromPolarXY(x * 1000, -y * 1000);
  pickCustom(lat, lon);
});
const zoomBy = k => { view.w *= k; applyView(); };
$('#zin').onclick = () => zoomBy(0.6); $('#zout').onclick = () => zoomBy(1 / 0.6);
$('#zreset').onclick = () => { view = { cx: 0, cy: 0, w: 2 * HW }; applyView(); };
$('#droppin').onclick = () => { const [lat, lon] = fromPolarXY(view.cx * 1000, -view.cy * 1000); pickCustom(lat, lon); };
$$('#layer button').forEach(b => b.onclick = () => {
  $$('#layer button').forEach(x => x.classList.toggle('on', x === b));
  $('#slopeimg', svg).style.display = b.dataset.l === 'slope' ? '' : 'none';
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

// ------------------------------------------------------------------ selected-site panel
let token = 0;
async function select(s, fromList = false) {
  if (!s) return;
  selected = s;
  store.set('lastSite', siteParams(s));
  const u = new URL(location.href);
  ['id', 'lat', 'lon'].forEach(k => u.searchParams.delete(k));
  for (const [k, v] of Object.entries(siteParams(s))) u.searchParams.set(k, v);
  history.replaceState(null, '', u);
  refreshNav(); renderList();
  if (fromList) centerOn(s, s.lat < -88.5 ? 120 : null); else drawMarks();
  await renderPanel();
  const p = $('#panel'); p.classList.remove('fadein'); void p.offsetWidth; p.classList.add('fadein');
  countUp($$('#panel .ministat .v'), 700);
}
async function pickCustom(lat, lon) {
  const tok = ++token;
  selected = { custom: true, lat, lon, name: 'Custom point' };
  drawMarks(); renderList();
  $('#panel').innerHTML = `<section class="card loading">Computing the skyline at ${fmtLat(lat)}, ${fmtLon(lon)}…<br><span class="faint">720 directions × 300 km of terrain</span></section>`;
  await new Promise(r => setTimeout(r, 30));
  const s = await siteFromKey(`custom:${lat.toFixed(4)},${lon.toFixed(4)}`);
  if (tok !== token) return;
  if (!s) { $('#panel').innerHTML = `<section class="card loading">No terrain data here. Custom points must be south of 60° S.</section>`; return; }
  await select(s);
}
async function renderPanel() {
  const tok = ++token, s = selected, y = year();
  let m = yearSummary(s, y);
  if (!m) {
    $('#panel').innerHTML = `<section class="card loading">Computing ${y} statistics…</section>`;
    m = await yearStats(s, y);
  }
  const st = await statusAt(s, state.t, 400);
  const slope = s.slope_deg ?? (s.terrain ? await slopeAt(s.lat, s.lon) : null);
  if (tok !== token) return;
  const tagTxt = s.custom ? 'Your point' : s.group === 'artemis3' ? 'Artemis III' : s.group === 'reference' ? 'Reference' : (s.status ?? '').split(' ')[0];
  const row = (icon, label, val, cls = '') => `<div class="kv"><span><span class="ms" style="font-size:15px">${icon}</span>${label}</span><span class="${cls}">${val}</span></div>`;
  const nowRow = (isSun, b) => {
    const word = isSun ? (b.visible ? 'Sunlit' : 'In shadow') : (b.visible ? 'Earth in view' : 'Earth hidden');
    const next = isSun ? (b.visible ? 'sunset' : 'sunrise') : (b.visible ? 'Earthset' : 'Earthrise');
    return `<div class="kv" style="font-size:12.5px"><span style="white-space:nowrap"><span class="dot" style="background:${isSun ? 'var(--sun)' : 'var(--earth)'};opacity:${b.visible ? 1 : .35}"></span>${word}</span>
      <span class="muted" style="font-weight:500;white-space:nowrap">${b.nextChange ? `${next} in ${fmtDur(b.nextChange - state.t)}` : '—'}</span></div>`;
  };
  $('#panel').innerHTML = `
    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="label earth">Selected site</span><span class="tag earth">${esc(tagTxt)}</span></div>
      <h2 style="font-size:24px;margin:10px 0 4px">${esc(s.custom ? 'Custom point' : shortName(s))}</h2>
      <div class="muted" style="font-size:12.5px">${fmtCoords(s)}${s.terrain ? ` · Elev. ${fmtNum(s.ground_m)} m` : ''}</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">
        <div class="ministat"><div class="label">${'<span class="ms sun" style="font-size:13px">wb_sunny</span>'} Sunlight</div><div class="v sun">${fmtPct(m.sunPct)}</div></div>
        <div class="ministat"><div class="label">${'<span class="ms earth" style="font-size:13px">public</span>'} Earth</div><div class="v earth">${fmtPct(m.earthPct)}</div></div>
      </div>
      <p class="note" style="margin:12px 0 0">${esc(verdict(m))} <span class="faint">(${y})</span></p>
    </section>
    <section class="card">
      <div class="label" style="margin-bottom:12px">Key metrics</div>
      ${row('dark_mode', 'Longest night', `${fmtLong(m.nightH)}<span class="x-only muted"> · ${m.nightH} h</span>`)}
      ${row('settings_input_antenna', 'Longest w/o Earth', `${fmtLong(m.noEarthH)}<span class="x-only muted"> · ${m.noEarthH} h</span>`, 'earth')}
      ${row('bolt', 'Energy per day', `${fmtNum(m.energyWhDay)} Wh`)}
      ${slope != null ? row('landscape', 'Slope', `${slope.toFixed(1)}°`, slope > 15 ? 'bad' : slope > 10 ? 'sun' : 'ok') : row('landscape', 'Horizon', 'flat (no polar terrain)', 'muted')}
      ${st ? `<div class="label" style="margin:16px 0 10px">Right now</div>${nowRow(true, st.sun)}${nowRow(false, st.earth)}` : ''}
      ${s.custom ? `<p class="note" style="margin:12px 0 0">${esc(s.notes)}</p>` : ''}
      ${s.source ? `<p class="note x-only" style="margin:12px 0 0">Source: ${s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener" style="text-decoration:underline dotted">${esc(s.source)}</a>` : esc(s.source)}${s.snapped_m ? ` · moved ${fmtNum(s.snapped_m)} m to flat high ground` : ''}</p>` : ''}
    </section>
    <div class="stack" style="gap:10px">
      <a class="btn wide" href="${href('site', siteParams(s))}">Open site detail <span class="ms" style="font-size:16px">arrow_forward</span></a>
      <button class="btn ghost wide" id="addcmp"><span class="ms" style="font-size:16px">add</span> Add to compare</button>
    </div>`;
  $('#addcmp').onclick = () => { const l = addCompare(siteKey(s)); toast(`Added. Compare has ${l.length} site${l.length > 1 ? 's' : ''}. <a href="${href('compare')}" style="color:var(--earth);text-decoration:underline">Open compare →</a>`, 3500); };
}

onTime(() => { renderList(); drawMarks(); if (selected) renderPanel(); });

// ------------------------------------------------------------------ start
renderChips(); applyView();
$('#cgo').onclick = () => {
  const lat = parseFloat($('#clat').value), lon = parseFloat($('#clon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat > -60 || lat < -90) { toast('Enter a latitude between −90 and −60, and a longitude.'); return; }
  pickCustom(lat, ((lon + 540) % 360) - 180).then(() => centerOn(selected, 60));
};
const q0 = new URLSearchParams(location.search);
if (q0.get('lat') && q0.get('lon')) pickCustom(+q0.get('lat'), +q0.get('lon'));
else select(sites.find(s => s.id === (q0.get('id') || 'a3_malapert_massif')) ?? sites[0]);

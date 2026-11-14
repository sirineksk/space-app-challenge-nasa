// compare.js — sites side by side, or one site on two dates. Metrics over a 30-day mission window.
import {
  initShell, onTime, state, $, $$, esc, href, siteParams, siteKey, siteFromKey, store, toast, loadSites,
  fmtCoords, fmtNum, fmtPct, fmtLong, fmtDate, fmtDay, isoMin, parseIsoUTC, DAY, getCompare, setCompare,
  yearSummary, shortName, timelineSVG,
} from './ui.js';
import { series, summarize } from './engine.js';
import { HOUR } from './data.js';

await initShell('compare');
const DAYS = 30;
const catalog = await loadSites();
const q = new URLSearchParams(location.search);
let mode = q.get('mode') === 'dates' ? 'dates' : 'sites';
let t2 = q.get('t2') ? parseIsoUTC(q.get('t2')) : null;
let dateSite = q.get('site') ?? getCompare()[0] ?? 'shackleton_rim_sr1';
const siteCache = new Map();
const getSite = async k => { if (!siteCache.has(k)) siteCache.set(k, await siteFromKey(k)); return siteCache.get(k); };

const METRICS = [
  ['sunPct', 'Time in sunlight', v => fmtPct(v), 'max', 'sun'],
  ['nightH', 'Longest night', v => fmtLong(v), 'min', 'sun'],
  ['earthPct', 'Time Earth in view', v => fmtPct(v), 'max', 'earth'],
  ['noEarthH', 'Longest time without Earth', v => fmtLong(v), 'min', 'earth'],
  ['energyWhDay', 'Energy per day, 1 m² panel', v => `${fmtNum(v)} Wh`, 'max', 'sun'],
];

function setUrl() {
  const u = new URL(location.href);
  u.searchParams.set('mode', mode);
  if (mode === 'dates') { u.searchParams.set('site', dateSite); u.searchParams.set('t2', isoMin(t2)); }
  else ['site', 't2'].forEach(k => u.searchParams.delete(k));
  history.replaceState(null, '', u);
}

// ------------------------------------------------------------------ toolbars
const options = (sel, exclude = []) => [['artemis3', 'Artemis III'], ['reference', 'Reference'], ['china', 'China'], ['clps', 'NASA CLPS'], ['india', 'India'], ['japan', 'Japan'], ['apollo', 'Apollo']]
  .map(([g, l]) => `<optgroup label="${l}">${catalog.filter(s => s.group === g && !exclude.includes(s.id)).map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(shortName(s))}</option>`).join('')}</optgroup>`).join('');

function renderTools(cols) {
  if (mode === 'sites') {
    const list = getCompare();
    $('#tools').innerHTML = `
      <select class="field" id="add" style="width:auto;max-width:230px" ${list.length >= 4 ? 'disabled' : ''}><option value="">+ Add site${list.length >= 4 ? ' (max 4)' : ''}</option>${options('', list)}</select>
      <button class="btn sm ghost" id="csv"><span class="ms" style="font-size:16px">file_download</span> Export CSV</button>
      <button class="btn sm ghost" onclick="print()"><span class="ms" style="font-size:16px">print</span> Print</button>`;
    $('#add').onchange = e => { if (!e.target.value) return; setCompare([...getCompare(), e.target.value]); render(); };
  } else {
    $('#tools').innerHTML = `
      <select class="field" id="dsite" style="width:auto;max-width:230px">${options(dateSite)}</select>
      <label class="mono muted" style="font-size:12px">Date B</label>
      <div class="when"><input type="datetime-local" id="t2" step="60" value="${isoMin(t2)}" min="${isoMin(state.range.startMs)}" max="${isoMin(state.range.endMs)}"><span class="utc">UTC</span></div>
      <button class="btn sm ghost" id="csv"><span class="ms" style="font-size:16px">file_download</span> Export CSV</button>`;
    $('#dsite').onchange = e => { dateSite = e.target.value; render(); };
    $('#t2').onchange = e => { const v = parseIsoUTC(e.target.value); if (v != null) { t2 = v; render(); } };
  }
  $('#csv').onclick = () => exportCsv(cols);
}

// ------------------------------------------------------------------ columns
async function buildCols() {
  if (mode === 'sites') {
    const keys = getCompare();
    const cols = [];
    for (const k of keys) {
      const s = await getSite(k);
      if (!s) continue;
      const ser = await series(s, state.t, DAYS * 24);
      cols.push({ key: k, site: s, t: state.t, title: s.custom ? 'Custom point' : shortName(s), sub: fmtCoords(s), ser, m: summarize(ser) });
    }
    return cols;
  }
  const s = await getSite(dateSite);
  t2 ??= Math.min(state.t + 14 * DAY, state.range.endMs - DAYS * DAY);
  const out = [];
  for (const [lab, t] of [['A', state.t], ['B', t2]]) {
    const ser = await series(s, t, DAYS * 24);
    out.push({ key: lab, site: s, t, title: `Date ${lab}`, sub: fmtDate(t), ser, m: summarize(ser) });
  }
  return out;
}

function renderCols(cols) {
  const el = $('#cols');
  el.style.setProperty('--n', Math.max(cols.length, mode === 'sites' ? 2 : 2));
  if (!cols.length) { el.innerHTML = `<div class="card loading" style="grid-column:1/-1">No sites yet. Add some with “+ Add site”, or from Explore.</div>`; return; }
  const best = {};
  for (const [k, , , dir] of METRICS) {
    const vals = cols.map(c => c.m[k]).filter(Number.isFinite);
    best[k] = vals.length && cols.length > 1 ? (dir === 'max' ? Math.max(...vals) : Math.min(...vals)) : null;
    if (vals.length > 1 && vals.every(v => v === vals[0])) best[k] = null;    // all equal: nobody "wins"
  }
  const y = new Date(state.t).getUTCFullYear();
  el.innerHTML = cols.map(c => {
    const ys = yearSummary(c.site, y);
    return `<section class="card" style="padding:18px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;padding-bottom:10px;border-bottom:1px solid var(--line);margin-bottom:4px">
        <div style="min-width:0"><a href="${href('site', siteParams(c.site))}" style="font:italic 24px/1.1 var(--serif)">${esc(c.title)}</a>
          <div class="mono muted" style="font-size:11px;margin-top:4px">${esc(c.sub)}</div></div>
        ${mode === 'sites' ? `<button class="btn sm ghost" data-rm="${esc(c.key)}" title="Remove" style="padding:4px"><span class="ms" style="font-size:15px">close</span></button>` : ''}
      </div>
      ${METRICS.map(([k, label, f, , col]) => {
        const win = best[k] != null && c.m[k] === best[k];
        return `<div class="metric ${win ? 'win-' + col : ''}"><div class="l"><span>${label}</span>${win ? `<span class="best ${col}">best</span>` : ''}</div><div class="v">${f(c.m[k])}</div></div>`;
      }).join('')}
      ${mode === 'sites' && ys ? `<div class="note mono" style="margin-top:8px">Whole ${y}: <span class="sun">☀ ${fmtPct(ys.sunPct, 0)}</span> · <span class="earth">◉ ${fmtPct(ys.earthPct, 0)}</span></div>` : ''}
    </section>`;
  }).join('');
  $$('[data-rm]').forEach(b => b.onclick = () => { setCompare(getCompare().filter(k => k !== b.dataset.rm)); render(); });
}

function renderTimeline(cols) {
  const el = $('#tl');
  if (mode === 'sites') {
    el.innerHTML = cols.length ? timelineSVG(cols.map(c => ({ label: c.title, sub: `☀ ${fmtPct(c.m.sunPct, 0)} · ◉ ${fmtPct(c.m.earthPct, 0)}`, series: c.ser })),
      { t0: cols[0].ser.t0, hours: DAYS * 24, now: state.t, width: el.clientWidth, labelW: 170 }) : '';
    $('#tlRange').textContent = `(${fmtDay(state.t)} – ${fmtDay(state.t + (DAYS * 24 - 1) * HOUR)} ${new Date(state.t + DAYS * DAY).getUTCFullYear()})`;
  } else {
    el.innerHTML = cols.map(c => timelineSVG([{ label: c.title, sub: `☀ ${fmtPct(c.m.sunPct, 0)} · ◉ ${fmtPct(c.m.earthPct, 0)}`, series: c.ser }],
        { t0: c.ser.t0, hours: DAYS * 24, now: c.t, width: el.clientWidth, labelW: 170 })).join('<div style="height:10px"></div>');
    $('#tlRange').textContent = '(each from its own landing date)';
  }
}

function renderSummary(cols) {
  const S = $('#summary'), N = $('#summaryNote');
  if (cols.length < 2) { S.textContent = 'Add at least two sites to compare.'; N.textContent = ''; return; }
  if (mode === 'sites') {
    const names = arr => arr.map(c => esc(c.title)).join(arr.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');
    const top = (k, dir = 'max') => { const v = (dir === 'max' ? Math.max : Math.min)(...cols.map(c => c.m[k])); return cols.filter(c => c.m[k] === v); };
    const sun = top('sunPct'), earth = top('earthPct'), night = top('nightH', 'min');
    const both = sun.filter(c => earth.includes(c));
    const verb = arr => arr.length > 1 ? 'have' : 'has', verb2 = arr => arr.length > 1 ? 'keep' : 'keeps';
    S.innerHTML = both.length
      ? `<b class="sun">${names(both)}</b> ${both.length > 1 ? 'win' : 'wins'} on both: the most sunlight (${fmtPct(both[0].m.sunPct, 0)}) and the best view of Earth (${fmtPct(both[0].m.earthPct, 0)}).`
      : `<span class="sun">${names(sun)}</span> ${verb(sun)} the most sunlight (${fmtPct(sun[0].m.sunPct, 0)}); <span class="earth">${names(earth)}</span> ${verb2(earth)} the best contact with Earth (${fmtPct(earth[0].m.earthPct, 0)}). No site wins both.`;
    const nightTxt = night[0].m.nightH === 0 ? `${names(night)} ${night.length > 1 ? 'stay' : 'stays'} in sunlight the whole time.`
      : `Shortest night: ${names(night)} (${fmtLong(night[0].m.nightH)}).`;
    N.innerHTML = `Over the 30 days from ${fmtDate(state.t)}. ${nightTxt} Change the date at the top to see how the ranking moves with the seasons.`;
  } else {
    const [a, b] = cols;
    const dSun = Math.round((b.m.sunPct - a.m.sunPct) / 100 * a.ser.n), dEarth = Math.round((b.m.earthPct - a.m.earthPct) / 100 * a.ser.n);
    const part = (d, what) => d === 0 ? `the same ${what}` : `${Math.abs(d)} h ${d > 0 ? 'more' : 'less'} ${what}`;
    S.innerHTML = `Landing on <b>date B</b> instead of date A gives <span class="sun">${part(dSun, 'sunlight')}</span> and <span class="earth">${part(dEarth, 'time in contact with Earth')}</span> in the first 30 days.`;
    N.textContent = `${a.site.custom ? 'Custom point' : shortName(a.site)} · A = ${fmtDate(a.t)} · B = ${fmtDate(b.t)}. Longest night: ${fmtLong(a.m.nightH)} (A) vs ${fmtLong(b.m.nightH)} (B).`;
  }
}

function exportCsv(cols) {
  const rows = [['site', 'case', 'utc', 'sun_visible_fraction', 'sun_elevation_deg', 'sun_azimuth_deg', 'skyline_at_sun_deg', 'earth_visible_fraction', 'earth_elevation_deg', 'earth_azimuth_deg', 'skyline_at_earth_deg', 'power_w_1m2']];
  for (const c of cols) {
    const s = c.ser;
    for (let k = 0; k < s.n; k++) if (s.valid[k])
      rows.push([c.site.custom ? `custom ${c.site.lat.toFixed(4)} ${c.site.lon.toFixed(4)}` : c.site.id, c.title, new Date(s.t0 + k * HOUR).toISOString().slice(0, 16) + 'Z',
        s.sunFrac[k].toFixed(3), s.sunEl[k].toFixed(3), s.sunAz[k].toFixed(2), s.sunHz[k].toFixed(3),
        s.earthFrac[k].toFixed(3), s.earthEl[k].toFixed(3), s.earthAz[k].toFixed(2), s.earthHz[k].toFixed(3), s.power[k].toFixed(1)]);
  }
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `luminaluna_${mode}_${isoMin(state.t).slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`CSV with ${rows.length - 1} hourly rows downloaded.`);
}

// ------------------------------------------------------------------ main
let lastCols = [];
async function render() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  $('#windowNote').innerHTML = mode === 'sites'
    ? `Numbers below are for a <b>30-day mission</b> starting at the date chosen at the top (${fmtDate(state.t)}).`
    : `Date A is the date at the top. Each column covers 30 days from its own date.`;
  const cols = await buildCols();
  lastCols = cols;
  setUrl(); renderTools(cols); renderCols(cols); renderTimeline(cols); renderSummary(cols);
}
$$('#tabs button').forEach(b => b.onclick = () => { mode = b.dataset.m; render(); });
onTime(() => render());
new ResizeObserver(() => renderTimeline(lastCols)).observe($('#tl'));
await render();

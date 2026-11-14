// ui.js — shared page shell (sidebar, date picker, Beginner/Expert), formatting and small widgets.
import { ephemRange, getSite, loadSites, HOUR, dataUrl } from './data.js';
import { prepareSite, customSite, runs, VISIBLE } from './engine.js';

export const DAY = 24 * HOUR;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ storage (never throws)
export const store = {
  get(k, d) { try { const v = localStorage.getItem('luminaluna.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('luminaluna.' + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};

// ------------------------------------------------------------------ formatting
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS = MON;
const p2 = n => String(n).padStart(2, '0');
export const fmtLat = v => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'S' : 'N'}`;
export const fmtLon = v => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'W' : 'E'}`;
export const fmtCoords = s => `${fmtLat(s.lat)}, ${fmtLon(s.lon)}`;
export const fmtNum = (v, d = 0) => Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
export const fmtPct = (v, d = 1) => Number.isFinite(v) ? `${v.toFixed(d)}%` : '–';
export const fmtDeg = (v, d = 2, sign = true) => Number.isFinite(v) ? `${sign && v > 0 ? '+' : ''}${v.toFixed(d)}°` : '–';
export function fmtDate(ms, withYear = true) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}
export const fmtDay = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const fmtDayHM = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${p2(mm)} min`;
  return `${mm} min`;
}
/** Hours as words a beginner understands (and exact hours for experts). */
export const fmtLong = h => !Number.isFinite(h) ? '–' : h < 48 ? `${h} h` : `${(h / 24).toFixed(1)} days`;
export const isoMin = ms => new Date(ms).toISOString().slice(0, 16);   // YYYY-MM-DDTHH:MM (UTC)
export const parseIsoUTC = s => { const t = Date.parse(s.length <= 16 ? s + ':00Z' : s); return Number.isFinite(t) ? t : null; };

// ------------------------------------------------------------------ logo + shell
export const LOGO = `<img class="emblem" src="${new URL('../assets/emblem.png', import.meta.url).href}" alt="LuminaLuna" width="40" height="40">`;

const PAGES = [
  ['explore', 'Explore', 'explore'],
  ['site', 'Site detail', 'radar', 'Site'],
  ['compare', 'Compare', 'compare_arrows'],
  ['learn', 'Learn', 'menu_book'],
];

export const state = { t: null, live: true, range: null, expert: false };
const timeListeners = [];
export const onTime = fn => timeListeners.push(fn);

/** Link to another page, carrying the chosen date if the user picked one. */
export function href(page, params = {}) {
  const u = new URLSearchParams(params);
  if (!state.live && state.t != null) u.set('t', isoMin(state.t));
  const q = u.toString();
  return `${page}.html${q ? '?' + q : ''}`;
}
export const siteParams = s => s.custom ? { lat: s.lat.toFixed(4), lon: s.lon.toFixed(4) } : { id: s.id };

export async function initShell(page) {
  state.range = await ephemRange();
  const q = new URLSearchParams(location.search);
  const qt = q.get('t') ? parseIsoUTC(q.get('t')) : null;
  state.live = qt == null;
  state.t = clampT(qt ?? Date.now());
  state.expert = store.get('expert', false);
  document.body.classList.toggle('expert', state.expert);

  const lastSite = store.get('lastSite', null);
  $('#sidebar').innerHTML = `
    <a class="brand" href="index.html" title="LuminaLuna home">${LOGO}</a>
    <nav class="nav" aria-label="Pages">${PAGES.map(([p, label, icon, short]) => {
      const params = p === 'site' && page !== 'site' && lastSite ? lastSite : {};
      return `<a data-page="${p}" class="${p === page ? 'on' : ''}" ${p === page ? 'aria-current="page"' : ''} href="${p === 'site' && page === 'site' ? '#' : href(p, params)}"><span class="ms">${icon}</span><span class="lbl-l">${label}</span><span class="lbl-s">${short ?? label}</span></a>`;
    }).join('')}</nav>
    <div class="tools">
      <div class="seg" id="mode" role="group" aria-label="Detail level"><button data-m="b">Beginner</button><button data-m="x">Expert</button></div>
      <button class="themebtn" id="theme" aria-label="Switch light or dark theme"></button>
    </div>`;
  if (!$('.backdrop')) document.body.insertAdjacentHTML('afterbegin', '<div class="backdrop" aria-hidden="true"><i class="bd-stars"></i><i class="bd-dust"></i><i class="bd-moon"></i></div>');
  initTheme();

  const c = $('#topbar');
  if (c) {
    c.insertAdjacentHTML('afterbegin', `
      <div class="when" role="group" aria-label="Date and time (UTC). Data covers ${new Date(state.range.startMs).getUTCFullYear()} to ${new Date(state.range.endMs).getUTCFullYear()}">
        <button class="d1" data-dt="-86400000" title="One day earlier">−1 d</button>
        <button data-dt="-3600000" title="One hour earlier" aria-label="One hour earlier"><span class="ms" style="font-size:18px">chevron_left</span></button>
        <button class="date" id="whenBtn" title="Pick a date and time (UTC)"><span class="ms" style="font-size:16px">schedule</span><span id="whenTxt"></span></button>
        <input type="datetime-local" id="when" step="60" tabindex="-1" aria-hidden="true">
        <button data-dt="3600000" title="One hour later" aria-label="One hour later"><span class="ms" style="font-size:18px">chevron_right</span></button>
        <button class="d1" data-dt="86400000" title="One day later">+1 d</button>
        <span class="sep"></span>
        <button class="now" data-now title="Back to the current time">Now</button>
      </div>`);
    const inp = $('#when');
    inp.min = isoMin(state.range.startMs); inp.max = isoMin(state.range.endMs);
    inp.addEventListener('change', () => { const t = parseIsoUTC(inp.value); if (t != null) setTime(t); });
    $('#whenBtn').addEventListener('click', () => {
      try { inp.showPicker(); } catch {
        const v = prompt('Date and time (UTC), e.g. 2026-11-14T14:30', isoMin(state.t));
        const t = v && parseIsoUTC(v.trim()); if (t != null) setTime(t);
      }
    });
    $$('.when button[data-dt]').forEach(b => b.addEventListener('click', () => setTime(state.t + Number(b.dataset.dt))));
    $('.when button[data-now]').addEventListener('click', () => setTime(Date.now(), true));
  }
  $$('#mode button').forEach(b => b.addEventListener('click', () => setExpert(b.dataset.m === 'x')));
  syncControls();
  const cr = $('#credits');
  if (cr) cr.innerHTML = `<span>Terrain: NASA LRO LOLA · Ephemeris: JPL DE421 · validated against JPL Horizons</span>
    <span>LuminaLuna, NASA Space Apps Challenge 2026</span>`;
  // keep "now" ticking when the user hasn't picked a date
  setInterval(() => { if (state.live) { state.t = clampT(Date.now()); syncControls(); emit({ tick: true }); } }, 60000);
}

function clampT(t) {
  const r = state.range;
  return Math.min(Math.max(Math.round(t / 60000) * 60000, r.startMs), r.endMs);
}
export function setTime(t, live = false) {
  state.t = clampT(t); state.live = live;
  const u = new URL(location.href);
  if (live) u.searchParams.delete('t'); else u.searchParams.set('t', isoMin(state.t));
  history.replaceState(null, '', u);
  syncControls(); refreshNav(); emit({});
}
function emit(info) { for (const fn of timeListeners) fn(state.t, info); }
function syncControls() {
  const i = $('#when'); if (i) i.value = isoMin(state.t);
  const w = $('#whenTxt'); if (w) w.textContent = fmtDate(state.t);
  $$('#mode button').forEach(b => b.classList.toggle('on', (b.dataset.m === 'x') === state.expert));
}
// ------------------------------------------------------------------ light / dark
const systemTheme = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'dark'; } };
export const currentTheme = () => document.documentElement.dataset.theme || systemTheme();
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = document.getElementById('theme');
  if (b) { b.innerHTML = ic(t === 'dark' ? 'light_mode' : 'dark_mode', 18); b.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'; }
  document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
}
export function initTheme() {
  applyTheme(store.get('theme', null) ?? systemTheme());
  const b = document.getElementById('theme');
  if (b) b.onclick = () => { const t = currentTheme() === 'dark' ? 'light' : 'dark'; store.set('theme', t); applyTheme(t); };
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!store.get('theme', null)) applyTheme(systemTheme()); }); } catch { /* old browsers */ }
}

export function setExpert(on) {
  state.expert = on; store.set('expert', on);
  document.body.classList.toggle('expert', on); syncControls();
  document.dispatchEvent(new CustomEvent('modechange'));
}
export function refreshNav() {
  const lastSite = store.get('lastSite', null);
  $$('.nav a').forEach(a => {
    const p = a.dataset.page;
    if (a.classList.contains('on') && p === 'site') return;
    a.href = href(p, p === 'site' && lastSite ? lastSite : {});
  });
}

export function toast(msg, ms = 2400) {
  const d = document.createElement('div'); d.className = 'toast'; d.innerHTML = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), ms);
}

// ------------------------------------------------------------------ sites
/** A site from a key: catalog id or "custom:lat,lon". Custom points compute their skyline. */
export async function siteFromKey(key) {
  if (key.startsWith('custom:')) {
    const [lat, lon] = key.slice(7).split(',').map(Number);
    const s = await customSite(lat, lon);
    if (s) s.name = `Custom point ${fmtLat(lat)}, ${fmtLon(lon)}`;
    return s;
  }
  const s = await getSite(key);
  return s ? prepareSite(s) : null;
}
export const thumbUrl = s => s && !s.custom && s.lat <= -80.6 ? dataUrl(`thumbs/${s.id}.jpg`) : new URL('../assets/moon.png', import.meta.url).href;
export const siteKey = s => s.custom ? `custom:${s.lat.toFixed(4)},${s.lon.toFixed(4)}` : s.id;
export const shortName = s => s.name.replace(/^Artemis III: /, '').replace(/ \(ESA study point (\w+)\)/, ' $1');
export { loadSites };

export function getCompare() { return store.get('compare', null) ?? ['shackleton_rim_sr1', 'a3_malapert_massif', 'de_gerlache_rim_gr1', 'a3_nobile_rim_2']; }
export function setCompare(list) { store.set('compare', list.slice(0, 4)); }
export function addCompare(key) {
  const l = getCompare().filter(k => k !== key);
  if (l.length >= 4) l.shift();
  l.push(key); setCompare(l);
  return l;
}

/** Year summary for a site: precomputed for catalog sites, null for custom (compute live). */
export const yearSummary = (s, y) => s.summary?.[y] ? {
  sunPct: s.summary[y].sun_pct, nightH: s.summary[y].night_h, earthPct: s.summary[y].earth_pct,
  noEarthH: s.summary[y].no_earth_h, energyWhDay: s.summary[y].energy_wh,
} : null;

/** One plain sentence describing a site's trade-off. */
export function verdict(m) {
  const sun = m.sunPct, earth = m.earthPct;
  const sunW = sun >= 75 ? 'Sunlit most of the time' : sun >= 55 ? 'Sunlit more than half the time' : sun >= 45 ? 'Sunlit about half the time' : 'Often in shadow';
  const nights = m.nightH >= 24 ? `, with nights up to ${fmtLong(m.nightH)}` : '';
  const earthW = earth >= 95 ? 'Earth almost always in view' : earth >= 60 ? 'Earth in view most of the time'
    : earth >= 40 ? 'Earth in view about half the time' : earth > 0 ? 'Earth hidden most of the time' : 'Earth never in view (far side)';
  const gap = earth < 95 && m.noEarthH >= 24 ? ` (gaps up to ${fmtLong(m.noEarthH)})` : '';
  return `${sunW}${nights}. ${earthW}${gap}.`;
}

// ------------------------------------------------------------------ 30-day timeline (SVG)
/**
 * rows: [{label, sub, series}] — each row draws a Sun band and an Earth band.
 * Returns an SVG string sized for `width` px.
 */
export function timelineSVG(rows, { t0, hours, now, width, labelW = 150, showPower = false, stacked = false }) {
  if (stacked) labelW = 0;
  const lab = stacked ? 20 : 0;
  const W = Math.max(280, width), x0 = labelW, x1 = W - (stacked ? 2 : 10), bandH = 14, gap = 5, rowH = bandH * 2 + gap + 18 + lab, top = 8;
  const H = top + rows.length * rowH + 24 + (showPower ? 70 : 0);
  const X = t => x0 + (t - t0) / (hours * HOUR) * (x1 - x0);
  let g = '';
  // day grid
  const firstDay = Math.ceil(t0 / DAY) * DAY;
  let lastLab = -1e9;
  for (let d = firstDay, i = 0; d <= t0 + hours * HOUR; d += DAY, i++) {
    const x = X(d), dom = new Date(d).getUTCDate();
    const lab = (dom === 1 || dom % 5 === 0) && x - lastLab > 42 && x < x1 - 18;
    if (lab) lastLab = x;
    g += `<line x1="${x}" x2="${x}" y1="${top}" y2="${H - 22}" stroke="var(--plot-grid)" stroke-width="${lab ? 1 : .5}" ${lab ? '' : 'stroke-dasharray="2 3"'}/>`;
    if (lab) g += `<text x="${x}" y="${H - 6}" fill="var(--ink-2)" font-size="10"  text-anchor="middle">${fmtDay(d)}</text>`;
  }
  rows.forEach((r, i) => {
    const y0r = top + i * rowH, s = r.series, y = y0r + lab;
    if (stacked) g += `<text x="0" y="${y0r + 11}" fill="var(--ink)" font-size="12.5"  font-weight="600">${esc(r.label ?? '')}</text>
      <text x="${x1}" y="${y0r + 11}" fill="var(--ink-2)" font-size="10.5"  font-weight="600" text-anchor="end">${esc(r.sub ?? (r.bandLabels ? r.bandLabels.join(' · ') : ''))}</text>`;
    if (labelW > 0 && r.bandLabels) g += `<text x="0" y="${y + 11}" fill="var(--sun-fill)" font-size="11" >${esc(r.bandLabels[0])}</text>
      <text x="0" y="${y + bandH + gap + 11}" fill="var(--earth-fill)" font-size="11" >${esc(r.bandLabels[1])}</text>`;
    else if (labelW > 0) g += `<text x="0" y="${y + 13}" fill="var(--ink)" font-size="14" font-weight="600">${esc(r.label)}</text>
      <text x="0" y="${y + 29}" fill="var(--ink-2)" font-size="10" >${esc(r.sub ?? '')}</text>`;
    g += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${bandH}" rx="3" fill="var(--plot-bg)"/>`;
    g += `<rect x="${x0}" y="${y + bandH + gap}" width="${x1 - x0}" height="${bandH}" rx="3" fill="var(--plot-bg)"/>`;
    for (const [a, b] of runs(s.n, k => s.valid[k] && s.sunFrac[k] >= VISIBLE))
      g += `<rect x="${X(s.t0 + a * HOUR)}" y="${y}" width="${Math.max(1, X(s.t0 + b * HOUR) - X(s.t0 + a * HOUR))}" height="${bandH}" fill="var(--sun-fill)"><title>Sunlight ${fmtDayHM(s.t0 + a * HOUR)} → ${fmtDayHM(s.t0 + b * HOUR)}</title></rect>`;
    for (const [a, b] of runs(s.n, k => s.valid[k] && s.earthFrac[k] >= VISIBLE))
      g += `<rect x="${X(s.t0 + a * HOUR)}" y="${y + bandH + gap}" width="${Math.max(1, X(s.t0 + b * HOUR) - X(s.t0 + a * HOUR))}" height="${bandH}" fill="var(--earth-fill)"><title>Earth in view ${fmtDayHM(s.t0 + a * HOUR)} → ${fmtDayHM(s.t0 + b * HOUR)}</title></rect>`;
    for (const [a, b] of runs(s.n, k => !s.valid[k]))
      g += `<rect x="${X(s.t0 + a * HOUR)}" y="${y}" width="${X(s.t0 + b * HOUR) - X(s.t0 + a * HOUR)}" height="${bandH * 2 + gap}" fill="url(#nodata)"/>`;
  });
  if (showPower && rows[0]) {
    const s = rows[0].series, y0 = top + rows.length * rowH + 4, h = 56;
    let max = 0; for (let k = 0; k < s.n; k++) max = Math.max(max, s.power[k]);
    max = Math.max(max, 1);
    let d = '';
    for (let k = 0; k < s.n; k++) if (s.valid[k]) d += `${d ? 'L' : 'M'}${X(s.t0 + (k + .5) * HOUR).toFixed(1)},${(y0 + h - s.power[k] / max * h).toFixed(1)}`;
    g += `<text x="${labelW ? 0 : x0}" y="${y0 + 10}" fill="var(--ink-2)" font-size="10" >${labelW ? 'Power (W)' : ''}</text>
      <text x="${labelW ? 0 : x0}" y="${y0 + 24}" fill="var(--ink-3)" font-size="10" >${labelW ? 'max ' + Math.round(max) : ''}</text>
      <path d="${d}" fill="none" stroke="var(--sun-fill)" stroke-width="1.3" opacity=".9"/>`;
  }
  if (now >= t0 && now <= t0 + hours * HOUR) {
    const x = X(now);
    g += `<line x1="${x}" x2="${x}" y1="${top - 4}" y2="${H - 20}" stroke="var(--ink)" stroke-width="1.5"/>
      <circle cx="${x}" cy="${top - 4}" r="3" fill="var(--ink)"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-x0="${x0}" data-x1="${x1}" style="cursor:pointer">
    <defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface-2)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" stroke-width="2"/></pattern></defs>${g}</svg>`;
}
/** Click on a timeline -> time (ms). */
export function timelinePick(svg, ev, t0, hours) {
  const r = svg.getBoundingClientRect(), W = Number(svg.getAttribute('width'));
  const x = (ev.clientX - r.left) * W / r.width, x0 = +svg.dataset.x0, x1 = +svg.dataset.x1;
  if (x < x0 || x > x1) return null;
  return t0 + (x - x0) / (x1 - x0) * hours * HOUR;
}

// ------------------------------------------------------------------ icons (inline SVG, no icon font needed)
const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  add: '<path d="M12 5v14M5 12h14"/>', remove: '<path d="M5 12h14"/>',
  fit_screen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  wb_sunny: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  public: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.5 12h17"/>',
  arrow_forward: '<path d="M5 12h14M13 6l6 6-6 6"/>', chevron_left: '<path d="M14.5 6l-6 6 6 6"/>', chevron_right: '<path d="M9.5 6l6 6-6 6"/>',
  explore: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  compare_arrows: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  menu_book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/>',
  play_arrow: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>', pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.6"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  file_download: '<path d="M12 4v11M7 10l5 5 5-5M5 19.5h14"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  pin_drop: '<path d="M12 21s6-5.5 6-11a6 6 0 0 0-12 0c0 5.5 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.5"/>',
  settings_input_antenna: '<path d="M12 13v8M8.5 21h7M8 9.5a5.5 5.5 0 0 1 8 0M5.2 6.7a9.5 9.5 0 0 1 13.6 0"/><circle cx="12" cy="12.5" r="1.3" fill="currentColor"/>',
  print: '<path d="M7 9V4h10v5M7 17H4.5V9.5h15V17H17M7 14h10v6H7z"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>', dark_mode: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', schedule: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', light_mode: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  landscape: '<path d="M3 19l6-9 4 6 3-4 5 7z"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5v3"/>', swap_horiz: '<path d="M4 9h15M15 5l4 4-4 4M20 15H5M9 11l-4 4 4 4"/>',
};
export const ic = (name, size = 18) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? P.info}</svg>`;
function upgradeIcons(root) {
  root.querySelectorAll?.('.ms').forEach(el => {
    const size = parseInt(el.style.fontSize) || 18;
    el.outerHTML = ic(el.textContent.trim(), size);
  });
}
upgradeIcons(document);
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.classList?.contains('ms')) upgradeIcons(n.parentNode); else upgradeIcons(n); } })))
  .observe(document.documentElement, { childList: true, subtree: true });
export const dirWord = c => ({ N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' }[c]);


// ------------------------------------------------------------------ animations
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
/** Count the first number in each element up from 0 (keeps its format: decimals, thousands separators). */
export function countUp(els, ms = 900) {
  if (reduced()) return;
  for (const el of els) {
    const node = [...el.childNodes].find(n => n.nodeType === 3 && /\d/.test(n.textContent)) ?? (el.firstChild?.nodeType === 3 ? el.firstChild : null);
    const target = node ?? el;
    const txt = target.textContent, m = txt.match(/-?[\d,]*\.?\d+/);
    if (!m) continue;
    const raw = m[0], end = parseFloat(raw.replace(/,/g, ''));
    if (!Number.isFinite(end) || end === 0) continue;
    const dec = (raw.split('.')[1] ?? '').length, comma = raw.includes(',') || Math.abs(end) >= 10000;
    const fmt = v => comma ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
      target.textContent = txt.replace(raw, fmt(end * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
/** Fade-in for elements with .reveal when they scroll into view. */
export function revealOnScroll(root = document) {
  const els = [...root.querySelectorAll('.reveal:not(.in)')];
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
  els.forEach(e => io.observe(e));
}


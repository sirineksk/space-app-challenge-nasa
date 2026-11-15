// landing.js — the home page: hero map with real site positions, top sites, key facts, mission skyline.
import { $, $$, esc, store, LOGO, countUp, revealOnScroll, fmtPct, fmtNum, fmtLat, fmtLon, isoMin, parseIsoUTC, shortName, thumbUrl, yearSummary } from './ui.js?v=8';
import { loadSites, ephemRange, dataUrl, mapMeta } from './data.js?v=8';
import { prepareSite, statusAt, series, VISIBLE } from './engine.js?v=8';
import { toPolarXY } from './geo.js?v=8';

const sites = await loadSites();
const range = await ephemRange();
const now = Math.min(Math.max(Date.now(), range.startMs), range.endMs);
const Y = new Date(now).getUTCFullYear();
const byId = id => sites.find(s => s.id === id);
const PIC = { shackleton_rim_sr1: 'shackleton', a3_malapert_massif: 'malapert', de_gerlache_rim_gr1: 'de-gerlache', a3_nobile_rim_2: 'nobile' };
const TOP = [
  ['shackleton_rim_sr1', 'Shackleton rim', 'A ridge 6.7 km from the pole, sunlit most of the year.'],
  ['a3_malapert_massif', 'Malapert Massif', 'Artemis III candidate that keeps Earth in view almost all the time.'],
  ['de_gerlache_rim_gr1', 'de Gerlache rim', 'Crater rim near the pole with long sunlit periods.'],
  ['a3_nobile_rim_2', 'Nobile Rim 2', 'Artemis III candidate, often in shadow.'],
];

$('#logo').innerHTML = LOGO;
$('#logo').title = 'LuminaLuna';
$('#burger').onclick = () => $('#lmenu').classList.toggle('open');
hideBarOnScroll(document.querySelector('.lnav'), () => document.getElementById('lmenu').classList.contains('open'));

// top bar: hides while scrolling down, comes back when scrolling up (self-contained on purpose)
function hideBarOnScroll(bar, isLocked = () => false) {
  if (!bar) return;
  let lastY = window.scrollY, ticking = false;
  const update = () => {
    ticking = false;
    const y = window.scrollY, dy = y - lastY;
    if (Math.abs(dy) < 6) return;
    bar.classList.toggle('bar-hidden', dy > 0 && y > bar.offsetHeight + 20 && !isLocked());
    lastY = y;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  bar.addEventListener('focusin', () => bar.classList.remove('bar-hidden'));
}


// ------------------------------------------------------------------ check-a-site form
const polar = sites.filter(s => s.terrain).sort((a, b) => (b.summary[Y]?.sun_pct ?? 0) - (a.summary[Y]?.sun_pct ?? 0));
$('#fSite').innerHTML = polar.map(s => `<option value="${s.id}" ${s.id === 'shackleton_rim_sr1' ? 'selected' : ''}>${esc(shortName(s))} · ${fmtLat(s.lat)}</option>`).join('');
const fDate = $('#fDate');
fDate.min = isoMin(range.startMs); fDate.max = isoMin(range.endMs); fDate.value = isoMin(now);
let expert = store.get('expert', false);
const syncMode = () => $$('#fMode button').forEach(b => b.classList.toggle('on', (b.dataset.m === 'x') === expert));
$$('#fMode button').forEach(b => b.onclick = () => { expert = b.dataset.m === 'x'; store.set('expert', expert); syncMode(); });
syncMode();
$('#check').onsubmit = e => {
  e.preventDefault();
  const t = parseIsoUTC(fDate.value);
  const u = new URLSearchParams({ id: $('#fSite').value });
  if (t != null && Math.abs(t - now) > 60e3) u.set('t', isoMin(t));
  location.href = `site.html?${u}`;
};

// ------------------------------------------------------------------ hero map (real positions)
const meta = await mapMeta();
const HW = meta.half_width_m / 1000, V = 190;     // show ±190 km around the pole
const P = (lat, lon) => { const [x, y] = toPolarXY(lat, lon); return [x / 1000, -y / 1000]; };
const pole = prepareSite(byId('south_pole'));
const st = await statusAt(pole, now, 60);
const sunAz = st?.sun.az ?? 0;
const sx = Math.sin(sunAz * Math.PI / 180) * (V - 18), sy = -Math.cos(sunAz * Math.PI / 180) * (V - 18);
const pin = (id, label, color, dx = 8, anchor = 'start') => {
  const s = byId(id), [x, y] = P(s.lat, s.lon);
  return `<g><circle cx="${x}" cy="${y}" r="9" fill="${color}" fill-opacity=".18"><animate attributeName="r" values="6;14;6" dur="${2.6 + x % 1.3}s" repeatCount="indefinite"/><animate attributeName="fill-opacity" values=".3;0;.3" dur="${2.6 + x % 1.3}s" repeatCount="indefinite"/></circle><circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#05080F" stroke-width="1.5"/>
    <text x="${x + dx}" y="${y - 8}" font-size="9.5" font-family="Inter" font-weight="700" letter-spacing="1" fill="#E6EAF2" text-anchor="${anchor}" paint-order="stroke" stroke="#05080F" stroke-width="3">${label}</text></g>`;
};
$('#disc').innerHTML = `<svg viewBox="${-V} ${-V} ${2 * V} ${2 * V}">
  <defs><radialGradient id="vig"><stop offset=".72" stop-color="#05080F" stop-opacity="0"/><stop offset="1" stop-color="#05080F" stop-opacity=".75"/></radialGradient></defs>
  <image href="${dataUrl('map/relief_80S.jpg')}" x="${-HW}" y="${-HW}" width="${2 * HW}" height="${2 * HW}" preserveAspectRatio="none"/>
  <circle r="${V}" fill="url(#vig)"/>
  <circle class="orbit" r="${Math.hypot(...toPolarXY(-88, 0)) / 1000}" fill="none" stroke="#57B8E8" stroke-opacity=".35" stroke-dasharray="2 4"/>
  ${pin('shackleton_rim_sr1', 'SHACKLETON RIM', '#F2B544')}
  ${pin('de_gerlache_rim_gr1', 'DE GERLACHE RIM', '#E6EAF2', -8, 'end')}
  ${pin('a3_malapert_massif', 'MALAPERT MASSIF', '#57B8E8')}
  ${pin('a3_nobile_rim_2', 'NOBILE RIM 2', '#E66D72', -8, 'end')}
  <g transform="translate(${sx} ${sy})"><circle r="12" fill="#F2B544" fill-opacity=".25"><animate attributeName="r" values="9;20;9" dur="3s" repeatCount="indefinite"/><animate attributeName="fill-opacity" values=".35;0;.35" dur="3s" repeatCount="indefinite"/></circle><circle r="7" fill="#F2B544"/></g>
  <text x="${Math.max(-V + 62, Math.min(V - 62, sx))}" y="${sy + (sy < 0 ? 26 : -18)}" font-size="9" font-family="Inter" font-weight="700" fill="#F2B544" text-anchor="middle" paint-order="stroke" stroke="#05080F" stroke-width="3">SUN NOW · AZ ${sunAz.toFixed(0)}°</text>
</svg>`;

// ------------------------------------------------------------------ top sites
$('#topsites').innerHTML = TOP.map(([id, name, line]) => {
  const s = byId(id), m = yearSummary(s, Y);
  return `<a class="tsite reveal" href="site.html?id=${id}"><div class="thumb" style="background-image:url(assets/photos/${PIC[id]}.webp)"></div>
    <h3>${name}</h3><p>${line}</p>
    <div class="row"><div><div class="label">Sunlight ${Y}</div><div class="v">${fmtPct(m.sunPct)}</div></div><span class="more">MORE INFO →</span></div></a>`;
}).join('');
countUp($$('#topsites .v'), 1200);

// ------------------------------------------------------------------ key facts
let k = 0;
function facts() {
  const [id, name] = TOP[k], s = byId(id), m = yearSummary(s, Y);
  $('#kName').textContent = name;
  const f = (label, v, cls = '') => `<div><div class="label">${label}</div><div class="v ${cls}">${v}</div></div>`;
  $('#kGrid').innerHTML =
    f(`Sunlight (${Y})`, fmtPct(m.sunPct), 'sun') +
    f('Longest night', `${(m.nightH / 24).toFixed(1)} <small>days</small>`) +
    f('Earth in view', fmtPct(m.earthPct), 'earth') +
    f('Longest without Earth', `${(m.noEarthH / 24).toFixed(1)} <small>days</small>`) +
    f('Energy, 1 m² panel', `${fmtNum(m.energyWhDay)} <small>Wh/day</small>`, 'sun') +
    `<div><div class="label">Coordinates</div><div class="v" style="font-size:26px">${fmtLat(s.lat)}</div><div class="muted">${fmtLon(s.lon)} · ${fmtNum(s.ground_m)} m</div></div>`;
}
function swap(d) {
  k = (k + TOP.length + d) % TOP.length;
  $('#kGrid').classList.add('swap');
  setTimeout(() => { facts(); $('#kGrid').classList.remove('swap'); countUp($$('#kGrid .v'), 700); }, 220);
}
$('#kPrev').onclick = () => swap(-1);
$('#kNext').onclick = () => swap(1);
facts();
const kio = new IntersectionObserver(es => { if (es[0].isIntersecting) { countUp($$('#kGrid .v'), 1100); kio.disconnect(); } }, { threshold: .3 });
kio.observe($('#kGrid'));

// ------------------------------------------------------------------ mission skyline (real data)
async function missionSky() {
  const site = byId('shackleton_rim_sr1'), s = prepareSite(site), win = await series(s, now, 30 * 24);
  const el = $('#mSky'), W = Math.max(300, el.clientWidth), H = 230, B = 22, L = 34;
  let lo = -2, hi = 2;
  s.skyline.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
  for (let i = 0; i < win.n; i++) if (win.valid[i]) { lo = Math.min(lo, win.sunEl[i], win.earthEl[i]); hi = Math.max(hi, win.sunEl[i], win.earthEl[i]); }
  lo = Math.floor(lo - .5); hi = Math.ceil(hi + .5);
  const X = az => L + az / 360 * (W - L), Yp = e => 6 + (hi - e) / (hi - lo) * (H - B - 6);
  let d = `M${L},${H - B}`;
  s.skyline.forEach((v, i) => { d += `L${X(i * 360 / s.skyline.length).toFixed(1)},${Yp(v).toFixed(1)}`; });
  d += `L${W},${Yp(s.skyline[0]).toFixed(1)}L${W},${H - B}Z`;
  let dots = '';
  for (let i = 0; i < win.n; i += 4) if (win.valid[i]) {
    const sOn = win.sunFrac[i] >= VISIBLE, eOn = win.earthFrac[i] >= VISIBLE;
    dots += `<circle cx="${X(win.earthAz[i]).toFixed(1)}" cy="${Yp(win.earthEl[i]).toFixed(1)}" r="2" fill="#57B8E8" opacity="${eOn ? .95 : .22}"/>`;
    dots += `<circle cx="${X(win.sunAz[i]).toFixed(1)}" cy="${Yp(win.sunEl[i]).toFixed(1)}" r="2" fill="#F2B544" opacity="${sOn ? .95 : .22}"/>`;
  }
  const step = (hi - lo) > 10 ? 4 : 2;
  let grid = '';
  for (let e = Math.ceil(lo / step) * step; e <= hi; e += step) grid += `<line x1="${L}" x2="${W}" y1="${Yp(e)}" y2="${Yp(e)}" stroke="#1E2A3D" ${e === 0 ? 'stroke="#3A4A63" stroke-dasharray="3 4"' : ''}/><text x="${L - 6}" y="${Yp(e) + 3.5}" font-size="10.5" fill="#8C98AB" text-anchor="end" font-family="Inter">${e > 0 ? '+' : ''}${e}°</text>`;
  const lab = [['N', 0], ['E', 90], ['S', 180], ['W', 270], ['N', 360]].map(([c, az]) => `<text x="${Math.min(W - 6, X(az))}" y="${H - 5}" font-size="11" fill="#AEB7C6" font-family="Inter" font-weight="600" text-anchor="middle">${c}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"><defs><linearGradient id="mt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A3954"/><stop offset="1" stop-color="#101827"/></linearGradient></defs>
    ${grid}${dots}<path d="${d}" fill="url(#mt)" stroke="#8FA1BA" stroke-opacity=".6"/>${lab}</svg>`;
  const m = yearSummary(site, Y);
  $('#mSun').textContent = fmtPct(m.sunPct, 0);
  $('#mEarth').textContent = fmtPct(m.earthPct, 0);
  $('#mSunL').textContent = `of ${Y} in sunlight`;
  $('#mEarthL').textContent = `of ${Y} with Earth in view`;
}
await missionSky();
revealOnScroll();
new ResizeObserver(() => missionSky()).observe($('#mSky'));

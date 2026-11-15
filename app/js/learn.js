// learn.js — the real example: Shackleton rim vs the exact south pole through 2026.
import { initShell, $, esc, href, fmtDate, fmtPct, fmtNum, fmtDeg, fmtLong, fmtDay, siteFromKey, yearSummary, timelineSVG, state, onTime, dirWord } from './ui.js?v=8';
import { series, VISIBLE } from './engine.js?v=8';
import { distanceBearing, horizonAt, compass } from './geo.js?v=8';
import { HOUR } from './data.js?v=8';

await initShell('learn');
$('#tryit').href = href('explore');

const Y = 2026, t0 = Date.UTC(Y, 0, 1), N = 8760;
const A = await siteFromKey('shackleton_rim_sr1'), B = await siteFromKey('south_pole');
const SA = await series(A, t0, N), SB = await series(B, t0, N);
const ya = yearSummary(A, Y), yb = yearSummary(B, Y);
const { dist, bearing } = distanceBearing(A.lat, A.lon, B.lat, B.lon);

$('#exIntro').innerHTML = `Drag through ${Y} to compare Shackleton's rim with the exact south pole, ${(dist / 1000).toFixed(1)} km away.`;
$('#exTake').innerHTML = `The rim sits about ${fmtNum(A.ground_m - B.ground_m)} m higher, so the Sun clears its skyline more often:
  <span class="sun">${fmtPct(ya.sunPct, 0)}</span> of ${Y} versus <span class="sun">${fmtPct(yb.sunPct, 0)}</span>, and a longest night of ${fmtLong(ya.nightH)} versus ${fmtLong(yb.nightH)}.
  Picking the exact spot matters as much as picking the region.`;

function strip() {
  const el = $('#exStrip');
  el.innerHTML = timelineSVG([
    { label: 'Shackleton rim', sub: `☀ ${fmtPct(ya.sunPct, 0)} of ${Y}`, series: SA },
    { label: 'Exact south pole', sub: `☀ ${fmtPct(yb.sunPct, 0)} of ${Y}`, series: SB },
  ], { t0, hours: N, now: t0 + (+$('#exSlider').value) * HOUR, width: el.clientWidth, labelW: 150, stacked: el.clientWidth < 600 });
  // day ticks are too dense for a year: keep month starts only
  el.querySelectorAll('text').forEach(t => { if (/^\d+ \w+$/.test(t.textContent) && !t.textContent.startsWith('1 ')) t.remove(); });
}

function miniHorizon(site, s, k) {
  const az = s.sunAz[k], el = s.sunEl[k], W = 460, H = 150, span = 40;
  let lo = -3, hi = 4;
  for (let a = -span / 2; a <= span / 2; a += .5) hi = Math.max(hi, horizonAt(site.skyline, az + a) + 1);
  hi = Math.min(Math.max(hi, el + 1.5), 14);
  const X = a => ((((a - az + 540) % 360) - 180) / span + .5) * W, Yp = e => (hi - e) / (hi - lo) * H;
  let d = `M0,${H}`;
  for (let a = -span / 2; a <= span / 2; a += .5) d += `L${X(az + a).toFixed(1)},${Yp(Math.max(lo, horizonAt(site.skyline, az + a))).toFixed(1)}`;
  d += `L${W},${H}Z`;
  const r = Math.max(6, .267 / (hi - lo) * H);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;border-radius:10px;border:1px solid var(--line);background:var(--plot-bg)">
    <defs><linearGradient id="tg${site.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--terrain-top)"/><stop offset="1" stop-color="var(--terrain-bot)"/></linearGradient></defs>
    <line x1="0" x2="${W}" y1="${Yp(0)}" y2="${Yp(0)}" stroke="var(--line-2)" stroke-dasharray="2 4"/>
    <text x="8" y="${Yp(0) - 5}" fill="var(--ink-3)" font-size="10" font-weight="600">0° horizon</text>
    <circle cx="${X(az)}" cy="${Yp(el)}" r="${r + 9}" fill="var(--sun-fill)" fill-opacity=".12"/>
    <circle cx="${X(az)}" cy="${Yp(el)}" r="${r}" fill="var(--sun-fill)"/>
    <path d="${d}" fill="url(#tg${site.id})" stroke="var(--terrain-line)" stroke-opacity=".55"/>
    <text x="${W / 2}" y="${H - 8}" fill="var(--ink-2)" font-size="10" font-weight="600" text-anchor="middle">Looking ${dirWord(compass(az))}, toward the Sun (±${span / 2}°)</text>
  </svg>`;
}

function card(site, s, k, kicker, name, ys) {
  const lit = s.sunFrac[k] >= VISIBLE, margin = s.sunEl[k] - s.sunHz[k];
  return `<section class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px">
      <div style="display:flex;gap:12px;align-items:center"><span class="iconbtn" style="color:${lit ? 'var(--sun)' : 'var(--muted)'}"><span class="ms" style="font-size:17px">${lit ? 'wb_sunny' : 'dark_mode'}</span></span>
        <div><div class="label ${lit ? 'sun' : 'earth'}">${kicker}</div><h3 style="font-size:19px;margin-top:2px">${esc(name)}</h3></div></div>
      <span class="tag ${lit ? 'sun' : 'earth'}">${fmtPct(ys.sunPct)} sunlit</span></div>
    ${miniHorizon(site, s, k)}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
      <div class="ministat"><div class="label">Right now</div><div class="v ${lit ? 'sun' : ''}" style="font-size:20px">${lit ? 'Sunlit' : 'In shadow'}</div>
        <div class="note">${Math.abs(margin) < 0.27 ? `Sun grazing the ridge: ${Math.round(s.sunFrac[k] * 100)}% of its disk shows` : margin > 0 ? `Sun ${fmtDeg(margin, 1)} above the ridge` : `Sun ${fmtDeg(-margin, 1, false)} behind the ridge`}</div></div>
      <div class="ministat"><div class="label">Power now · per day (${Y})</div><div class="v" style="font-size:20px">${fmtNum(s.power[k])} W</div>
        <div class="note">${fmtNum(ys.energyWhDay)} Wh/day on average</div></div>
    </div></section>`;
}

function render() {
  const k = +$('#exSlider').value;
  $('#exDate').textContent = fmtDate(t0 + k * HOUR);
  $('#exCards').innerHTML = card(A, SA, k, 'Elevated crest', 'Shackleton rim', ya) + card(B, SB, k, `True pole · ${fmtNum(A.ground_m - B.ground_m)} m lower · ${(dist / 1000).toFixed(1)} km away`, 'Exact south pole', yb);
  strip();
}
// start on a moment where they differ, near the chosen date if possible
let k0 = Math.min(N - 1, Math.max(0, Math.round((state.t - t0) / HOUR)));
if (!(SA.sunFrac[k0] >= VISIBLE && SB.sunFrac[k0] < VISIBLE)) {
  for (let d = 0; d < N; d++) { const k = (k0 + d) % N; if (SA.sunFrac[k] >= VISIBLE && SB.sunFrac[k] < VISIBLE) { k0 = k; break; } }
}
$('#exSlider').value = k0;
$('#exSlider').addEventListener('input', render);
$('#exStrip').addEventListener('click', ev => {
  const svg = ev.target.closest('svg'); if (!svg) return;
  const r = svg.getBoundingClientRect(), W = +svg.getAttribute('width'), x = (ev.clientX - r.left) * W / r.width;
  const x0 = +svg.dataset.x0, x1 = +svg.dataset.x1;
  if (x >= x0 && x <= x1) { $('#exSlider').value = Math.round((x - x0) / (x1 - x0) * (N - 1)); render(); }
});
new ResizeObserver(() => strip()).observe($('#exStrip'));
onTime(() => { $('#tryit').href = href('explore'); });
render();

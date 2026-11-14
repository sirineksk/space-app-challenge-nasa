// learn.js — the real example: Shackleton rim vs the exact south pole through 2026.
import { initShell, $, esc, href, fmtDate, fmtPct, fmtNum, fmtDeg, fmtLong, fmtDay, siteFromKey, yearSummary, timelineSVG, state, onTime, dirWord } from './ui.js';
import { series, VISIBLE } from './engine.js';
import { distanceBearing, horizonAt, compass } from './geo.js';
import { HOUR } from './data.js';

await initShell('learn');
$('#tryit').href = href('explore');

const Y = 2026, t0 = Date.UTC(Y, 0, 1), N = 8760;
const A = await siteFromKey('shackleton_rim_sr1'), B = await siteFromKey('south_pole');
const SA = await series(A, t0, N), SB = await series(B, t0, N);
const ya = yearSummary(A, Y), yb = yearSummary(B, Y);
const { dist, bearing } = distanceBearing(A.lat, A.lon, B.lat, B.lon);

$('#exIntro').innerHTML = `<b>Shackleton crater's rim</b> and the <b>exact south pole</b> are only
  ${(dist / 1000).toFixed(1)} km apart. Over ${Y}, the rim point is in sunlight <span class="sun">${fmtPct(ya.sunPct, 0)}</span> of the time;
  the pole only <span class="sun">${fmtPct(yb.sunPct, 0)}</span>. Drag the slider to see why.`;
$('#exTake').innerHTML = `The rim sits on a ridge about ${fmtNum(A.ground_m - B.ground_m)} m higher, so its skyline is lower and the Sun clears it more often.
  The longest night is ${fmtLong(ya.nightH)} on the rim versus ${fmtLong(yb.nightH)} at the pole.
  Picking the exact spot matters as much as picking the region, and that is what this tool is for.`;

function strip() {
  const el = $('#exStrip');
  el.innerHTML = timelineSVG([
    { label: 'Shackleton rim', sub: `☀ ${fmtPct(ya.sunPct, 0)} of ${Y}`, series: SA },
    { label: 'Exact south pole', sub: `☀ ${fmtPct(yb.sunPct, 0)} of ${Y}`, series: SB },
  ], { t0, hours: N, now: t0 + (+$('#exSlider').value) * HOUR, width: el.clientWidth, labelW: 150 });
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
  const r = .267 / (hi - lo) * H;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;background:#070E1B;border-radius:10px;border:1px solid #1F2C3F">
    <line x1="0" x2="${W}" y1="${Yp(0)}" y2="${Yp(0)}" stroke="#2F415C" stroke-dasharray="2 4"/>
    <text x="6" y="${Yp(0) - 4}" fill="#5E6E85" font-size="10" font-family="IBM Plex Mono">0°</text>
    <circle cx="${X(az)}" cy="${Yp(el)}" r="${Math.max(5, r)}" fill="#F2B544"/>
    <circle cx="${X(az)}" cy="${Yp(el)}" r="${Math.max(5, r) + 6}" fill="none" stroke="#F2B544" stroke-opacity=".3"/>
    <path d="${d}" fill="#1A2638" stroke="#57B8E8" stroke-opacity=".6"/>
    <text x="${W / 2}" y="${H - 6}" fill="#94A3B8" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">looking ${dirWord(compass(az))}, toward the Sun · ±${span / 2}°</text>
  </svg>`;
}

function card(site, s, k, name, ys) {
  const lit = s.sunFrac[k] >= VISIBLE, margin = s.sunEl[k] - s.sunHz[k];
  return `<div class="inner">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px">
      <span style="font:italic 22px var(--serif)">${esc(name)}</span>
      <span class="tag ${lit ? 'sun' : ''}">${lit ? 'SUNLIT' : 'IN SHADOW'}</span></div>
    ${miniHorizon(site, s, k)}
    <div style="margin-top:10px">
      <div class="kv"><span>Sun vs skyline</span><span class="${margin > 0 ? 'sun' : 'muted'}">${margin > 0 ? fmtDeg(margin, 1) + ' above' : fmtDeg(-margin, 1, false) + ' behind'}</span></div>
      <div class="kv"><span>Power, 1 m² panel</span><span>${fmtNum(s.power[k])} W</span></div>
      <div class="kv"><span>Ground height</span><span>${fmtNum(site.ground_m)} m</span></div>
      <div class="kv"><span>Sunlight over ${Y}</span><span class="sun">${fmtPct(ys.sunPct)}</span></div>
    </div></div>`;
}

function render() {
  const k = +$('#exSlider').value;
  $('#exDate').textContent = fmtDate(t0 + k * HOUR);
  $('#exCards').innerHTML = card(A, SA, k, 'Shackleton rim', ya) + card(B, SB, k, 'Exact south pole', yb);
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

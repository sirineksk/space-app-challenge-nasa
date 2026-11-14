// engine.js — everything the website computes, from sites.json + hourly ephemeris.
import {
  makeObserver, azEl, angularRadius, visibleFraction, horizonAt, solarPowerW,
  R_SUN_KM, R_EARTH_KM, toPolarXY, destination, terrainAngle, distanceBearing,
} from './geo.js';
import { ephemHours, HOUR, loadDEMs } from './data.js';

export const VISIBLE = 0.5;          // body "visible" when >= half its disk is above the skyline
export const AZ_STEP = 0.5;

/** A site the engine can work with: catalog entry or custom point. */
export function prepareSite(s) {
  const h = (s.ground_m ?? 0) + (s.observer_m ?? 2);
  return { ...s, obs: makeObserver(s.lat, s.lon, h) };
}

function evalRow(site, r) {
  const sky = site.skyline;
  const sun = azEl(site.obs, r[0] * r[3], r[1] * r[3], r[2] * r[3]);
  const earth = azEl(site.obs, r[4], r[5], r[6]);
  sun.hz = horizonAt(sky, sun.az); earth.hz = horizonAt(sky, earth.az);
  sun.margin = sun.el - sun.hz; earth.margin = earth.el - earth.hz;
  sun.frac = visibleFraction(sun.margin, angularRadius(R_SUN_KM, sun.dist));
  earth.frac = visibleFraction(earth.margin, angularRadius(R_EARTH_KM, earth.dist));
  return { sun, earth, power: solarPowerW(sun.dist, sun.el, sun.frac) };
}

/** Hour-by-hour values over [startMs, startMs + hours). */
export async function series(site, startMs, hours) {
  const e = await ephemHours(startMs, hours);
  const out = {
    t0: e.t0, n: hours, valid: new Uint8Array(hours),
    sunFrac: new Float32Array(hours), earthFrac: new Float32Array(hours),
    sunEl: new Float32Array(hours), sunAz: new Float32Array(hours), sunHz: new Float32Array(hours),
    earthEl: new Float32Array(hours), earthAz: new Float32Array(hours), earthHz: new Float32Array(hours),
    power: new Float32Array(hours),
  };
  for (let k = 0; k < hours; k++) {
    const r = e.row(k);
    if (!r) continue;
    const v = evalRow(site, r);
    out.valid[k] = 1;
    out.sunFrac[k] = v.sun.frac; out.earthFrac[k] = v.earth.frac;
    out.sunEl[k] = v.sun.el; out.sunAz[k] = v.sun.az; out.sunHz[k] = v.sun.hz;
    out.earthEl[k] = v.earth.el; out.earthAz[k] = v.earth.az; out.earthHz[k] = v.earth.hz;
    out.power[k] = v.power;
  }
  return out;
}

/** Continuous runs where pred(k) is true -> [[startIdx, endIdxExclusive], ...]. */
export function runs(n, pred) {
  const out = []; let s = -1;
  for (let k = 0; k <= n; k++) {
    const on = k < n && pred(k);
    if (on && s < 0) s = k;
    if (!on && s >= 0) { out.push([s, k]); s = -1; }
  }
  return out;
}
const longest = rs => rs.reduce((m, [a, b]) => Math.max(m, b - a), 0);

/** Summary numbers over a period (same definitions as the Python pipeline). */
export function summarize(s) {
  let nv = 0, sunOn = 0, earthOn = 0, energy = 0;
  for (let k = 0; k < s.n; k++) {
    if (!s.valid[k]) continue;
    nv++;
    if (s.sunFrac[k] >= VISIBLE) sunOn++;
    if (s.earthFrac[k] >= VISIBLE) earthOn++;
    energy += s.power[k];
  }
  const dark = runs(s.n, k => s.valid[k] && s.sunFrac[k] < VISIBLE);
  const noEarth = runs(s.n, k => s.valid[k] && s.earthFrac[k] < VISIBLE);
  return {
    hours: nv,
    sunPct: nv ? 100 * sunOn / nv : NaN,
    earthPct: nv ? 100 * earthOn / nv : NaN,
    nightH: longest(dark),
    noEarthH: longest(noEarth),
    energyWhDay: nv ? energy / (nv / 24) : NaN,
  };
}

/** Earth-contact windows (start/end in ms) from a series. */
export function earthWindows(s) {
  return runs(s.n, k => s.valid[k] && s.earthFrac[k] >= VISIBLE)
    .map(([a, b]) => ({ start: s.t0 + a * HOUR, end: s.t0 + b * HOUR, hours: b - a }));
}
export function sunWindows(s) {
  return runs(s.n, k => s.valid[k] && s.sunFrac[k] >= VISIBLE)
    .map(([a, b]) => ({ start: s.t0 + a * HOUR, end: s.t0 + b * HOUR, hours: b - a }));
}

/** Statistics for a calendar year, with month-by-month percentages. */
export async function yearStats(site, year) {
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  const s = await series(site, start, Math.round((end - start) / HOUR));
  const months = [];
  for (let m = 0; m < 12; m++) {
    const a = Math.round((Date.UTC(year, m, 1) - start) / HOUR), b = Math.round((Date.UTC(year, m + 1, 1) - start) / HOUR);
    let n = 0, su = 0, ea = 0;
    for (let k = a; k < b; k++) if (s.valid[k]) { n++; if (s.sunFrac[k] >= VISIBLE) su++; if (s.earthFrac[k] >= VISIBLE) ea++; }
    months.push({ sunPct: n ? 100 * su / n : NaN, earthPct: n ? 100 * ea / n : NaN });
  }
  return { ...summarize(s), months, series: s };
}

/**
 * Situation at an exact time: interpolated angles + when each body next rises/sets.
 * Searches up to `searchDays` ahead (limited by the ephemeris range).
 */
export async function statusAt(site, tMs, searchDays = 400) {
  const t0 = Math.floor(tMs / HOUR) * HOUR, f = (tMs - t0) / HOUR;
  const s = await series(site, t0, searchDays * 24 + 2);
  if (!s.valid[0]) return null;
  const lerp = (a, k) => a[k] + (a[k + 1] - a[k]) * f;
  const lerpAz = (a, k) => { let d = a[k + 1] - a[k]; if (d > 180) d -= 360; if (d < -180) d += 360; return (a[k] + d * f + 360) % 360; };
  const body = (frac, el, az, hz) => {
    const now = {
      frac: lerp(frac, 0), el: lerp(el, 0), az: lerpAz(az, 0), hz: lerp(hz, 0),
    };
    now.margin = now.el - now.hz;
    now.visible = now.frac >= VISIBLE;
    // next change: first hour boundary after t where visibility differs, refined linearly
    let next = null;
    for (let k = 1; k < s.n; k++) {
      if (!s.valid[k]) break;
      if ((frac[k] >= VISIBLE) !== now.visible) {
        const a = frac[k - 1] - VISIBLE, b = frac[k] - VISIBLE;
        const x = a !== b ? a / (a - b) : 0;
        next = Math.max(tMs, t0 + (k - 1 + x) * HOUR);
        break;
      }
    }
    now.nextChange = next;               // ms, or null if beyond the data
    return now;
  };
  return {
    t: tMs,
    sun: body(s.sunFrac, s.sunEl, s.sunAz, s.sunHz),
    earth: body(s.earthFrac, s.earthEl, s.earthAz, s.earthHz),
    series: s,
  };
}

// ====================================================================== terrain
/** Ground height (m) at a point from the light DEM grids (finest available). */
export async function heightAt(lat, lon) {
  const grids = await loadDEMs();
  return heightFromGrids(grids, ...toPolarXY(lat, lon));
}
function heightFromGrids(grids, x, y) {
  for (const g of grids) {
    const c = (x - g.x0) / g.res_m, r = (g.y0 - y) / g.res_m;
    const c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= g.n || r0 + 1 >= g.n) continue;
    const i = r0 * g.n + c0, z = g.z;
    const a = z[i], b = z[i + 1], cc = z[i + g.n], d = z[i + g.n + 1];
    if (a === g.nodata || b === g.nodata || cc === g.nodata || d === g.nodata) continue;
    const fx = c - c0, fy = r - r0;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
  }
  return NaN;
}

// Sample distances: 120 m steps from 360 m to 5 km, then +1.5 % per step to 300 km.
// Starting at 360 m (1.5 cells of the 240 m grid) avoids "self-shadowing" by smoothed
// terrain on sharp crests; tested against the 80 m skylines of 7 catalog sites
// (sunlight within ~3 points for 6 of 7; see docs/validation.md).
const RAY = (() => {
  const d = [];
  for (let x = 360; x < 5000; x += 120) d.push(x);
  for (let x = 5000; x <= 300000; x *= 1.015) d.push(x);
  return Float64Array.from(d);
})();

/** Terrain angle along one azimuth (max over the ray). */
function rayHorizon(grids, lat, lon, hObs, az) {
  let best = -90;
  for (let j = 0; j < RAY.length; j++) {
    const [la, lo] = destination(lat, lon, az, RAY[j]);
    const h = heightFromGrids(grids, ...toPolarXY(la, lo));
    if (Number.isNaN(h)) continue;
    const a = terrainAngle(hObs, h, RAY[j]);
    if (a > best) best = a;
  }
  return best;
}

/** Full 360° skyline for any point (approximate: 240 m terrain near the pole). */
export async function computeSkyline(lat, lon, observerM = 2) {
  const grids = await loadDEMs();
  const ground = heightFromGrids(grids, ...toPolarXY(lat, lon));
  if (Number.isNaN(ground)) return null;
  const n = Math.round(360 / AZ_STEP), sky = new Array(n);
  for (let i = 0; i < n; i++) sky[i] = Math.round(rayHorizon(grids, lat, lon, ground + observerM, i * AZ_STEP) * 100) / 100;
  return { ground_m: Math.round(ground), skyline: sky };
}

/** Build a custom site object (from map click or coordinates). */
export async function customSite(lat, lon) {
  const r = await computeSkyline(lat, lon);
  if (!r) return null;
  return prepareSite({
    id: 'custom', name: 'Custom point', group: 'custom', custom: true,
    lat, lon, ground_m: r.ground_m, observer_m: 2, skyline: r.skyline, terrain: true,
    notes: 'Computed in your browser from NASA LOLA terrain at 240 m per pixel (catalog sites use 80 m).',
  });
}

/** Local slope (deg) from the DEM around a point. */
export async function slopeAt(lat, lon, stepM = 240) {
  const grids = await loadDEMs();
  const [x, y] = toPolarXY(lat, lon);
  const h = (dx, dy) => heightFromGrids(grids, x + dx, y + dy);
  const gx = (h(stepM, 0) - h(-stepM, 0)) / (2 * stepM), gy = (h(0, stepM) - h(0, -stepM)) / (2 * stepM);
  return Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
}

/**
 * ECO-PATH: nearest point (within radiusM) that sees Earth clearly more than the site
 * over the next `days` days. Uses the same 240 m terrain for the site and every candidate
 * so the comparison is fair. Returns null if nothing better is found.
 */
export async function nearestEarthSpot(site, startMs, { days = 30, radiusM = 5000, stepM = 240, onProgress } = {}) {
  const grids = await loadDEMs();
  const hours = days * 24;
  const e = await ephemHours(startMs, hours);
  const rows = [];
  for (let k = 0; k < hours; k += 2) { const r = e.row(k); if (r) rows.push(r); }   // every 2 h is plenty

  const evalPoint = (lat, lon) => {
    const g = heightFromGrids(grids, ...toPolarXY(lat, lon));
    if (Number.isNaN(g)) return null;
    const obs = makeObserver(lat, lon, g + 2);
    const azs = rows.map(r => azEl(obs, r[4], r[5], r[6]));
    const cache = new Map();
    let vis = 0;
    for (const a of azs) {
      const key = Math.round(a.az / AZ_STEP);
      if (!cache.has(key)) cache.set(key, rayHorizon(grids, lat, lon, g + 2, key * AZ_STEP));
      if (visibleFraction(a.el - cache.get(key), angularRadius(R_EARTH_KM, a.dist)) >= VISIBLE) vis++;
    }
    return { lat, lon, ground: g, earthPct: 100 * vis / rows.length };
  };

  const here = evalPoint(site.lat, site.lon);
  if (!here) return null;
  const [x0, y0] = toPolarXY(site.lat, site.lon);
  const cands = [];
  for (let dy = -radiusM; dy <= radiusM; dy += stepM)
    for (let dx = -radiusM; dx <= radiusM; dx += stepM) {
      const d = Math.hypot(dx, dy);
      if (d > radiusM || d < stepM / 2) continue;
      cands.push({ dx, dy, d });
    }
  cands.sort((a, b) => a.d - b.d);
  const target = Math.min(100, Math.max(here.earthPct + 20, 50));
  let best = null, bestPct = here.earthPct;
  const { fromPolarXY } = await import('./geo.js');
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (best && c.d > best.d + 1) break;                 // nearest qualifying ring found
    const [la, lo] = fromPolarXY(x0 + c.dx, y0 + c.dy);
    const p = evalPoint(la, lo);
    if (p && p.earthPct >= target && p.earthPct > bestPct) { best = { ...p, d: c.d }; bestPct = p.earthPct; }
    if (onProgress && i % 40 === 0) { onProgress(i / cands.length); await new Promise(r => setTimeout(r)); }
  }
  if (!best) return { here, best: null };
  // straight-line path: steepest slope and climb
  const { dist, bearing } = distanceBearing(site.lat, site.lon, best.lat, best.lon);
  let maxSlope = 0, prev = here.ground;
  const N = Math.max(4, Math.ceil(dist / 120));
  for (let j = 1; j <= N; j++) {
    const [la, lo] = destination(site.lat, site.lon, bearing, dist * j / N);
    const h = heightFromGrids(grids, ...toPolarXY(la, lo));
    maxSlope = Math.max(maxSlope, Math.atan(Math.abs(h - prev) / (dist / N)) * 180 / Math.PI);
    prev = h;
  }
  return { here, best: { ...best, dist, bearing, climb: best.ground - here.ground, maxSlope } };
}

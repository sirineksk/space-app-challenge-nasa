// geo.js — the same formulas as pipeline/lunar_geometry.py, in JavaScript.
// Frame: MOON_ME (DE421). Angles in degrees. Azimuth 0 = north, 90 = east.

export const R_MOON_KM = 1737.4;
export const R_SUN_KM = 695700;
export const R_EARTH_KM = 6371;
export const AU_KM = 149597870.7;
export const SOLAR_CONSTANT = 1361;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Precompute everything that depends only on the site. */
export function makeObserver(latDeg, lonDeg, heightM = 0) {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  const r = R_MOON_KM + heightM / 1000;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  return { lat: latDeg, lon: lonDeg, h: heightM, pos: up.map(c => c * r), up, east, north };
}

/** Azimuth/elevation of a body at (bx,by,bz) km from the Moon's centre. */
export function azEl(obs, bx, by, bz) {
  const vx = bx - obs.pos[0], vy = by - obs.pos[1], vz = bz - obs.pos[2];
  const d = Math.hypot(vx, vy, vz);
  const ve = vx * obs.east[0] + vy * obs.east[1] + vz * obs.east[2];
  const vn = vx * obs.north[0] + vy * obs.north[1] + vz * obs.north[2];
  const vu = vx * obs.up[0] + vy * obs.up[1] + vz * obs.up[2];
  let az = Math.atan2(ve, vn) * R2D;
  if (az < 0) az += 360;
  return { az, el: Math.asin(vu / d) * R2D, dist: d };
}

export const angularRadius = (radiusKm, distKm) => Math.asin(radiusKm / distKm) * R2D;

/** Fraction (0..1) of a disk above a locally straight horizon. */
export function visibleFraction(marginDeg, radiusDeg) {
  const x = Math.max(-1, Math.min(1, marginDeg / radiusDeg));
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

/** Skyline elevation at any azimuth (linear interpolation, wraps at 360). */
export function horizonAt(sky, azDeg, step = 0.5) {
  const n = sky.length;
  const p = ((azDeg % 360) + 360) % 360 / step;
  const i = Math.floor(p), f = p - i;
  return sky[i % n] * (1 - f) + sky[(i + 1) % n] * f;
}

/** Electrical power (W) of a panel; vertical Sun-tracking panel by default. */
export function solarPowerW(sunDistKm, sunElDeg, sunFrac, eff = 0.3, area = 1, panel = 'vertical') {
  const flux = SOLAR_CONSTANT * (AU_KM / sunDistKm) ** 2;
  const g = panel === 'vertical' ? Math.cos(sunElDeg * D2R) : Math.sin(sunElDeg * D2R);
  return eff * area * flux * Math.max(0, g) * sunFrac;
}

// ---------------------------------------------------------------- map projection
const R_M = R_MOON_KM * 1000;
/** South polar stereographic (sphere, true scale at the pole), metres. */
export function toPolarXY(latDeg, lonDeg) {
  const rho = 2 * R_M * Math.tan((45 + latDeg / 2) * D2R);
  return [rho * Math.sin(lonDeg * D2R), rho * Math.cos(lonDeg * D2R)];
}
export function fromPolarXY(x, y) {
  const rho = Math.hypot(x, y);
  return [2 * Math.atan(rho / (2 * R_M)) * R2D - 90, Math.atan2(x, y) * R2D];
}

/** Great-circle destination point. */
export function destination(latDeg, lonDeg, azDeg, distM) {
  const la1 = latDeg * D2R, lo1 = lonDeg * D2R, b = azDeg * D2R, d = distM / R_M;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [la2 * R2D, ((lo2 * R2D + 540) % 360) - 180];
}

/** Ground distance (m) and initial bearing (deg) between two points. */
export function distanceBearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * R_M * Math.asin(Math.min(1, Math.sqrt(a)));
  let brg = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D;
  return { dist: d, bearing: (brg + 360) % 360 };
}

/** Elevation angle (deg) of terrain seen from a site, exact on a sphere. */
export function terrainAngle(hSite, hTerrain, distM) {
  const g = distM / R_M, rt = R_M + hTerrain, rs = R_M + hSite;
  return Math.atan2(rt * Math.cos(g) - rs, rt * Math.sin(g)) * R2D;
}

export const compass = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

// data.js — loads the files in app/data/ (cached, on demand).
const BASE = new URL('../data/', import.meta.url);
const cache = new Map();

async function once(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}
const json = path => once(path, () => fetch(new URL(path, BASE)).then(r => {
  if (!r.ok) throw new Error(`Cannot load ${path}`); return r.json();
}));
const bin = (path, Type) => once(path, () => fetch(new URL(path, BASE)).then(r => {
  if (!r.ok) throw new Error(`Cannot load ${path}`); return r.arrayBuffer();
}).then(b => new Type(b)));

export async function loadSites() {
  const d = await json('sites.json');
  return d.sites;
}
export async function getSite(id) {
  return (await loadSites()).find(s => s.id === id);
}

// ---------------------------------------------------------------- ephemeris
export const HOUR = 3600e3;
export async function ephemIndex() { return json('ephem/index.json'); }

export async function ephemRange() {
  const idx = await ephemIndex();
  const ys = Object.keys(idx.years).map(Number).sort();
  const first = idx.years[ys[0]], last = idx.years[ys.at(-1)];
  return { startMs: first.start_ms, endMs: last.start_ms + (last.n - 1) * HOUR, years: ys };
}

async function yearArray(y) {
  const idx = await ephemIndex();
  const meta = idx.years[y];
  if (!meta) return null;
  return { meta, arr: await bin(meta.file, Float32Array) };
}

/**
 * Hourly rows from startMs (rounded down to the hour) for `hours` hours.
 * Returns { t0, n, row(k) -> [sunUx,sunUy,sunUz,sunDist,ex,ey,ez] } ; rows beyond the data are null.
 */
export async function ephemHours(startMs, hours) {
  const t0 = Math.floor(startMs / HOUR) * HOUR;
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t0 + hours * HOUR).getUTCFullYear();
  const chunks = [];
  for (let y = y0; y <= y1; y++) { const c = await yearArray(y); if (c) chunks.push(c); }
  const F = 7;
  return {
    t0, n: hours,
    row(k) {
      const t = t0 + k * HOUR;
      for (const { meta, arr } of chunks) {
        const i = Math.round((t - meta.start_ms) / HOUR);
        if (i >= 0 && i < meta.n) return arr.subarray(i * F, i * F + F);
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- terrain grids
export async function loadDEMs() {
  return once('dems', async () => {
    const idx = await json('dem/index.json');
    const grids = [];
    for (const name of idx.order) {
      const g = idx[name];
      grids.push({ ...g, name, z: await bin(g.file, Int16Array) });
    }
    return grids;
  });
}

export async function mapMeta() { return json('map/index.json'); }
export const dataUrl = path => new URL(path, BASE).href;

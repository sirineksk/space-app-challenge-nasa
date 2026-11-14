"""
engine.py — the LUMINALUNA calculations in Python/numpy, for the API.

Same formulas and same input files as the website (app/js/engine.js), so the API and
the website always give the same numbers:
  app/data/sites.json        catalog sites, 720-value skylines (80 m LOLA), yearly summaries
  app/data/ephem/*.bin       hourly Sun & Earth vectors in MOON_ME (JPL DE421), 2025-2030
  app/data/dem/*.bin         light LOLA terrain grids (240 m / 640 m / 1920 m) for custom points
Only numpy is needed (no rasterio / SPICE), so it deploys anywhere.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parent.parent / "app" / "data"

R_MOON_KM = 1737.4
R_M = R_MOON_KM * 1000
R_SUN_KM = 695700.0
R_EARTH_KM = 6371.0
AU_KM = 149597870.7
SOLAR_CONSTANT = 1361.0
PANEL_EFFICIENCY = 0.3
VISIBLE = 0.5          # a body counts as visible when >= half of its disk is above the skyline
AZ_STEP = 0.5
OBSERVER_M = 2.0
HOUR = 3_600_000       # ms
D2R, R2D = math.pi / 180, 180 / math.pi


# ============================================================================ data
@lru_cache(maxsize=1)
def sites() -> list[dict]:
    return json.loads((DATA / "sites.json").read_text())["sites"]


def site_by_id(site_id: str) -> dict | None:
    return next((s for s in sites() if s["id"] == site_id), None)


@lru_cache(maxsize=1)
def ephemeris():
    """All years glued into one array (rows are contiguous hours)."""
    idx = json.loads((DATA / "ephem" / "index.json").read_text())
    years = sorted(idx["years"], key=int)
    arrs = [np.fromfile(DATA / idx["years"][y]["file"], dtype="<f4").reshape(-1, 7).astype(np.float64) for y in years]
    t0 = idx["years"][years[0]]["start_ms"]
    rows = np.concatenate(arrs)
    return t0, rows, [int(y) for y in years]


def data_range() -> tuple[int, int]:
    t0, rows, _ = ephemeris()
    return t0, t0 + (len(rows) - 1) * HOUR


@lru_cache(maxsize=1)
def dem_grids():
    idx = json.loads((DATA / "dem" / "index.json").read_text())
    out = []
    for name in idx["order"]:
        g = dict(idx[name])
        g["z"] = np.fromfile(DATA / g["file"], dtype="<i2").reshape(g["n"], g["n"])
        out.append(g)
    return out


# ============================================================================ geometry
def make_observer(lat: float, lon: float, height_m: float = 0.0) -> dict:
    la, lo = lat * D2R, lon * D2R
    r = R_MOON_KM + height_m / 1000
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    return {"pos": up * r, "up": up, "east": east, "north": north}


def az_el(obs: dict, body_km: np.ndarray):
    """Azimuth (0 = north, 90 = east), elevation (deg) and distance (km) of body positions (N,3)."""
    v = body_km - obs["pos"]
    d = np.linalg.norm(v, axis=1)
    ve, vn, vu = v @ obs["east"], v @ obs["north"], v @ obs["up"]
    az = np.degrees(np.arctan2(ve, vn)) % 360
    el = np.degrees(np.arcsin(vu / d))
    return az, el, d


def angular_radius(radius_km, dist_km):
    return np.degrees(np.arcsin(radius_km / dist_km))


def visible_fraction(margin_deg, radius_deg):
    """Fraction (0..1) of a disk above a locally straight horizon."""
    x = np.clip(margin_deg / radius_deg, -1, 1)
    return 1 - (np.arccos(x) - x * np.sqrt(1 - x * x)) / math.pi


def horizon_at(sky: np.ndarray, az_deg):
    n = len(sky)
    p = (np.asarray(az_deg) % 360) / AZ_STEP
    i = np.floor(p).astype(int)
    f = p - i
    return sky[i % n] * (1 - f) + sky[(i + 1) % n] * f


def solar_power_w(sun_dist_km, sun_el_deg, sun_frac):
    """Power of a 1 m², 30 % efficient vertical panel that turns to face the Sun."""
    flux = SOLAR_CONSTANT * (AU_KM / sun_dist_km) ** 2
    return PANEL_EFFICIENCY * flux * np.maximum(0, np.cos(np.radians(sun_el_deg))) * sun_frac


def to_polar_xy(lat, lon):
    """South polar stereographic on a sphere, true scale at the pole (metres)."""
    rho = 2 * R_M * np.tan(np.radians(45 + np.asarray(lat) / 2))
    return rho * np.sin(np.radians(lon)), rho * np.cos(np.radians(lon))


def from_polar_xy(x, y):
    rho = np.hypot(x, y)
    return np.degrees(2 * np.arctan(rho / (2 * R_M))) - 90, np.degrees(np.arctan2(x, y))


def destination(lat, lon, az, dist_m):
    # at an exact pole every bearing would give the same longitude: nudge by 1e-6 deg (~3 cm)
    la1, lo1, b, d = np.radians(np.clip(lat, -89.999999, 89.999999)), np.radians(lon), np.radians(az), np.asarray(dist_m) / R_M
    la2 = np.arcsin(np.sin(la1) * np.cos(d) + np.cos(la1) * np.sin(d) * np.cos(b))
    lo2 = lo1 + np.arctan2(np.sin(b) * np.sin(d) * np.cos(la1), np.cos(d) - np.sin(la1) * np.sin(la2))
    return np.degrees(la2), (np.degrees(lo2) + 540) % 360 - 180


def distance_bearing(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    d = 2 * R_M * math.asin(min(1, math.sqrt(a)))
    brg = math.degrees(math.atan2(math.sin(dl) * math.cos(p2),
                                  math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)))
    return d, (brg + 360) % 360


def terrain_angle(h_site, h_terrain, dist_m):
    g = np.asarray(dist_m) / R_M
    rt, rs = R_M + h_terrain, R_M + h_site
    return np.degrees(np.arctan2(rt * np.cos(g) - rs, rt * np.sin(g)))


COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
def compass(deg: float) -> str:
    return COMPASS[int(round((deg % 360) / 45)) % 8]


# ============================================================================ sites
def prepare(s: dict) -> dict:
    h = (s.get("ground_m") or 0) + (s.get("observer_m") or OBSERVER_M)
    return {**s, "obs": make_observer(s["lat"], s["lon"], h), "sky": np.asarray(s["skyline"], dtype=float)}


@lru_cache(maxsize=256)
def _custom(lat_r: float, lon_r: float):
    r = compute_skyline(lat_r, lon_r)
    if r is None:
        return None
    return prepare({
        "id": "custom", "name": f"Custom point {abs(lat_r):.2f}° {'S' if lat_r < 0 else 'N'}, {abs(lon_r):.2f}° {'W' if lon_r < 0 else 'E'}",
        "group": "custom", "custom": True, "lat": lat_r, "lon": lon_r, "ground_m": r["ground_m"],
        "observer_m": OBSERVER_M, "skyline": r["skyline"], "terrain": True,
        "notes": "Skyline from NASA LOLA terrain at 240 m per pixel (catalog sites use 80 m): within ~5 points on open ground, but next to steep walls it can overestimate sunlight.",
    })


def resolve(site_id: str | None = None, lat: float | None = None, lon: float | None = None) -> dict | None:
    """A prepared site from a catalog id, or a custom point from coordinates."""
    if site_id:
        s = site_by_id(site_id)
        return prepare(s) if s else None
    if lat is None or lon is None:
        return None
    return _custom(round(float(lat), 4), round((float(lon) + 540) % 360 - 180, 4))


# ============================================================================ time series
def series(site: dict, start_ms: int, hours: int) -> dict:
    """Hour-by-hour Sun/Earth visibility and power over [start, start + hours)."""
    T0, rows, _ = ephemeris()
    t0 = (int(start_ms) // HOUR) * HOUR
    idx = (t0 - T0) // HOUR + np.arange(hours)
    valid = (idx >= 0) & (idx < len(rows))
    n = hours
    out = {k: np.zeros(n) for k in ("sun_frac", "earth_frac", "sun_el", "sun_az", "sun_hz",
                                     "earth_el", "earth_az", "earth_hz", "power")}
    out.update(t0=t0, n=n, valid=valid)
    if valid.any():
        r = rows[idx[valid]]
        sun = r[:, :3] * r[:, 3:4]
        saz, sel, sd = az_el(site["obs"], sun)
        eaz, eel, ed = az_el(site["obs"], r[:, 4:7])
        shz, ehz = horizon_at(site["sky"], saz), horizon_at(site["sky"], eaz)
        sf = visible_fraction(sel - shz, angular_radius(R_SUN_KM, sd))
        ef = visible_fraction(eel - ehz, angular_radius(R_EARTH_KM, ed))
        for k, v in (("sun_frac", sf), ("earth_frac", ef), ("sun_el", sel), ("sun_az", saz), ("sun_hz", shz),
                     ("earth_el", eel), ("earth_az", eaz), ("earth_hz", ehz), ("power", solar_power_w(sd, sel, sf))):
            out[k][valid] = v
    return out


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Continuous True runs -> [(start, end_exclusive), ...]."""
    m = np.concatenate([[False], np.asarray(mask, bool), [False]])
    d = np.diff(m.astype(int))
    return list(zip(np.where(d == 1)[0].tolist(), np.where(d == -1)[0].tolist()))


def _longest(mask) -> int:
    return max((b - a for a, b in runs(mask)), default=0)


def summarize(s: dict) -> dict:
    v = s["valid"]
    nv = int(v.sum())
    if not nv:
        return {"hours": 0, "sun_pct": None, "earth_pct": None, "night_h": None, "no_earth_h": None, "energy_wh_day": None}
    return {
        "hours": nv,
        "sun_pct": round(100 * float((s["sun_frac"][v] >= VISIBLE).sum()) / nv, 2),
        "earth_pct": round(100 * float((s["earth_frac"][v] >= VISIBLE).sum()) / nv, 2),
        "night_h": _longest(v & (s["sun_frac"] < VISIBLE)),
        "no_earth_h": _longest(v & (s["earth_frac"] < VISIBLE)),
        "energy_wh_day": round(float(s["power"][v].sum()) / (nv / 24), 1),
    }


def windows(s: dict, body: str = "earth") -> list[dict]:
    frac = s[f"{body}_frac"]
    return [{"start": iso(s["t0"] + a * HOUR), "end": iso(s["t0"] + b * HOUR), "hours": b - a}
            for a, b in runs(s["valid"] & (frac >= VISIBLE))]


def year_stats(site: dict, year: int) -> dict:
    start = int(datetime(year, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    end = int(datetime(year + 1, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    s = series(site, start, (end - start) // HOUR)
    months = []
    for m in range(12):
        a = (int(datetime(year, m + 1, 1, tzinfo=timezone.utc).timestamp() * 1000) - start) // HOUR
        b = (int(datetime(year + (m == 11), (m + 1) % 12 + 1, 1, tzinfo=timezone.utc).timestamp() * 1000) - start) // HOUR
        v = s["valid"][a:b]
        nv = int(v.sum())
        months.append({
            "month": m + 1,
            "sun_pct": round(100 * float((s["sun_frac"][a:b][v] >= VISIBLE).sum()) / nv, 1) if nv else None,
            "earth_pct": round(100 * float((s["earth_frac"][a:b][v] >= VISIBLE).sum()) / nv, 1) if nv else None,
        })
    return {"year": year, **summarize(s), "months": months}


def status_at(site: dict, t_ms: int, search_days: int = 400) -> dict | None:
    """Sun & Earth right now (interpolated) and when each next rises or sets."""
    t0 = (int(t_ms) // HOUR) * HOUR
    f = (t_ms - t0) / HOUR
    s = series(site, t0, search_days * 24 + 2)
    if not s["valid"][0]:
        return None

    def lerp(a):
        return float(a[0] + (a[1] - a[0]) * f)

    def lerp_az(a):
        d = a[1] - a[0]
        d = d - 360 if d > 180 else d + 360 if d < -180 else d
        return float((a[0] + d * f) % 360)

    def body(name: str, radius_deg: float) -> dict:
        frac = s[f"{name}_frac"]
        b = {"visible_fraction": lerp(frac), "elevation_deg": lerp(s[f"{name}_el"]),
             "azimuth_deg": lerp_az(s[f"{name}_az"]), "skyline_deg": lerp(s[f"{name}_hz"])}
        b["margin_deg"] = b["elevation_deg"] - b["skyline_deg"]
        b["visible"] = b["visible_fraction"] >= VISIBLE
        b["direction"] = compass(b["azimuth_deg"])
        b["disk_radius_deg"] = radius_deg
        nxt = None
        for k in range(1, s["n"]):
            if not s["valid"][k]:
                break
            if (frac[k] >= VISIBLE) != b["visible"]:
                a_, b_ = frac[k - 1] - VISIBLE, frac[k] - VISIBLE
                x = a_ / (a_ - b_) if a_ != b_ else 0
                nxt = max(t_ms, t0 + (k - 1 + x) * HOUR)
                break
        b["next_change"] = iso(nxt) if nxt else None
        b["next_change_in_hours"] = round((nxt - t_ms) / HOUR, 2) if nxt else None
        b["next_event"] = ({"sun": ("sunset", "sunrise"), "earth": ("earthset", "earthrise")}[name])[0 if b["visible"] else 1]
        return b

    k = 0
    return {
        "time": iso(t_ms),
        "sun": body("sun", 0.267),
        "earth": body("earth", 0.95),
        "power_w": round(float(s["power"][k] + (s["power"][k + 1] - s["power"][k]) * f), 1),
        "searched_days": search_days,
    }


# ============================================================================ terrain
def heights(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Ground height (m) by bilinear interpolation in the finest grid that covers each point."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    out = np.full(x.shape, np.nan)
    for g in dem_grids():
        todo = np.isnan(out)
        if not todo.any():
            break
        c = (x - g["x0"]) / g["res_m"]
        r = (g["y0"] - y) / g["res_m"]
        c0, r0 = np.floor(c), np.floor(r)
        ok = todo & (c0 >= 0) & (r0 >= 0) & (c0 + 1 < g["n"]) & (r0 + 1 < g["n"])
        if not ok.any():
            continue
        ci, ri = c0[ok].astype(int), r0[ok].astype(int)
        z = g["z"]
        a, b, cc, d = z[ri, ci], z[ri, ci + 1], z[ri + 1, ci], z[ri + 1, ci + 1]
        bad = (a == g["nodata"]) | (b == g["nodata"]) | (cc == g["nodata"]) | (d == g["nodata"])
        fx, fy = c[ok] - c0[ok], r[ok] - r0[ok]
        h = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy
        h = np.where(bad, np.nan, h)
        tmp = out[ok]
        tmp[~bad] = h[~bad]
        out[ok] = tmp
    return out


def height_at(lat: float, lon: float) -> float:
    x, y = to_polar_xy(lat, lon)
    return float(heights(np.array([x]), np.array([y]))[0])


# 120 m steps from 360 m to 5 km, then +1.5 % per step to 300 km (same as the website).
_ray = [float(x) for x in range(360, 5000, 120)]
_x = 5000.0
while _x <= 300000:
    _ray.append(_x)
    _x *= 1.015
RAY = np.array(_ray)


def ray_horizons(lat: float, lon: float, h_obs: float, azimuths) -> np.ndarray:
    """Highest terrain angle along each azimuth, up to 300 km."""
    az = np.asarray(azimuths, float)[:, None]
    la, lo = destination(lat, lon, az, RAY[None, :])
    x, y = to_polar_xy(la, lo)
    h = heights(x, y)
    a = terrain_angle(h_obs, h, RAY[None, :])
    a = np.where(np.isnan(a), -90.0, a)
    return np.maximum(a.max(axis=1), -90.0)


def compute_skyline(lat: float, lon: float, observer_m: float = OBSERVER_M) -> dict | None:
    ground = height_at(lat, lon)
    if math.isnan(ground):
        return None
    sky = ray_horizons(lat, lon, ground + observer_m, np.arange(int(360 / AZ_STEP)) * AZ_STEP)
    return {"ground_m": int(round(ground)), "skyline": (np.round(sky * 100) / 100).tolist()}


def slope_at(lat: float, lon: float, step_m: float = 240) -> float:
    x, y = to_polar_xy(lat, lon)
    h = heights(np.array([x + step_m, x - step_m, x, x]), np.array([y, y, y + step_m, y - step_m]))
    gx, gy = (h[0] - h[1]) / (2 * step_m), (h[2] - h[3]) / (2 * step_m)
    return float(math.degrees(math.atan(math.hypot(gx, gy))))


# ============================================================================ ECO-PATH
def eco_path(site: dict, start_ms: int, days: int = 30, radius_m: float = 5000, step_m: float = 240) -> dict | None:
    """Nearest point within radius_m that sees Earth clearly more than the site over the next `days`.

    Site and candidates all use the same 240 m terrain so they are compared fairly.
    """
    T0, rows, _ = ephemeris()
    t0 = (int(start_ms) // HOUR) * HOUR
    idx = (t0 - T0) // HOUR + np.arange(0, days * 24, 2)          # every 2 h is plenty
    idx = idx[(idx >= 0) & (idx < len(rows))]
    if not len(idx):
        return None
    E = rows[idx, 4:7]

    def evaluate(lat, lon):
        g = height_at(lat, lon)
        if math.isnan(g):
            return None
        obs = make_observer(lat, lon, g + OBSERVER_M)
        az, el, d = az_el(obs, E)
        keys = np.floor(az / AZ_STEP + 0.5).astype(int)
        uk, inv = np.unique(keys, return_inverse=True)
        hz = ray_horizons(lat, lon, g + OBSERVER_M, uk * AZ_STEP)[inv]
        vis = visible_fraction(el - hz, angular_radius(R_EARTH_KM, d)) >= VISIBLE
        return {"lat": lat, "lon": lon, "ground_m": g, "earth_pct": 100 * float(vis.mean())}

    here = evaluate(site["lat"], site["lon"])
    if here is None:
        return None
    x0, y0 = to_polar_xy(site["lat"], site["lon"])
    steps = np.arange(-radius_m, radius_m + 1, step_m)
    dx, dy = np.meshgrid(steps, steps)
    dd = np.hypot(dx, dy)
    keep = (dd <= radius_m) & (dd >= step_m / 2)
    order = np.argsort(dd[keep], kind="stable")
    cand = np.stack([dx[keep], dy[keep], dd[keep]], axis=1)[order]

    target = min(100.0, max(here["earth_pct"] + 20, 50.0))
    best, best_pct = None, here["earth_pct"]
    for cx, cy, cd in cand:
        if best and cd > best["d"] + 1:
            break
        la, lo = from_polar_xy(x0 + cx, y0 + cy)
        p = evaluate(float(la), float(lo))
        if p and p["earth_pct"] >= target and p["earth_pct"] > best_pct:
            best, best_pct = {**p, "d": float(cd)}, p["earth_pct"]

    result = {"days": days, "radius_m": radius_m, "target_earth_pct": round(target, 1),
              "here": {"earth_pct": round(here["earth_pct"], 1), "ground_m": round(here["ground_m"])}, "best": None}
    if not best:
        return result
    dist, brg = distance_bearing(site["lat"], site["lon"], best["lat"], best["lon"])
    n = max(4, math.ceil(dist / 120))
    la, lo = destination(site["lat"], site["lon"], brg, dist * np.arange(1, n + 1) / n)
    hs = heights(*to_polar_xy(la, lo))
    prof = np.concatenate([[here["ground_m"]], hs])
    max_slope = float(np.degrees(np.arctan(np.abs(np.diff(prof)) / (dist / n))).max())
    result["best"] = {
        "lat": round(best["lat"], 5), "lon": round(best["lon"], 5), "earth_pct": round(best["earth_pct"], 1),
        "distance_m": round(dist), "bearing_deg": round(brg, 1), "direction": compass(brg),
        "climb_m": round(best["ground_m"] - here["ground_m"]), "max_slope_deg": round(max_slope, 1),
        "rover_ok": max_slope < 15,
    }
    return result


# ============================================================================ helpers
def iso(ms) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(t: str | None) -> int:
    """ISO time (UTC) or epoch ms -> epoch ms, clamped to the data range. None = now."""
    lo, hi = data_range()
    if t is None or t == "" or t == "now":
        ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    elif t.isdigit():
        ms = int(t)
    else:
        s = t.strip().replace(" ", "T")
        if s.endswith("Z"):
            s = s[:-1]
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        ms = int(dt.timestamp() * 1000)
    return min(max(ms, lo), hi)

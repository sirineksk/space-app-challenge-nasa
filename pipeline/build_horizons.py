"""
build_horizons.py — 360 deg terrain skyline for every catalog site, plus a
yearly Sun / Earth visibility summary.

Outputs
  data/horizons/<site_id>.json     skyline: 720 azimuths (0.5 deg step)
  data/horizons/horizons_all.json  all skylines in one file, for the web app
  data/horizons/site_summary_<year>.csv   % lit, % Earth in view, longest gaps

Method (see docs/methodology.md):
  For each azimuth, walk outward along the great circle from the site,
  sample LOLA terrain heights, and keep the largest elevation angle using
  exact spherical geometry (lunar curvature included). Observer height =
  ground + OBSERVER_HEIGHT_M (a lander's solar panel / antenna).

Usage:  python pipeline/build_horizons.py [--years 2026 2027]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from lunar_geometry import (R_EARTH_KM, R_SUN_KM, angular_radius_deg, az_el_deg,
                            destination_point, solar_power_w, terrain_elevation_angle_deg,
                            visible_fraction)
from terrain import load_default_stack

ROOT = Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data" / "raw", ROOT / "data" / "horizons"
AZ_STEP_DEG = 0.5
MAX_DIST_M = 300_000.0
OBSERVER_HEIGHT_M = 2.0
POLAR_LIMIT_DEG = -60.0      # our LOLA maps cover 60S-90S


def ray_distances_m():
    near = np.arange(40.0, 5000.0, 40.0)                     # every 40 m up to 5 km
    far = 5000.0 * 1.01 ** np.arange(1, 600)                 # then 1% steps
    return np.concatenate([near, far[far <= MAX_DIST_M]])


def skyline(stack, lat, lon):
    az = np.arange(0.0, 360.0, AZ_STEP_DEG)
    d = ray_distances_m()
    ground = float(stack.sample_latlon(np.array([lat]), np.array([lon]))[0])
    if np.isnan(ground):
        return None
    h_obs = ground + OBSERVER_HEIGHT_M
    A, D = np.meshgrid(az, d, indexing="ij")                  # (n_az, n_d)
    plat, plon = destination_point(lat, lon, A, D)
    h = stack.sample_latlon(plat.ravel(), plon.ravel()).reshape(A.shape)
    ang = terrain_elevation_angle_deg(h_obs, h, D)
    ang = np.where(np.isnan(ang), -90.0, ang)
    k = ang.argmax(axis=1)
    horizon = ang[np.arange(len(az)), k]
    blocker_km = d[k] / 1000.0
    return dict(ground_height_m=round(ground, 1), observer_height_m=OBSERVER_HEIGHT_M,
                azimuth_step_deg=AZ_STEP_DEG,
                horizon_deg=np.round(horizon, 3).tolist(),
                blocker_distance_km=np.round(blocker_km, 2).tolist())


SNAP_TYPES = {"region center", "approximate"}
SNAP_RADIUS_M = 1000.0
MAX_SLOPE_DEG = 5.0


def snap_to_landing_spot(dem, lat, lon):
    """
    Region centers are not landing spots: one can sit on a 20 deg slope or in
    a hollow. Like a mission planner, move to the highest ground with slope
    < MAX_SLOPE_DEG within SNAP_RADIUS_M (or the flattest point if none).
    Returns (lat, lon, shift_m, slope_deg).
    """
    from terrain import latlon_to_polar_xy, polar_xy_to_latlon
    x0, y0 = latlon_to_polar_xy(lat, lon)
    step = dem.res
    off = np.arange(-SNAP_RADIUS_M - step, SNAP_RADIUS_M + 2 * step, step)
    X, Y = np.meshgrid(x0 + off, y0 + off)
    Z = dem.sample_xy(X, Y)
    gy, gx = np.gradient(Z, step)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    dist = np.hypot(X - x0, Y - y0)
    ok = (dist <= SNAP_RADIUS_M) & np.isfinite(slope)
    good = ok & (slope < MAX_SLOPE_DEG)
    if good.any():
        k = np.nanargmax(np.where(good, Z, -np.inf))
    else:
        k = np.nanargmin(np.where(ok, slope, np.inf))
    k = np.unravel_index(k, Z.shape)
    nlat, nlon = polar_xy_to_latlon(X[k], Y[k])
    return float(nlat), float(nlon), float(dist[k]), float(slope[k])


def horizon_at(sky_deg, az_deg):
    grid = np.arange(0.0, 360.0, AZ_STEP_DEG)
    return np.interp(np.asarray(az_deg) % 360.0, np.append(grid, 360.0), np.append(sky_deg, sky_deg[0]))


def longest_run_hours(mask):
    best = cur = 0
    for m in mask:
        cur = cur + 1 if m else 0
        best = max(best, cur)
    return best


def summarize(site, sky, eph):
    lat, lon, h = site.lat_deg, site.lon_deg, sky["ground_height_m"] + OBSERVER_HEIGHT_M
    sky_arr = np.array(sky["horizon_deg"])
    out = {}
    for body, cols, radius in [("sun", ["sun_x_km", "sun_y_km", "sun_z_km"], R_SUN_KM),
                               ("earth", ["earth_x_km", "earth_y_km", "earth_z_km"], R_EARTH_KM)]:
        az, el, dist = az_el_deg(lat, lon, h, eph[cols].values)
        f = visible_fraction(el - horizon_at(sky_arr, az), angular_radius_deg(radius, dist))
        vis = f >= 0.5
        out[f"{body}_visible_pct"] = round(100 * vis.mean(), 1)
        out[f"{body}_longest_hidden_h"] = longest_run_hours(~vis)
        out[f"{body}_max_elev_deg"] = round(float(el.max()), 2)
        if body == "sun":
            p = solar_power_w(dist, el, f)
            out["energy_wh_per_day_1m2"] = round(float(p.sum() / (len(p) / 24.0)), 0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, nargs="+", default=[2026])
    args = ap.parse_args()

    sites = pd.read_csv(ROOT / "data" / "sites" / "sites.csv")
    sites = sites.dropna(subset=["lat_deg", "lon_deg"])
    stack = load_default_stack(RAW)
    print("DEMs:", [f"{d.name} ({d.res:.0f} m/px)" for d in stack.dems])
    OUT.mkdir(parents=True, exist_ok=True)

    allsky = {}
    for s in sites.itertuples():
        rec = dict(id=s.id, name=s.name, lat_deg=s.lat_deg, lon_deg=s.lon_deg)
        if s.lat_deg <= POLAR_LIMIT_DEG and s.coord_type in SNAP_TYPES:
            nlat, nlon, shift, slope = snap_to_landing_spot(stack.dems[0], s.lat_deg, s.lon_deg)
            rec.update(catalog_lat_deg=s.lat_deg, catalog_lon_deg=s.lon_deg,
                       lat_deg=round(nlat, 5), lon_deg=round(nlon, 5),
                       snapped_m=round(shift), slope_deg=round(slope, 1))
            sites.loc[s.Index, ["lat_deg", "lon_deg"]] = [rec["lat_deg"], rec["lon_deg"]]
            s = next(sites.loc[[s.Index]].itertuples())
        sky = skyline(stack, s.lat_deg, s.lon_deg) if s.lat_deg <= POLAR_LIMIT_DEG else None
        if sky is None:
            rec.update(terrain="not modelled (outside 60-90S polar maps); flat horizon used",
                       ground_height_m=None, observer_height_m=OBSERVER_HEIGHT_M,
                       azimuth_step_deg=AZ_STEP_DEG,
                       horizon_deg=[0.0] * int(360 / AZ_STEP_DEG), blocker_distance_km=None)
        else:
            rec.update(terrain="LOLA " + " + ".join(d.name for d in stack.dems), **sky)
        (OUT / f"{s.id}.json").write_text(json.dumps(rec))
        allsky[s.id] = rec
        mx = max(rec["horizon_deg"])
        print(f"{s.id:28s} ground={rec['ground_height_m']!s:>8} m  max skyline={mx:6.2f} deg")
    (OUT / "horizons_all.json").write_text(json.dumps(allsky))

    for year in args.years:
        eph = pd.read_csv(ROOT / "data" / "ephemeris" / f"sun_earth_moonME_{year}.csv")
        rows = []
        for s in sites.itertuples():
            sky = allsky[s.id]
            if sky["ground_height_m"] is None:
                sky = dict(sky, ground_height_m=0.0)
            rows.append(dict(id=s.id, name=s.name, lat_deg=s.lat_deg, lon_deg=s.lon_deg,
                             terrain_modelled=allsky[s.id]["ground_height_m"] is not None,
                             **summarize(s, sky, eph)))
        df = pd.DataFrame(rows)
        df.to_csv(OUT / f"site_summary_{year}.csv", index=False)
        print(df.to_string(index=False))


if __name__ == "__main__":
    main()

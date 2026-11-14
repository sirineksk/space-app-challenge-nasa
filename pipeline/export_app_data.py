"""
export_app_data.py — package the pipeline results for the web app (app/data/).

The website does every calculation in the browser, from these files:
  app/data/sites.json        catalog + 720-value skyline + yearly summaries
  app/data/ephem/<year>.bin  hourly Sun & Earth vectors (Float32, MOON_ME)
  app/data/ephem/index.json  layout of the .bin files
  app/data/dem/*.bin         light int16 terrain grids (custom points, ECO-PATH)
  app/data/dem/index.json    grid geometry
  app/data/map/              polar map: shaded relief (.jpg) + slope overlay (.png)

Usage: python pipeline/export_app_data.py   (after build_ephemeris/build_horizons)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.enums import Resampling

from build_horizons import AZ_STEP_DEG, OBSERVER_HEIGHT_M

ROOT = Path(__file__).resolve().parents[1]
DATA, RAW = ROOT / "data", ROOT / "data" / "raw"
APP = ROOT / "app"
OUT = APP / "data"
YEARS = range(2025, 2031)


def find_raw(stem):
    for ext in (".TIF", ".tif", ".tiff", ".TIFF"):
        if (RAW / f"{stem}{ext}").exists():
            return RAW / f"{stem}{ext}"
    raise FileNotFoundError(stem)


# ---------------------------------------------------------------- sites
def export_sites():
    sites = pd.read_csv(DATA / "sites" / "sites.csv")
    sky = json.loads((DATA / "horizons" / "horizons_all.json").read_text())
    summaries = {}
    for y in YEARS:
        p = DATA / "horizons" / f"site_summary_{y}.csv"
        if p.exists():
            summaries[y] = pd.read_csv(p).set_index("id")
    out = []
    for s in sites.itertuples():
        if s.id not in sky:
            continue
        h = sky[s.id]
        rec = dict(
            id=s.id, name=s.name, group=s.group, agency=None if pd.isna(s.agency) else s.agency,
            status=s.status, coord_type=s.coord_type,
            notes=None if pd.isna(s.notes) else s.notes,
            source=None if pd.isna(s.source) else s.source,
            source_url=None if pd.isna(s.source_url) else s.source_url,
            lat=h["lat_deg"], lon=h["lon_deg"],
            catalog_lat=h.get("catalog_lat_deg"), catalog_lon=h.get("catalog_lon_deg"),
            snapped_m=h.get("snapped_m"), slope_deg=h.get("slope_deg"),
            ground_m=h["ground_height_m"], observer_m=OBSERVER_HEIGHT_M,
            terrain=h["ground_height_m"] is not None,
            skyline=[round(v, 2) for v in h["horizon_deg"]],
            summary={},
        )
        for y, df in summaries.items():
            if s.id in df.index:
                r = df.loc[s.id]
                rec["summary"][str(y)] = dict(
                    sun_pct=float(r.sun_visible_pct), night_h=int(r.sun_longest_hidden_h),
                    earth_pct=float(r.earth_visible_pct), no_earth_h=int(r.earth_longest_hidden_h),
                    energy_wh=int(r.energy_wh_per_day_1m2))
        out.append(rec)
    meta = dict(azimuth_step_deg=AZ_STEP_DEG, generated_by="pipeline/export_app_data.py")
    (OUT / "sites.json").write_text(json.dumps(dict(meta=meta, sites=out), separators=(",", ":")))
    print(f"sites.json: {len(out)} sites, {(OUT / 'sites.json').stat().st_size / 1e3:.0f} kB")


# ---------------------------------------------------------------- ephemeris
def export_ephemeris():
    d = OUT / "ephem"
    d.mkdir(parents=True, exist_ok=True)
    index = dict(step_s=3600, fields=["sun_ux", "sun_uy", "sun_uz", "sun_dist_km",
                                      "earth_x_km", "earth_y_km", "earth_z_km"], years={})
    for y in YEARS:
        e = pd.read_csv(DATA / "ephemeris" / f"sun_earth_moonME_{y}.csv")
        sun = e[["sun_x_km", "sun_y_km", "sun_z_km"]].values
        dist = np.linalg.norm(sun, axis=1)
        arr = np.column_stack([sun / dist[:, None], dist,
                               e[["earth_x_km", "earth_y_km", "earth_z_km"]].values]).astype("<f4")
        arr.tofile(d / f"{y}.bin")
        t0 = pd.Timestamp(e.utc.iloc[0].replace("Z", ""), tz="UTC")
        index["years"][str(y)] = dict(start_ms=int(t0.value // 10**6), n=len(e), file=f"ephem/{y}.bin")
    (d / "index.json").write_text(json.dumps(index))
    print("ephemeris:", ", ".join(index["years"]), f"({arr.nbytes / 1e3:.0f} kB per year)")


# ---------------------------------------------------------------- terrain grids
def export_grid(src_path, factor, half_width_m, name, index):
    with rasterio.open(src_path) as src:
        res0 = abs(src.transform.a)
        # crop window centred on the pole
        n0 = int(round(2 * half_width_m / res0))
        col0 = int(round((-half_width_m - src.transform.c) / res0))
        row0 = int(round((src.transform.f - half_width_m) / res0))
        n0 -= n0 % factor
        win = rasterio.windows.Window(col0, row0, n0, n0)
        n = n0 // factor
        z = src.read(1, window=win, out_shape=(n, n), resampling=Resampling.average).astype(np.float32)
    z = np.where(np.isfinite(z), np.round(z), -32768).astype("<i2")
    res = res0 * factor
    (OUT / "dem" / f"{name}.bin").write_bytes(z.tobytes())
    x0 = -half_width_m + res / 2          # centre of first column (west)
    y0 = half_width_m - res / 2          # centre of first row (north/top)
    index[name] = dict(file=f"dem/{name}.bin", n=int(n), res_m=res, x0=x0, y0=y0, nodata=-32768)
    print(f"dem/{name}.bin: {n}x{n} at {res:.0f} m, {z.nbytes / 1e6:.1f} MB")
    return z, res


def export_dems():
    (OUT / "dem").mkdir(parents=True, exist_ok=True)
    index = {"projection": "south polar stereographic, sphere R=1737.4 km, true scale at pole",
             "order": ["inner", "outer", "far"]}
    p80, p60 = find_raw("LDEM_80S_80MPP_ADJ"), find_raw("LDEM_60S_240MPP_ADJ")
    export_grid(p80, 3, 182_400.0, "inner", index)      # 84S-90S at 240 m
    export_grid(p80, 8, 302_080.0, "outer", index)      # 80S-90S at 640 m
    export_grid(p60, 8, 929_280.0, "far", index)        # 60S-90S at 1920 m
    (OUT / "dem" / "index.json").write_text(json.dumps(index))


# ---------------------------------------------------------------- map images
def hillshade(z, res, az_deg=315.0, alt_deg=25.0, exag=2.0):
    gy, gx = np.gradient(z * exag, res)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(az_deg), np.radians(alt_deg)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def export_map():
    from PIL import Image
    d = OUT / "map"
    d.mkdir(parents=True, exist_ok=True)
    p80 = find_raw("LDEM_80S_80MPP_ADJ")
    with rasterio.open(p80) as src:
        size = 2048
        z = src.read(1, out_shape=(size, size), resampling=Resampling.average).astype(np.float32)
        res = abs(src.transform.a) * src.width / size
        half = abs(src.transform.c)
        zf = np.nan_to_num(z, nan=np.nanmean(z))
        hs = hillshade(zf, res, az_deg=315, alt_deg=18, exag=3.0)
        # height tint so deep craters read darker, high massifs brighter
        zn = np.clip((zf - np.percentile(zf, 1)) / (np.percentile(zf, 99) - np.percentile(zf, 1)), 0, 1)
        g = np.clip(0.06 + 0.88 * hs ** 1.15 * (0.55 + 0.45 * zn), 0, 1)
        Image.fromarray((g * 255).astype(np.uint8), "L").save(d / "relief_80S.jpg", quality=86, optimize=True, progressive=True)
        gy, gx = np.gradient(zf, res)
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        rgba = np.zeros((size, size, 4), np.uint8)
        for lo, hi, col, alpha in [(0, 10, (85, 201, 149), 30), (10, 15, (242, 181, 68), 95),
                                   (15, 90, (230, 109, 114), 120)]:
            m = (slope >= lo) & (slope < hi)
            rgba[m, :3] = col
            rgba[m, 3] = alpha
        Image.fromarray(rgba, "RGBA").save(d / "slope_80S.png", optimize=True)
        meta = dict(half_width_m=half, size_px=size, res_m=res,
                    note="pixel (0,0) is the top-left = north-west; +y (up) = longitude 0")
        (d / "index.json").write_text(json.dumps(meta))
        print(f"map: relief + slope {size}px, {res:.0f} m/px")



def main():
    OUT.mkdir(parents=True, exist_ok=True)
    export_sites()
    export_ephemeris()
    export_dems()
    export_map()


if __name__ == "__main__":
    main()

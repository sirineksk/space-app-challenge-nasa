"""
prepare_terrain.py — turn the big raw LOLA maps into small, GitHub-friendly
files for the web app (each well under GitHub's 100 MB limit).

Heights are stored as 16-bit integers in meters (the Moon's terrain spans
about -10 km to +11 km, which fits) with lossless DEFLATE compression.
Format: Cloud-Optimized GeoTIFF, readable in the browser with geotiff.js.

Outputs (data/terrain/):
  south_pole_80S_160m.tif    80-90 S, 160 m/px  (core polar map for the app)
  south_pole_60S_480m.tif    60-90 S, 480 m/px  (wide context / far mountains)
  south_pole_preview.png     shaded-relief picture for the README
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling

from terrain import load_default_stack

ROOT = Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data" / "raw", ROOT / "data" / "terrain"


def export(dem, factor: int, name: str):
    with rasterio.open(dem.path) as src:
        h, w = src.height // factor, src.width // factor
        data = src.read(1, out_shape=(h, w), resampling=Resampling.average).astype(np.float32)
        if src.nodata is not None:
            data[data == src.nodata] = np.nan
        transform = src.transform * src.transform.scale(src.width / w, src.height / h)
        nodata = -32768
        out = np.where(np.isnan(data), nodata, np.round(data)).astype(np.int16)
        profile = dict(driver="GTiff", height=h, width=w, count=1, dtype="int16",
                       crs=src.crs, transform=transform, nodata=nodata,
                       compress="DEFLATE", predictor=2, tiled=True,
                       blockxsize=512, blockysize=512, zlevel=9)
        path = OUT / name
        with rasterio.open(path, "w", **profile) as dst:
            dst.write(out, 1)
            dst.update_tags(units="meters above 1737.4 km sphere",
                            source=f"NASA PGDA LOLA {dem.name}, averaged {factor}x{factor}",
                            frame="MOON_ME (DE421), south polar stereographic")
    print(f"{path.relative_to(ROOT)}  {w}x{h}  {path.stat().st_size / 1e6:.1f} MB")
    return out


def preview(z: np.ndarray):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    zf = np.where(z == -32768, np.nan, z).astype(float)
    ls = LightSource(azdeg=315, altdeg=20)
    rgb = ls.shade(np.nan_to_num(zf, nan=np.nanmean(zf)), cmap=plt.cm.terrain, vert_exag=4, blend_mode="soft")
    plt.figure(figsize=(8, 8), dpi=110)
    plt.imshow(rgb)
    plt.axis("off")
    plt.title("Lunar south pole, 80-90 S (NASA LOLA)")
    plt.savefig(OUT / "south_pole_preview.png", bbox_inches="tight")
    print("data/terrain/south_pole_preview.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack = load_default_stack(RAW)
    by_name = {d.name: d for d in stack.dems}
    core = export(by_name["LDEM_80S_80MPP_ADJ"], 2, "south_pole_80S_160m.tif")
    if "LDEM_60S_240MPP_ADJ" in by_name:
        export(by_name["LDEM_60S_240MPP_ADJ"], 2, "south_pole_60S_480m.tif")
    preview(core)


if __name__ == "__main__":
    main()

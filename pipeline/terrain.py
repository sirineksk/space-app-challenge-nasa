"""
terrain.py — read NASA LOLA polar elevation maps and sample heights.

The PGDA LOLA polar products are GeoTIFFs in south polar stereographic
projection on a sphere of radius 1737.4 km (true scale at the pole), in the
MOON_ME frame of DE421. Pixel values are heights in meters above 1737.4 km.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from scipy.ndimage import map_coordinates

from lunar_geometry import R_MOON_KM

R_M = R_MOON_KM * 1000.0


def latlon_to_polar_xy(lat_deg, lon_deg):
    """South polar stereographic (sphere, true scale at pole), meters."""
    rho = 2.0 * R_M * np.tan(np.radians(45.0 + np.asarray(lat_deg) / 2.0))
    lon = np.radians(lon_deg)
    return rho * np.sin(lon), rho * np.cos(lon)


def polar_xy_to_latlon(x, y):
    rho = np.hypot(x, y)
    lat = 2.0 * np.degrees(np.arctan(rho / (2.0 * R_M))) - 90.0
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


class PolarDEM:
    """One LOLA polar GeoTIFF held in memory, with bilinear sampling."""

    def __init__(self, path: str | Path, name: str | None = None):
        self.path = Path(path)
        self.name = name or self.path.stem
        with rasterio.open(self.path) as src:
            self.crs = src.crs
            self.transform = src.transform
            self.res = abs(src.transform.a)
            self.shape = (src.height, src.width)
            arr = src.read(1).astype(np.float32)
            if src.nodata is not None:
                arr[arr == src.nodata] = np.nan
            arr[np.abs(arr) > 20000] = np.nan          # guard against fill values
        self.z = arr
        self._check_crs()

    def _check_crs(self):
        txt = (self.crs.to_proj4() if self.crs else "").lower()
        if txt and "stere" not in txt:
            raise ValueError(f"{self.name}: expected a polar stereographic CRS, got {txt}")
        if txt and "lat_0=-90" not in txt:
            print(f"WARNING {self.name}: CRS is not centred on the south pole: {txt}")

    def bounds_radius_m(self):
        """Radius (m) of the largest circle around the pole inside the map."""
        b = rasterio.transform.array_bounds(*self.shape, self.transform)
        return min(abs(b[0]), abs(b[1]), abs(b[2]), abs(b[3]))

    def sample_xy(self, x, y):
        inv = ~self.transform
        col, row = inv * (np.asarray(x), np.asarray(y))
        # pixel-center registration: centre of pixel (0,0) is at col=row=0.5
        coords = np.vstack([np.ravel(row) - 0.5, np.ravel(col) - 0.5])
        out = map_coordinates(self.z, coords, order=1, mode="constant", cval=np.nan)
        return out.reshape(np.shape(x))

    def sample_latlon(self, lat, lon):
        return self.sample_xy(*latlon_to_polar_xy(lat, lon))


class DEMStack:
    """Several DEMs, finest first: each point uses the finest map that covers it."""

    def __init__(self, dems: list[PolarDEM]):
        self.dems = dems

    def sample_latlon(self, lat, lon):
        x, y = latlon_to_polar_xy(lat, lon)
        out = np.full(np.shape(x), np.nan, dtype=np.float32)
        for dem in self.dems:
            todo = np.isnan(out)
            if not todo.any():
                break
            out[todo] = dem.sample_xy(x[todo], y[todo])
        return out


def load_default_stack(raw_dir: Path) -> DEMStack:
    """Finest first. File names as downloaded from PGDA (.tif or .tiff)."""
    order = ["LDEM_80S_80MPP_ADJ", "LDEM_60S_240MPP_ADJ"]
    dems = []
    for stem in order:
        for ext in (".TIF", ".tif", ".tiff", ".TIFF"):
            p = raw_dir / f"{stem}{ext}"
            if p.exists():
                dems.append(PolarDEM(p, stem))
                break
    if not dems:
        raise FileNotFoundError(f"No LOLA DEM found in {raw_dir}. Run pipeline/download_data.py first.")
    return DEMStack(dems)

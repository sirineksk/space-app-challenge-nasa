"""
build_ephemeris.py — hourly Sun and Earth positions as seen from the Moon.

Output: data/ephemeris/sun_earth_moonME_<year>.csv, one row per UTC hour.

Positions are vectors from the Moon's center to the body, in km, in the
MOON_ME (mean-Earth / polar-axis) body-fixed frame of DE421: the same frame
as the NASA LOLA terrain maps. They are *apparent* positions: corrected for
light travel time and for stellar aberration (the Moon's motion), like
JPL Horizons' default.

Sources (all official, pip-installable, no NASA server access needed):
  - JPL DE421 planetary + lunar ephemeris  (PyPI package `de421`)
  - NAIF lunar orientation: moon_pa_de421_1900-2050.bpc, moon_080317.tf,
    moon_assoc_me.tf (bundled in PyPI package `lunarsky`)

Usage:  python pipeline/build_ephemeris.py --start 2025 --end 2030
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import numpy as np
import pandas as pd
import spiceypy as sp
from astropy.time import Time
from astropy.utils import iers

import de421
import lunarsky
from jplephem.ephem import Ephemeris

iers.conf.auto_download = False          # use astropy's bundled leap-second table
import warnings
warnings.filterwarnings("ignore", message=".*dubious year.*")  # future UTC: assumes no new leap seconds

C_KM_S = 299_792.458
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "ephemeris"


def load_kernels():
    kdir = Path(lunarsky.__file__).parent / "data"
    for k in ["fk/satellites/moon_080317.tf",
              "fk/satellites/moon_assoc_me.tf",
              "pck/moon_pa_de421_1900-2050.bpc"]:
        sp.furnsh(str(kdir / k))


class DE421:
    """Barycentric (SSB) positions/velocities from DE421, km and km/s, ICRF."""

    def __init__(self):
        self.e = Ephemeris(de421)
        self.emrat = float(self.e.EMRAT)

    def _pv(self, name, jd):
        p, v = self.e.position_and_velocity(name, jd)
        return p.T, v.T / 86400.0          # (N,3) km, km/s

    def moon_earth_sun(self, jd):
        emb, emb_v = self._pv("earthmoon", jd)
        mg, mg_v = self._pv("moon", jd)          # geocentric Moon
        earth = emb - mg / (1.0 + self.emrat)
        earth_v = emb_v - mg_v / (1.0 + self.emrat)
        moon, moon_v = earth + mg, earth_v + mg_v
        sun, _ = self._pv("sun", jd)
        return (moon, moon_v), earth, sun

    def body(self, name, jd):
        if name == "sun":
            return self._pv("sun", jd)[0]
        emb, _ = self._pv("earthmoon", jd)
        mg, _ = self._pv("moon", jd)
        return emb - mg / (1.0 + self.emrat)       # Earth


def apparent_from_moon(eph: DE421, target: str, jd: np.ndarray) -> np.ndarray:
    """Light-time + stellar-aberration corrected vector Moon -> target (ICRF, km)."""
    (moon, moon_v), _, _ = eph.moon_earth_sun(jd)
    lt = np.zeros_like(jd)
    for _ in range(4):                               # converges in 2-3 iterations
        p = eph.body(target, jd - lt / 86400.0) - moon
        lt = np.linalg.norm(p, axis=1) / C_KM_S
    # first-order stellar aberration: shift unit vector by v/c
    dist = np.linalg.norm(p, axis=1, keepdims=True)
    u = p / dist + moon_v / C_KM_S
    u /= np.linalg.norm(u, axis=1, keepdims=True)
    return u * dist


def to_moon_me(vec_icrf: np.ndarray, et: np.ndarray) -> np.ndarray:
    out = np.empty_like(vec_icrf)
    for i, t in enumerate(et):
        out[i] = np.asarray(sp.pxform("J2000", "MOON_ME", float(t))) @ vec_icrf[i]
    return out


def latlon(v):
    r = np.linalg.norm(v, axis=1)
    return np.degrees(np.arcsin(v[:, 2] / r)), np.degrees(np.arctan2(v[:, 1], v[:, 0])), r


def build_year(eph: DE421, year: int) -> pd.DataFrame:
    utc = pd.date_range(f"{year}-01-01", f"{year + 1}-01-01", freq="1h", inclusive="left", tz="UTC")
    t = Time(utc.tz_localize(None).to_pydatetime(), scale="utc")
    jd_tdb = t.tdb.jd
    et = (jd_tdb - 2451545.0) * 86400.0

    sun = to_moon_me(apparent_from_moon(eph, "sun", jd_tdb), et)
    earth = to_moon_me(apparent_from_moon(eph, "earth", jd_tdb), et)
    slat, slon, sdist = latlon(sun)
    elat, elon, edist = latlon(earth)

    return pd.DataFrame({
        "utc": utc.strftime("%Y-%m-%dT%H:%MZ"),
        "sun_x_km": sun[:, 0].round(1), "sun_y_km": sun[:, 1].round(1), "sun_z_km": sun[:, 2].round(1),
        "earth_x_km": earth[:, 0].round(3), "earth_y_km": earth[:, 1].round(3), "earth_z_km": earth[:, 2].round(3),
        "subsolar_lat_deg": slat.round(5), "subsolar_lon_deg": slon.round(5),
        "subearth_lat_deg": elat.round(5), "subearth_lon_deg": elon.round(5),
        "sun_dist_km": sdist.round(0).astype(np.int64), "earth_dist_km": edist.round(1),
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2025)
    ap.add_argument("--end", type=int, default=2030)
    args = ap.parse_args()
    load_kernels()
    eph = DE421()
    OUT.mkdir(parents=True, exist_ok=True)
    for year in range(args.start, args.end + 1):
        df = build_year(eph, year)
        path = OUT / f"sun_earth_moonME_{year}.csv"
        df.to_csv(path, index=False)
        print(f"{path.relative_to(ROOT)}  {len(df)} rows  {os.path.getsize(path) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()

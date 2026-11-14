"""
check_against_horizons.py — compare our Sun/Earth angles with JPL Horizons.

Reference values were copied from the JPL Horizons API on 2026-11-14
(observer = site on the Moon, CENTER=coord@301, QUANTITIES=4, frame MEAN_ME,
ephemeris DE441). Run:  python pipeline/check_against_horizons.py

Query used (paste in a browser to re-check):
https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=10&CENTER=coord@301&SITE_COORD='23.47297,0.67408,0'&START_TIME=2026-11-14&STOP_TIME=2026-11-15&STEP_SIZE=6h&QUANTITIES=4&ANG_FORMAT=DEG
(COMMAND=399 and SITE_COORD='45.0,-89.5,0' for the Earth case)
"""
from pathlib import Path

import numpy as np
import pandas as pd

from lunar_geometry import az_el_deg

ROOT = Path(__file__).resolve().parents[1]

CASES = [
    # body, lat, lon, utc, horizons_az, horizons_el
    ("sun", 0.67408, 23.47297, "2026-11-14T00:00Z", 91.441745, -13.158098),
    ("sun", 0.67408, 23.47297, "2026-11-14T06:00Z", 91.461740, -10.112234),
    ("sun", 0.67408, 23.47297, "2026-11-14T12:00Z", 91.485723, -7.066737),
    ("sun", 0.67408, 23.47297, "2026-11-14T18:00Z", 91.513734, -4.021623),
    ("earth", -89.5, 45.0, "2026-11-14T00:00Z", 313.799347, -4.302398),
    ("earth", -89.5, 45.0, "2026-11-14T06:00Z", 313.450797, -4.046683),
    ("earth", -89.5, 45.0, "2026-11-14T12:00Z", 313.100651, -3.779945),
    ("earth", -89.5, 45.0, "2026-11-14T18:00Z", 312.750053, -3.502799),
]


def main():
    eph = pd.read_csv(ROOT / "data" / "ephemeris" / "sun_earth_moonME_2026.csv").set_index("utc")
    worst = 0.0
    print(f"{'body':6} {'site':>16} {'utc':18} {'d_az (deg)':>11} {'d_el (deg)':>11}")
    for body, lat, lon, t, haz, hel in CASES:
        v = eph.loc[t, [f"{body}_x_km", f"{body}_y_km", f"{body}_z_km"]].values.astype(float)
        az, el, _ = az_el_deg(lat, lon, 0.0, v)
        daz, dele = (float(az) - haz + 180) % 360 - 180, float(el) - hel
        worst = max(worst, abs(daz), abs(dele))
        print(f"{body:6} {lat:7.3f},{lon:8.3f} {t:18} {daz:11.6f} {dele:11.6f}")
    print(f"\nlargest difference: {worst:.6f} deg = {worst * 3600:.2f} arcsec")
    assert worst < 0.01, "difference larger than 0.01 deg"
    print("OK: matches JPL Horizons")


if __name__ == "__main__":
    main()

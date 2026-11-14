"""
lunar_geometry.py — shared math for LUMINALUNA & ECO-PATH.

Everything here is plain numpy so the same formulas can be ported 1:1 to
JavaScript for the web app. All vectors are in the Moon's body-fixed
MOON_ME frame (DE421), the same frame as the NASA LOLA terrain maps.

Conventions
-----------
- Latitude / longitude in degrees, longitude east-positive in [-180, 180].
- Heights in meters above the LOLA reference sphere (R = 1737.4 km).
- Azimuth: 0 deg = north, 90 deg = east (clockwise seen from above).
- Elevation: degrees above the local horizontal plane.
"""
from __future__ import annotations

import numpy as np

R_MOON_KM = 1737.4          # LOLA reference radius
R_SUN_KM = 695_700.0        # IAU nominal solar radius
R_EARTH_KM = 6_371.0        # Earth mean radius
AU_KM = 149_597_870.7
SOLAR_CONSTANT_W_M2 = 1361.0


# ---------------------------------------------------------------------------
# Site position and local frame
# ---------------------------------------------------------------------------
def site_vector_km(lat_deg, lon_deg, height_m=0.0):
    """Position of a surface point from the Moon's center, in km (MOON_ME)."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    r = R_MOON_KM + np.asarray(height_m) / 1000.0
    return np.stack([r * np.cos(lat) * np.cos(lon),
                     r * np.cos(lat) * np.sin(lon),
                     r * np.sin(lat)], axis=-1)


def enu_basis(lat_deg, lon_deg):
    """Local unit vectors (east, north, up) at a site, as rows of a 3x3 array."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    return np.vstack([east, north, up])


def az_el_deg(lat_deg, lon_deg, height_m, body_vec_km):
    """
    Azimuth and elevation of a body (Sun or Earth) seen from a lunar site.

    body_vec_km: (..., 3) position of the body from the Moon's center (MOON_ME).
    Returns (azimuth_deg, elevation_deg, distance_km), each shaped (...).
    Topocentric: the site offset is subtracted, so Earth's parallax
    (up to ~0.26 deg) is included.
    """
    site = site_vector_km(lat_deg, lon_deg, height_m)
    v = np.asarray(body_vec_km) - site
    e, n, u = enu_basis(lat_deg, lon_deg)
    ve, vn, vu = v @ e, v @ n, v @ u
    dist = np.linalg.norm(v, axis=-1)
    el = np.degrees(np.arcsin(vu / dist))
    az = np.degrees(np.arctan2(ve, vn)) % 360.0
    return az, el, dist


# ---------------------------------------------------------------------------
# Disks partly hidden by the horizon
# ---------------------------------------------------------------------------
def angular_radius_deg(body_radius_km, dist_km):
    return np.degrees(np.arcsin(body_radius_km / np.asarray(dist_km)))


def visible_fraction(center_minus_horizon_deg, radius_deg):
    """
    Fraction (0..1) of a disk visible above a locally straight horizon.
    center_minus_horizon_deg: elevation of disk center minus horizon elevation.
    """
    x = np.clip(np.asarray(center_minus_horizon_deg) / np.asarray(radius_deg), -1.0, 1.0)
    return 1.0 - (np.arccos(x) - x * np.sqrt(1.0 - x * x)) / np.pi


# ---------------------------------------------------------------------------
# Terrain horizon (exact spherical geometry, includes lunar curvature)
# ---------------------------------------------------------------------------
def terrain_elevation_angle_deg(h_site_m, h_terrain_m, dist_m):
    """
    Elevation angle of a terrain point seen from a site, on a sphere.
    dist_m: ground (arc) distance between them. Arrays broadcast.
    """
    R = R_MOON_KM * 1000.0
    gamma = np.asarray(dist_m) / R
    rt = R + np.asarray(h_terrain_m)
    rs = R + np.asarray(h_site_m)
    return np.degrees(np.arctan2(rt * np.cos(gamma) - rs, rt * np.sin(gamma)))


def destination_point(lat_deg, lon_deg, azimuth_deg, dist_m):
    """Great-circle destination from a start point, bearing and distance."""
    # Exactly at a pole every bearing would give the same longitude (0/0 in atan2):
    # nudge the start point by 1e-6 deg (~3 cm) so bearings keep their meaning.
    lat1, lon1 = np.radians(np.clip(lat_deg, -89.999999, 89.999999)), np.radians(lon_deg)
    brg = np.radians(azimuth_deg)
    d = np.asarray(dist_m) / (R_MOON_KM * 1000.0)
    lat2 = np.arcsin(np.sin(lat1) * np.cos(d) + np.cos(lat1) * np.sin(d) * np.cos(brg))
    lon2 = lon1 + np.arctan2(np.sin(brg) * np.sin(d) * np.cos(lat1),
                             np.cos(d) - np.sin(lat1) * np.sin(lat2))
    lon2 = (np.degrees(lon2) + 180.0) % 360.0 - 180.0
    return np.degrees(lat2), lon2


# ---------------------------------------------------------------------------
# Power
# ---------------------------------------------------------------------------
def solar_power_w(sun_dist_km, sun_elev_deg, sun_fraction,
                  efficiency=0.30, area_m2=1.0, panel="vertical-tracking"):
    """Electrical power of a panel. 'vertical-tracking' suits polar sites."""
    flux = SOLAR_CONSTANT_W_M2 * (AU_KM / np.asarray(sun_dist_km)) ** 2
    el = np.radians(sun_elev_deg)
    geom = np.cos(el) if panel == "vertical-tracking" else np.sin(el)
    return efficiency * area_m2 * flux * np.clip(geom, 0, None) * sun_fraction

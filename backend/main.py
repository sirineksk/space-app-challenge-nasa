"""
LUMINALUNA · ECO-PATH — API

Run locally (from the repo root):
    pip install -r backend/requirements.txt
    uvicorn backend.main:app --reload
Then open http://localhost:8000/docs (interactive API docs) or http://localhost:8000/ (the website).
"""
from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import engine as E

APP_DIR = Path(__file__).resolve().parent.parent / "app"

app = FastAPI(
    title="LUMINALUNA · ECO-PATH API",
    version="1.0.0",
    description=(
        "Sunlight (power) and Earth visibility (direct radio contact) for lunar south-pole landing sites, "
        "computed from NASA LRO LOLA terrain and JPL DE421 ephemerides (validated against JPL Horizons). "
        "Times are UTC; data covers 2025-2030. A body is 'visible' when at least half of its disk is above "
        "the terrain skyline. Power: 1 m² panel, 30 % efficient, vertical, turning to face the Sun."
    ),
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

SITE_Q = Query(None, description="Catalog site id, e.g. shackleton_rim_sr1 (see /api/sites)")
LAT_Q = Query(None, ge=-90, le=-60, description="Custom point latitude (south of 60° S)")
LON_Q = Query(None, ge=-180, le=360, description="Custom point longitude")
T_Q = Query(None, description="UTC time, e.g. 2026-11-14T14:30 (default: now)")


def _site(site: Optional[str], lat: Optional[float], lon: Optional[float]) -> dict:
    if not site and (lat is None or lon is None):
        raise HTTPException(400, "Give either ?site=<id> or ?lat=..&lon=..")
    s = E.resolve(site, lat, lon)
    if s is None:
        raise HTTPException(404, f"Unknown site '{site}'" if site else "No terrain data at this point (must be south of 60° S)")
    return s


def _public(s: dict, with_skyline: bool = False) -> dict:
    keep = ["id", "name", "group", "agency", "status", "coord_type", "lat", "lon", "catalog_lat", "catalog_lon",
            "snapped_m", "slope_deg", "ground_m", "observer_m", "terrain", "notes", "source", "source_url", "custom"]
    out = {k: s.get(k) for k in keep if k in s}
    if "summary" in s:
        out["summary"] = s["summary"]
    if with_skyline:
        out["skyline_step_deg"] = E.AZ_STEP
        out["skyline_deg"] = list(s["skyline"])
    return out


def _time(t: Optional[str]) -> int:
    try:
        return E.parse_time(t)
    except ValueError:
        raise HTTPException(400, f"Bad time '{t}'. Use e.g. 2026-11-14T14:30")


# ------------------------------------------------------------------------- endpoints
@app.get("/api/health", tags=["info"])
def health():
    return {"status": "ok"}


@app.get("/api/meta", tags=["info"], summary="Data range, method and constants")
def meta():
    lo, hi = E.data_range()
    return {
        "data_from": E.iso(lo), "data_to": E.iso(hi), "step_hours": 1,
        "terrain": "NASA LRO LOLA LDEM_80S_80MPP_ADJ + LDEM_60S_240MPP_ADJ (PGDA product 90)",
        "ephemeris": "JPL DE421, frame MOON_ME, apparent positions (light time + aberration)",
        "validation": "Sun/Earth directions match JPL Horizons within 0.05 arcsec",
        "visible_rule": "at least 50 % of the disk above the skyline",
        "observer_height_m": E.OBSERVER_M, "skyline_step_deg": E.AZ_STEP, "skyline_range_km": 300,
        "panel": {"area_m2": 1, "efficiency": E.PANEL_EFFICIENCY, "orientation": "vertical, sun-tracking"},
        "sites": len(E.sites()),
    }


@app.get("/api/sites", tags=["sites"], summary="List catalog sites (with yearly summaries)")
def list_sites(group: Optional[str] = Query(None, description="artemis3, reference, apollo, china, clps, india, japan"),
               q: Optional[str] = Query(None, description="Search in name / agency / status"),
               year: Optional[int] = Query(None, description="Sort by sunlight in this year")):
    out = E.sites()
    if group:
        out = [s for s in out if s["group"] == group]
    if q:
        ql = q.lower()
        out = [s for s in out if ql in f"{s['name']} {s.get('agency') or ''} {s['status']}".lower()]
    if year:
        out = sorted(out, key=lambda s: -(s["summary"].get(str(year), {}).get("sun_pct") or 0))
    return [_public(s) for s in out]


@app.get("/api/sites/{site_id}", tags=["sites"], summary="One site, with its 360° skyline")
def get_site(site_id: str):
    s = E.site_by_id(site_id)
    if not s:
        raise HTTPException(404, f"Unknown site '{site_id}'")
    return _public(s, with_skyline=True)


@app.get("/api/year", tags=["analysis"], summary="Yearly statistics + month by month")
def year(site: Optional[str] = SITE_Q, lat: Optional[float] = LAT_Q, lon: Optional[float] = LON_Q,
         year: int = Query(2026, ge=2025, le=2030)):
    s = _site(site, lat, lon)
    return {"site": _public(s), **E.year_stats(s, year)}


@app.get("/api/status", tags=["analysis"], summary="Sun & Earth right now, with countdowns")
def status(site: Optional[str] = SITE_Q, lat: Optional[float] = LAT_Q, lon: Optional[float] = LON_Q, t: Optional[str] = T_Q):
    s = _site(site, lat, lon)
    st = E.status_at(s, _time(t))
    if st is None:
        raise HTTPException(422, "Time outside the data range (2025-2030)")
    return {"site": _public(s), **st}


@app.get("/api/timeline", tags=["analysis"], summary="Hourly series, summary and windows (JSON or CSV)")
def timeline(site: Optional[str] = SITE_Q, lat: Optional[float] = LAT_Q, lon: Optional[float] = LON_Q,
             start: Optional[str] = Query(None, description="UTC start (default: now)"),
             days: int = Query(30, ge=1, le=400), format: str = Query("json", pattern="^(json|csv)$")):
    s = _site(site, lat, lon)
    t0 = _time(start)
    ser = E.series(s, t0, days * 24)
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["utc", "sun_visible_fraction", "sun_elevation_deg", "sun_azimuth_deg", "skyline_at_sun_deg",
                    "earth_visible_fraction", "earth_elevation_deg", "earth_azimuth_deg", "skyline_at_earth_deg", "power_w"])
        for k in range(ser["n"]):
            if ser["valid"][k]:
                w.writerow([E.iso(ser["t0"] + k * E.HOUR), *(f"{ser[c][k]:.3f}" for c in (
                    "sun_frac", "sun_el", "sun_az", "sun_hz", "earth_frac", "earth_el", "earth_az", "earth_hz")),
                    f"{ser['power'][k]:.1f}"])
        buf.seek(0)
        name = f"luminaluna_{s['id']}_{E.iso(t0)[:10]}_{days}d.csv"
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{name}"'})
    r3 = lambda a: [round(float(x), 3) if v else None for x, v in zip(a, ser["valid"])]
    return {
        "site": _public(s), "start": E.iso(ser["t0"]), "hours": ser["n"], "summary": E.summarize(ser),
        "sun_windows": E.windows(ser, "sun"), "earth_windows": E.windows(ser, "earth"),
        "hourly": {"sun_visible_fraction": r3(ser["sun_frac"]), "sun_elevation_deg": r3(ser["sun_el"]),
                   "sun_azimuth_deg": r3(ser["sun_az"]), "earth_visible_fraction": r3(ser["earth_frac"]),
                   "earth_elevation_deg": r3(ser["earth_el"]), "earth_azimuth_deg": r3(ser["earth_az"]),
                   "power_w": r3(ser["power"])},
    }


@app.get("/api/compare", tags=["analysis"], summary="Compare up to 4 sites over a mission window")
def compare(sites: str = Query(..., description="Comma-separated ids, e.g. shackleton_rim_sr1,a3_malapert_massif"),
            start: Optional[str] = Query(None, description="UTC start (default: now)"), days: int = Query(30, ge=1, le=400)):
    ids = [x.strip() for x in sites.split(",") if x.strip()][:4]
    t0 = _time(start)
    rows = []
    for i in ids:
        s = E.resolve(i)
        if not s:
            raise HTTPException(404, f"Unknown site '{i}'")
        rows.append({"site": _public(s), **E.summarize(E.series(s, t0, days * 24))})
    best = {}
    for k, better in (("sun_pct", max), ("earth_pct", max), ("energy_wh_day", max), ("night_h", min), ("no_earth_h", min)):
        vals = [r[k] for r in rows if r[k] is not None]
        best[k] = [r["site"]["id"] for r in rows if vals and r[k] == better(vals)]
    return {"start": E.iso(t0), "days": days, "sites": rows, "best": best}


@app.get("/api/skyline", tags=["terrain"], summary="360° skyline for any point south of 60° S (240 m terrain)")
def skyline(lat: float = Query(..., ge=-90, le=-60), lon: float = Query(..., ge=-180, le=360)):
    s = E.resolve(None, lat, lon)
    if s is None:
        raise HTTPException(404, "No terrain data at this point")
    return {**_public(s, with_skyline=True), "slope_deg": round(E.slope_at(s["lat"], s["lon"]), 1)}


@app.get("/api/eco-path", tags=["analysis"], summary="ECO-PATH: nearest spot that sees Earth more")
def eco(site: Optional[str] = SITE_Q, lat: Optional[float] = LAT_Q, lon: Optional[float] = LON_Q, t: Optional[str] = T_Q,
        days: int = Query(30, ge=1, le=90), radius_m: float = Query(5000, ge=500, le=10000)):
    s = _site(site, lat, lon)
    if not s.get("terrain") or s["lat"] > -60:
        raise HTTPException(422, "ECO-PATH needs terrain data (south of 60° S)")
    r = E.eco_path(s, _time(t), days=days, radius_m=radius_m)
    if r is None:
        raise HTTPException(422, "No terrain or ephemeris data for this request")
    return {"site": _public(s), "start": E.iso(_time(t)), **r}


# ------------------------------------------------------------------------- the website
@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app/")


if APP_DIR.exists():
    app.mount("/app", StaticFiles(directory=APP_DIR, html=True), name="app")

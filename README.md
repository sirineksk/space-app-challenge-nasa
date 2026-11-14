# LUMINALUNA & ECO-PATH

**Will a lander get sunlight, and can it talk to Earth?** For any site at the
Moon's south pole and any date, this project answers both questions in seconds,
and shows what to change when the answer is no.

Built for the NASA Space Apps Challenge: *compare lunar landing sites and dates
by showing Sun and Earth positions relative to the local horizon, to assess
power generation and direct-to-Earth communication windows.*

- **LUMINALUNA** (Sun → power): is the site lit, how much of the Sun is visible,
  countdown to sunset, % of time lit, longest night, energy per day.
- **ECO-PATH** (Earth → comms): is Earth in view, direct-to-Earth (DTE) windows,
  countdown to Earthset, and the nearest spot that can see Earth.

Both share one engine: a 360° terrain skyline computed from NASA LOLA laser
altimetry, compared against Sun and Earth positions from JPL's DE421 ephemeris.

## Repository layout

```
data/
  sites/sites.csv        landing-site catalog (Apollo → Artemis III), with sources
  ephemeris/             hourly Sun & Earth vectors on the Moon, 2025–2030
  terrain/               compact LOLA height maps of the south pole (GeoTIFF)
  horizons/              360° skyline of every polar site + yearly summaries
  raw/                   big original NASA files (NOT in git; see below)
pipeline/                Python code that builds everything in data/
app/                     the website (static, see app/README.md)
backend/                 the API (FastAPI, see backend/README.md)
index.html               redirects to app/index.html (GitHub Pages)
Dockerfile, render.yaml  deploy website + API together, later
docs/                    method and validation notes
```

See [`data/README.md`](data/README.md) for every column and unit.

## For front-end teammates

You don't need to download anything from NASA. Clone the repo and use the files
in `data/`. The two most useful ones:

- `data/horizons/horizons_all.json`: the skyline of each site (720 values, one
  per 0.5° of azimuth).
- `data/ephemeris/sun_earth_moonME_<year>.csv`: where the Sun and Earth are,
  every hour.

The formulas to combine them are in `pipeline/lunar_geometry.py`. They are
plain math, short enough to port to JavaScript.

## Rebuilding the data (only if you change the pipeline)

```bash
pip install -r requirements.txt
python pipeline/download_data.py        # ~390 MB from NASA PGDA → data/raw/
python pipeline/build_ephemeris.py      # Sun/Earth tables (seconds)
python pipeline/prepare_terrain.py      # compact terrain maps
python pipeline/build_horizons.py       # skylines + site summaries
python pipeline/check_against_horizons.py   # compare with JPL Horizons
```

## Accuracy

Our Sun and Earth directions match **JPL Horizons to 0.00002° (0.05
arcseconds)**. See `docs/validation.md`. The main limit is terrain detail: the
maps have 80 m pixels near the pole and 240 m pixels further out.

## Data sources and credits

- **Terrain**: NASA GSFC PGDA, *A New View of the Lunar South Pole from LOLA*
  ([product 90](https://pgda.gsfc.nasa.gov/products/90)); Barker et al. 2023,
  *Planetary Science Journal* 4:183, doi:10.3847/PSJ/acf3e1.
- **Ephemeris**: JPL DE421 (Folkner et al. 2008), and NAIF lunar orientation
  kernels `moon_pa_de421_1900-2050.bpc` and `moon_080317.tf`.
- **Validation**: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/).
- **Sites**: see the `source` and `source_url` columns of `data/sites/sites.csv`.

NASA data are public domain. Code is MIT-licensed (see `LICENSE`).

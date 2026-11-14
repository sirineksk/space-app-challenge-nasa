# LUMINALUNA · ECO-PATH — web app

A static website: no server, no database, no build step. Every number is computed
**in the browser** from the small files in `data/`, with the same formulas as
`../pipeline/lunar_geometry.py` (checked against the Python results to 0.1 %).

| Page | What it does |
|---|---|
| `index.html` | Landing page: hero map with real site positions, check-a-site form, top sites, key facts, mission, team |
| `explore.html` | Site list with filters, polar map (relief / slope), click anywhere to test your own point |
| `site.html?id=…` or `?lat=…&lon=…` | Sun & Earth status now with countdowns, 360° skyline, 30-day timeline (play), communication windows, ECO-PATH, month by month |
| `compare.html` | Up to 4 sites side by side, or one site on two landing dates; CSV export |
| `learn.html` | Four ideas for beginners + a real example (Shackleton rim vs the exact pole) |

Add `&t=2026-11-14T14:30` to any URL to fix the date (UTC). Data covers 2025–2030.

## Run it locally
Browsers block ES modules from `file://`, so start a tiny local server from the repo root:

```
py -m http.server 8000          # Windows   (python3 on Mac/Linux)
```
then open http://localhost:8000/app/  (or run the API, which serves the site too: see ../backend/README.md)

## Put it online (GitHub Pages)
Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
After a minute: `https://<user>.github.io/<repo>/` (it opens the landing page). Phones work too (bottom tab bar).

## Files
```
css/app.css      colours and layout (final Stitch design); css/landing.css for the home page
js/geo.js        geometry: az/el, visible fraction, power, polar projection
js/data.js       loads data/ (cached)
js/engine.js     hourly series, summaries, windows, custom skylines, ECO-PATH
js/ui.js         sidebar, date picker, Beginner/Expert, timeline drawing, icons
js/landing.js  js/explore.js  js/site.js  js/compare.js  js/learn.js   one per page
assets/moon.png  Moon icon made from the LOLA 80° S map; data/thumbs/ = real 40 km terrain views per site
data/            made by ../pipeline/export_app_data.py — don't edit by hand
```

## Accuracy notes
* Catalog sites use skylines from the 80 m LOLA terrain (computed by the pipeline).
* Custom points use 240 m terrain computed in the browser: within ~5 points of the 80 m result at 14 of 15
  test sites; next to steep walls (e.g. the exact pole) they can overestimate sunlight (see `../docs/validation.md`). ECO-PATH uses 240 m terrain for both ends so the
  comparison is fair.
* "Visible" = at least half of the Sun's / Earth's disk above the skyline. Power = 1 m² panel,
  30 % efficient, vertical, turning to face the Sun.

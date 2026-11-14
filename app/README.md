# LUMINALUNA · ECO-PATH — web app

A static website: no server, no database, no build step. Every number is computed
**in the browser** from the small files in `data/`, with the same formulas as
`../pipeline/lunar_geometry.py` (checked against the Python results to 0.1 %).

| Page | What it does |
|---|---|
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
then open http://localhost:8000/app/explore.html

## Put it online (GitHub Pages)
Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
After a minute: `https://<user>.github.io/<repo>/` (it redirects to the app).

## Files
```
css/app.css      colours and layout (from the Stitch design)
js/geo.js        geometry: az/el, visible fraction, power, polar projection
js/data.js       loads data/ (cached)
js/engine.js     hourly series, summaries, windows, custom skylines, ECO-PATH
js/ui.js         sidebar, date picker, Beginner/Expert, timeline drawing, icons
js/explore.js  js/site.js  js/compare.js  js/learn.js   one per page
data/            made by ../pipeline/export_app_data.py — don't edit by hand
```

## Accuracy notes
* Catalog sites use skylines from the 80 m LOLA terrain (computed by the pipeline).
* Custom points use 240 m terrain computed in the browser: sunlight within ~3 points of the 80 m result
  at 6 of 7 test sites (see `../docs/validation.md`). ECO-PATH uses 240 m terrain for both ends so the
  comparison is fair.
* "Visible" = at least half of the Sun's / Earth's disk above the skyline. Power = 1 m² panel,
  30 % efficient, vertical, turning to face the Sun.

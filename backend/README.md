# LUMINALUNA · ECO-PATH — API (FastAPI)

The same calculations as the website (`app/js/engine.js`), in Python, served as a JSON API.
It reads only the small files in `app/data/` (no NASA downloads, no database), so it deploys anywhere.
The website does **not** need the API — it works on its own (GitHub Pages). The API is for other
programs, judges, and teammates who want the numbers.

## Run it
```
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```
- Interactive docs: http://localhost:8000/docs
- The website, served by the same server: http://localhost:8000/

Tests: `pytest backend -q`

## Endpoints
| GET | What | Example |
|---|---|---|
| `/api/health` | is it up | |
| `/api/meta` | data range, method, constants | |
| `/api/sites` | all sites + yearly summaries (`?group=artemis3&q=malapert&year=2026`) | |
| `/api/sites/{id}` | one site + 720-value skyline | `/api/sites/shackleton_rim_sr1` |
| `/api/year` | yearly stats + month by month | `?site=shackleton_rim_sr1&year=2026` |
| `/api/status` | Sun & Earth now, countdowns, power | `?site=a3_malapert_massif&t=2026-11-14T14:30` |
| `/api/timeline` | hourly series, summary, sun/earth windows; `format=csv` | `?site=...&start=2026-11-14&days=30` |
| `/api/compare` | up to 4 sites over a mission window, with "best" | `?sites=shackleton_rim_sr1,a3_malapert_massif` |
| `/api/skyline` | skyline for any point south of 60° S (240 m terrain) | `?lat=-89.5&lon=120` |
| `/api/eco-path` | nearest spot within 5 km that sees Earth more | `?site=a3_nobile_rim_2&t=2026-11-14T14:30` |

Every analysis endpoint accepts either `site=<id>` or `lat=..&lon=..` (custom point).
Times are UTC (`2026-11-14T14:30`), clamped to 2025–2030.

## Deploy later
- **Render.com** (free): New + → Blueprint → this repo (uses `render.yaml`). URL like `https://luminaluna.onrender.com`.
- **Docker**: `docker build -t luminaluna . && docker run -p 8000:8000 luminaluna`.

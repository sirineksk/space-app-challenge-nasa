# Data dictionary

All positions use the Moon's **MOON_ME** body-fixed frame (mean Earth / polar
axis, DE421). That is the same frame as the NASA LOLA terrain maps, so terrain,
Sun and Earth line up with no hidden offset. Longitudes are east-positive, in
[-180, 180].

## `sites/sites.csv`: landing-site catalog

| column | meaning |
| --- | --- |
| `id` | short unique key, used for file names |
| `name` | display name |
| `group` | apollo · china · india · japan · clps · artemis3 · reference |
| `agency`, `status` | who, and landed / planned / candidate |
| `lat_deg`, `lon_deg` | coordinates (empty = TODO, see `notes`) |
| `coord_type` | `landed` (measured) · `target` · `region center` · `best point in region` · `approximate` · `TODO` |
| `notes` | caveats |
| `source`, `source_url` | where the coordinates come from |

**TODO for a teammate:** fill in Mons Mouton, Nobile Rim 1, Griffin-1 and Blue
Moon MK1. Read them from LROC Quickmap (Artemis III layer), and add the source.

## `ephemeris/sun_earth_moonME_<year>.csv`: Sun and Earth, every UTC hour

| column | unit | meaning |
| --- | --- | --- |
| `utc` | ISO time | start of the hour, UTC |
| `sun_x_km`, `sun_y_km`, `sun_z_km` | km | vector from the Moon's center to the Sun |
| `earth_x_km`, `earth_y_km`, `earth_z_km` | km | vector from the Moon's center to Earth |
| `subsolar_lat_deg`, `subsolar_lon_deg` | deg | point on the Moon where the Sun is straight overhead |
| `subearth_lat_deg`, `subearth_lon_deg` | deg | point on the Moon where Earth is straight overhead (shows libration) |
| `sun_dist_km`, `earth_dist_km` | km | distances from the Moon's center |

Vectors are *apparent* (light time + aberration), like JPL Horizons. To get
azimuth and elevation at a site, use `lunar_geometry.az_el_deg(lat, lon, height_m, vector)`.

## `horizons/<site_id>.json` and `horizons/horizons_all.json`: skylines

| field | meaning |
| --- | --- |
| `horizon_deg` | 720 elevation angles of the terrain skyline: index *i* = azimuth *i* × 0.5° (0 = north, 90 = east) |
| `blocker_distance_km` | how far away the highest terrain is, for each azimuth |
| `ground_height_m` | LOLA height of the site (m above 1737.4 km) |
| `observer_height_m` | panel / antenna height above ground (2 m) |
| `terrain` | which maps were used, or "not modelled" for non-polar sites |

A body is **visible** when its elevation is above `horizon_deg` at its azimuth
(interpolate between the 0.5° steps).

## `horizons/site_summary_<year>.csv`: one row per site, for that year

| column | meaning |
| --- | --- |
| `sun_visible_pct` | % of hours with at least half of the Sun above the skyline |
| `sun_longest_hidden_h` | longest continuous darkness, hours |
| `sun_max_elev_deg` | highest Sun elevation of the year |
| `earth_visible_pct`, `earth_longest_hidden_h`, `earth_max_elev_deg` | same for Earth |
| `energy_wh_per_day_1m2` | mean energy per Earth day from 1 m² of 30%-efficient vertical, Sun-tracking panel |
| `terrain_modelled` | False = flat horizon assumed (site outside the 60–90°S maps) |

## `terrain/`: compact height maps

16-bit integer heights in meters above the 1737.4 km sphere, as Cloud-Optimized
GeoTIFF, south polar stereographic (sphere R = 1737.4 km, true scale at the
pole). No-data value: −32768. They can be read in the browser with
[geotiff.js](https://geotiffjs.github.io/).

## `raw/`: not in git

The original NASA files go here. `pipeline/download_data.py` fetches them.

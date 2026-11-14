# Validation

## Sun and Earth positions vs. JPL Horizons

Checked on 2026-11-14 against the JPL Horizons API. The observer is a site on
the Moon (`CENTER=coord@301`), in the `MEAN_ME` frame. Horizons uses DE441;
we use DE421.

| body | site (lat, lon) | times (UTC) | max azimuth diff | max elevation diff |
| --- | --- | --- | --- | --- |
| Sun | 0.674°, 23.473° (Apollo 11) | 2026-11-14 00/06/12/18h | 0.000010° | 0.000003° |
| Earth | −89.5°, 45.0° (near the pole) | 2026-11-14 00/06/12/18h | 0.000005° | 0.000015° |

**Largest difference: 0.000015° (0.05 arcsec).** For scale, the Sun's disk is
0.53° wide. Reproduce it with `python pipeline/check_against_horizons.py`.

## Internal checks

- The NAIF lunar orientation kernel (`moon_pa_de421_1900-2050.bpc`) and DE421's
  own libration angles agree to < 0.001 arcsec.
- The ephemeris over 2025–2030 behaves as physics predicts. The sub-solar
  latitude stays within ±1.59° (the Moon's 1.54° tilt plus small orbital
  terms). The sub-Earth point wanders ±6.86° in latitude and ±8.05° in
  longitude (libration). The Earth–Moon distance ranges from 356,653 to
  406,693 km.
- Skyline code on a synthetic flat Moon gives −0.0870° everywhere. That equals
  the geometric dip for a 2 m mast, −0.0869°.
- A synthetic 2 km block 50 km away gives the expected angle, about 1.5°, and
  the correct blocker distance.

## First illumination results (2026, 2 m mast)

The best-known high-illumination spots near the pole come out as the best lit
in our catalog: Shackleton rim 85%, de Gerlache rim 82%, the peak near
Shackleton (Chang'e 7 target) 81%. Malapert Massif sees Earth 99% of the
time, as expected for a mountain facing the nearside. The far-side Chang'e 4
and 6 sites never see Earth.

Adding the 240 m map (mountains 300+ km away) changed no polar result: the
lunar curve hides such distant terrain.

## Web app vs. Python pipeline

The browser engine (`app/js/`) re-implements the same formulas. For 2026, catalog sites:

| Site | Sun % JS / PY | Earth % JS / PY | Energy Wh/day JS / PY |
|---|---|---|---|
| Shackleton rim SR1 | 85.3 / 85.2 | 49.7 / 49.7 | 8388 / 8388 |
| Malapert Massif | 54.9 / 54.9 | 98.8 / 98.9 | 5414 / 5415 |
| Nobile Rim 2 | 31.9 / 31.9 | 24.6 / 24.6 | 3119 / 3119 |
| Chandrayaan-3 | 48.6 / 48.6 | 100 / 100 | 4590 / 4590 |

**Custom points** (clicked on the map) use lighter 240 m terrain computed in the browser.
Rays start 360 m from the observer (1.5 grid cells) so the smoothed terrain does not shade
a sharp crest. Against the 80 m skylines (sun % / Earth %, 240 m vs 80 m):
Shackleton 84/85 · 50/50, de Gerlache GR1 80/82, Malapert 56/55 · 100/99, Nobile Rim 2 34/32,
Haworth 54/56, Chang'e 7 86/81. Exception: at the exact pole Earth visibility is 45 % vs 23 %,
because Earth grazes a ridge there; the UI labels custom points as "240 m terrain".

## Still to do

- Compare `site_summary` "% of time lit" at classic sites (e.g. Shackleton rim)
  with published LOLA illumination studies (Mazarico et al. 2011; Barker et
  al. 2021).

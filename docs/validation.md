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

## Still to do

- Compare `site_summary` "% of time lit" at classic sites (e.g. Shackleton rim)
  with published LOLA illumination studies (Mazarico et al. 2011; Barker et
  al. 2021).

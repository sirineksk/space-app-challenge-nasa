"""
download_data.py — fetch the raw NASA LOLA terrain maps into data/raw/.

You only need this to REBUILD the derived data. The repo already contains the
small processed files that the web app uses.

Source: NASA GSFC Planetary Geodesy Data Archive (PGDA), product 90,
"A New View of the Lunar South Pole from LOLA" (Barker et al. 2023, PSJ 4:183).
https://pgda.gsfc.nasa.gov/products/90
"""
from pathlib import Path
from urllib.request import urlretrieve

BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
FILES = {
    "LDEM_80S_80MPP_ADJ.TIF": "80-90 S, 80 m/pixel, ~181 MB",
    "LDEM_60S_240MPP_ADJ.TIF": "60-90 S, 240 m/pixel, ~210 MB",
}
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    for name, desc in FILES.items():
        dest = RAW / name
        if dest.exists():
            print(f"already have {name}")
            continue
        print(f"downloading {name} ({desc}) ...")
        urlretrieve(BASE + name, dest)
    print("done:", RAW)


if __name__ == "__main__":
    main()

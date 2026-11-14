"""API tests. Run from the repo root:  pytest backend -q"""
from fastapi.testclient import TestClient

from backend.main import app

c = TestClient(app)
T = "2026-11-14T14:30"


def test_health_and_meta():
    assert c.get("/api/health").json() == {"status": "ok"}
    m = c.get("/api/meta").json()
    assert m["sites"] == 23 and m["data_from"].startswith("2025-01-01") and m["data_to"].startswith("2030-12-31")


def test_sites_list_and_detail():
    lst = c.get("/api/sites", params={"group": "artemis3"}).json()
    assert len(lst) == 7
    s = c.get("/api/sites/shackleton_rim_sr1").json()
    assert len(s["skyline_deg"]) == 720 and abs(s["lat"] + 89.78) < 0.01
    assert c.get("/api/sites/nope").status_code == 404


def test_year_matches_pipeline():
    # yearly numbers from the Python pipeline (sites.json) vs the API engine
    for sid in ["shackleton_rim_sr1", "a3_malapert_massif", "a3_nobile_rim_2", "chandrayaan3"]:
        ref = c.get(f"/api/sites/{sid}").json()["summary"]["2026"]
        y = c.get("/api/year", params={"site": sid, "year": 2026}).json()
        assert abs(y["sun_pct"] - ref["sun_pct"]) < 0.3, sid
        assert abs(y["earth_pct"] - ref["earth_pct"]) < 0.3, sid
        assert abs(y["energy_wh_day"] - ref["energy_wh"]) < 0.5 / 100 * ref["energy_wh"] + 2, sid
        assert len(y["months"]) == 12


def test_status_shackleton():
    st = c.get("/api/status", params={"site": "shackleton_rim_sr1", "t": T}).json()
    assert st["sun"]["visible"] and not st["earth"]["visible"]
    assert st["sun"]["next_change"].startswith("2027-02-01")      # sunset ~78.9 days later
    assert st["earth"]["next_change"].startswith("2026-11-16")    # earthrise ~2 d 8 h later
    assert abs(st["sun"]["margin_deg"] - 2.69) < 0.05


def test_timeline_and_csv():
    tl = c.get("/api/timeline", params={"site": "a3_malapert_massif", "start": T, "days": 30}).json()
    assert tl["hours"] == 720 and len(tl["hourly"]["power_w"]) == 720
    r = c.get("/api/timeline", params={"site": "a3_malapert_massif", "start": T, "days": 2, "format": "csv"})
    assert r.status_code == 200 and r.text.count("\n") >= 48


def test_compare_best():
    r = c.get("/api/compare", params={"sites": "shackleton_rim_sr1,a3_malapert_massif", "start": T}).json()
    assert r["best"]["earth_pct"] == ["a3_malapert_massif"]


def test_custom_skyline_and_eco():
    sk = c.get("/api/skyline", params={"lat": -89.78, "lon": -156.35}).json()
    assert len(sk["skyline_deg"]) == 720 and 1500 < sk["ground_m"] < 1900
    eco = c.get("/api/eco-path", params={"site": "a3_nobile_rim_2", "t": T}).json()
    assert eco["best"] and 2500 < eco["best"]["distance_m"] < 3800 and eco["best"]["direction"] in ("NW", "W")
    none = c.get("/api/eco-path", params={"site": "shackleton_rim_sr1", "t": T}).json()
    assert none["best"] is None


def test_errors():
    assert c.get("/api/status").status_code == 400
    assert c.get("/api/status", params={"site": "x"}).status_code == 404
    assert c.get("/api/status", params={"site": "shackleton_rim_sr1", "t": "banana"}).status_code == 400

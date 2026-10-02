"""Tests für die Auswertung: python3 -m unittest test_server"""

import os
import tempfile
import time
import unittest
from datetime import date, datetime

import server


class EnergyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = server.Store(os.path.join(self.tmp.name, "t.sqlite"))

    def tearDown(self):
        self.tmp.cleanup()

    def rows(self, day, counters=True):
        start = int(datetime(day.year, day.month, day.day, 10).timestamp())
        out = []
        for i in range(60):  # eine Stunde: 3 kW PV, 1 kW Verbrauch, 2 kW Einspeisung
            row = {"ts": start + 60 * i, "dt": 60, "production": 3000, "consumption": 1000,
                   "grid": -2000, "ess": 0, "soc": 50,
                   "i_production": 50, "i_consumption": 1000 / 60, "i_grid_buy": 0,
                   "i_grid_sell": 2000 / 60, "i_ess_charge": 0, "i_ess_discharge": 0}
            if counters:
                row.update(e_production=1e6 + 50 * (i + 1), e_consumption=5e5 + 1000 / 60 * (i + 1),
                           e_grid_buy=0, e_grid_sell=1e5 + 2000 / 60 * (i + 1),
                           e_ess_charge=0, e_ess_discharge=0)
            out.append(row)
        return out

    def test_counter_difference(self):
        d = date(2026, 6, 1)
        self.store.insert(self.rows(d))
        day = self.store.daily_energy(d, d)[0]
        # 59 Zählerdifferenzen à 50 Wh + erste Minute aus der gemessenen Leistung = 1 h × 3 kW
        self.assertAlmostEqual(day["production"], 3000, delta=1)
        self.assertEqual(day["grid_buy"], 0)

    def test_falls_back_to_integrated_power(self):
        d = date(2026, 6, 2)
        self.store.insert(self.rows(d, counters=False))
        day = self.store.daily_energy(d, d)[0]
        self.assertAlmostEqual(day["production"], 3000, delta=1)
        self.assertAlmostEqual(day["grid_sell"], 2000, delta=1)

    def test_rollup_and_ratios(self):
        self.store.insert(self.rows(date(2026, 6, 1), counters=False) + self.rows(date(2026, 6, 2), counters=False))
        month = server.rollup(self.store.daily_energy(date(2026, 6, 1), date(2026, 6, 30)), "month")
        self.assertEqual(len(month), 1)
        self.assertAlmostEqual(month[0]["production"], 6000, delta=1)
        self.assertEqual(month[0]["autarky"], 100.0)
        self.assertAlmostEqual(month[0]["self_consumption"], 33.3, delta=0.1)

    def counter_rows(self, start, values, step=60):
        return [{"ts": start + step * i, "dt": step, "e_production": v, "e_consumption": v,
                 "e_grid_buy": 0, "e_grid_sell": 0, "e_ess_charge": 0, "e_ess_discharge": 0}
                for i, v in enumerate(values)]

    def test_counter_reset_is_not_counted_as_energy(self):
        d = date(2026, 6, 3)
        start = int(datetime(2026, 6, 3, 12).timestamp())
        # 1000 -> 1300 Wh, dann Rücksprung auf 5 (z. B. nach einem Update), dann weiter bis 205
        self.store.insert(self.counter_rows(start, [1000, 1100, 1200, 1300, 5, 105, 205]))
        day = self.store.daily_energy(d, d)[0]
        self.assertEqual(day["production"], 500)

    def test_first_sample_of_day_counts_since_last_sample_before_midnight(self):
        start = int(datetime(2026, 6, 4, 23, 58).timestamp())
        self.store.insert(self.counter_rows(start, [100, 110, 130, 160]))  # 23:58 … 00:01
        days = self.store.daily_energy(date(2026, 6, 5), date(2026, 6, 5))
        self.assertEqual(days[0]["production"], 50)   # 110->130->160, dazu 23:59->00:00

    def test_long_gap_is_not_attributed_to_one_day(self):
        start = int(datetime(2026, 6, 6, 8).timestamp())
        rows = self.counter_rows(start, [0, 100])
        rows += self.counter_rows(start + 12 * 3600, [5000, 5100])  # 12 h Lücke
        self.store.insert(rows)
        day = self.store.daily_energy(date(2026, 6, 6), date(2026, 6, 6))[0]
        self.assertEqual(day["production"], 200)

    def test_single_zero_reading_does_not_explode_the_day(self):
        # Fall vom 30.09.: ein einzelner Messwert 0 im Verbrauchszähler -> 2,8 MWh
        d = date(2026, 9, 30)
        start = int(datetime(2026, 9, 30, 12).timestamp())
        rows = self.counter_rows(start, [2_800_000, 2_800_030, 0, 2_800_060, 2_800_090])
        for r in rows:
            r["i_production"] = 30
        self.store.insert(rows)
        day = self.store.daily_energy(d, d)[0]
        self.assertEqual(day["production"], 150)   # 5 Minuten à 30 Wh
        glitches = self.store.counter_glitches()
        self.assertEqual({(g[1], g[3]) for g in glitches if g[1] == "e_production"},
                         {("e_production", 0), ("e_production", 2_800_060)})

    def test_jump_faster_than_max_power_uses_measured_power(self):
        store = server.Store(os.path.join(self.tmp.name, "p.sqlite"), max_power_w=10000)
        start = int(datetime(2026, 6, 7, 12).timestamp())
        rows = self.counter_rows(start, [0, 100, 50_000, 50_100])  # +49,9 kWh in 1 Minute: unmöglich
        for r in rows:
            r["i_production"] = 100
        store.insert(rows)
        self.assertEqual(store.daily_energy(date(2026, 6, 7), date(2026, 6, 7))[0]["production"], 400)

    def test_balance_check_flags_implausible_day(self):
        ok = server.check_balance({"production": 38200, "grid_buy": 1000, "ess_discharge": 12800,
                                   "ess_charge": 15100, "grid_sell": 0, "consumption": 37000})
        self.assertNotIn("warning", ok)
        bad = server.check_balance({"production": 33500, "grid_buy": 2900, "ess_discharge": 16700,
                                    "ess_charge": 10000, "grid_sell": 100, "consumption": 2_835_200})
        self.assertEqual(bad["warning"]["expected"], 43000)
        self.assertTrue(bad["warning"]["corrected"])
        self.assertEqual(bad["consumption"], 43000)            # durch den Bilanzwert ersetzt
        self.assertEqual(bad["warning"]["consumption"], 2_835_200)  # Zählerwert bleibt nachvollziehbar
        broken = server.check_balance({"production": 0, "grid_buy": 0, "ess_discharge": 0,
                                       "ess_charge": 9000, "grid_sell": 0, "consumption": 5000})
        self.assertFalse(broken["warning"]["corrected"])
        self.assertEqual(broken["consumption"], 5000)

    def test_first_date(self):
        self.assertIsNone(self.store.first_date())
        self.store.insert(self.rows(date(2026, 6, 2)) + self.rows(date(2026, 6, 1)))
        self.assertEqual(self.store.first_date(), "2026-06-01")

    def test_series_is_downsampled(self):
        d = date(2026, 6, 1)
        self.store.insert(self.rows(d))
        start, end = server.day_bounds(d)
        data = self.store.series(start, end, max_points=12)
        self.assertEqual(data["bucket_seconds"], 7200)
        self.assertEqual(round(data["points"][0]["production"]), 3000)


class DemoTests(unittest.TestCase):
    def test_energy_balance(self):
        sim = server.DemoClient()
        t = time.mktime(datetime(2026, 6, 21, 13).timetuple())
        s = sim.step(t, 5)
        self.assertAlmostEqual(s["consumption"], s["production"] + s["ess"] + s["grid"], delta=2)
        self.assertTrue(0 <= s["soc"] <= 100)


if __name__ == "__main__":
    unittest.main()

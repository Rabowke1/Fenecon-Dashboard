"""Tests für die Stromkosten: python3 -m unittest test_tariff"""

import unittest

import tariff


class TariffTests(unittest.TestCase):
    def test_full_month_costs_exactly_the_base_price(self):
        days = [{"date": f"2026-02-{d:02d}", "grid_buy": 0, "consumption": 0} for d in range(1, 29)]
        self.assertEqual(tariff.costs(days, 11.90, 0.326)["base"], 11.90)

    def test_savings_do_not_depend_on_base_price(self):
        day = [{"date": "2026-09-28", "grid_buy": 1000, "consumption": 37000}]
        a = tariff.costs(day, 11.90, 0.326)
        b = tariff.costs(day, 99.00, 0.326)
        self.assertEqual(a["bought"], 0.33)             # 1 kWh × 32,6 ct
        self.assertEqual(a["saved"], 11.74)             # 36 kWh × 32,6 ct
        self.assertEqual(a["without_pv"], 12.07)        # 37 kWh × 32,6 ct
        self.assertEqual((a["saved"], a["without_pv"]), (b["saved"], b["without_pv"]))
        self.assertEqual(a["total"], round(a["bought"] + a["base"], 2))
        self.assertAlmostEqual(a["self_share"], 97.3, places=1)

    def test_day_without_grid_purchase(self):
        c = tariff.costs([{"date": "2026-09-29", "grid_buy": 0, "consumption": 200}], 11.90, 0.326)
        self.assertEqual((c["bought"], c["saved"], c["without_pv"]), (0.0, 0.07, 0.07))
        self.assertEqual((c["base"], c["total"]), (0.40, 0.40))
        self.assertEqual(c["self_share"], 100.0)

    def test_feed_in(self):
        day = [{"date": "2026-09-28", "grid_buy": 1000, "grid_sell": 20000, "consumption": 37000}]
        c = tariff.costs(day, 11.90, 0.326, 0.0666)
        self.assertEqual(c["feed_in"], 1.33)            # 20 kWh × 6,66 ct
        self.assertEqual(c["benefit"], round(c["saved"] + 1.33, 2))
        self.assertEqual(c["balance"], round(0.33 + c["base"] - 1.33, 2))
        self.assertEqual(tariff.costs(day, 11.90, 0.326)["feed_in"], 0)

    def test_display_adds_up(self):
        for n in range(0, 40000, 137):
            c = tariff.costs([{"date": "2026-02-10", "grid_buy": n / 3, "grid_sell": n / 7, "consumption": n}],
                             11.90, 0.326, 0.0666)
            self.assertAlmostEqual(c["bought"] + c["saved"], c["without_pv"], places=9)
            self.assertAlmostEqual(c["bought"] + c["base"], c["total"], places=9)
            self.assertAlmostEqual(c["total"] - c["feed_in"], c["balance"], places=9)
            self.assertAlmostEqual(c["saved"] + c["feed_in"], c["benefit"], places=9)

    def test_empty_period(self):
        c = tariff.costs([], 11.90, 0.326)
        self.assertEqual((c["days"], c["bought"], c["saved"], c["self_share"]), (0, 0, 0, None))


if __name__ == "__main__":
    unittest.main()

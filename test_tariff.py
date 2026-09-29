"""Tests für die Stromkosten: python3 -m unittest test_tariff"""

import unittest

import tariff


class TariffTests(unittest.TestCase):
    def test_full_month_costs_exactly_the_base_price(self):
        days = [{"date": f"2026-02-{d:02d}", "grid_buy": 0, "consumption": 0} for d in range(1, 29)]
        self.assertEqual(tariff.costs(days, 11.90, 0.326)["base"], 11.90)

    def test_day_with_and_without_pv(self):
        c = tariff.costs([{"date": "2026-09-28", "grid_buy": 1000, "consumption": 37000}], 11.90, 0.326)
        base = 11.90 / 30
        self.assertAlmostEqual(c["total"], round(base + 0.326, 2))
        self.assertAlmostEqual(c["without_pv"]["total"], round(base + 37 * 0.326, 2))
        self.assertAlmostEqual(c["savings"], round(36 * 0.326, 2), places=2)

    def test_empty_period(self):
        c = tariff.costs([], 11.90, 0.326)
        self.assertEqual((c["days"], c["total"], c["savings"]), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()

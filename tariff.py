"""Stromkosten nach Tarif: Grundpreis pro Monat plus Arbeitspreis je kWh Netzbezug.

Der Grundpreis wird tageweise auf den jeweiligen Monat verteilt (ein ganzer Monat
kostet also genau den Monatsgrundpreis). Zum Vergleich wird berechnet, was der
gesamte Verbrauch ohne PV-Anlage und Batterie aus dem Netz gekostet hätte.
"""

import calendar
from datetime import date


def base_share(day, base_price_month):
    """Anteiliger Grundpreis für einen Kalendertag (ISO-Datum oder date)."""
    d = date.fromisoformat(day) if isinstance(day, str) else day
    return base_price_month / calendar.monthrange(d.year, d.month)[1]


def costs(days, base_price_month, price_per_kwh):
    """days: Einträge mit 'date', 'grid_buy' und 'consumption' (Wh).

    Liefert die Kosten in Euro für den gesamten Zeitraum.
    """
    base = sum(base_share(d["date"], base_price_month) for d in days)
    grid_kwh = sum(d.get("grid_buy") or 0 for d in days) / 1000
    cons_kwh = sum(d.get("consumption") or 0 for d in days) / 1000
    actual = base + grid_kwh * price_per_kwh
    without = base + cons_kwh * price_per_kwh
    return {
        "days": len(days),
        "base": round(base, 2),
        "grid_kwh": round(grid_kwh, 2),
        "energy": round(grid_kwh * price_per_kwh, 2),
        "total": round(actual, 2),
        "without_pv": {
            "consumption_kwh": round(cons_kwh, 2),
            "energy": round(cons_kwh * price_per_kwh, 2),
            "total": round(without, 2),
        },
        "savings": round(without - actual, 2),
        "tariff": {"base_price_month": base_price_month, "price_per_kwh": price_per_kwh},
    }

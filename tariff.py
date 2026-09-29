"""Stromkosten nach Tarif.

Verglichen wird nur der Strom selbst, zum Arbeitspreis je kWh:
    gekaufter Strom      = Netzbezug × Arbeitspreis
    selbst erzeugt       = (Verbrauch − Netzbezug) × Arbeitspreis   -> Ersparnis durch PV
    ohne PV              = Verbrauch × Arbeitspreis                 (= gekauft + selbst erzeugt)
Der Grundpreis fällt mit und ohne PV gleich an und wird nur getrennt ausgewiesen,
tageweise auf den jeweiligen Monat verteilt (ein ganzer Monat = Monatsgrundpreis).
"""

import calendar
from decimal import ROUND_HALF_UP, Decimal
from datetime import date


def base_share(day, base_price_month):
    """Anteiliger Grundpreis für einen Kalendertag (ISO-Datum oder date)."""
    d = date.fromisoformat(day) if isinstance(day, str) else day
    return base_price_month / calendar.monthrange(d.year, d.month)[1]


def cents(value):
    """Kaufmännisch auf ganze Cent runden."""
    return Decimal(repr(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def costs(days, base_price_month, price_per_kwh):
    """days: Einträge mit 'date', 'grid_buy' und 'consumption' (Wh). Beträge in Euro.

    Einzelposten werden auf Cent gerundet und die Summen daraus gebildet,
    damit die Anzeige immer aufgeht.
    """
    grid_kwh = sum(d.get("grid_buy") or 0 for d in days) / 1000
    cons_kwh = max(grid_kwh, sum(d.get("consumption") or 0 for d in days) / 1000)
    self_kwh = cons_kwh - grid_kwh
    bought = cents(grid_kwh * price_per_kwh)
    saved = cents(self_kwh * price_per_kwh)
    base = cents(sum(base_share(d["date"], base_price_month) for d in days))
    return {
        "days": len(days),
        "grid_kwh": round(grid_kwh, 2),
        "self_kwh": round(self_kwh, 2),
        "consumption_kwh": round(cons_kwh, 2),
        "self_share": round(self_kwh / cons_kwh * 100, 1) if cons_kwh > 0 else None,
        "bought": float(bought),             # gekaufter Strom
        "saved": float(saved),               # selbst erzeugter Strom = Ersparnis
        "without_pv": float(bought + saved),  # gesamter Verbrauch zum Arbeitspreis
        "base": float(base),                 # Grundpreis anteilig, fällt immer an
        "total": float(bought + base),       # tatsächlich bezahlt
        "tariff": {"base_price_month": base_price_month, "price_per_kwh": price_per_kwh},
    }

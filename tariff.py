"""Stromkosten nach Tarif.

Verglichen wird nur der Strom selbst, zum Arbeitspreis je kWh:
    gekaufter Strom      = Netzbezug × Arbeitspreis
    selbst erzeugt       = (Verbrauch − Netzbezug) × Arbeitspreis   -> Ersparnis durch PV
    ohne PV              = Verbrauch × Arbeitspreis                 (= gekauft + selbst erzeugt)
Der Grundpreis fällt mit und ohne PV gleich an und wird nur getrennt ausgewiesen,
tageweise auf den jeweiligen Monat verteilt (ein ganzer Monat = Monatsgrundpreis).
Dazu kommt die Einspeisevergütung für den ins Netz gelieferten Strom:
    Einspeisevergütung   = Einspeisung × Vergütungssatz
    Saldo                = gekaufter Strom + Grundpreis − Einspeisevergütung
    Nutzen der PV        = selbst erzeugter Strom (gespart) + Einspeisevergütung
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


def costs(days, base_price_month, price_per_kwh, feed_in_per_kwh=0.0, base_days=None):
    """days: Einträge mit 'date', 'grid_buy', 'grid_sell' und 'consumption' (Wh). Beträge in Euro.

    base_days: alle Kalendertage des Zeitraums, für die der Grundpreis anfällt –
    auch Tage ohne Messwerte. Ohne Angabe die Tage aus days.

    Einzelposten werden auf Cent gerundet und die Summen daraus gebildet,
    damit die Anzeige immer aufgeht.
    """
    grid_kwh = sum(d.get("grid_buy") or 0 for d in days) / 1000
    sell_kwh = sum(d.get("grid_sell") or 0 for d in days) / 1000
    cons_kwh = max(grid_kwh, sum(d.get("consumption") or 0 for d in days) / 1000)
    self_kwh = cons_kwh - grid_kwh
    bought = cents(grid_kwh * price_per_kwh)
    saved = cents(self_kwh * price_per_kwh)
    feed_in = cents(sell_kwh * feed_in_per_kwh)
    if base_days is None:
        base_days = [d["date"] for d in days]
    base = cents(sum(base_share(d, base_price_month) for d in base_days))
    return {
        "days": len(base_days),
        "days_with_data": len(days),
        "grid_kwh": round(grid_kwh, 2),
        "sell_kwh": round(sell_kwh, 2),
        "self_kwh": round(self_kwh, 2),
        "consumption_kwh": round(cons_kwh, 2),
        "self_share": round(self_kwh / cons_kwh * 100, 1) if cons_kwh > 0 else None,
        "bought": float(bought),               # gekaufter Strom
        "saved": float(saved),                 # selbst erzeugter Strom = Ersparnis
        "feed_in": float(feed_in),             # Einspeisevergütung
        "without_pv": float(bought + saved),    # gesamter Verbrauch zum Arbeitspreis
        "base": float(base),                   # Grundpreis anteilig, fällt immer an
        "total": float(bought + base),         # an den Versorger bezahlt
        "balance": float(bought + base - feed_in),  # Saldo nach Vergütung (negativ = Guthaben)
        "benefit": float(saved + feed_in),     # Nutzen der PV insgesamt
        "tariff": {"base_price_month": base_price_month, "price_per_kwh": price_per_kwh,
                   "feed_in_per_kwh": feed_in_per_kwh},
    }

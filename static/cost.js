"use strict";

/* Stromkosten und Einspeisevergütung als fest sichtbare Aufschlüsselung. */
const Cost = (() => {
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const ct = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kwh = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

  const money = (v) => (v == null ? "–" : eur.format(v));
  const cents = (euro) => `${ct.format(euro * 100)} ct`;

  /** Kurzform für Diagramm-Tooltips und Kacheln. */
  const summary = (cost) => (cost
    ? `Gekauft ${money(cost.bought)} · Vergütung ${money(cost.feed_in)} · durch PV gespart ${money(cost.saved)}`
    : "");

  const row = (label, detail, value, cls = "") =>
    `<div class="ledger-row ${cls}"><span>${label}${detail ? `<small>${detail}</small>` : ""}</span><span>${value}</span></div>`;

  /** Zwei Spalten: was an den Versorger geht, und was die PV einbringt. */
  function card(cost) {
    if (!cost) return `<p class="card-sub">Keine Daten für diesen Zeitraum.</p>`;
    const t = cost.tariff;
    const days = cost.days === 1 ? "1 Tag" : `${cost.days} Tage`;
    const selfPct = cost.self_share ?? 0;
    const credit = cost.balance < 0;
    return `
      <div class="money">
        <div class="money-col">
          <h3>Stromrechnung</h3>
          ${row("Gekaufter Strom", `${kwh.format(cost.grid_kwh)} kWh × ${cents(t.price_per_kwh)}`, money(cost.bought))}
          ${row("Grundpreis anteilig", `${ct.format(t.base_price_month)} €/Monat · ${days} (fällt jeden Tag an)`, money(cost.base))}
          ${row("Einspeisevergütung", `${kwh.format(cost.sell_kwh)} kWh × ${cents(t.feed_in_per_kwh)}`, `− ${money(cost.feed_in)}`, "credit")}
          ${row(credit ? "Guthaben" : "Saldo", credit ? "Vergütung höher als die Kosten" : "Kosten abzüglich Vergütung",
                money(Math.abs(cost.balance)), `total${credit ? " credit" : ""}`)}
          ${cost.days_with_data < cost.days ? `<p class="money-note">Strommengen nur aus ${cost.days_with_data} von ${cost.days} Tagen
            mit Aufzeichnung – der Grundpreis zählt für alle ${cost.days} Tage.</p>` : ""}
        </div>
        <div class="money-col">
          <h3>Das bringt die PV</h3>
          ${row("Selbst erzeugter Strom", `${kwh.format(cost.self_kwh)} kWh × ${cents(t.price_per_kwh)} nicht gekauft`, money(cost.saved), "credit")}
          ${row("Einspeisevergütung", `${kwh.format(cost.sell_kwh)} kWh × ${cents(t.feed_in_per_kwh)}`, money(cost.feed_in), "credit")}
          ${row("Nutzen gesamt", "Ersparnis + Vergütung", money(cost.benefit), "total credit")}
          <div class="ratio" aria-hidden="true"><i style="flex-grow:${100 - selfPct}"></i><b style="flex-grow:${selfPct}"></b></div>
          <div class="ratio-legend"><span><i></i>gekauft ${pct.format(100 - selfPct)} %</span><span><b></b>selbst erzeugt ${pct.format(selfPct)} %</span></div>
          <p class="money-note">Ohne PV hätte der Verbrauch von ${kwh.format(cost.consumption_kwh)} kWh
            <strong>${money(cost.without_pv)}</strong> gekostet (zzgl. Grundpreis).</p>
        </div>
      </div>`;
  }

  return { card, money, summary };
})();

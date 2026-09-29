"use strict";

/* Stromkosten mit Mouse-over: gekaufter gegenüber selbst erzeugtem Strom, Grundpreis getrennt. */
const Cost = (() => {
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const ct = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kwh = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const money = (v) => (v == null ? "–" : eur.format(v));

  function period(cost) {
    return cost.days === 1 ? "1 Tag" : `${cost.days} Tage`;
  }

  /** Kurzform für Diagramm-Tooltips. */
  const summary = (cost) => (cost ? `Gekaufter Strom ${money(cost.bought)} · durch PV gespart ${money(cost.saved)}` : "");

  /** HTML für den Betrag (Kosten für gekauften Strom) samt Info-Panel. */
  function html(cost, title = "Stromkosten") {
    if (!cost) return "–";
    const price = `${ct.format(cost.tariff.price_per_kwh * 100)} ct/kWh`;
    const base = `${ct.format(cost.tariff.base_price_month)} €/Monat`;
    const selfPct = cost.self_share == null ? 0 : cost.self_share;
    const pct = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
    return `
      <span class="cost" tabindex="0">
        <span class="cost-value">${money(cost.bought)}</span>
        <svg class="cost-info" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.9v.1"/></svg>
        <span class="cost-pop" role="tooltip">
          <span class="cost-title">${title} <small>· ${period(cost)}</small></span>
          <span class="cost-sub">Strom zum Arbeitspreis von ${price}</span>
          <span class="cost-row"><span>Gekaufter Strom <small>${kwh.format(cost.grid_kwh)} kWh aus dem Netz</small></span><span>${money(cost.bought)}</span></span>
          <span class="cost-row saving"><span>Selbst erzeugter Strom <small>${kwh.format(cost.self_kwh)} kWh aus PV und Batterie</small></span><span>${money(cost.saved)}</span></span>
          <span class="cost-ratio" aria-hidden="true"><i style="flex-grow:${100 - selfPct}"></i><b style="flex-grow:${selfPct}"></b></span>
          <span class="cost-ratio-legend"><span>gekauft ${pct.format(100 - selfPct)} %</span><span>selbst erzeugt ${pct.format(selfPct)} %</span></span>
          <span class="cost-row sum"><span>Ohne PV <small>${kwh.format(cost.consumption_kwh)} kWh Verbrauch komplett gekauft</small></span><span>${money(cost.without_pv)}</span></span>
          <span class="cost-row saving strong"><span>Ersparnis durch PV</span><span>${money(cost.saved)}</span></span>
          <span class="cost-sep"></span>
          <span class="cost-row"><span>Grundpreis anteilig <small>${base} – fällt immer an, mit und ohne PV</small></span><span>${money(cost.base)}</span></span>
          <span class="cost-row sum"><span>Bezahlt insgesamt <small>gekaufter Strom + Grundpreis</small></span><span>${money(cost.total)}</span></span>
        </span>
      </span>`;
  }

  // Panel innerhalb des Fensters halten.
  function place(el) {
    const pop = el.querySelector(".cost-pop");
    if (!pop) return;
    pop.style.left = "0px";
    const r = pop.getBoundingClientRect();
    const overflow = r.right - (window.innerWidth - 12);
    if (overflow > 0) pop.style.left = `${-overflow}px`;
    const r2 = pop.getBoundingClientRect();
    if (r2.left < 12) pop.style.left = `${parseFloat(pop.style.left) + (12 - r2.left)}px`;
  }
  for (const type of ["mouseover", "focusin"]) {
    document.addEventListener(type, (e) => {
      const el = e.target.closest?.(".cost");
      if (el) place(el);
    });
  }

  return { html, money, summary };
})();

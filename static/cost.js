"use strict";

/* Stromkosten-Anzeige mit Mouse-over: tatsächliche Kosten und fiktive Kosten ohne PV. */
const Cost = (() => {
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const ct = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kwh = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const money = (v) => (v == null ? "–" : eur.format(v));

  function period(cost) {
    return cost.days === 1 ? "1 Tag" : `${cost.days} Tage`;
  }

  /** HTML für den Betrag samt Info-Panel; title z. B. "Stromkosten am 28.09.". */
  function html(cost, title = "Stromkosten") {
    if (!cost) return "–";
    const price = `${ct.format(cost.tariff.price_per_kwh * 100)} ct/kWh`;
    const base = `${ct.format(cost.tariff.base_price_month)} €/Monat`;
    return `
      <span class="cost" tabindex="0" aria-describedby="">
        <span class="cost-value">${money(cost.total)}</span>
        <svg class="cost-info" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.9v.1"/></svg>
        <span class="cost-pop" role="tooltip">
          <span class="cost-title">${title} <small>· ${period(cost)}</small></span>
          <span class="cost-row"><span>Grundpreis anteilig <small>${base}</small></span><span>${money(cost.base)}</span></span>
          <span class="cost-row"><span>Netzbezug <small>${kwh.format(cost.grid_kwh)} kWh × ${price}</small></span><span>${money(cost.energy)}</span></span>
          <span class="cost-row sum"><span>Mit PV bezahlt</span><span>${money(cost.total)}</span></span>
          <span class="cost-sep"></span>
          <span class="cost-row"><span>Ohne PV <small>${kwh.format(cost.without_pv.consumption_kwh)} kWh × ${price} + Grundpreis</small></span><span>${money(cost.without_pv.total)}</span></span>
          <span class="cost-row saving"><span>Ersparnis durch PV</span><span>${money(cost.savings)}</span></span>
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

  return { html, money };
})();

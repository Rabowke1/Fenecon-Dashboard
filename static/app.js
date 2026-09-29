"use strict";

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmtPower(w) {
  if (w == null) return "–";
  return Math.abs(w) >= 1000 ? `${nf1.format(w / 1000)} kW` : `${nf0.format(w)} W`;
}
function fmtEnergy(wh) {
  if (wh == null) return "–";
  return Math.abs(wh) >= 1e6 ? `${nf1.format(wh / 1e6)} MWh` : `${nf1.format(wh / 1000)} kWh`;
}
const fmtPct = (p) => (p == null ? "–" : `${nf0.format(p)} %`);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------- Live-Werte ---------- */

let lastLiveTs = null;

async function refreshLive() {
  let data;
  try {
    data = await getJSON("/api/live");
  } catch (e) {
    setStatus("error", "Dashboard-Server nicht erreichbar");
    return;
  }
  const v = data.values || {};
  $("v-production").textContent = fmtPower(v.production);
  $("v-consumption").textContent = fmtPower(v.consumption);
  $("v-ess").textContent = fmtPower(v.ess == null ? null : Math.abs(v.ess));
  $("v-ess-dir").textContent = v.ess == null ? "–" : v.ess > 20 ? "entlädt" : v.ess < -20 ? "lädt" : "Standby";
  $("v-grid").textContent = fmtPower(v.grid == null ? null : Math.abs(v.grid));
  $("v-grid-dir").textContent = v.grid == null ? "–" : v.grid > 20 ? "Bezug" : v.grid < -20 ? "Einspeisung" : "ausgeglichen";
  $("v-soc").textContent = fmtPct(v.soc);
  $("soc-fill").style.width = `${Math.max(0, Math.min(100, v.soc || 0))}%`;
  $("soc-meter").setAttribute("aria-valuenow", v.soc ?? 0);

  const when = data.ts ? new Date(data.ts * 1000).toLocaleTimeString("de-DE") : "–";
  const demo = data.demo ? " · Demo-Modus" : "";
  if (data.ok) setStatus("ok", `Verbunden · ${when}${demo}`);
  else setStatus("error", `${data.error}${data.ts ? ` · letzte Daten ${when}` : ""}`);

  // Enthält der gewählte Zeitraum heute, die Auswertung jede Minute nachziehen.
  if (data.ts && range.to >= isoDay(new Date()) && (!lastLiveTs || data.ts - lastLiveTs >= 60)) {
    lastLiveTs = data.ts;
    loadRange({ quiet: true });
  }
}

function setStatus(kind, text) {
  $("status").className = `status ${kind}`;
  $("status-text").textContent = text;
}

/* ---------- Diagramm-Grundlagen ---------- */

const POWER_SERIES = [
  { key: "production", label: "Erzeugung", slot: 1 },
  { key: "consumption", label: "Verbrauch", slot: 2 },
  { key: "ess", label: "Batterie", slot: 3 },
  { key: "grid", label: "Netz", slot: 4 },
];
const ENERGY_SERIES = [
  { key: "production", label: "Erzeugung", slot: 1 },
  { key: "consumption", label: "Verbrauch", slot: 2 },
  { key: "grid_buy", label: "Netzbezug", slot: 4 },
  { key: "grid_sell", label: "Einspeisung", slot: 5 },
];

function legend(el, series) {
  el.innerHTML = series.map((s) => `<span data-series="${s.slot}"><i class="swatch"></i>${s.label}</span>`).join("");
}

function baseOptions() {
  const muted = css("--muted"), grid = css("--grid");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text-2"),
        borderColor: css("--axis"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 16 } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted } },
    },
  };
}

let powerChart, socChart, energyChart;
let historyData = null, energyData = null;

/* ---------- Zeitraum ---------- */

const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseDay(iso); d.setDate(d.getDate() + n); return isoDay(d); };
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000) + 1;
const fmtDay = (iso, opts = { day: "2-digit", month: "2-digit", year: "numeric" }) => parseDay(iso).toLocaleDateString("de-DE", opts);

let range = presetRange("today");

function presetRange(preset, anchor = isoDay(new Date())) {
  const a = parseDay(anchor);
  switch (preset) {
    case "yesterday": return { preset, from: addDays(anchor, -1), to: addDays(anchor, -1) };
    case "week": return { preset, from: addDays(anchor, -6), to: anchor };
    case "month": return { preset, from: isoDay(new Date(a.getFullYear(), a.getMonth(), 1)), to: isoDay(new Date(a.getFullYear(), a.getMonth() + 1, 0)) };
    case "year": return { preset, from: `${a.getFullYear()}-01-01`, to: `${a.getFullYear()}-12-31` };
    default: return { preset: "today", from: anchor, to: anchor };
  }
}

// Zukunft abschneiden: "Monat" heißt 1. bis heute, solange der Monat läuft.
function effective(r) {
  const today = isoDay(new Date());
  return { ...r, to: r.to > today ? today : r.to };
}

function shiftRange(dir) {
  const r = range;
  let next;
  if (r.preset === "month") {
    const a = parseDay(r.from);
    next = presetRange("month", isoDay(new Date(a.getFullYear(), a.getMonth() + dir, 1)));
  } else if (r.preset === "year") {
    next = presetRange("year", `${parseDay(r.from).getFullYear() + dir}-01-01`);
  } else {
    const span = daysBetween(r.from, r.to);
    next = { preset: r.preset === "week" ? "week" : r.from === r.to ? "day" : "custom",
             from: addDays(r.from, dir * span), to: addDays(r.to, dir * span) };
    if (next.preset === "day") {
      const today = isoDay(new Date());
      if (next.from === today) next.preset = "today";
      else if (next.from === addDays(today, -1)) next.preset = "yesterday";
    }
  }
  if (next.from > isoDay(new Date())) return;
  range = next;
  loadRange();
}

function rangeLabel(r) {
  const e = effective(r);
  if (r.preset === "today") return `Heute, ${fmtDay(e.from)}`;
  if (r.preset === "yesterday") return `Gestern, ${fmtDay(e.from)}`;
  if (e.from === e.to) return fmtDay(e.from, { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  if (r.preset === "month") return parseDay(r.from).toLocaleDateString("de-DE", { month: "long", year: "numeric" }) + (e.to !== r.to ? ` (bis ${fmtDay(e.to)})` : "");
  if (r.preset === "year") return `Jahr ${r.from.slice(0, 4)}` + (e.to !== r.to ? ` (bis ${fmtDay(e.to)})` : "");
  return `${fmtDay(e.from)} – ${fmtDay(e.to)} · ${daysBetween(e.from, e.to)} Tage`;
}

function groupFor(e) {
  const span = daysBetween(e.from, e.to);
  return span <= 62 ? "day" : span <= 3 * 366 ? "month" : "year";
}

function syncControls() {
  document.querySelectorAll(".periods button").forEach((b) =>
    b.classList.toggle("active", b.dataset.preset === range.preset || (b.dataset.preset === "custom" && ["custom", "day"].includes(range.preset))));
  $("custom-range").hidden = !["custom", "day"].includes(range.preset);
  const e = effective(range);
  $("range-from").value = e.from;
  $("range-to").value = e.to;
  $("range-from").max = $("range-to").max = isoDay(new Date());
  $("range-label").textContent = rangeLabel(range);
  $("range-next").disabled = effective(range).to >= isoDay(new Date());
}

/* ---------- Laden ---------- */

async function loadRange({ quiet = false } = {}) {
  syncControls();
  const e = effective(range);
  const span = daysBetween(e.from, e.to);
  const group = groupFor(e);
  try {
    const [energy, history] = await Promise.all([
      getJSON(`/api/energy?group=${group}&from=${e.from}&to=${e.to}`),
      span <= 7 ? getJSON(`/api/history?date=${e.from}&days=${span}`) : Promise.resolve(null),
    ]);
    energyData = energy;
    historyData = history;
  } catch (err) {
    if (!quiet) $("range-notice").textContent = `Daten konnten nicht geladen werden: ${err.message}`;
    $("range-notice").hidden = quiet;
    return;
  }
  renderStats();
  $("power-card").hidden = !historyData;
  $("energy-card").hidden = span < 2;
  renderHistory();
  renderEnergy();
}

function renderStats() {
  const t = energyData.total;
  for (const k of ["production", "consumption", "grid_buy", "grid_sell", "ess_charge", "ess_discharge"]) $(`t-${k}`).textContent = fmtEnergy(t[k]);
  $("t-autarky").textContent = fmtPct(t.autarky);
  $("t-self_consumption").textContent = fmtPct(t.self_consumption);
  $("t-money").innerHTML = Cost.card(t.cost);

  // Hinweis, wenn für einen Teil des Zeitraums noch keine Aufzeichnung existiert.
  const e = effective(range);
  const notice = $("range-notice");
  const first = energyData.first_date;
  if (!first) {
    notice.textContent = "Noch keine gespeicherten Werte. Die Aufzeichnung beginnt, sobald das FEMS erreichbar ist.";
  } else if (first > e.to) {
    notice.textContent = `Für diesen Zeitraum gibt es keine Daten. Die Aufzeichnung läuft seit ${fmtDay(first)}.`;
  } else if (first > e.from) {
    notice.textContent = `Werte erst ab ${fmtDay(first)} – seitdem läuft die Aufzeichnung.`;
  } else if (energyData.days_with_data < daysBetween(e.from, e.to)) {
    notice.textContent = `Für ${daysBetween(e.from, e.to) - energyData.days_with_data} Tag(e) im Zeitraum fehlen Aufzeichnungen.`;
  } else {
    notice.textContent = "";
  }
  notice.hidden = !notice.textContent;
}

/* ---------- Diagramme ---------- */

function renderHistory() {
  if (!historyData) return;
  const pts = historyData.points;
  const start = parseDay(historyData.date).getTime();
  const end = start + historyData.days * 86400000;
  const multi = historyData.days > 1;
  const fmtX = (v) => multi
    ? new Date(v).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })
    : new Date(v).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const fmtTitle = (v) => new Date(v).toLocaleString("de-DE", multi
    ? { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
  const timeAxis = (opts) => {
    Object.assign(opts.scales.x, { type: "linear", min: start, max: end });
    opts.scales.x.ticks.callback = fmtX;
    opts.scales.x.ticks.stepSize = multi ? 86400000 : 3 * 3600000;
  };
  const gap = Math.max(5 * 60000, historyData.bucket_seconds * 2000);

  const powerOpts = baseOptions();
  timeAxis(powerOpts);
  powerOpts.scales.y.ticks.callback = (v) => fmtPower(v);
  powerOpts.plugins.tooltip.callbacks = { title: (i) => fmtTitle(i[0].parsed.x), label: (c) => ` ${c.dataset.label}: ${fmtPower(c.parsed.y)}` };
  const datasets = POWER_SERIES.map((s) => ({
    label: s.label,
    data: pts.map((p) => ({ x: p.ts * 1000, y: p[s.key] })),
    borderColor: css(`--series-${s.slot}`),
    backgroundColor: css(`--series-${s.slot}`),
    borderWidth: multi ? 1.5 : 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: gap,
  }));
  if (powerChart) powerChart.destroy();
  powerChart = new Chart($("power-chart"), { type: "line", data: { datasets }, options: powerOpts });

  const socOpts = baseOptions();
  timeAxis(socOpts);
  Object.assign(socOpts.scales.y, { min: 0, max: 100 });
  socOpts.scales.y.ticks.stepSize = 50;
  socOpts.scales.y.ticks.callback = (v) => `${v} %`;
  socOpts.plugins.tooltip.callbacks = { title: (i) => fmtTitle(i[0].parsed.x), label: (c) => ` Ladezustand: ${fmtPct(c.parsed.y)}` };
  const socColor = css("--series-3");
  if (socChart) socChart.destroy();
  socChart = new Chart($("soc-chart"), {
    type: "line",
    data: { datasets: [{
      label: "Ladezustand", data: pts.map((p) => ({ x: p.ts * 1000, y: p.soc })),
      borderColor: socColor, backgroundColor: socColor + "33", fill: "origin",
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, spanGaps: gap,
    }] },
    options: socOpts,
  });
}

function labelFor(key, group) {
  if (group === "year") return key;
  if (group === "month") return parseDay(`${key}-01`).toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
  return fmtDay(key, { day: "2-digit", month: "2-digit" });
}

function renderEnergy() {
  if (!energyData || $("energy-card").hidden) return;
  const rows = energyData.rows;
  const group = energyData.group;
  $("energy-title").textContent = { day: "Energie je Tag", month: "Energie je Monat", year: "Energie je Jahr" }[group];
  $("energy-hint").textContent = group === "day" ? "Balken anklicken, um den Tag im Leistungsverlauf zu öffnen." : "Balken anklicken, um den Zeitraum zu öffnen.";
  const opts = baseOptions();
  opts.scales.y.ticks.callback = (v) => fmtEnergy(v);
  opts.plugins.tooltip.callbacks = {
    label: (c) => ` ${c.dataset.label}: ${fmtEnergy(c.parsed.y)}`,
    footer: (items) => {
      const r = rows[items[0].dataIndex];
      return `Autarkie ${fmtPct(r.autarky)} · Eigenverbrauch ${fmtPct(r.self_consumption)}\n`
        + Cost.summary(r.cost);
    },
  };
  opts.plugins.tooltip.footerColor = css("--text-2");
  opts.plugins.tooltip.footerFont = { weight: "normal" };
  opts.onClick = (_e, els) => {
    if (!els.length) return;
    const key = rows[els[0].index].date;
    if (group === "day") range = { preset: "day", from: key, to: key };
    else if (group === "month") range = presetRange("month", `${key}-01`);
    else range = presetRange("year", `${key}-01-01`);
    if (range.preset === "day") {
      const today = isoDay(new Date());
      if (key === today) range.preset = "today";
      else if (key === addDays(today, -1)) range.preset = "yesterday";
    }
    loadRange();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  opts.onHover = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
  const datasets = ENERGY_SERIES.map((s) => ({
    label: s.label,
    data: rows.map((r) => r[s.key]),
    backgroundColor: css(`--series-${s.slot}`),
    borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom",
    categoryPercentage: 0.8, barPercentage: 0.9,
  }));
  if (energyChart) energyChart.destroy();
  energyChart = new Chart($("energy-chart"), {
    type: "bar", data: { labels: rows.map((r) => labelFor(r.date, group)), datasets }, options: opts,
  });

  const head = ["Zeitraum", ...ENERGY_SERIES.map((s) => s.label), "Batterie geladen", "Batterie entladen", "Autarkie", "Eigenverbrauch", "Gekaufter Strom", "Einspeisevergütung", "Durch PV gespart", "Saldo"];
  const body = rows.slice().reverse().map((r) => [
    labelFor(r.date, group), ...ENERGY_SERIES.map((s) => fmtEnergy(r[s.key])),
    fmtEnergy(r.ess_charge), fmtEnergy(r.ess_discharge), fmtPct(r.autarky), fmtPct(r.self_consumption),
    Cost.money(r.cost?.bought), Cost.money(r.cost?.feed_in), Cost.money(r.cost?.saved), Cost.money(r.cost?.balance),
  ]);
  $("energy-table").innerHTML =
    `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

/* ---------- Bedienung ---------- */

document.querySelectorAll(".periods button").forEach((btn) => btn.addEventListener("click", () => {
  if (btn.dataset.preset === "custom") {
    const e = effective(range);
    range = { preset: "custom", from: e.from, to: e.to };
    syncControls();
    $("range-from").focus();
    return;
  }
  range = presetRange(btn.dataset.preset);
  loadRange();
}));
$("custom-range").addEventListener("submit", (ev) => {
  ev.preventDefault();
  let from = $("range-from").value, to = $("range-to").value;
  if (!from || !to) return;
  if (from > to) [from, to] = [to, from];
  range = { preset: from === to ? "day" : "custom", from, to };
  loadRange();
});
$("range-prev").addEventListener("click", () => shiftRange(-1));
$("range-next").addEventListener("click", () => shiftRange(1));

// Farben bei Wechsel hell/dunkel neu einlesen.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderHistory(); renderEnergy(); });

legend($("power-legend"), POWER_SERIES);
legend($("energy-legend"), ENERGY_SERIES);
if (window.Chart) {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 12;
}
loadRange();
refreshLive();
setInterval(refreshLive, 5000);

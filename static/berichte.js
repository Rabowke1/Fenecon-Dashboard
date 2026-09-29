"use strict";

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const fmtPower = (w) => (w == null ? "–" : Math.abs(w) >= 1000 ? `${nf1.format(w / 1000)} kW` : `${nf0.format(w)} W`);
const fmtEnergy = (wh) => (wh == null ? "–" : Math.abs(wh) >= 1e6 ? `${nf1.format(wh / 1e6)} MWh` : `${nf1.format(wh / 1000)} kWh`);
const fmtPct = (p) => (p == null ? "–" : `${nf0.format(p)} %`);
const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function parseDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const longDate = (iso) => parseDay(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = (iso) => parseDay(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const tinyDate = (iso) => parseDay(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let overview = null;
let current = null;
let charts = {};

function toast(text, isError = false) {
  const el = $("toast");
  el.textContent = text;
  el.className = `toast${isError ? " error" : ""}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 5000);
}

/* ---------- Laden ---------- */

async function loadOverview(selectDate) {
  overview = await getJSON("/api/exports");
  $("folder").textContent = overview.folder;
  const days = overview.days.map((d) => d.date).sort().reverse();
  $("empty").hidden = days.length > 0;
  $("report").hidden = days.length === 0;
  $("day-select").innerHTML = days.map((d) => `<option value="${d}">${shortDate(d)}</option>`).join("");
  renderFiles();
  renderOverview();
  if (!days.length) return;
  const wanted = selectDate || location.hash.slice(1);
  await showDay(days.includes(wanted) ? wanted : days[0]);
}

async function showDay(date) {
  current = await getJSON(`/api/exports/day?date=${encodeURIComponent(date)}`);
  $("day-select").value = date;
  history.replaceState(null, "", `#${date}`);
  const opts = [...$("day-select").options].map((o) => o.value);
  const i = opts.indexOf(date);
  $("day-prev").disabled = i >= opts.length - 1;
  $("day-next").disabled = i <= 0;
  renderDay();
}

/* ---------- Tagesbericht ---------- */

function setRing(id, pct) {
  const fig = $(id);
  const bar = fig.querySelector(".bar");
  const len = 2 * Math.PI * 50;
  bar.style.strokeDasharray = `${len}`;
  bar.style.strokeDashoffset = `${len * (1 - Math.max(0, Math.min(100, pct || 0)) / 100)}`;
  fig.querySelector("strong").textContent = fmtPct(pct);
}

function sentence(d) {
  const parts = [];
  if (d.autarky != null) {
    parts.push(d.autarky >= 95 ? `Ihr Haus hat sich zu ${fmtPct(d.autarky)} selbst versorgt`
      : `${fmtPct(d.autarky)} Ihres Verbrauchs kamen aus der eigenen Anlage`);
  }
  if (d.grid_buy > 0) parts.push(`aus dem Netz kamen ${d.grid_buy < 0.1 * d.consumption ? "nur " : ""}${fmtEnergy(d.grid_buy)}`);
  let text = parts.join(", ");
  if (d.grid_sell >= 100) text += `. ${fmtEnergy(d.grid_sell)} wurden eingespeist`;
  if (d.soc_max != null) text += `. Die Batterie war zwischen ${fmtPct(d.soc_min)} und ${fmtPct(d.soc_max)} geladen`;
  if (d.cost) text += `. Die PV hat ${Cost.money(d.cost.benefit)} eingebracht (${Cost.money(d.cost.saved)} gespart, ${Cost.money(d.cost.feed_in)} Einspeisevergütung)`;
  return text ? `${text}.` : "";
}

function renderSplit(el, legendEl, parts, total) {
  const visible = parts.filter((p) => share(p.value, total) >= 0.5);
  el.innerHTML = visible.map((p) =>
    `<div class="seg" data-series="${p.slot}" style="flex-grow:${p.value}" title="${p.label}: ${fmtEnergy(p.value)} (${fmtPct(share(p.value, total))})"></div>`).join("");
  legendEl.innerHTML = parts.map((p) => `
    <li data-series="${p.slot}"><i class="swatch"></i><span>${p.label}</span>
      <strong>${fmtPct(share(p.value, total))}</strong><small>${fmtEnergy(p.value)}</small></li>`).join("");
}

function renderDetails(d) {
  const groups = {};
  for (const item of d.details) (groups[item.group] ||= []).push(item);
  const titles = { Erzeugung: "Erzeugung nach PV-String", Verbrauch: "Einzelne Verbraucher" };
  $("details-grid").innerHTML = Object.entries(groups).map(([group, items]) => {
    const slot = group === "Verbrauch" ? 2 : group === "Erzeugung" ? 1 : 3;
    const withEnergy = items.filter((x) => x.energy != null);
    const total = withEnergy.reduce((s, x) => s + x.energy, 0);
    const max = Math.max(...withEnergy.map((x) => x.energy), 1);
    const rows = items.map((x) => `
      <li>
        <div class="bar-head"><span>${esc(x.name)}</span><strong>${x.energy != null ? fmtEnergy(x.energy) : "–"}</strong></div>
        <div class="hbar" data-series="${slot}"><div style="width:${x.energy != null ? (x.energy / max) * 100 : 0}%"></div></div>
        <small>${group === "Erzeugung" && total > 0 ? `${fmtPct(share(x.energy, total))} der Erzeugung · ` : ""}Spitze ${fmtPower(x.peak)} um ${x.peak_time} Uhr</small>
      </li>`).join("");
    return `<article class="card"><h2>${esc(titles[group] || group)}</h2><ul class="hbars">${rows}</ul></article>`;
  }).join("");
}

function baseOptions() {
  const muted = css("--muted");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text-2"),
        footerColor: css("--text-2"), borderColor: css("--axis"), borderWidth: 1, padding: 10,
        boxPadding: 4, usePointStyle: true,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: muted, maxRotation: 0, autoSkip: false } },
      y: { grid: { color: css("--grid") }, border: { display: false }, ticks: { color: muted } },
    },
  };
}

function everyThreeHours(labels) {
  return (value) => {
    const t = labels[value];
    const every = window.innerWidth < 600 ? 6 : 3;
    return t && t.endsWith(":00") && Number(t.slice(0, 2)) % every === 0 ? t : null;
  };
}

function gradient(ctx, color) {
  const { chart } = ctx;
  if (!chart.chartArea) return color + "33";
  const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
  g.addColorStop(0, color + "55");
  g.addColorStop(1, color + "05");
  return g;
}

function renderDayCharts(d) {
  const labels = d.points.map((p) => p.t);
  const series = [
    { label: "Erzeugung", slot: 1, fill: true, value: (p) => p.production },
    { label: "Verbrauch", slot: 2, value: (p) => p.consumption },
    { label: "Batterie", slot: 3, value: (p) => (p.ess_discharge ?? 0) - (p.ess_charge ?? 0) },
    { label: "Netz", slot: 4, value: (p) => (p.grid_buy ?? 0) - (p.grid_sell ?? 0) },
  ];
  $("day-legend").innerHTML = series.map((s) => `<span data-series="${s.slot}"><i class="swatch"></i>${s.label}</span>`).join("");

  const opts = baseOptions();
  opts.scales.x.ticks.callback = everyThreeHours(labels);
  opts.scales.y.ticks.callback = (v) => fmtPower(v);
  opts.plugins.tooltip.callbacks = {
    title: (items) => `${items[0].label} Uhr`,
    label: (c) => ` ${c.dataset.label}: ${fmtPower(c.parsed.y)}`,
  };
  charts.day?.destroy();
  charts.day = new Chart($("day-chart"), {
    type: "line",
    data: {
      labels,
      datasets: series.map((s) => {
        const color = css(`--series-${s.slot}`);
        return {
          label: s.label, data: d.points.map(s.value), borderColor: color, backgroundColor: s.fill ? (ctx) => gradient(ctx, color) : color,
          fill: s.fill ? "origin" : false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.35,
        };
      }),
    },
    options: opts,
  });

  const socOpts = baseOptions();
  socOpts.scales.x.ticks.callback = everyThreeHours(labels);
  Object.assign(socOpts.scales.y, { min: 0, max: 100 });
  socOpts.scales.y.ticks.stepSize = 50;
  socOpts.scales.y.ticks.callback = (v) => `${v} %`;
  socOpts.plugins.tooltip.callbacks = { title: (i) => `${i[0].label} Uhr`, label: (c) => ` Ladezustand: ${fmtPct(c.parsed.y)}` };
  const socColor = css("--series-3");
  charts.soc?.destroy();
  charts.soc = new Chart($("soc-chart"), {
    type: "line",
    data: { labels, datasets: [{ label: "Ladezustand", data: d.points.map((p) => p.soc), borderColor: socColor,
      backgroundColor: (ctx) => gradient(ctx, socColor), fill: "origin", borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.35 }] },
    options: socOpts,
  });
}

function renderDay() {
  const d = current;
  if (!d) return;
  $("hero-date").textContent = longDate(d.date) + (d.complete ? "" : " · unvollständig");
  $("hero-production").textContent = fmtEnergy(d.production);
  $("hero-sentence").textContent = sentence(d);
  setRing("ring-autarky", d.autarky);
  setRing("ring-self", d.self_consumption);

  $("k-production").textContent = fmtEnergy(d.production);
  $("k-production-sub").textContent = `Spitze ${fmtPower(d.peak_production.value)} um ${d.peak_production.time} Uhr`;
  $("k-consumption").textContent = fmtEnergy(d.consumption);
  $("k-consumption-sub").textContent = `Spitze ${fmtPower(d.peak_consumption.value)} um ${d.peak_consumption.time} Uhr`;
  $("k-battery").textContent = `${fmtEnergy(d.ess_charge)}`;
  $("k-battery-sub").textContent = `geladen · ${fmtEnergy(d.ess_discharge)} entladen`;
  $("k-grid").textContent = fmtEnergy(d.grid_buy);
  $("k-grid-sub").textContent = `Bezug · ${fmtEnergy(d.grid_sell)} eingespeist`;
  $("k-grid-cost").textContent = d.cost ? `${Cost.money(d.cost.bought)} gekauft · ${Cost.money(d.cost.feed_in)} Vergütung` : "";
  $("day-money").innerHTML = Cost.card(d.cost);

  const fromBattery = Math.max(0, d.consumption - d.pv_direct - d.grid_buy);
  renderSplit($("split-source"), $("split-source-legend"), [
    { label: "Solar direkt", slot: 1, value: d.pv_direct },
    { label: "Batterie", slot: 3, value: fromBattery },
    { label: "Netz", slot: 4, value: d.grid_buy },
  ], d.consumption);
  $("src-total").textContent = `Verbrauch ${fmtEnergy(d.consumption)}`;

  const toBattery = Math.max(0, d.production - d.pv_direct - d.grid_sell);
  renderSplit($("split-use"), $("split-use-legend"), [
    { label: "Direkt verbraucht", slot: 2, value: d.pv_direct },
    { label: "In die Batterie", slot: 3, value: toBattery },
    { label: "Eingespeist", slot: 5, value: d.grid_sell },
  ], d.production);
  $("use-total").textContent = `Erzeugung ${fmtEnergy(d.production)}`;

  $("sun-window").textContent = d.sun_from ? `Solarertrag von ${d.sun_from} bis ${d.sun_to} Uhr` : "";
  $("soc-range").textContent = d.soc_min != null ? `· ${fmtPct(d.soc_min)} bis ${fmtPct(d.soc_max)}, am Tagesende ${fmtPct(d.soc_end)}` : "";
  renderDetails(d);
  renderDayCharts(d);
}

/* ---------- Übersicht über alle Exporte ---------- */

function renderOverview() {
  const rows = overview.days;
  $("overview").hidden = rows.length < 2;
  if (rows.length < 2) return;
  const t = overview.total;
  $("overview-sub").textContent = `${rows.length} Tage · ${tinyDate(rows[0].date)} bis ${tinyDate(rows[rows.length - 1].date)}`;
  const best = rows.find((r) => r.date === overview.best_day);
  $("overview-stats").innerHTML = [
    ["Erzeugung", fmtEnergy(t.production)],
    ["Verbrauch", fmtEnergy(t.consumption)],
    ["Netzbezug", fmtEnergy(t.grid_buy)],
    ["Einspeisung", fmtEnergy(t.grid_sell)],
    ["Autarkie", fmtPct(t.autarky)],
    ["Bester Tag", best ? `${fmtEnergy(best.production)} <small>${tinyDate(best.date)}</small>` : "–"],
  ].map(([l, v]) => `<div><span class="label">${l}</span><span class="num">${v}</span></div>`).join("");
  $("overview-money").innerHTML = Cost.card(t.cost);

  const series = [
    { key: "production", label: "Erzeugung", slot: 1 },
    { key: "consumption", label: "Verbrauch", slot: 2 },
    { key: "grid_buy", label: "Netzbezug", slot: 4 },
    { key: "grid_sell", label: "Einspeisung", slot: 5 },
  ];
  $("overview-legend").innerHTML = series.map((s) => `<span data-series="${s.slot}"><i class="swatch"></i>${s.label}</span>`).join("");
  const opts = baseOptions();
  opts.scales.x.ticks.autoSkip = true;
  opts.scales.y.ticks.callback = (v) => fmtEnergy(v);
  opts.plugins.tooltip.callbacks = {
    title: (items) => shortDate(rows[items[0].dataIndex].date),
    label: (c) => ` ${c.dataset.label}: ${fmtEnergy(c.parsed.y)}`,
    footer: (items) => {
      const r = rows[items[0].dataIndex];
      return `Autarkie ${fmtPct(r.autarky)}\n${Cost.summary(r.cost)}`;
    },
  };
  opts.onClick = (_e, els) => { if (els.length) showDay(rows[els[0].index].date); };
  opts.onHover = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
  charts.overview?.destroy();
  charts.overview = new Chart($("overview-chart"), {
    type: "bar",
    data: {
      labels: rows.map((r) => tinyDate(r.date)),
      datasets: series.map((s) => ({
        label: s.label, data: rows.map((r) => r[s.key]), backgroundColor: css(`--series-${s.slot}`),
        borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", categoryPercentage: 0.8, barPercentage: 0.9,
      })),
    },
    options: opts,
  });

  const head = ["Tag", "Erzeugung", "Verbrauch", "Netzbezug", "Einspeisung", "Batterie geladen", "Batterie entladen", "Autarkie", "Eigenverbrauch", "Gekaufter Strom", "Einspeisevergütung", "Durch PV gespart", "Saldo"];
  $("overview-table").innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>` +
    rows.slice().reverse().map((r) => `<tr><td><a href="#${r.date}" data-day="${r.date}">${shortDate(r.date)}</a></td>` +
      [r.production, r.consumption, r.grid_buy, r.grid_sell, r.ess_charge, r.ess_discharge].map((v) => `<td>${fmtEnergy(v)}</td>`).join("") +
      `<td>${fmtPct(r.autarky)}</td><td>${fmtPct(r.self_consumption)}</td>` +
      [r.cost?.bought, r.cost?.feed_in, r.cost?.saved, r.cost?.balance].map((v) => `<td>${Cost.money(v)}</td>`).join("") + "</tr>").join("") + "</tbody>";
}

function renderFiles() {
  $("file-list").innerHTML = overview.files.map((f) => f.error
    ? `<li class="error"><strong>${esc(f.file)}</strong> – nicht lesbar: ${esc(f.error)}</li>`
    : `<li><strong>${esc(f.file)}</strong> – Anlage ${esc(f.system)}, Zeitraum ${esc(f.period || "–")}${f.created ? `, erstellt ${new Date(f.created).toLocaleString("de-DE")}` : ""}</li>`,
  ).join("");
}

/* ---------- Hochladen ---------- */

async function upload(files) {
  let lastDay = null;
  for (const file of files) {
    try {
      const res = await fetch("/api/exports", { method: "POST", body: file, headers: { "X-Filename": encodeURIComponent(file.name) } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      lastDay = data.days[data.days.length - 1] || lastDay;
      toast(`${file.name} eingelesen (${data.days.length} ${data.days.length === 1 ? "Tag" : "Tage"})`);
    } catch (e) {
      toast(`${file.name}: ${e.message}`, true);
    }
  }
  await loadOverview(lastDay);
}

$("file-input").addEventListener("change", (e) => { upload([...e.target.files]); e.target.value = ""; });
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { if (e.dataTransfer.types.includes("Files")) { dragDepth++; $("dropzone").hidden = false; } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropzone").hidden = true; } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("dropzone").hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith(".xlsx"));
  if (files.length) upload(files); else toast("Bitte eine .xlsx-Datei aus dem FEMS-Export ablegen.", true);
});

/* ---------- Bedienung ---------- */

function step(delta) {
  const sel = $("day-select");
  const i = sel.selectedIndex - delta; // Liste ist absteigend sortiert
  if (i >= 0 && i < sel.options.length) showDay(sel.options[i].value);
}
$("day-prev").addEventListener("click", () => step(-1));
$("day-next").addEventListener("click", () => step(1));
$("day-select").addEventListener("change", (e) => showDay(e.target.value));
$("overview-table").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-day]");
  if (a) { e.preventDefault(); showDay(a.dataset.day); window.scrollTo({ top: 0, behavior: "smooth" }); }
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderDay(); renderOverview(); });

Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
Chart.defaults.font.size = 12;
loadOverview().catch((e) => toast(`Exporte konnten nicht geladen werden: ${e.message}`, true));

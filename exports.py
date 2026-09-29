"""Liest die Excel-Exporte des FEMS (Datenexport im FEMS-Portal) ein.

Aufbau einer Exportdatei (Blatt "Export"):
    Kopf:              Nr., Export erstellt am, Export Zeitraum
    Gesamtübersicht:   Netzbezug [kWh], Netzeinspeisung [kWh], Erzeugung [kWh], ...
    Allgemeine Daten:  Datum / Uhrzeit | Netzbezug [W] | ... | Ladezustand [%]
    Detailspalten:     z. B. PV-Strings (Gruppe "Erzeugung") und Verbraucher (Gruppe "Verbrauch")

Es wird nur die Python-Standardbibliothek verwendet (xlsx = ZIP mit XML-Dateien).
"""

import os
import re
import statistics
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Spaltenüberschrift -> interner Name (Leistungen in W, Ladezustand in %)
MAIN_COLUMNS = {
    "netzbezug": "grid_buy",
    "netzeinspeisung": "grid_sell",
    "erzeugung": "production",
    "speicher beladung": "ess_charge",
    "speicher entladung": "ess_discharge",
    "verbrauch": "consumption",
    "ladezustand": "soc",
}
FLOWS = ["production", "consumption", "grid_buy", "grid_sell", "ess_charge", "ess_discharge"]


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def _base_label(text):
    """'Netzbezug [W]' -> ('netzbezug', 'W')"""
    m = re.match(r"\s*(.*?)\s*\[(.*?)\]\s*$", text or "")
    if not m:
        return (text or "").strip().lower(), None
    return m.group(1).lower(), m.group(2)


def read_rows(path):
    """Liefert das erste Tabellenblatt als Liste von Zeilen (Liste von Zellwerten)."""
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        shared = []
        if "xl/sharedStrings.xml" in names:
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(NS + "si"):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
        sheet = "xl/worksheets/sheet1.xml"
        if sheet not in names:
            sheet = sorted(n for n in names if n.startswith("xl/worksheets/sheet"))[0]
        root = ET.fromstring(z.read(sheet))
    rows = []
    for row in root.iter(NS + "row"):
        cells = {}
        for c in row.iter(NS + "c"):
            v = c.find(NS + "v")
            kind = c.get("t")
            if kind == "s" and v is not None:
                val = shared[int(v.text)]
            elif kind == "inlineStr":
                val = "".join(t.text or "" for t in c.iter(NS + "t"))
            elif v is not None and v.text is not None:
                try:
                    val = float(v.text)
                except ValueError:
                    val = v.text
            else:
                continue
            cells[_col_index(c.get("r"))] = val
        width = max(cells) + 1 if cells else 0
        rows.append([cells.get(i) for i in range(width)])
    return rows


def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", "."))
        except ValueError:
            return None
    return None


def _parse_time(v):
    if not isinstance(v, str):
        return None
    for fmt in ("%d.%m.%Y %H:%M:%S %z", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(v.strip(), fmt)
        except ValueError:
            pass
    return None


def parse_export(path):
    rows = read_rows(path)
    meta = {}
    header_idx = None
    for i, row in enumerate(rows):
        first = (row[0] if row else None) or ""
        if isinstance(first, str):
            key = first.strip().lower()
            if key in ("nr.", "export erstellt am", "export zeitraum") and len(row) > 1:
                meta[key] = row[1]
            if key.startswith("datum"):
                header_idx = i
                break
    if header_idx is None:
        raise ValueError("Keine Spalte 'Datum / Uhrzeit' gefunden – ist das ein FEMS-Export?")

    header = rows[header_idx]
    groups = rows[header_idx - 1] if header_idx > 0 else []
    columns = {}  # index -> (kind, name, unit, group)
    group = None
    for idx, text in enumerate(header):
        if idx < len(groups) and isinstance(groups[idx], str) and groups[idx].strip():
            group = groups[idx].strip()
        if idx == 0 or not isinstance(text, str) or not text.strip():
            continue
        label, unit = _base_label(text)
        if label in MAIN_COLUMNS and group in (None, "Allgemeine Daten"):
            columns[idx] = ("main", MAIN_COLUMNS[label], unit, group)
        else:
            columns[idx] = ("detail", text.split("[")[0].strip(), unit, group or "Weitere")

    points = []
    for row in rows[header_idx + 1:]:
        ts = _parse_time(row[0] if row else None)
        if ts is None:
            continue
        p = {"time": ts, "details": {}}
        for idx, (kind, name, _unit, _grp) in columns.items():
            val = _num(row[idx]) if idx < len(row) else None
            if kind == "main":
                p[name] = val
            else:
                p["details"][name] = val
        points.append(p)
    if not points:
        raise ValueError("Die Datei enthält keine Messwerte.")

    # Rasterweite (meist 15 Minuten), damit aus Leistung Energie wird.
    steps = [(b["time"] - a["time"]).total_seconds() for a, b in zip(points, points[1:])]
    step = statistics.median(steps) if steps else 900.0

    detail_meta = [{"name": name, "unit": unit, "group": grp}
                   for kind, name, unit, grp in columns.values() if kind == "detail"]

    days = {}
    for p in points:
        days.setdefault(p["time"].date().isoformat(), []).append(p)

    created = _parse_time(meta.get("export erstellt am"))
    return {
        "file": os.path.basename(path),
        "system": str(meta.get("nr.") or ""),
        "created": created.isoformat() if created else None,
        "period": meta.get("export zeitraum"),
        "step_seconds": step,
        "details": detail_meta,
        "days": {d: summarize_day(d, pts, step, detail_meta) for d, pts in days.items()},
    }


def _wh(values, step):
    return sum(v for v in values if v is not None) * step / 3600


def summarize_day(day, pts, step, detail_meta):
    totals = {f: round(_wh([p.get(f) for p in pts], step), 1) for f in FLOWS}

    # Herkunft des Verbrauchs und Verwendung des PV-Stroms je Intervall.
    direct = 0.0
    for p in pts:
        cons = p.get("consumption") or 0
        own = cons - (p.get("ess_discharge") or 0) - (p.get("grid_buy") or 0)
        direct += max(0.0, min(own, p.get("production") or 0))
    direct = round(direct * step / 3600, 1)

    cons, prod = totals["consumption"], totals["production"]
    autarky = round(max(0.0, 1 - totals["grid_buy"] / cons) * 100, 1) if cons > 0 else None
    self_use = round(max(0.0, 1 - totals["grid_sell"] / prod) * 100, 1) if prod > 0 else None

    def peak(key):
        best = max(pts, key=lambda p: p.get(key) or 0)
        return {"value": best.get(key) or 0, "time": best["time"].strftime("%H:%M")}

    socs = [p["soc"] for p in pts if p.get("soc") is not None]
    sun = [p["time"] for p in pts if (p.get("production") or 0) > 20]

    details = []
    for d in detail_meta:
        vals = [p["details"].get(d["name"]) for p in pts]
        energy = _wh(vals, step) if d["unit"] == "W" else None
        best = max(range(len(pts)), key=lambda i: vals[i] or 0)
        details.append({**d, "energy": round(energy, 1) if energy is not None else None,
                        "peak": vals[best] or 0, "peak_time": pts[best]["time"].strftime("%H:%M")})

    return {
        "date": day,
        "intervals": len(pts),
        "complete": len(pts) * step >= 86400 - step,
        **totals,
        "pv_direct": direct,
        "autarky": autarky,
        "self_consumption": self_use,
        "peak_production": peak("production"),
        "peak_consumption": peak("consumption"),
        "soc_min": min(socs) if socs else None,
        "soc_max": max(socs) if socs else None,
        "soc_end": socs[-1] if socs else None,
        "sun_from": sun[0].strftime("%H:%M") if sun else None,
        "sun_to": (sun[-1] + timedelta(seconds=step)).strftime("%H:%M") if sun else None,
        "details": details,
        "points": [{
            "t": p["time"].strftime("%H:%M"),
            **{k: p.get(k) for k in FLOWS + ["soc"]},
            "details": p["details"],
        } for p in pts],
    }


class ExportLibrary:
    """Alle Exporte eines Ordners; neu eingelesen wird nur, was sich geändert hat."""

    def __init__(self, folder):
        self.folder = folder
        os.makedirs(folder, exist_ok=True)
        self.cache = {}  # Pfad -> (mtime, Ergebnis oder Fehler)

    def scan(self):
        found = {}
        for name in sorted(os.listdir(self.folder)):
            if not name.lower().endswith(".xlsx") or name.startswith("~$"):
                continue
            path = os.path.join(self.folder, name)
            mtime = os.path.getmtime(path)
            cached = self.cache.get(path)
            if not cached or cached[0] != mtime:
                try:
                    cached = (mtime, parse_export(path))
                except zipfile.BadZipFile:
                    cached = (mtime, {"file": name, "error": "keine gültige Excel-Datei (.xlsx)"})
                except Exception as exc:  # defekte oder fremde Datei
                    cached = (mtime, {"file": name, "error": str(exc)})
                self.cache[path] = cached
            found[path] = cached[1]
        self.cache = {p: self.cache[p] for p in found}
        return list(found.values())

    def days(self):
        """{Datum: Tageszusammenfassung}; bei Überschneidungen gewinnt der neueste Export."""
        out = {}
        for exp in sorted(self.scan(), key=lambda e: e.get("created") or ""):
            for day, data in exp.get("days", {}).items():
                prev = out.get(day)
                if prev and prev["complete"] and not data["complete"]:
                    continue
                out[day] = {**data, "file": exp["file"], "system": exp["system"]}
        return out

    def overview(self):
        files = self.scan()
        days = self.days()
        rows = [{k: v for k, v in d.items() if k not in ("points", "details")}
                for _, d in sorted(days.items())]
        total = {f: round(sum(r[f] for r in rows), 1) for f in FLOWS + ["pv_direct"]}
        if total["consumption"] > 0:
            total["autarky"] = round(max(0.0, 1 - total["grid_buy"] / total["consumption"]) * 100, 1)
        if total["production"] > 0:
            total["self_consumption"] = round(max(0.0, 1 - total["grid_sell"] / total["production"]) * 100, 1)
        return {
            "folder": self.folder,
            "files": [{k: f.get(k) for k in ("file", "system", "created", "period", "error")} for f in files],
            "days": rows,
            "total": total,
            "best_day": max(rows, key=lambda r: r["production"])["date"] if rows else None,
        }

    def day(self, date):
        return self.days().get(date)

    def save_upload(self, filename, data):
        name = os.path.basename(filename or "")
        name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip() or "export.xlsx"
        if not name.lower().endswith(".xlsx"):
            raise ValueError("Bitte eine .xlsx-Datei aus dem FEMS-Export hochladen.")
        tmp = os.path.join(self.folder, ".upload-" + name)
        with open(tmp, "wb") as fh:
            fh.write(data)
        try:
            parsed = parse_export(tmp)
        except zipfile.BadZipFile:
            os.remove(tmp)
            raise ValueError("keine gültige Excel-Datei (.xlsx)")
        except Exception:
            os.remove(tmp)
            raise
        os.replace(tmp, os.path.join(self.folder, name))
        return {"file": name, "days": sorted(parsed["days"])}

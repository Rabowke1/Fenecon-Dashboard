"""Tests für den Excel-Import: python3 -m unittest test_exports"""

import os
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape

import exports

HEADER = ["Datum / Uhrzeit", "Netzbezug [W]", "Netzeinspeisung [W]", "Erzeugung [W]",
          "Speicher Beladung [W]", "Speicher Entladung [W]", "Verbrauch [W]", "Ladezustand [%]",
          None, None, "PV Süd [W]", "PV Nord [W]", "Wallbox [W]"]


def col(i):
    return chr(65 + i)


def write_xlsx(path, rows):
    """Minimale xlsx-Datei mit Inline-Strings, aufgebaut wie ein FEMS-Export."""
    xml_rows = []
    for r, row in enumerate(rows, start=1):
        cells = []
        for c, val in enumerate(row):
            ref = f"{col(c)}{r}"
            if val is None:
                continue
            if isinstance(val, str):
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(val)}</t></is></c>')
            else:
                cells.append(f'<c r="{ref}"><v>{val}</v></c>')
        xml_rows.append(f'<row r="{r}">{"".join(cells)}</row>')
    sheet = ('<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/'
             f'spreadsheetml/2006/main"><sheetData>{"".join(xml_rows)}</sheetData></worksheet>')
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", sheet)


def export_rows(day="28.09.2026", hours=24):
    rows = [["Nr.", "fems1"], ["Export erstellt am", "29.09.2026 12:23:09 +0200"], ["Export Zeitraum", day], [],
            [None, "Gesamtübersicht"], [], [],
            [None, "Allgemeine Daten", None, None, None, None, None, None, None, None, "Erzeugung", None, "Verbrauch"],
            HEADER]
    for h in range(hours):
        for q in range(4):
            sunny = 8 <= h < 16
            rows.append([f"{day} {h:02d}:{q * 15:02d}:00 +0200",
                         0 if sunny else 400,      # Netzbezug
                         1000 if sunny else 0,      # Einspeisung
                         4000 if sunny else 0,      # Erzeugung
                         1000 if sunny else 0,      # Beladung
                         0 if sunny else 100,       # Entladung
                         2000 if sunny else 500,    # Verbrauch
                         50, None, None,
                         3000 if sunny else 0, 1000 if sunny else 0, 800 if sunny else 0])
    return rows


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def path(self, name):
        return os.path.join(self.tmp.name, name)

    def test_day_totals(self):
        write_xlsx(self.path("a.xlsx"), export_rows())
        exp = exports.parse_export(self.path("a.xlsx"))
        self.assertEqual(exp["system"], "fems1")
        self.assertEqual(exp["step_seconds"], 900)
        d = exp["days"]["2026-09-28"]
        self.assertTrue(d["complete"])
        self.assertEqual(d["production"], 32000)      # 8 h * 4 kW
        self.assertEqual(d["consumption"], 16000 + 8000)
        self.assertEqual(d["grid_buy"], 6400)
        self.assertEqual(d["pv_direct"], 16000)        # tagsüber 2 kW direkt
        self.assertEqual(d["autarky"], round((1 - 6400 / 24000) * 100, 1))
        self.assertEqual(d["peak_production"]["time"], "08:00")
        self.assertEqual((d["sun_from"], d["sun_to"]), ("08:00", "16:00"))

    def test_detail_columns_keep_their_group(self):
        write_xlsx(self.path("a.xlsx"), export_rows())
        d = exports.parse_export(self.path("a.xlsx"))["days"]["2026-09-28"]
        groups = {x["name"]: (x["group"], x["energy"]) for x in d["details"]}
        self.assertEqual(groups["PV Süd"], ("Erzeugung", 24000))
        self.assertEqual(groups["Wallbox"], ("Verbrauch", 6400))

    def test_library_overview_and_bad_files(self):
        write_xlsx(self.path("a.xlsx"), export_rows("27.09.2026"))
        write_xlsx(self.path("b.xlsx"), export_rows("28.09.2026"))
        with open(self.path("kaputt.xlsx"), "w") as fh:
            fh.write("kein zip")
        lib = exports.ExportLibrary(self.tmp.name)
        ov = lib.overview()
        self.assertEqual([d["date"] for d in ov["days"]], ["2026-09-27", "2026-09-28"])
        self.assertEqual(ov["total"]["production"], 64000)
        self.assertTrue(any(f.get("error") for f in ov["files"]))
        self.assertIsNotNone(lib.day("2026-09-28"))

    def test_upload_rejects_non_exports(self):
        lib = exports.ExportLibrary(self.tmp.name)
        with self.assertRaises(ValueError):
            lib.save_upload("bild.png", b"x")
        with self.assertRaises(ValueError):
            lib.save_upload("x.xlsx", b"kein zip")
        self.assertEqual([n for n in os.listdir(self.tmp.name)], [])


if __name__ == "__main__":
    unittest.main()

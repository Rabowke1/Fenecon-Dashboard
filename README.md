# Fenecon-Dashboard

Eine lokale Webseite für FENECON-PV-Anlagen: Ein kleiner Python-Server liest die Werte
über die REST/JSON-API direkt aus dem FEMS, speichert sie in einer SQLite-Datenbank und
zeigt sie im Browser an.

- **Live-Werte** (alle 5 s): Erzeugung, Verbrauch, Batterie mit Ladezustand, Netzbezug/Einspeisung
- **Heute**: PV-Ertrag, Verbrauch, Netzbezug, Einspeisung, Autarkie, Eigenverbrauch
- **Leistungsverlauf** eines beliebigen Tages und Ladezustand der Batterie
- **Energiebilanz** nach Tagen, Monaten oder Jahren, auch als Tabelle
- **Berichte aus den Excel-Exporten** des FEMS: Tageszusammenfassung auf einen Blick (siehe unten)

Benötigt wird nur Python 3.8+ (keine Zusatzpakete). Chart.js liegt in `static/vendor/`,
die Seite braucht also keine Internetverbindung.

## 1. REST-API im FEMS freischalten

Die API ist bei FENECON eine eigene App: **„FEMS App REST/JSON Lesezugriff“**. Ist sie im
App-Center des FEMS installiert, liefert das FEMS die Kanäle unter

```
http://<IP-des-FEMS>/rest/channel/_sum/.*        (neuere Versionen, Port 80)
http://<IP-des-FEMS>:8084/rest/channel/_sum/.*   (ältere Versionen)
```

Anmeldung per HTTP Basic Auth mit Benutzer `x` und Passwort `user` (Nur-Lese-Zugang).
Zum Ausprobieren im Browser: `http://x:user@<IP>/rest/channel/_sum/EssSoc`.

## 2. Einrichten

```bash
git clone https://github.com/rabowke1/Fenecon-Dashboard.git
cd Fenecon-Dashboard
cp config.example.json config.json   # IP-Adresse des FEMS eintragen
python3 server.py --check            # Verbindung testen, alle _sum-Kanäle werden aufgelistet
python3 server.py                    # Server starten
```

Dann im Browser <http://127.0.0.1:8080/> öffnen.

Ohne FEMS (zum Anschauen): `python3 server.py --demo` erzeugt 60 Tage simulierte Daten in
`demo.sqlite` und simuliert laufend Live-Werte.

### Einstellungen (`config.json`)

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `fems_url` | Adresse des FEMS, ggf. mit `:8084` | `http://192.168.178.50` |
| `username` / `password` | Zugang zur REST-API | `x` / `user` |
| `poll_seconds` | Abfrageintervall | `5` |
| `store_seconds` | Speicherintervall (Mittelwerte) | `60` |
| `listen_host` | `127.0.0.1` = nur dieser Rechner, `0.0.0.0` = ganzes Heimnetz | `127.0.0.1` |
| `listen_port` | Port der Webseite | `8080` |
| `database` | SQLite-Datei | `fems.sqlite` |
| `export_dir` | Ordner für die Excel-Exporte | `exports` |
| `max_upload_mb` | maximale Größe beim Hochladen | `20` |

Alle Werte lassen sich auch über Umgebungsvariablen setzen, z. B. `FEMS_FEMS_URL=http://192.168.0.23`.

## Berichte aus dem FEMS-Datenexport

Die Seite **Berichte** (<http://127.0.0.1:8080/berichte.html>) wertet die Excel-Dateien aus dem
Datenexport des FEMS aus. Sie werden auf zwei Wegen eingelesen:

- Datei auf die Seite ziehen oder über **Export hochladen** auswählen, oder
- Datei direkt in den Ordner `exports/` auf dem Server kopieren (z. B. per Netzlaufwerk).

Hochladen kann jeder, der die Seite erreicht. Mit `listen_host: "0.0.0.0"` ist das das ganze Heimnetz,
die Seite sollte daher nicht aus dem Internet erreichbar sein.

Pro Tag zeigt die Seite:

- erzeugte Energie, Autarkie und Eigenverbrauch als Überblick, dazu ein kurzer Satz zum Tag
- Erzeugung, Verbrauch, Batterie (geladen/entladen) und Netz (Bezug/Einspeisung) mit Tagesspitzen
- **Woher kam der Strom?** (Solar direkt, Batterie, Netz) und **Wohin ging der Solarstrom?**
  (direkt verbraucht, Batterie, eingespeist)
- den Verlauf in Viertelstunden und den Ladezustand der Batterie
- die einzelnen PV-Strings und Verbraucher aus der Detailauswertung des Exports

Liegen mehrere Exporte vor, fasst **Alle Exporte** den gesamten Zeitraum zusammen: Summen,
Autarkie, bester Tag und ein Balkendiagramm aller Tage. Exporte über mehrere Tage werden
automatisch in einzelne Tage aufgeteilt. Gibt es einen Tag doppelt, gilt der neueste Export.

## Wie gerechnet wird

Gelesen wird das Summen-Component `_sum` des FEMS:

| Wert | Kanal | Vorzeichen |
|---|---|---|
| Erzeugung | `ProductionActivePower` | |
| Verbrauch | `ConsumptionActivePower` | |
| Netz | `GridActivePower` | + Bezug, − Einspeisung |
| Batterie | `EssDischargePower` (sonst `EssActivePower`) | + Entladen, − Laden |
| Ladezustand | `EssSoc` | % |
| Energiezähler | `ProductionActiveEnergy`, `ConsumptionActiveEnergy`, `GridBuyActiveEnergy`, `GridSellActiveEnergy`, `EssDcChargeEnergy`, `EssDcDischargeEnergy` | Wh |

Pro Minute wird ein Datensatz mit Mittelwerten und den Zählerständen gespeichert
(etwa 50 MB pro Jahr). Die Tagesenergie ergibt sich aus der Differenz der FEMS-Zähler;
fehlen diese, wird die Leistung aufintegriert.

- **Autarkie** = 1 − Netzbezug / Verbrauch
- **Eigenverbrauch** = 1 − Einspeisung / Erzeugung

Die Historie beginnt mit dem ersten Start des Servers. Damit sie lückenlos bleibt, sollte der
Server dauerhaft laufen, z. B. auf einem Raspberry Pi oder NAS.

## Dauerbetrieb (Linux/systemd)

```ini
# /etc/systemd/system/fems-dashboard.service
[Unit]
Description=FEMS-Dashboard
After=network-online.target

[Service]
WorkingDirectory=/home/pi/Fenecon-Dashboard
ExecStart=/usr/bin/python3 server.py
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now fems-dashboard`

## JSON-API des Dashboards

| Pfad | Inhalt |
|---|---|
| `/api/live` | aktuelle Werte, Verbindungsstatus, Energie von heute |
| `/api/history?date=2026-06-21` | Leistungsverlauf eines Tages (`&days=7` für mehrere Tage) |
| `/api/energy?group=day\|month\|year&from=…&to=…` | Energiebilanz |
| `/api/channels?address=_sum/.*` | Rohwerte direkt aus dem FEMS (zum Erkunden weiterer Kanäle) |
| `/api/exports` | alle eingelesenen Exporte mit Tageswerten und Summen |
| `/api/exports/day?date=2026-09-28` | Tagesbericht mit Viertelstundenwerten |
| `POST /api/exports` | Export hochladen (Dateiinhalt als Body, Name im Header `X-Filename`) |

## Tests

```bash
python3 -m unittest test_server test_exports
```

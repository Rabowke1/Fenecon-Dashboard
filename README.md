# Fenecon-Dashboard

Eine lokale Webseite für FENECON-PV-Anlagen: Ein kleiner Python-Server liest die Werte
über die REST/JSON-API direkt aus dem FEMS, speichert sie in einer SQLite-Datenbank und
zeigt sie im Browser an.

- **Live-Werte** (alle 5 s): Erzeugung, Verbrauch, Batterie mit Ladezustand, Netzbezug/Einspeisung
- **Auswertung beliebiger Zeiträume**: Heute, Gestern, 7 Tage, Monat, Jahr oder frei gewählt (Von/Bis),
  mit ‹ › zum Blättern – jeweils Erzeugung, Verbrauch, Netzbezug, Einspeisung, Batterie, Autarkie,
  Eigenverbrauch und Stromkosten
- **Leistungsverlauf** mit Ladezustand der Batterie (für Zeiträume bis 7 Tage)
- **Energie je Tag, Monat oder Jahr** als Balkendiagramm und Tabelle (für längere Zeiträume)
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
| `base_price_month` | Grundpreis des Stromtarifs in €/Monat | `11.90` |
| `price_per_kwh` | Arbeitspreis in €/kWh | `0.326` |
| `feed_in_per_kwh` | Einspeisevergütung in €/kWh | `0.0666` |

Alle Werte lassen sich auch über Umgebungsvariablen setzen, z. B. `FEMS_FEMS_URL=http://192.168.0.23`.
Der Ordner für `config.json`, Datenbank und Exporte ist standardmäßig der Programmordner;
`FEMS_DATA_DIR` legt einen anderen fest.

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

### Speicherung

Alle Live-Werte landen in der SQLite-Datenbank `fems.sqlite` (Einstellung `database`): pro Minute ein
Datensatz mit den Mittelwerten der Leistungen, dem Ladezustand und den Zählerständen des FEMS
(etwa 50 MB pro Jahr). Es wird nichts automatisch gelöscht. Aus dieser Datenbank entstehen alle
Auswertungen der Live-Seite. Zur Sicherung genügt es, die Datei zu kopieren, am besten während der
Server kurz gestoppt ist. Die Tagesenergie ergibt sich aus der Differenz der FEMS-Zähler;
fehlen diese, wird die Leistung aufintegriert.

### Kosten und Vergütung

Für jeden gewählten Zeitraum (Auswertung, Berichtstag, alle Exporte) zeigt ein fest sichtbarer Block
die Aufschlüsselung, die Tabellen enthalten dieselben Werte je Zeile:

**Stromrechnung**

| Posten | Rechnung |
|---|---|
| Gekaufter Strom | Netzbezug × Arbeitspreis (32,60 ct/kWh) |
| Grundpreis anteilig | 11,90 €/Monat ÷ Tage des Monats, für **jeden Kalendertag** im Zeitraum bis heute – auch für Tage ohne Aufzeichnung |
| − Einspeisevergütung | Einspeisung × Vergütung (6,66 ct/kWh) |
| **Saldo** | gekaufter Strom + Grundpreis − Vergütung (negativ = Guthaben) |

**Das bringt die PV**

| Posten | Rechnung |
|---|---|
| Selbst erzeugter Strom | (Verbrauch − Netzbezug) × Arbeitspreis – nicht gekaufter Strom |
| Einspeisevergütung | Einspeisung × Vergütung |
| **Nutzen gesamt** | Ersparnis + Vergütung |

Dazu der Anteil gekauft/selbst erzeugt und zum Vergleich, was der gesamte Verbrauch ohne PV zum
Arbeitspreis gekostet hätte. Der Grundpreis fällt mit und ohne PV an und steckt deshalb nicht in
der Ersparnis. Alle Posten werden auf Cent gerundet und die Summen daraus gebildet, sodass die
Anzeige immer aufgeht. Tarif und Vergütung stehen in `config.json` (`base_price_month`,
`price_per_kwh`, `feed_in_per_kwh`).

### Tagesenergie aus den Zählern

Die Tageswerte entstehen aus den Zuwächsen der FEMS-Energiezähler zwischen zwei Messwerten.
Springt ein Zähler zurück (z. B. nach einem Update des FEMS), wird dieser Sprung übersprungen.
War der Server bis zu 6 Stunden aus, wird die Energie dieser Zeit dem ersten Messwert danach
zugerechnet; längere Lücken bleiben leer.

- **Autarkie** = 1 − Netzbezug / Verbrauch
- **Eigenverbrauch** = 1 − Einspeisung / Erzeugung

Die Historie beginnt mit dem ersten Start des Servers. Damit sie lückenlos bleibt, sollte der
Server dauerhaft laufen, z. B. auf einem Raspberry Pi oder NAS.

## Windows (.exe zum Testen)

Im Branch `windows` baut GitHub Actions bei jedem Push eine eigenständige `FeneconDashboard.exe`;
Python muss auf dem PC nicht installiert sein.

- **Download:** Auf GitHub unter *Releases → Windows-Testversion* die Datei
  `FeneconDashboard-windows.zip` laden (alternativ unter *Actions → Windows-EXE → Artifacts*).
- ZIP an einen festen Ort entpacken (z. B. `C:\FeneconDashboard`) und `FeneconDashboard.exe` starten.
  Beim ersten Start wird daneben eine `config.json` angelegt: IP-Adresse des FEMS eintragen und neu starten.
- Der Browser öffnet das Dashboard automatisch. Datenbank und Exporte liegen neben der `.exe`.
- Die `.exe` ist nicht signiert: Windows SmartScreen fragt beim ersten Start nach
  (*Weitere Informationen → Trotzdem ausführen*).

Selbst bauen auf einem Windows-PC mit Python 3: `windows\build.bat` ausführen,
Ergebnis in `dist\FeneconDashboard.exe`.

## Docker / Portainer

Bei jedem Push auf `main` baut GitHub Actions ein Image für amd64 und arm64 (z. B. Raspberry Pi,
Synology) und veröffentlicht es als `ghcr.io/rabowke1/fenecon-dashboard:latest`.

### In Portainer einrichten

1. **Zugang zur Registry** (nur nötig, solange das Paket privat ist): Auf GitHub unter
   *Settings → Developer settings → Personal access tokens* einen Token mit dem Recht
   `read:packages` anlegen. In Portainer unter *Registries → Add registry → Custom registry*
   eintragen: URL `ghcr.io`, Benutzername = GitHub-Name, Passwort = Token.
   Alternativ das Paket auf GitHub unter *Packages → fenecon-dashboard → Package settings*
   öffentlich machen, dann entfällt dieser Schritt.
2. *Stacks → Add stack*, Name `fenecon-dashboard`, Inhalt von [`docker-compose.yml`](docker-compose.yml)
   in den Web-Editor kopieren und **IP-Adresse des FEMS** sowie Tarif anpassen.
3. *Deploy the stack*. Das Dashboard ist danach unter `http://<Docker-Host>:8080/` erreichbar.

Updates: Im Stack *Pull and redeploy* bzw. *Update the stack* mit „Re-pull image“ wählen.
Die Daten liegen im Volume `fenecon-data` und bleiben dabei erhalten.

### Einstellungen im Container

Jede Einstellung aus der Tabelle oben lässt sich als Umgebungsvariable mit dem Präfix `FEMS_` setzen,
z. B. `FEMS_FEMS_URL`, `FEMS_PASSWORD`, `FEMS_PRICE_PER_KWH`. Alternativ eine `config.json` in das
Volume legen; Umgebungsvariablen haben Vorrang.

Im Volume `/data` liegen:

| Pfad | Inhalt |
|---|---|
| `/data/fems.sqlite` | alle aufgezeichneten Werte – diese Datei sichern |
| `/data/exports/` | Excel-Exporte für die Berichte (auch per Hochladen auf der Seite) |
| `/data/config.json` | optional, statt der Umgebungsvariablen |

Der Container läuft als Benutzer mit UID 1000. Wer statt des benannten Volumes einen Ordner des
Hosts einbindet (`/pfad/auf/host:/data`), muss diesem Ordner die Rechte geben:
`sudo chown 1000:1000 /pfad/auf/host`.

Die Zeitzone steht auf `Europe/Berlin` (Variable `TZ`); sie bestimmt, wo ein Tag beginnt und endet.

### Ohne Registry direkt auf dem Docker-Host bauen

```bash
git clone https://github.com/Rabowke1/fenecon-dashboard.git
cd fenecon-dashboard
docker build -t fenecon-dashboard .
```

Dann in der `docker-compose.yml` `image: fenecon-dashboard` eintragen.

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
| `/api/energy?group=day\|month\|year&from=…&to=…` | Energiebilanz je Tag/Monat/Jahr plus Summe (`total`) und Stromkosten für den Zeitraum |
| `/api/channels?address=_sum/.*` | Rohwerte direkt aus dem FEMS (zum Erkunden weiterer Kanäle) |
| `/api/exports` | alle eingelesenen Exporte mit Tageswerten und Summen |
| `/api/exports/day?date=2026-09-28` | Tagesbericht mit Viertelstundenwerten |
| `POST /api/exports` | Export hochladen (Dateiinhalt als Body, Name im Header `X-Filename`) |

## Tests

```bash
python3 -m unittest test_server test_exports test_tariff
```

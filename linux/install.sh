#!/bin/sh
# Installiert das Fenecon-Dashboard als systemd-Dienst, der beim Booten startet.
#   sudo ./linux/install.sh            installieren bzw. aktualisieren und starten
#   sudo ./linux/install.sh --remove   Dienst stoppen und entfernen (Daten bleiben erhalten)
set -eu

NAME=fenecon-dashboard
UNIT=/etc/systemd/system/$NAME.service
DIR=$(cd "$(dirname "$0")/.." && pwd)

if [ "$(id -u)" -ne 0 ]; then
    echo "Bitte mit sudo ausführen: sudo $0 $*" >&2
    exit 1
fi

if [ "${1:-}" = "--remove" ]; then
    systemctl disable --now "$NAME" 2>/dev/null || true
    rm -f "$UNIT"
    systemctl daemon-reload
    echo "Dienst $NAME entfernt. Datenbank und Einstellungen in $DIR bleiben erhalten."
    exit 0
fi

# Der Dienst läuft als der Benutzer, dem der Programmordner gehört (nicht als root).
RUN_USER=${SERVICE_USER:-$(stat -c %U "$DIR")}
[ "$RUN_USER" = "root" ] && [ -n "${SUDO_USER:-}" ] && RUN_USER=$SUDO_USER
PYTHON=$(command -v python3) || { echo "python3 nicht gefunden – bitte installieren." >&2; exit 1; }

if [ ! -f "$DIR/config.json" ]; then
    cp "$DIR/config.example.json" "$DIR/config.json"
    chown "$RUN_USER" "$DIR/config.json"
    echo "config.json angelegt – bitte die IP-Adresse des FEMS eintragen: $DIR/config.json"
fi

sed -e "s|@USER@|$RUN_USER|g" -e "s|@DIR@|$DIR|g" -e "s|@PYTHON@|$PYTHON|g" \
    "$DIR/linux/$NAME.service" > "$UNIT"
systemctl daemon-reload
systemctl enable "$NAME" >/dev/null
systemctl restart "$NAME"

echo "Dienst $NAME installiert und gestartet (Benutzer $RUN_USER, Ordner $DIR)."
echo
echo "  Status:       systemctl status $NAME"
echo "  Neu starten:  sudo systemctl restart $NAME"
echo "  Stoppen:      sudo systemctl stop $NAME"
echo "  Protokoll:    journalctl -u $NAME -f"

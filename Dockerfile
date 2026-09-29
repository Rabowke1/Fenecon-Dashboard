FROM python:3.12-slim

RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin fems \
 && mkdir /data && chown fems:fems /data

# Zeitzone für Tagesgrenzen und Uhrzeiten (tzdata ist im Basis-Image enthalten)

ENV TZ=Europe/Berlin \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FEMS_DATA_DIR=/data \
    FEMS_LISTEN_HOST=0.0.0.0 \
    FEMS_LISTEN_PORT=8080

WORKDIR /app
COPY server.py exports.py tariff.py config.example.json ./
COPY static ./static

USER fems
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/live', timeout=4)" || exit 1

CMD ["python", "server.py"]

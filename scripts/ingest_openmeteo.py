#!/usr/bin/env python3
"""
Open-Meteo -> Cloudflare R2 Cache (Amriswil Region).

Holt regelmässig die wichtigsten Forecast-Variablen, damit der Cloudflare
Worker keine direkten api.open-meteo.com-Calls mehr machen muss (Shared-IP-
Throttle vermeiden).

Output: <R2_BUCKET>/openmeteo/forecast.json

ENV (required):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
ENV (optional):
  OPENMETEO_OUT_KEY        default "openmeteo/forecast.json"
  OPENMETEO_PROXY_URL      z.B. https://wetter.example.ch/om-proxy.php — wird
                           als Fallback verwendet, wenn der Direkt-Call an
                           api.open-meteo.com vom Runner aus nicht klappt
                           (DNS-Glitches, IP-Throttle).
  OPENMETEO_PROXY_KEY      optional, wird als Header X-Proxy-Key gesendet
  BBOX_MIN_LAT / MAX_LAT   default Amriswil + 15km
  BBOX_MIN_LON / MAX_LON
  GRID_LAT (default 7), GRID_LON (default 7)
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
from datetime import datetime, timezone

import boto3
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

VERSION = "amriswil-openmeteo-cache-v1"
DIRECT_HOST = "api.open-meteo.com"
DIRECT_PATH = "/v1/forecast"
DIRECT_URL = f"https://{DIRECT_HOST}{DIRECT_PATH}"

# Amriswil center: 47.5469, 9.2986
DEFAULTS = {
    "BBOX_MIN_LAT": 47.45,
    "BBOX_MAX_LAT": 47.65,
    "BBOX_MIN_LON": 9.20,
    "BBOX_MAX_LON": 9.45,
    "GRID_LAT": 7,
    "GRID_LON": 7,
}


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"missing required env var: {name}")
    return v


def envf(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def envi(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def make_s3():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def build_grid():
    min_lat = envf("BBOX_MIN_LAT", DEFAULTS["BBOX_MIN_LAT"])
    max_lat = envf("BBOX_MAX_LAT", DEFAULTS["BBOX_MAX_LAT"])
    min_lon = envf("BBOX_MIN_LON", DEFAULTS["BBOX_MIN_LON"])
    max_lon = envf("BBOX_MAX_LON", DEFAULTS["BBOX_MAX_LON"])
    n_lat = envi("GRID_LAT", DEFAULTS["GRID_LAT"])
    n_lon = envi("GRID_LON", DEFAULTS["GRID_LON"])
    lats = [min_lat + (max_lat - min_lat) * i / (n_lat - 1) for i in range(n_lat)]
    lons = [min_lon + (max_lon - min_lon) * j / (n_lon - 1) for j in range(n_lon)]
    return [(la, lo) for la in lats for lo in lons]


RETRY_BACKOFFS = (3, 8, 20, 45, 90)  # seconds; total 6 attempts (~3 min total)


def make_session() -> requests.Session:
    """requests-Session mit Connect-Retries für transient DNS/SSL Fehler."""
    s = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=0,
        status=0,
        backoff_factor=1.5,
        allowed_methods=frozenset(["GET"]),
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=4)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def dns_ok(host: str) -> bool:
    try:
        socket.getaddrinfo(host, 443)
        return True
    except socket.gaierror as e:
        print(f"  [dns] getaddrinfo({host}) failed: {e}")
        return False


def build_endpoints(params: dict):
    """Liefert eine Liste von (label, url, params, headers)-Tupeln in Probe-Reihenfolge."""
    eps = []

    # 1) Direkt — nur, wenn DNS überhaupt funktioniert.
    if dns_ok(DIRECT_HOST):
        eps.append(("direct", DIRECT_URL, dict(params), {}))
    else:
        print(f"  [dns] skip direct call — switching to proxy immediately")

    # 2) Proxy-Fallback (Cyon o.ä.) — nur, wenn konfiguriert.
    proxy_url = os.environ.get("OPENMETEO_PROXY_URL", "").strip()
    if proxy_url:
        proxy_params = dict(params)
        proxy_params["__host"] = DIRECT_HOST
        proxy_params["__path"] = DIRECT_PATH
        headers = {}
        proxy_key = os.environ.get("OPENMETEO_PROXY_KEY", "").strip()
        if proxy_key:
            headers["X-Proxy-Key"] = proxy_key
        eps.append(("proxy", proxy_url, proxy_params, headers))

    if not eps:
        sys.exit(
            "No usable endpoints: direct DNS failed and OPENMETEO_PROXY_URL not set"
        )
    return eps


def fetch(label: str, params: dict) -> list:
    """Probiert alle verfügbaren Endpunkte (direct, dann proxy) je mit Backoff."""
    endpoints = build_endpoints(params)
    last_err = ""

    for ep_label, url, ep_params, headers in endpoints:
        print(f"  [{label}] trying endpoint: {ep_label} ({url})")
        session = make_session()
        for attempt in range(len(RETRY_BACKOFFS) + 1):
            try:
                r = session.get(url, params=ep_params, headers=headers, timeout=45)
            except requests.RequestException as e:
                last_err = f"network error: {e}"
                print(
                    f"  [{label}/{ep_label}] attempt {attempt + 1} failed: {last_err}"
                )
            else:
                if r.ok:
                    try:
                        data = r.json()
                    except ValueError as e:
                        last_err = f"invalid JSON ({len(r.content)} bytes): {e}"
                        print(
                            f"  [{label}/{ep_label}] attempt {attempt + 1} bad body: {last_err}"
                        )
                    else:
                        print(f"  [{label}/{ep_label}] ok via {ep_label}")
                        return data if isinstance(data, list) else [data]
                # 4xx vom Direct-Call: hartes Client-Fehler — kein Retry, aber
                # Proxy-Pfad noch probieren (er könnte Header anders setzen).
                elif 400 <= r.status_code < 500 and ep_label == "direct":
                    last_err = f"HTTP {r.status_code}: {r.text[:200]}"
                    print(
                        f"  [{label}/{ep_label}] HTTP {r.status_code} — skip retries on this endpoint"
                    )
                    break
                else:
                    last_err = f"HTTP {r.status_code}: {r.text[:200]}"
                    print(
                        f"  [{label}/{ep_label}] attempt {attempt + 1} failed: {last_err}"
                    )

            if attempt < len(RETRY_BACKOFFS):
                delay = RETRY_BACKOFFS[attempt]
                print(f"    retrying in {delay}s …")
                time.sleep(delay)

        print(f"  [{label}/{ep_label}] exhausted — moving to next endpoint")

    sys.exit(
        f"open-meteo failed on all endpoints ({label}): last error: {last_err}"
    )


def main() -> None:
    print(f"OPENMETEO INGEST START version={VERSION}")
    proxy_set = bool(os.environ.get("OPENMETEO_PROXY_URL", "").strip())
    print(f"proxy fallback configured: {proxy_set}")

    pts = build_grid()
    lat_str = ",".join(f"{p[0]:.4f}" for p in pts)
    lon_str = ",".join(f"{p[1]:.4f}" for p in pts)
    print(f"grid points: {len(pts)}")

    # Phase A — Multi-Modell hourly, Tag 0-11 (Hot-Path-Forecast, forecast_days=12)
    phase_a = {
        "latitude": lat_str,
        "longitude": lon_str,
        "hourly": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "precipitation",
            "weathercode",
            "cloudcover",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
            "pressure_msl",
        ]),
        "daily": ",".join([
            "temperature_2m_min",
            "temperature_2m_max",
            "precipitation_sum",
            "weathercode",
            "wind_speed_10m_max",
        ]),
        "forecast_days": 12,
        "timezone": "Europe/Zurich",
        "models": "meteoswiss_icon_ch2,ecmwf_ifs025,gfs_global",
    }

    # Phase B — ICON-CH1 minutely_15, ±6h (Nowcast / Radar)
    phase_b = {
        "latitude": lat_str,
        "longitude": lon_str,
        "minutely_15": "precipitation,temperature_2m",
        "past_minutely_15": 24,   # 6 h zurück
        "forecast_minutely_15": 24,  # 6 h vorwärts
        "timezone": "UTC",
        "models": "meteoswiss_icon_ch1",
    }

    # Phase C — Bias-Lookback hourly, 7 Tage past
    phase_c = {
        "latitude": lat_str,
        "longitude": lon_str,
        "hourly": "temperature_2m,wind_speed_10m",
        "past_days": 7,
        "forecast_days": 1,
        "timezone": "Europe/Zurich",
        "models": "best_match",
    }

    print("fetch phase A (multi-model hourly+daily, 12 days) …")
    a = fetch("A", phase_a)
    print(f"  -> {len(a)} locations")
    print("fetch phase B (ICON-CH1 minutely_15) …")
    b = fetch("B", phase_b)
    print(f"  -> {len(b)} locations")
    print("fetch phase C (bias lookback) …")
    c = fetch("C", phase_c)
    print(f"  -> {len(c)} locations")

    # Sanity-Check: Phase A muss wirklich 12 Tage daily-Daten enthalten,
    # sonst hat ein Endpunkt einen alten/abgeschnittenen Datensatz geliefert.
    daily_times = (a[0].get("daily") or {}).get("time") if a else None
    if not daily_times or len(daily_times) < 12:
        sys.exit(
            f"phase A returned only {len(daily_times) if daily_times else 0} daily entries — refusing to overwrite cache"
        )
    print(f"  phase A daily coverage: {len(daily_times)} days ({daily_times[0]} … {daily_times[-1]})")

    payload = {
        "version": VERSION,
        "generatedAt": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "grid": {
            "points": [{"lat": la, "lon": lo} for la, lo in pts],
        },
        "phaseA": a,
        "phaseB": b,
        "phaseC": c,
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    key = os.environ.get("OPENMETEO_OUT_KEY", "openmeteo/forecast.json")
    s3 = make_s3()
    s3.put_object(
        Bucket=env("R2_BUCKET"),
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=60, s-maxage=120",
    )
    print(f"uploaded {key} ({len(body)} bytes)")
    print("done")


if __name__ == "__main__":
    main()

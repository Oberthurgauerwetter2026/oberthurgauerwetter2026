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
  BBOX_MIN_LAT / MAX_LAT   default Amriswil + 15km
  BBOX_MIN_LON / MAX_LON
  GRID_LAT (default 7), GRID_LON (default 7)
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone

import boto3
import requests

VERSION = "amriswil-openmeteo-cache-v1"
API = "https://api.open-meteo.com/v1/forecast"

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


def fetch(label: str, params: dict) -> list:
    r = requests.get(API, params=params, timeout=45)
    if not r.ok:
        sys.exit(f"open-meteo HTTP {r.status_code} ({label}): {r.text[:300]}")
    data = r.json()
    return data if isinstance(data, list) else [data]


def main() -> None:
    print(f"OPENMETEO INGEST START version={VERSION}")
    pts = build_grid()
    lat_str = ",".join(f"{p[0]:.4f}" for p in pts)
    lon_str = ",".join(f"{p[1]:.4f}" for p in pts)
    print(f"grid points: {len(pts)}")

    # Phase A — Multi-Modell hourly, Tag 0-7 (Hot-Path-Forecast)
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
        "forecast_days": 7,
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

    print("fetch phase A (multi-model hourly+daily) …")
    a = fetch("A", phase_a)
    print(f"  -> {len(a)} locations")
    print("fetch phase B (ICON-CH1 minutely_15) …")
    b = fetch("B", phase_b)
    print(f"  -> {len(b)} locations")
    print("fetch phase C (bias lookback) …")
    c = fetch("C", phase_c)
    print(f"  -> {len(c)} locations")

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

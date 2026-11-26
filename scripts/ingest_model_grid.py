#!/usr/bin/env python3
"""
Open-Meteo Modellgitter Schweiz -> Cloudflare R2.

Erzeugt pro Modell und Variable ein kompaktes Int16-Raster (base64) über der
Schweiz, damit das Frontend mehrere Modelle als Karten-Panels synchron
vergleichen kann (Meteociel-Stil).

Output:
  <R2_BUCKET>/model-grid/index.json
  <R2_BUCKET>/model-grid/<model>/<variable>.json

ENV (required):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
ENV (optional):
  OPENMETEO_PROXY_URL, OPENMETEO_PROXY_KEY   Fallback-Proxy (Cyon)
  GRID_LAT (default 22), GRID_LON (default 34)
  FORECAST_DAYS (default 4)
"""
from __future__ import annotations

import base64
import json
import os
import socket
import struct
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import boto3
import requests

VERSION = "ch-model-grid-v1"
DIRECT_HOST = "api.open-meteo.com"
DIRECT_PATH = "/v1/forecast"
DIRECT_URL = f"https://{DIRECT_HOST}{DIRECT_PATH}"

MIN_LAT, MAX_LAT = 45.80, 47.85
MIN_LON, MAX_LON = 5.90, 10.55

MODELS = [
    "meteoswiss_icon_ch1",
    "meteoswiss_icon_ch2",
    "icon_d2",
    "meteofrance_arome_france",
    "meteofrance_arpege_europe",
    "icon_eu",
    "ecmwf_ifs025",
    "gfs_global",
]

# variable -> (open-meteo hourly name, scale)
VARIABLES = {
    "temperature_2m": ("temperature_2m", 10),
    "precipitation": ("precipitation", 100),
    "precipitation_probability": ("precipitation_probability", 1),
    "snowfall": ("snowfall", 100),
    "rain": ("rain", 100),
    "cloudcover": ("cloudcover", 1),
    "cloudcover_low": ("cloudcover_low", 1),
    "cloudcover_mid": ("cloudcover_mid", 1),
    "cloudcover_high": ("cloudcover_high", 1),
    "wind_speed_10m": ("wind_speed_10m", 10),
    "wind_direction_10m": ("wind_direction_10m", 1),
    "wind_gusts_10m": ("wind_gusts_10m", 10),
}

MISSING = -32768
BATCH = 100
THROTTLE_S = 1.0
RETRY_BACKOFFS = (3, 8, 20, 45)


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"missing required env var: {name}")
    return v


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


def dns_ok(host: str) -> bool:
    try:
        socket.getaddrinfo(host, 443)
        return True
    except socket.gaierror as e:
        print(f"  [dns] getaddrinfo({host}) failed: {e}")
        return False


def build_endpoints(params: dict):
    eps = []
    if dns_ok(DIRECT_HOST):
        eps.append(("direct", DIRECT_URL, dict(params), {}))
    proxy_url = os.environ.get("OPENMETEO_PROXY_URL", "").strip()
    if proxy_url:
        p = dict(params)
        p["__host"] = DIRECT_HOST
        p["__path"] = DIRECT_PATH
        headers = {}
        key = os.environ.get("OPENMETEO_PROXY_KEY", "").strip()
        if key:
            headers["X-Proxy-Key"] = key
        eps.append(("proxy", proxy_url, p, headers))
    if not eps:
        sys.exit("No usable endpoint (DNS failed, no proxy configured)")
    return eps


def fetch(label: str, params: dict):
    last = ""
    for ep_label, url, ep_params, headers in build_endpoints(params):
        for attempt in range(len(RETRY_BACKOFFS) + 1):
            try:
                r = requests.get(url, params=ep_params, headers=headers, timeout=60)
            except requests.RequestException as e:
                last = f"network: {e}"
            else:
                if r.ok:
                    try:
                        data = r.json()
                    except ValueError as e:
                        last = f"bad json: {e}"
                    else:
                        return data if isinstance(data, list) else [data]
                else:
                    last = f"HTTP {r.status_code}: {r.text[:180]}"
                    if r.status_code == 400:
                        print(f"  [{label}/{ep_label}] {last}")
                        return None
            print(f"  [{label}/{ep_label}] attempt {attempt + 1} failed: {last}")
            if attempt < len(RETRY_BACKOFFS):
                time.sleep(RETRY_BACKOFFS[attempt])
    print(f"  [{label}] giving up: {last}")
    return None


def build_grid(n_lat: int, n_lon: int):
    lats = [MIN_LAT + (MAX_LAT - MIN_LAT) * i / (n_lat - 1) for i in range(n_lat)]
    lons = [MIN_LON + (MAX_LON - MIN_LON) * j / (n_lon - 1) for j in range(n_lon)]
    pts = [(la, lo) for la in lats for lo in lons]
    return lats, lons, pts


def encode_int16(values: list[int]) -> str:
    buf = struct.pack(f"<{len(values)}h", *values)
    return base64.b64encode(buf).decode("ascii")


def fetch_chunk(model: str, chunk, hourly: str, days: int, start: int):
    params = {
        "latitude": ",".join(f"{p[0]:.4f}" for p in chunk),
        "longitude": ",".join(f"{p[1]:.4f}" for p in chunk),
        "hourly": hourly,
        "forecast_days": days,
        "timezone": "GMT",
        "models": model,
    }
    time.sleep(THROTTLE_S * (start // BATCH % 3))
    return start, fetch(f"{model}#{start}", params)


def ingest_model(model: str, s3, bucket: str, n_lat: int, n_lon: int, days: int, pts, generated_at: str) -> dict | None:
    print(f"== model {model}")
    hourly = ",".join(v[0] for v in VARIABLES.values())
    starts = list(range(0, len(pts), BATCH))
    results: dict[int, list] = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = [ex.submit(fetch_chunk, model, pts[s:s + BATCH], hourly, days, s) for s in starts]
        for f in futures:
            start, data = f.result()
            if data is None:
                print(f"  aborted at batch {start}")
                return None
            results[start] = data

    time_axis: list[str] | None = None
    per_var: dict[str, list[list]] = {k: [] for k in VARIABLES}
    for start in starts:
        for loc in results[start]:
            h = loc.get("hourly") or {}
            if time_axis is None and h.get("time"):
                time_axis = h["time"]
            for var, (om_name, _scale) in VARIABLES.items():
                series = h.get(om_name)
                per_var[var].append(series if isinstance(series, list) else [])

    if time_axis is None:
        print(f"  skipped {model}: no time axis")
        return None

    nt = len(time_axis)
    available = []
    for var, (_om, scale) in VARIABLES.items():
        series_list = per_var[var]
        if len(series_list) != len(pts):
            continue
        has_any = False
        flat: list[int] = []
        for t in range(nt):
            for i in range(len(pts)):
                s = series_list[i]
                v = s[t] if t < len(s) else None
                if v is None:
                    flat.append(MISSING)
                else:
                    has_any = True
                    iv = int(round(v * scale))
                    flat.append(max(-32767, min(32767, iv)))
        if not has_any:
            print(f"  {var}: no data")
            continue
        body = json.dumps({
            "version": VERSION,
            "model": model,
            "variable": var,
            "scale": scale,
            "missing": MISSING,
            "nt": nt,
            "nlat": n_lat,
            "nlon": n_lon,
            "generatedAt": generated_at,
            "data": encode_int16(flat),
        }, separators=(",", ":")).encode("utf-8")
        s3.put_object(
            Bucket=bucket,
            Key=f"model-grid/{model}/{var}.json",
            Body=body,
            ContentType="application/json",
            CacheControl="public, max-age=300, s-maxage=600",
        )
        available.append(var)
        print(f"  {var}: {len(body)} bytes")

    if not available:
        return None

    meta = {
        "version": VERSION,
        "model": model,
        "variables": available,
        "times": time_axis,
        "grid": {"nlat": n_lat, "nlon": n_lon},
        "generatedAt": generated_at,
    }
    s3.put_object(
        Bucket=bucket,
        Key=f"model-grid/_meta/{model}.json",
        Body=json.dumps(meta, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
        CacheControl="no-store",
    )
    return meta


def build_index(s3, bucket: str, n_lat: int, n_lon: int) -> None:
    lats, lons, _pts = build_grid(n_lat, n_lon)
    model_meta = []
    times: list[str] = []
    newest = ""
    for model in MODELS:
        try:
            obj = s3.get_object(Bucket=bucket, Key=f"model-grid/_meta/{model}.json")
        except Exception as e:  # noqa: BLE001
            print(f"  no meta for {model}: {type(e).__name__}")
            continue
        meta = json.loads(obj["Body"].read())
        if meta.get("version") != VERSION or not meta.get("variables"):
            continue
        model_meta.append({"model": model, "variables": meta["variables"]})
        if len(meta.get("times") or []) > len(times):
            times = meta["times"]
        newest = max(newest, meta.get("generatedAt", ""))

    index = {
        "version": VERSION,
        "generatedAt": newest or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "times": times,
        "grid": {
            "nlat": n_lat,
            "nlon": n_lon,
            "minLat": MIN_LAT,
            "maxLat": MAX_LAT,
            "minLon": MIN_LON,
            "maxLon": MAX_LON,
            "lats": [round(x, 4) for x in lats],
            "lons": [round(x, 4) for x in lons],
        },
        "models": model_meta,
    }
    s3.put_object(
        Bucket=bucket,
        Key="model-grid/index.json",
        Body=json.dumps(index, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
        CacheControl="public, max-age=120, s-maxage=300",
    )
    print(f"uploaded index.json with {len(model_meta)} models")


def main() -> None:
    print(f"MODEL GRID INGEST START version={VERSION}")
    n_lat = envi("GRID_LAT", 22)
    n_lon = envi("GRID_LON", 34)
    days = envi("FORECAST_DAYS", 4)
    mode = os.environ.get("MODE", "ingest").strip()
    s3 = make_s3()
    bucket = env("R2_BUCKET")

    if mode == "index":
        build_index(s3, bucket, n_lat, n_lon)
        print("done")
        return

    only = os.environ.get("MODEL", "").strip()
    models = [only] if only else MODELS
    for m in models:
        if m not in MODELS:
            sys.exit(f"unknown model: {m}")

    _lats, _lons, pts = build_grid(n_lat, n_lon)
    print(f"grid {n_lat}x{n_lon} = {len(pts)} points, {days} days, models={models}")
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    ok = 0
    for model in models:
        if ingest_model(model, s3, bucket, n_lat, n_lon, days, pts, generated_at):
            ok += 1

    if not only:
        build_index(s3, bucket, n_lat, n_lon)
    if ok == 0:
        sys.exit("no model ingested")
    print("done")


if __name__ == "__main__":
    main()

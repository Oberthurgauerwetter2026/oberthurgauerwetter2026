## Weiterführung: Prompt-Integration + Lightning + Ensemble

### 1. Prompt-Integration (forecast.functions.ts)

Die neuen Felder aus `formatDayData` (gusts, thunderstorm, humidity, precip_phase, uncertainty) sind aktuell im `weather_data` JSON, aber das AI-Modell weiß nicht, wie es sie verwenden soll. Ergänzungen in `DEFAULT_SKY_RULES` und `DEFAULT_WIND_RULES`:

**SKY_RULES erweitern um:**
- `thunderstorm.label` → bei `scattered`/`widespread`/`severe` explizit "Gewitter" / "teils kräftige Gewitter" / "schwere Gewitter mit Hagelgefahr" einbauen
- `precip_phase` → "Regen" / "Schneeregen" / "Schnee" / "gefrierender Regen (Glatteisgefahr)" sauber benennen
- `humidity.fog_potential` → bei klaren Nächten mit hoher Feuchte "Nebel-/Hochnebelfelder am Morgen" erwähnen
- `humidity.muggy` → im Sommer bei Schwüle-Hinweis "schwül" verwenden

**WIND_RULES erweitern um:**
- `wind_gusts.label` → bei `kräftige Böen` / `stürmische Böen` / `Sturmböen` zwingend benennen mit km/h-Bereich
- `uncertainty.wind` → bei `high` Formulierung "Windstärke noch unsicher" zulassen

**Globale Regel ergänzen:**
- `uncertainty.temperature` = `high` → "Temperaturprognose noch unsicher, mögliche Bandbreite X–Y°C"
- Bei Tag ≥3: Ensemble-Spannweite (sobald #12 fertig) als Bandbreite nutzen

### 2. `src/server/lightning.server.ts` (neu)

Blitzortung.org-Integration:

```text
fetchLightning(lat, lon, radiusKm) → {
  count_last_1h, count_last_3h, count_last_6h,
  closest_strike_km, last_strike_at,
  active_now: boolean
}
```

- Quelle: Blitzortung WebSocket-Archiv ist nicht öffentlich; nutze stattdessen den **kostenlosen JSON-Feed** von `https://api.blitzortung.org/v2/strikes/...` (BBox um lat/lon ± radiusKm umgerechnet in Grad).
- Falls Blitzortung-API nicht direkt erreichbar (CORS/Auth): Fallback auf **Open-Meteo `lightning_potential` Variable** (CAPE-basiert) oder **MetOffice DataHub** — wir prüfen zur Implementierung welcher Endpoint stabil ohne Key liefert.
- Cache 5 Minuten in `weather_cache` (`cache_key = lightning:{lat}:{lon}:{radius}`).
- Setting-Gates: nur ausführen wenn `app_settings.lightning_enabled = true`, BBox aus `lightning_radius_km`.
- Aufruf in `forecast.functions.ts`: Ergebnis nur dem **heutigen** Tag (Tag 0) anhängen als `lightning: {...}`, weil Live-Daten nur kurzfristig relevant sind.
- Prompt-Hinweis ergänzen: bei `active_now` oder `count_last_1h > 5` → "Aktuell Gewitteraktivität im Raum Amriswil".

### 3. `src/server/ensemble.server.ts` (neu)

Open-Meteo Ensemble:

```text
fetchEnsemble(lat, lon) → per day:
  t_max: { p10, p50, p90 },
  t_min: { p10, p50, p90 },
  precip_sum: { p10, p50, p90 },
  wind_max: { p10, p50, p90 }
```

- Endpoint: `https://ensemble-api.open-meteo.com/v1/ensemble`
- Modelle: `icon_seamless` (40 Member) + `gfs_seamless` (31 Member) — kombiniert zu einem Multi-Model-Ensemble.
- Variablen: `temperature_2m`, `precipitation`, `wind_speed_10m` stündlich; lokal zu Tagesaggregaten + Perzentilen reduzieren.
- Cache: 2h in `weather_cache` (`cache_key = ensemble:{lat}:{lon}`).
- Setting-Gates: nur wenn `app_settings.ensemble_enabled = true` und `dayIndex >= ensemble_min_day` (Default 2).
- Integration in `formatDayData`: pro Tag ab Index 2 ein `ensemble: { t_max_p10, t_max_p50, t_max_p90, ... }` Block mit Spread → `ensemble_spread_class` (low/moderate/high) basierend auf `(p90-p10)`.
- Prompt-Hinweis: ab Tag 3 die p10/p90-Spanne als Unsicherheitsbandbreite nutzen ("Modelle sehen 18–24°C möglich").

### 4. Reihenfolge der Implementierung

1. **Prompt-Regeln erweitern** (DEFAULT_SKY_RULES + DEFAULT_WIND_RULES in `forecast.functions.ts`) — XS, sofort sichtbarer Effekt.
2. **Ensemble-Modul** (`ensemble.server.ts`) + Integration in `formatDayData` für Tag ≥2.
3. **Lightning-Modul** (`lightning.server.ts`) + Integration für Tag 0.
4. Ein Testlauf mit `invoke-server-function` auf eine bestehende Forecast-ID, um zu prüfen dass `weather_data` die neuen Blöcke enthält und der AI-Output sie sinnvoll verwendet.

### Offene Frage zur Bestätigung

Bei Lightning-Daten: Blitzortung.org bietet keinen offiziellen offenen REST-Feed mehr (nur WebSocket mit Registrierung). Drei realistische Optionen:

- **A) Open-Meteo `lightning_potential`** — bereits in unserer API verfügbar, modellbasiert (kein echter Live-Strike). Zuverlässig, kein Key.
- **B) Blitzortung WebSocket** mit eigenem Account/Token — echte Live-Strikes, aber Setup-Aufwand und User muss Token besorgen.
- **C) Lightning-Feature streichen** und stattdessen die CAPE-/LI-basierte Gewitterklassifikation (bereits in #2 implementiert) als ausreichend betrachten.

Bitte wähle A, B oder C bevor ich Lightning baue. Punkt 1 (Prompts) und Punkt 2 (Ensemble) starte ich unabhängig.

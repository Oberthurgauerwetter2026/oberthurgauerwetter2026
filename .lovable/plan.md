# ICON-EU ab Tag 5 aufnehmen

## Befund

Aktuelle Konfiguration in `app_settings`:
- `models_longterm = "ecmwf_ifs025,gfs_global"` (greift ab Tag > 5, d. h. Tag 6+)
- `models_midterm = "meteoswiss_icon_ch2,arpege_europe"` (Tag 2–5)

Der Code-Default in `src/server/forecast.functions.ts` Zeile 902 ist identisch (`longModels = "ecmwf_ifs025,gfs_global"`).

**Hinweis zur Reichweite:** ICON-EU (Open-Meteo `icon_eu`) liefert Stunden­werte bis ca. +120 h und Tageswerte bis ~Tag 5/6. Genau ab Tag 5 ist es also noch sinnvoll dabei, ab Tag 7 liefert es nichts mehr — das Tier-Mixing ignoriert leere Werte automatisch, daher unproblematisch.

## Änderungen

### 1. Datenbank: `app_settings.models_longterm` erweitern

```sql
update app_settings
set models_longterm = 'ecmwf_ifs025,gfs_global,icon_eu',
    updated_at = now();
```

### 2. Code-Default angleichen (`src/server/forecast.functions.ts`, Z. 902)

```ts
longModels = "ecmwf_ifs025,gfs_global,icon_eu"
```

Damit greift der gleiche Wert, falls `app_settings` einmal leer ist.

### 3. Keine weiteren Anpassungen nötig

- `HOURLY_LONGRANGE_BLOCKLIST` (Z. 2057) muss **nicht** ergänzt werden — ICON-EU hat brauchbare Stundendaten bis +120 h und darf bei Tag 5 mit Stundenprofil beitragen.
- Das Tier-Modell mischt ICON-EU automatisch ab Tag 6 (Langfrist) und als Fallback bei Tag 5 (über `collectModelValuesTiered`).

## Erwartetes Ergebnis

| Tag | Modelle |
|---|---|
| Tag 5 | ECMWF-IFS, GFS-Global, **ICON-EU** (über Mid→Long Fallback wenn nötig) |
| Tag 6 | ECMWF-IFS, GFS-Global, **ICON-EU** (sofern noch Daten vorhanden) |
| Tag 7+ | ECMWF-IFS, GFS-Global (ICON-EU außerhalb Reichweite) |

## Geänderte Dateien

- DB-Migration auf `app_settings`
- `src/server/forecast.functions.ts` (1 Zeile)

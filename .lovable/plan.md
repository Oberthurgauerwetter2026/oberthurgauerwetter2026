## Ziel

Den Tag-1-Befund (Freitag: nur ICON-CH2 + ARPEGE → ARPEGE bei Sonne/Wolken stillschweigend ignoriert) beheben durch zwei minimale Änderungen:

1. **ICON-D2 wieder als Standard-Short-Modell** — garantiert in fast allen Fällen mindestens zwei Short-Tier-Modelle für Tag 0 + Tag 1, auch wenn ICON-CH1 (33 h) und AROME HD (51 h) im Run-Übergang Lücken haben.
2. **ARPEGE Europe in `CLOUD_SUN_WEIGHTS`** — sonst wirkt der bestehende Mid-Tier-Fallback (`collectModelValuesTiered`) für Bewölkung und Sonne nicht, weil ARPEGE keinen Gewichtseintrag hat und damit aus `weightedCloudSunAvg` rausfällt.

Beide Änderungen ausschliesslich in `src/server/forecast.functions.ts`. Keine DB-Migration, kein UI-Change, kein neuer Open-Meteo-Call.

## Baustein 1 — ICON-D2 in den Short-Tier-Default

In `fetchWeather` ist der Default heute:

```ts
shortModels = "meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2"
```

ICON-D2 ist also dort schon drin — aber `app_settings.models_shortterm` (DB) lautet beim aktuellen Projekt nur `"meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd"` und überschreibt damit den Code-Default. Zwei Stellen anpassen:

- **Code-Default** unverändert lassen (enthält ICON-D2 bereits).
- **`app_settings`-Spaltendefault** in einer Migration von `'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd'` auf `'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2'` setzen UND in der einen vorhandenen Zeile `models_shortterm` aktualisieren — sonst greift die Änderung beim aktuellen Tenant nicht.

ICON-D2 ist nicht in `HOURLY_LONGRANGE_BLOCKLIST`, hat alle benötigten Daily- und Hourly-Variablen, und ist für 0–48 h zuverlässig verfügbar.

## Baustein 2 — ARPEGE Europe in `CLOUD_SUN_WEIGHTS`

Aktuell:

```ts
const CLOUD_SUN_WEIGHTS = {
  meteoswiss_icon_ch1: 0.30,
  meteoswiss_icon_ch2: 0.25,
  icon_d2: 0.15,
  meteofrance_arome_france_hd: 0.15,
  icon_eu: 0.10,
  ecmwf_ifs025: 0.05,
};
```

ARPEGE Europe ist das einzige Mid-Tier-Modell mit französischer Konvektionsphysik und damit ein wertvoller Gegenanker zur ICON-Familie — fehlt aber in der Tabelle. Einfügen mit kleinem Gewicht (0.10), damit es bei voller Modellabdeckung nicht dominiert, aber bei dünnem Short-Tier (wie im Freitag-Beispiel) eingeht statt ignoriert zu werden:

```ts
arpege_europe: 0.10,
```

Andere Gewichte unverändert. `weightedCloudSunAvg` und `weightedHourValue` profitieren automatisch (beide lesen `CLOUD_SUN_WEIGHTS`).

## Reihenfolge

1. Migration für `app_settings.models_shortterm` (Default-Spalte + Update der bestehenden Zeile).
2. Edit `CLOUD_SUN_WEIGHTS` in `forecast.functions.ts`.
3. Typecheck.
4. Optional: kurze Verifikation per `read_query` auf `app_settings`, dass der neue Wert wirkt.

## Nicht im Scope

- Hebel 3 (Hourly für Tag 1 absichern) — separater Plan, grössere Änderung.
- Hebel 4 (Unsicherheits-Pflicht-Vokabel im Prompt).
- Hebel 5 (`cloud_sun_distribution` aus Daily-Modellvergleich ableiten).
- Anpassung von `TEMP_HOURLY_WEIGHTS` / `PRECIP_HOURLY_WEIGHTS` für ARPEGE — die enthalten ARPEGE bereits seit der vorigen Iteration.

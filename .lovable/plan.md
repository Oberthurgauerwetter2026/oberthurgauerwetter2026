## Modell-Setup verschlanken

Ziel: Weniger Modell-Mittelung, klarere Signale. ICON-D2 (DWD) komplett raus, Globalmodelle (GFS, ECMWF) nur noch im Trend Tag 6–10.

### Neue Modell-Tiers (in `app_settings`)

| Tier | Tage | Modelle |
|------|------|---------|
| Kurzfrist | 0–2 | `meteoswiss_icon_ch1`, `meteoswiss_icon_ch2`, `meteofrance_arome_france_hd` |
| Mittelfrist | 3–5 | `meteoswiss_icon_ch2`, `arpege_europe` |
| Langfrist / Trend | 6–10 | `ecmwf_ifs025`, `gfs_global` |

Änderungen gegenüber heute:
- `icon_d2` aus Kurzfrist **und** Mittelfrist entfernt
- `ecmwf_ifs025` + `gfs_global` aus Mittelfrist entfernt → nur noch Tag 6–10
- Kurzfrist auf reine CH-/HD-Modelle reduziert (3 Modelle statt 4)
- Mittelfrist nur noch 2 Modelle (ICON-CH2 + ARPEGE)

### Umsetzung

1. **Migration** (`app_settings` Defaults aktualisieren):
   ```sql
   UPDATE app_settings SET
     models_shortterm = 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd',
     models_midterm   = 'meteoswiss_icon_ch2,arpege_europe',
     models_longterm  = 'ecmwf_ifs025,gfs_global';
   ```
   Plus neue Spalten-Defaults via `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...` für künftige Resets.

2. **Settings-UI** (`src/routes/_app.settings.tsx`): Hilfetexte / Default-Hinweise an die neuen Listen anpassen, falls dort Beispielwerte stehen.

3. **Keine Code-Änderungen** in `forecast.functions.ts` nötig — die Tier-Logik liest die Modelle dynamisch aus `app_settings`.

### Auswirkungen

- **Kurzfrist (Tag 0–2):** schärfere CH-Auflösung, weniger Glättung durch grobes ICON-D2.
- **Mittelfrist (Tag 3–5):** nur ICON-CH2 + ARPEGE — Spread-Klassifizierung („Unsicherheit") wird häufiger `high` ausweisen, weil nur 2 Modelle. → Empfehlung: **Ensemble (#12, P10/P50/P90)** als Stabilisator hier wichtig.
- **Trend Tag 6–10:** unverändert ECMWF + GFS.

### Validierung

- Neue Prognose generieren, im `weather_data`-Debug prüfen dass `byModel` für Mittwoch nur noch ICON-CH2 + ARPEGE enthält.
- Stichprobe Trend Tag 6–10: nur ECMWF + GFS.
## Ziel

- `arpege_europe` (Météo-France) zum **Mittelfrist-Set** hinzufügen
- `icon_eu` (DWD) **aus allen drei Sets** (Kurz-, Mittel-, Langfrist) entfernen

## Neue Modell-Konfiguration

| Set | Vorher | Nachher |
|---|---|---|
| `models_shortterm` | meteoswiss_icon_ch1, meteoswiss_icon_ch2, meteofrance_arome_france_hd, icon_d2 | meteoswiss_icon_ch1, meteoswiss_icon_ch2, meteofrance_arome_france_hd, icon_d2 *(unverändert — kein icon_eu drin)* |
| `models_midterm` | meteoswiss_icon_ch2, icon_d2, **icon_eu**, ecmwf_ifs025 | meteoswiss_icon_ch2, icon_d2, ecmwf_ifs025, **arpege_europe** |
| `models_longterm` | ecmwf_ifs025, gfs_global | ecmwf_ifs025, gfs_global *(unverändert — kein icon_eu drin)* |

Hinweis: `icon_eu` ist aktuell nur im Mittelfrist-Set vorhanden — die Entfernung "überall" betrifft also faktisch nur dieses Set, plus eine Code-Prüfung, dass `icon_eu` nirgendwo hartkodiert referenziert wird.

## Änderungen

### 1. Defaults in der DB anpassen

Migration auf `app_settings`: Spalten-Defaults für `models_midterm` aktualisieren auf:
```
meteoswiss_icon_ch2,icon_d2,ecmwf_ifs025,arpege_europe
```

### 2. Bestehenden Datensatz aktualisieren

Per Insert/Update-Tool den aktuellen Wert in `app_settings.models_midterm` auf den neuen String setzen, damit die Änderung sofort wirksam wird (nicht nur für neue Settings).

### 3. Code-Prüfung in `forecast.functions.ts`

- Sicherstellen, dass `arpege_europe` als gültiger Open-Meteo-Modellname akzeptiert wird (Whitelist / Mapping prüfen, ggf. ergänzen).
- Suche nach hartkodierten `icon_eu`-Referenzen (Fallbacks, Debug-Logs, Modell-spezifische Sonderlogik) und entfernen, falls vorhanden.
- Ensemble-Gewichte (`tag1_weight_*`) bleiben unverändert — das Mittelfrist-Set hat weiterhin 4 Modelle.

### 4. UI in `/settings`

Falls die Modell-Sets als Multi-Select dargestellt werden:
- `arpege_europe` (Label: "ARPEGE Europe (Météo-France)") zur Auswahl hinzufügen
- `icon_eu` darf in der Auswahl bleiben (für manuelle Re-Aktivierung), aber Default-State entsprechend neu

## Validierung

Nach Deployment einen Mittelfrist-Tag (z.B. Tag 3) neu generieren und in `weather_data` prüfen, dass:
- `arpege_europe` als beigetragenes Modell auftaucht
- `icon_eu` nicht mehr im Ensemble vorkommt

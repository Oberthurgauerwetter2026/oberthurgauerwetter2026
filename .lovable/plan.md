## Ziel

`gfs_global` zum **Mittelfrist-Set** hinzufügen, aber mit **reduziertem Gewicht** (0.5) gegenüber den hochauflösenden europäischen Modellen (Gewicht 1.0). Damit fliesst GFS als unabhängiger US-Gegenpol ins Ensemble ein, dominiert aber nicht die feinen Voralpen-Details, in denen es zu grob auflöst.

## Neue Modell-Konfiguration

| Set | Vorher | Nachher |
|---|---|---|
| `models_shortterm` | meteoswiss_icon_ch1, meteoswiss_icon_ch2, meteofrance_arome_france_hd, icon_d2 | *(unverändert)* |
| `models_midterm` | meteoswiss_icon_ch2, icon_d2, ecmwf_ifs025, arpege_europe | meteoswiss_icon_ch2, icon_d2, ecmwf_ifs025, arpege_europe, **gfs_global** |
| `models_longterm` | ecmwf_ifs025, gfs_global | *(unverändert)* |

## Modell-Gewichtung (neu)

Statt einfachem arithmetischem Mittel über alle Ensemble-Mitglieder wird ein **gewichteter Mittelwert** verwendet. Standard-Gewichte:

| Modell | Gewicht | Begründung |
|---|---|---|
| meteoswiss_icon_ch1 / ch2 | 1.0 | Lokale Hochauflösung Schweiz |
| meteofrance_arome_france_hd | 1.0 | Hochauflösung Westalpen |
| icon_d2 | 1.0 | Hochauflösung DACH |
| ecmwf_ifs025 | 1.0 | Globaler Goldstandard |
| arpege_europe | 1.0 | Europäisches Modell |
| **gfs_global** | **0.5** | Globales US-Modell, grob im Voralpenraum |

Gewichte gelten für `t`, `precip`, `cloud`, `sunshine`, `wind` etc. — überall, wo aktuell `aggregate(perModel)` einfaches Mittel bildet.

## Änderungen

### 1. DB-Migration
Default für `app_settings.models_midterm`:
```
meteoswiss_icon_ch2,icon_d2,ecmwf_ifs025,arpege_europe,gfs_global
```

### 2. Bestehender Datensatz
Per Update-Tool den aktuellen `models_midterm`-Wert auf den neuen String setzen.

### 3. Code-Defaults
In `src/server/forecast.functions.ts`, `src/server/forecast.auto.ts`, `src/routes/_app.settings.tsx` den Mittelfrist-Default auf den neuen 5-Modell-String aktualisieren.

### 4. Gewichtete Aggregation
In `src/server/forecast.functions.ts`:

- Konstante `MODEL_WEIGHTS: Record<string, number>` einführen mit GFS = 0.5, alle anderen = 1.0 (Default 1.0 für unbekannte Modelle).
- Funktion `aggregate(perModel)` (Zeile 814) so erweitern, dass `avg` als gewichtetes Mittel berechnet wird:
  ```
  avg = Σ(value_i * weight_i) / Σ(weight_i)
  ```
- `min`, `max`, `spread`, `by_model` bleiben unverändert (informativ, kein Gewicht).
- Optional: gleiche Gewichtung in `aggregateHourly`/Tagesverlaufs-Aggregation (Niederschlag pro Stunde, Wolken pro Stunde) anwenden, damit der Tagesverlauf konsistent bleibt.

### 5. UI / Labels
Keine Änderung — `gfs_global` ist im Label-Mapping bereits vorhanden (wird im Langfrist-Set genutzt).

## Validierung

Tag 3–5 neu generieren und prüfen:
- `by_model` enthält `gfs_global` mit eigenem Wert
- `avg` liegt erkennbar näher bei den 4 europäischen Modellen als bei einem 5er-Gleichmittel
- `spread` macht IFS↔GFS-Divergenzen sichtbar (Unsicherheits-Signal)
- Tagesverlauf (Niederschlag / Bewölkung) bleibt sauber aufgelöst

## Optional / später

Falls gewünscht, lassen sich die Modell-Gewichte später in `app_settings` als JSON-Spalte editierbar machen. Für diesen Plan bleiben sie hartkodiert in `forecast.functions.ts`.

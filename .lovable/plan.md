## Tag-1 ebenfalls als konfigurierbaren MOSMIX/Open-Meteo-Mix

Aktuell ist Tag 1 fix: Open-Meteo führt, MOSMIX nur als Referenz (`mosmix_reference`). Für Tag 0 gibt es bereits den gewichteten Mix (`mixOmWithMosmix`) plus zwei DB-Spalten und (frisch) zwei UI-Slider. Wir erweitern dasselbe Muster auf Tag 1.

### Änderungen

**1. DB-Migration**
- `app_settings` erweitern um:
  - `tag1_weight_mosmix int not null default 50`
  - `tag1_weight_om int not null default 50`
- Default 50/50 als neutrale Ausgangslage für Tag 1 (MOSMIX hat dort traditionell mehr Gewicht als heute, Open-Meteo-Modelle bleiben aber stark).

**2. `src/server/forecast.functions.ts`**
- Beide `buildDay` / `withTopo`-Stellen (Zeilen ~1462–1488 und ~1639–1675):
  - Werte einlesen: `tag1WMosmix`, `tag1WOm` (mit Clamp 0–100, Default 50/50).
  - Im `dayIndex === 1`-Zweig statt nur `mosmix_reference` jetzt `base = mixOmWithMosmix(omDay, mosmixDay, tag1WMosmix, tag1WOm)` aufrufen — analog zu Tag 0.
  - `mosmix_reference` für Tag 1 entfällt (Mix übernimmt die Werte; `mix_weights` wird sichtbar).
- Bias-Korrektur greift weiterhin auf allen Tagen.
- Nowcast/Radar bleibt unverändert (Tag 0 only für Nowcast).
- Zod-Schema in `updateSettings` ergänzen:
  - `tag1_weight_mosmix: z.number().int().min(0).max(100).optional()`
  - `tag1_weight_om: z.number().int().min(0).max(100).optional()`

**3. `src/routes/_app.settings.tsx`**
- Form-State + `load()` um `tag1_weight_mosmix` (50) und `tag1_weight_om` (50) erweitern.
- Im MOSMIX-Card-Block direkt unter den Tag-0-Slidern zwei weitere Slider 0–100 % einfügen:
  - "Tag 1 — Gewicht MOSMIX (%)"
  - "Tag 1 — Gewicht Open-Meteo Modelle (%)"
  - Hinweistext: "Default 50/50. Tag 1 mischt MOSMIX-Stationsensemble (10935/10929) mit Open-Meteo-Modellen (ICON-EU, ICON-D2, IFS …). Stations-Bias und Bias-Korrektur wirken zusätzlich. Nowcast/Radar greift nur Tag 0."
  - Live-Anzeige der normalisierten Aufteilung.

**4. `src/components/WeatherDataView.tsx`**
- Das bereits vorhandene `mix_weights`-Badge zeigt automatisch auch für Tag 1 den Mix-Anteil (kein zusätzlicher Code nötig, ggf. nur Label "Tag 0/1 Mix" generischer).
- `MosmixReferenceBlock` für Tag 1 nicht mehr separat anzeigen (Werte sind jetzt im Mix), oder weiterhin als reine Referenz behalten — Empfehlung: weglassen, da redundant.

### Erwartetes Verhalten

Tag 0 und Tag 1 sind jeweils unabhängig regelbar: 4 Slider in `/settings` (Tag 0: 40/60 default, Tag 1: 50/50 default). Höheres MOSMIX-Gewicht = stärker DWD-Stationsensemble; höheres OM-Gewicht = stärker hochauflösende Modelle. Tag 2+ bleibt wie bisher reines Open-Meteo + Bias.


# Prognose-Präzisierung: Radar-Nowcast, Höhenwind/Hochnebel, Ensemble-Spread

Drei aufeinander aufbauende Layer in `src/server/forecast.functions.ts`. Räumliches Ziel bleibt der Oberthurgau-Perimeter (Horn–Münsterlingen–Erlen–Hauptwil-Gottshaus–Roggwil). Alle Layer sind **fail-soft**: wenn Daten fehlen, wird der Layer stillschweigend übersprungen.

## Ausgangslage (was bereits da ist)

- Radar-Modul (`radar.server.ts`) ist voll implementiert und liefert für Tag 0 bereits eine Niederschlags-Tageskorrektur
- **Aber**: Nowcast (nächste 2 h) und Radar-Beobachtung (letzte 3 h) sind im Code als `out.radar_now` verfügbar, werden aber **noch nicht in den KI-Prompt eingespielt**. Genau hier sitzt der grösste ungenutzte Hebel.
- Föhn-Layer + Multi-Modell-Voting + SMN-Bias funktionieren bereits

---

## Layer 1 — Radar-Nowcast im Prompt (heute/morgen, höchster Impact)

**Ziel**: Aussagen wie *"Aktuell zieht ein Schauer durch (1.2 mm in der letzten Stunde gemessen), in den nächsten 2 h sind weitere 0.8 mm zu erwarten"* statt vager Modellprosa.

**Umsetzung**:
1. Neuer Helper `formatRadarNowHint(radar: RadarSnapshot)`, formuliert in 1–3 Sätzen:
   - aktueller Status (trocken / Schauer aktiv / Niederschlag im Anzug)
   - Vergleich Beobachtung vs. Modellerwartung (zeigt Modellfehler)
   - Nowcast-Tendenz nächste 2 h
2. Block `=== AKTUELLER RADAR (Nowcast) ===` in den System-Prompt einfügen — **nur** für `firstEntry` (heute) und Tag 1 (morgen, falls Nowcast in Spätnachmittag/Abend reinspielt). Tage 2–10 ignorieren Radar.
3. Prompt-Direktive: *"Diese Radar-Beobachtung hat Vorrang vor der Modellprognose für die nächsten 2–3 h. Erwähne sie nur, wenn sie eine konkrete Aussage erlaubt (Schauer aktiv, Front im Anzug); bei trockener Lage nicht erwähnen."*
4. An allen 6 Prompt-Stellen einbinden (generate + regenerate, je 3× firstEntry/day/trend), aber nur firstEntry/Tag 1 erhalten den Block

**Aufwand**: ~80 Zeilen, 0 zusätzliche API-Calls (Daten existieren bereits)

---

## Layer 2 — Höhenwind & Hochnebel-Layer (Winter-Killer)

**Ziel**: Inversionserkennung + verlässliche Hochnebel-Persistenz-Aussagen + frühere Föhn-Vorboten.

**Umsetzung**:
1. Open-Meteo-Calls erweitern um **hourly**-Variablen (gleiche Calls, nur mehr Felder):
   - `temperature_850hPa` → Inversionsdetektion (Bodentemperatur vs. 850 hPa: Δ < normale Lapse-Rate ≈ Inversion)
   - `wind_speed_700hPa`, `wind_direction_700hPa` → Föhn-Frühindikator (Süd 12+ h vor Bodenwind-Drehung)
   - `geopotential_height_500hPa` → Trog/Rücken-Klassifikation
   - `cloudcover_low` (zusätzlich zum bestehenden cloudcover) → Hochnebel-Indikator
2. Helper `formatInversionHint(modelData)`:
   - Trigger Hochnebel-Persistenz: `cloudcover_low ≥ 80%` + Inversion (T_850hPa > T_2m + 2°C) + Wind < 10 km/h
   - Stufen: "zähe Hochnebeldecke", "Hochnebel mit Auflösungstendenz am Nachmittag", "Nebelgrenze um ~XXX m"
   - Nebelgrenze grob aus T_850hPa + Standardatmosphäre ableitbar
3. Helper `formatFoehnPrecursorHint(modelData)`:
   - 700 hPa Süd 130–200° + ≥ 30 kt → Föhn wahrscheinlich in 6–18 h (auch wenn Bodenwind noch nicht dreht)
   - Ergänzt bestehende `formatFoehnHint`-Logik für Tag 1–3
4. Neue Prompt-Blöcke `=== HOCHNEBEL/INVERSION ===` und Erweiterung des bestehenden `=== FÖHN-HINWEIS ===` um den Höhenwind-Vorlauf

**Aufwand**: ~250 Zeilen, 0 zusätzliche API-Calls (gleiche Endpoints, mehr Variablen)

---

## Layer 3 — Ensemble-Spread für Unsicherheit (Tag 4–10)

**Ziel**: Ehrliche Trend-Aussagen mit quantifizierter Unsicherheit. *"Tmax 22°C ± 4°C, Szenarien spreizen zwischen Hochdrucklage und Trogdurchgang"* statt falscher Punktgenauigkeit.

**Umsetzung**:
1. Zusätzlicher Open-Meteo-Call gegen Ensemble-Endpoints: `icon_eps` (40 Member) + `ecmwf_ifs025_ensemble` (51 Member). Variablen: `temperature_2m_max`, `precipitation_sum`, `wind_speed_10m_max`. Nur **daily**, nur Tag 4–10 (Tag 0–3 sind deterministische Modelle besser).
2. Aggregation pro Tag: Median, P10, P90, Standardabweichung
3. Neue Felder in den Trend-Tagen:
   - `tmax_spread: { p10, median, p90, sigma }`
   - `precip_probability_ensemble` (Anteil Member mit > 1 mm)
4. Helper `formatUncertaintyHint(day)`:
   - σ < 1.5°C → "verlässlicher Trend"
   - σ 1.5–3°C → "Trend mit moderater Unsicherheit"
   - σ > 3°C → "hohe Unsicherheit, mehrere Wetterszenarien möglich"
   - Bei bimodaler Niederschlagsverteilung (z.B. 40% Member trocken, 40% > 5 mm): explizit "zwei Szenarien"
5. Prompt-Block `=== UNSICHERHEIT (Ensemble) ===` nur für Trend-Generation (Tage 4–10)
6. Caching: 1 h TTL (Ensembles laufen 4× täglich)

**Aufwand**: ~300 Zeilen, **+1 API-Call pro Forecast-Run** (cachebar)

---

## Reihenfolge & Risiko

1. **Layer 1 zuerst** — niedrigster Aufwand, sofort spürbar in Heute-Prognose
2. **Layer 2** — Mittelfristig grösster Qualitätssprung im Winter
3. **Layer 3** — Saubere Erweiterung, nur Trend-Bereich betroffen, einfach zurückrollbar

Alle Layer:
- ändern **keine** bestehenden Pfade/Outputs (nur Erweiterungen)
- haben **fail-soft** Pfade (fehlende Daten → Layer wird übersprungen, Prognose läuft normal weiter)
- erfordern **keine** DB- oder Schema-Änderungen
- erfordern **keine** neuen Secrets/Connectoren

## Technische Stellen (für Umsetzung)

- `src/server/forecast.functions.ts` Z. 174 (`generateTextNominal`), Z. 1613 (`generateText`), Z. 1779 (`FÖHN-HINWEIS`-Block) — analoge Prompt-Injection
- `src/server/forecast.functions.ts` Z. 1858/1991 — bereits Radar-Fetch-Stellen, hier die neuen Datenfelder anhängen
- Neuer Helper-File optional: `src/server/uncertainty.server.ts` für Layer 3 (analog `radar.server.ts`)
- Settings-Schema (Z. 2276+): optionale Toggles `inversion_enabled`, `ensemble_enabled` (Default true)

## Was NICHT Teil dieses Plans ist

- Blitzortung-Integration (separater Layer, später)
- Bodensee-Wassertemperatur (separater Layer)
- Verifikations-Loop / Prognose-Tracking (eigener grösserer Plan)
- Multi-Punkt-Abfragen Amriswil/Horn (vorher abgelehnt)


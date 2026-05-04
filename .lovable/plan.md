# Föhn-Layer + Präzisierungs-Layer 1-3 (umgesetzt)

Räumlich strikt auf den Oberthurgau-Perimeter beschränkt: Horn – Münsterlingen – Erlen – Hauptwil-Gottshaus – Roggwil – Horn. Rheintal und Steckborn werden im Prompt explizit ausgeschlossen.

## Föhn-Layer

Föhn-Erkennung aus Modelldaten: Süd-Wind 130–200° + Wind ≥ 25 km/h oder Böen ≥ 45 km/h + Tmax mind. 4 °C über Klima + Niederschlag < 1.5 mm. Stärke-Stufen schwach/kräftig/Föhnsturm/schwerer Föhnsturm. Tagesgang via `diurnalFoehnPeak` (3 Fenster), Föhnabbruch-Erkennung (Böen-Drop + rH-Anstieg). Trend-Helper für Tage 6–10. Räumliche Differenzierung im Perimeter, explizites Verbot von Rheintal/Vaduz/Steckborn/westl. Bodensee/Frauenfeld/Konstanz/Kreuzlingen.

## Layer 1 — Radar-Nowcast im Prompt

Helper `formatRadarNowHint` formuliert aktuellen Radar-Status für den KI-Prompt:
- aktuell Niederschlag aktiv (mm/h, mm/3h)
- Nowcast nächste 2 h
- Modell-Über-/Unterschätzung
Wird nur bei firstEntry und Tag 1 in den Prompt eingespeist. System-Prompt-Block `=== AKTUELLER RADAR (Nowcast) ===` erklärt der KI den Vorrang vor Modellprognose für die nächsten 2-3 h. 0 zusätzliche API-Calls (Daten kamen schon aus `radar.server.ts`).

## Layer 2 — Hochnebel / Inversion / Höhenwind

Hourly-Variablen erweitert: `cloudcover_low`, `temperature_850hPa`, `wind_speed_700hPa`, `wind_direction_700hPa`, `geopotential_height_500hPa`. Helper `formatInversionHint` erkennt Hochnebellagen (cloudcover_low ≥ 80% morgens + Inversion T_850 > T_2m − 2°C + windschwach), schätzt Nebelobergrenze ab und beschreibt Auflösungstendenz. Trend-Variante `formatInversionTrendHint` zählt mehrtägige Lagen. System-Prompt-Block `=== HOCHNEBEL / INVERSION ===`. 0 zusätzliche API-Calls.

## Layer 3 — Ensemble-Spread (Tag 6–10)

Neues Modul `src/server/uncertainty.server.ts`: holt Open-Meteo Ensemble (icon_seamless + ecmwf_ifs025), berechnet pro Tag P10/Median/P90/Sigma für Tmax und Niederschlagswahrscheinlichkeit (% Member > 1 mm). Erkennt bimodale Verteilungen (gleichzeitig ≥30% trocken und ≥30% nass). Helper `formatUncertaintyHint` leitet qualitative Stufe ab: "verlässlicher Trend" / "moderate Unsicherheit" / "hohe Unsicherheit, mehrere Szenarien möglich". Wird nur im Trend-Prompt (Tag 6-10) eingespielt. System-Prompt-Block `=== UNSICHERHEIT (Ensemble) ===`. +1 cachebarer API-Call (1h TTL).

## Prompt-Injection

Alle Layer an allen 6 Stellen (generate + regenerate, je 3× firstEntry/day/trend) eingebunden, mit korrekter Layer-Zuordnung (Radar nur Tag 0/1, Inversion alle Tage, Ensemble nur Trend).

Fail-soft an allen Stellen.


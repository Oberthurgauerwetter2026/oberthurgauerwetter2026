# Föhn-Layer (umgesetzt)

Föhn-Erkennung aus Modelldaten in `src/server/forecast.functions.ts`. Räumlich strikt auf den Oberthurgau-Perimeter beschränkt: Horn – Münsterlingen – Erlen – Hauptwil-Gottshaus – Roggwil – Horn. Rheintal und Steckborn werden im Prompt explizit ausgeschlossen.

## Was umgesetzt wurde

1. **Variablen erweitert**: `wind_gusts_10m_max` (daily), `wind_gusts_10m` und `relative_humidity_2m` (hourly).
2. **Klima-Mittel**: `OBERTHURGAU_TMAX_CLIMATOLOGY_C` (12 Monatswerte Romanshorn/Arbon).
3. **Helper `formatFoehnHint`**: Trigger Süd-Wind 130–200° + Wind ≥ 25 km/h oder Böen ≥ 45 km/h + Tmax mind. 4 °C über Klima + Niederschlag < 1.5 mm. Stärke-Stufen schwach/kräftig/Föhnsturm/schwerer Föhnsturm.
4. **Tagesgang via `diurnalFoehnPeak`**: 3 Fenster (06–12, 12–18, 18–24), Föhnabbruch-Erkennung (Böen-Drop + rH-Anstieg).
5. **Trend-Helper `formatFoehnTrendHint`**: Tage 6–10.
6. **System-Prompt-Block FÖHN-HINWEIS**: räumliche Differenzierung im Perimeter, explizites Verbot von Rheintal/Vaduz/Steckborn/westl. Bodensee/Frauenfeld/Konstanz/Kreuzlingen.
7. **Prompt-Injection** an allen 6 Stellen (generate + regenerate, je 3× firstEntry/day/trend).

0 zusätzliche API-Calls. Fail-soft bei Modellen ohne Variablen.

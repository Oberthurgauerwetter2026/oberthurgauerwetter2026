## Fix: „Heute Abend & Nacht" – Wetterdaten lassen sich nicht öffnen

**Ursache:** Der erste Eintrag (Day 0) speichert Wetterdaten im flachen Format (`tmax: 12.3, by_model: { icon_d2: { tmax, ... } }`). `WeatherDataView` erkennt keine Top-Level-Aggregate und springt fälschlich in den „nested sections"-Zweig, wodurch nichts gerendert wird. `flatToAggs()` würde das Format umwandeln, wird aber nie erreicht.

### Änderung

`src/components/WeatherDataView.tsx`, in der `WeatherDataView`-Hauptfunktion:

Vor dem „nested sections"-Branch prüfen, ob `flatToAggs(data)` ein Ergebnis liefert. Falls ja → direkt `<DayTable data={data} />` rendern. `DayTable` ruft intern bereits `flatToAggs` auf und zeigt dann die komplette Tabelle inkl. Modellen, Spread, Topographie und Wind-Regime.

Eine Stelle, ~3 Zeilen Code.

### Ergebnis

Der erste Forecast-Eintrag zeigt seine Wetterdaten genau wie die Folgetage (Tmax/Tmin/Niederschlag/Wind/Bewölkung pro Modell + Topographie-Block).

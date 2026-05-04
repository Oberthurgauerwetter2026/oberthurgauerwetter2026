## Ziel

Föhn als eigenständigen Wetterlagen-Layer in den Prompt einbauen — analog zu CAPE/Gewitter, AIFS und Bodensee. Bedingt: erscheint nur, wenn Modelle eine Föhnlage zeigen. **Räumlich strikt auf den Oberthurgau beschränkt** (Perimeter: Horn – Münsterlingen – Erlen – Hauptwil-Gottshaus – Roggwil – Horn). Rheintal, Steckborn und westlicher Bodensee werden im Prompt nicht erwähnt.

Implementierung in `src/server/forecast.functions.ts`. Keine zusätzlichen API-Calls, keine DB-Änderung, keine Settings.

## Geografische Differenzierung (statisch im Prompt)

Innerhalb des Oberthurgau-Perimeters:
- **Östliche Seeufer-Zone** (Horn, Arbon, Steinach Richtung Rorschacher Bucht, Roggwil): Föhn am stärksten spürbar, höchste Böen, deutlichste Erwärmung und Austrocknung.
- **Mittlere Seezone** (Egnach, Romanshorn, Uttwil, Kesswil): noch klar föhnig, etwas abgeschwächt gegenüber Osten.
- **Westliche Seezone** (Altnau, Münsterlingen): Föhn nur noch schwach spürbar, oft ohne markante Böen.
- **Hinterland** (Erlen, Sulgen-Umgebung, Hauptwil-Gottshaus, Amriswil-Hinterland): Föhn meist abgeschirmt, nur milde, trockene Südströmung ohne starke Böen.

Diese Differenzierung wird im System-Prompt als statischer Text hinterlegt — die LLM kombiniert sie automatisch mit dem dynamischen Föhn-Hinweis. Orte ausserhalb des Perimeters (Rheintal, Steckborn, Frauenfeld, Konstanz, Kreuzlingen) werden nie genannt.

## Umsetzung

### 1. Variablen erweitern

Bereits vorhanden: `winddirection_10m_dominant`, `windspeed_10m_max`, `temperature_2m_max`, `windspeed_10m`, `winddirection_10m`, `temperature_2m`.

Ergänzen:
- `DAILY_VARS`: `wind_gusts_10m_max` (Böen-Maximum, wichtig für Föhnsturm)
- `HOURLY_VARS`: `wind_gusts_10m`, `relative_humidity_2m` (Föhn = sehr trocken, oft <40 % rH)

### 2. Klima-Mittel Tmax pro Monat

Konstante `OBERTHURGAU_TMAX_CLIMATOLOGY_C` (Mittel Romanshorn/Arbon, 12 Werte Jan–Dez) als Referenz für die Wärmeüberschuss-Detektion. Approximierte Werte aus MeteoSchweiz-Normen, nachjustierbar.

### 3. Helper `formatFoehnHint(weather, day, dayIndex)`

Neuer Helper, parallel zu `formatThunderstormHint`. Returnt String oder `null`.

**Trigger (alle müssen erfüllt sein):**
- Dominante Windrichtung 130–200° (Süd bis Südwest)
- Wind ≥ 25 km/h (Mittel) **oder** Böen ≥ 45 km/h
- Tmax mindestens 4 °C über Klima-Monatsmittel
- Tagesniederschlag < 1.5 mm
- (Optional verstärkend) min. relative Feuchte < 55 %

**Stärke-Stufen (basierend auf max. Böen über Modelle, fallback Wind-Mittel):**

| Böen | Label |
|---|---|
| 45–60 km/h | "schwacher Föhneinfluss" |
| 60–80 km/h | "kräftiger Föhn" |
| 80–100 km/h | "Föhnsturm" |
| > 100 km/h | "schwerer Föhnsturm, lokal Schäden möglich" |

**Tagesgang (nur Tag 0–1, Hourly verfügbar):**
- Drei Fenster: 06–12, 12–18, 18–24
- Pro Fenster: max. Wind/Böen, min. rH
- "Föhnabbruch" erkennen: deutlicher Rückgang Wind + Anstieg rH zwischen Fenstern → Hinweis "Föhnabbruch im Verlauf des Nachmittags/Abends"
- Sonst: "Föhnfenster vor allem ${zeitfenster}"

**Räumliche Aussage im Hinweis (kompakt, statisch):**
> "Föhnwirkung im Oberthurgau am ausgeprägtesten an den östlichen Seeufern (Horn, Arbon, Roggwil), deutlich abgeschwächt im Hinterland (Erlen, Hauptwil-Gottshaus) und im westlichen Seebereich (Altnau, Münsterlingen)."

### 4. Helper `formatFoehnTrendHint(weather, days)`

Für Trend-Block Tag 6–10. Wenn ≥1 Tag Föhnkriterien erfüllt: kompakter Hinweis "im Trend-Zeitraum zeitweise föhnige Phasen mit milder, trockener Südströmung möglich". Sonst `null`.

### 5. System-Prompt-Erweiterung

Neuer Abschnitt nach GEWITTER-HINWEIS (~Zeile 1605):

```
=== FÖHN-HINWEIS ===
Wenn im User-Prompt ein Block 'Föhn-Hinweis' enthalten ist: Übernimm Stärke,
Tagesgang und räumliche Differenzierung sinngemäss in den Fliesstext.
Verwende Föhn-Vokabular: "föhnig mild", "sehr trocken", "kräftige Südböen",
"Föhnfenster", "Föhnabbruch", "Föhnsturm".

Prognose-Perimeter Oberthurgau: Horn – Münsterlingen – Erlen –
Hauptwil-Gottshaus – Roggwil – Horn. Räumliche Differenzierung INNERHALB
dieses Perimeters:
- Östliche Seeufer (Horn, Arbon, Roggwil): Föhn am stärksten
- Mittlere Seezone (Egnach, Romanshorn, Uttwil): klar föhnig, etwas
  abgeschwächt
- Westliche Seezone (Altnau, Münsterlingen): nur schwach
- Hinterland (Erlen, Hauptwil-Gottshaus, Amriswil-Hinterland): meist
  abgeschirmt

Orte AUSSERHALB des Perimeters NICHT erwähnen — insbesondere kein Rheintal,
kein Vaduz/Buchs, kein Steckborn, kein westlicher Bodensee, kein Frauenfeld,
kein Konstanz/Kreuzlingen. Bei Föhnsturm klar benennen. Wenn kein Block
vorhanden ist, KEINE Föhn-Aussagen.
```

### 6. Prompt-Injection

An allen 6 bestehenden Stellen (parallel zu `aifsBlock`, `lakeBlock`, `stormBlock`):

```ts
const foehnHint = formatFoehnHint(weather, day, dayIndex);
const foehnBlock = foehnHint ? `\n\nFöhn-Hinweis: ${foehnHint}` : "";
```

Im Template-String anhängen. Trend-Block analog mit `formatFoehnTrendHint`.

## Was nicht geändert wird

- Bestehende Multi-Modell-Aggregation, AIFS, Bodensee, CAPE/Gewitter, Topografie, MOSMIX, Radar, Settings-UI: unverändert.
- Keine Live-Validierung über SwissMetNet (Vaduz/Altenrhein) — bewusst Phase 2.
- Keine zusätzlichen Open-Meteo-Punkte für räumliche Differenzierung — erfolgt qualitativ über statischen Prompt-Text.

## Quota-/Performance-Impact

- 0 zusätzliche externe Requests. Neue Variablen werden in den bestehenden Multi-Modell-Calls mitgeliefert.
- JSON-Antwort ~5 % grösser, vernachlässigbar.
- Modelle ohne diese Variablen: `null`, `aggregate()` ignoriert — fail-soft.

## Akzeptanzkriterien

- Klassische Südföhnlage (SW-Wind 35 km/h, Böen 75 km/h, Tmax 18 °C im März, rH 35 %, kein Niederschlag): Hinweis "kräftiger Föhn, föhnig mild und trocken, Schwerpunkt östliche Seeufer Horn–Arbon–Roggwil, im Hinterland Erlen/Hauptwil-Gottshaus abgeschwächt".
- Föhnsturm mit Abbruch (Böen 95 km/h vormittags Tag 0, danach NW-Wind, Regen): Hinweis "Föhnsturm am Vormittag, Föhnabbruch im Verlauf des Tages".
- NW-Lage mit Bise: kein Föhn-Hinweis.
- Stabile Hochdrucklage windstill: kein Hinweis.
- Trend Tag 6–10 mit einem Föhn-Tag: knapper Trend-Hinweis.
- Im generierten Text werden Rheintal, Steckborn, Konstanz, Kreuzlingen, Frauenfeld nie genannt.

## Risiken

- **Falsch-positiv bei föhnähnlichen warmen SW-Lagen ohne echten Leeeffekt**: durch Kombination aller vier Trigger reduziert.
- **Klima-Mittel approximiert**: Schwellwert "+4 °C über Mittel" saisonal nachjustierbar.
- **Räumliche Differenzierung statisch**: bei untypischen Lagen nicht abbildbar. Akzeptiert für Phase 1.
- **AIFS/IFS unterschätzen Böen-Peaks gegenüber ICON-CH1**: Helper nimmt Maximum über Modelle, nicht Mittelwert.
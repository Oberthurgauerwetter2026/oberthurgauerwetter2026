# Schritt 2 — Beobachtungs-Overlay für Tag 0 im Stundenprofil

## Ziel

Für Tag 0 sollen die bereits **vergangenen Stunden** im `hourly_profile` nicht mehr aus dem Modell-Median, sondern aus realen Messungen kommen:

- **SMN** (Güttingen, St. Gallen, Tänikon): Temperatur, Niederschlag, Wind, Bewölkung pro Stunde
- **Radar** (Open-Meteo `meteoswiss_icon_ch1`, radar-assimiliert): Niederschlag der letzten 3 h und der nächsten ~2 h

Zusätzlich: weicher **Übergang** für die aktuelle und die nächste Stunde (kein Sprung zwischen Beobachtung und Modell).

Das Stundenprofil bekommt dadurch pro Stunde eine `source`-Kennzeichnung — der KI-Prompt nennt vergangene Stunden dann explizit als Beobachtung („gemessen 7,2 °C um 10 Uhr").

## Was sich konkret ändert

### A) `buildHourlyProfile` — Felder erweitern

Heute: `{ h, t, t_spread, p, p_spread, w, c, s, n_models }`

Neu pro Zeile zusätzlich:
- `source`: `"observed_smn"` | `"observed_radar"` | `"observed_blend"` | `"model_blend"` | `"model_median"`
- `confidence`: `0..1` (1 = reine Beobachtung, 0.5 = Übergang, 0.7–0.9 = Modell je nach Spread)

Bestehende Aggregat-Ableitung (`refineDayFromHour` via Open-Meteo-Hourly) bleibt unverändert; das neue Profil wird **on top** in `applyObservedOverlay` befüllt.

### B) Neuer Helper `applyObservedOverlay(profile, smn, radar, nowAt)`

Lebt entweder in `forecast.functions.ts` oder neu `src/server/observed-overlay.server.ts`.

Pro Stunde bis inkl. der „letzten vollen vergangenen Stunde":

1. **Temperatur, Wind, Bewölkung**: Mittel über die SMN-Stationen mit Wert für diese Stunde → ersetzt `t`, `w`, `c`. `t_spread` = max−min der Stationen (statt Modell-Spread). `source = "observed_smn"`, `confidence = 1`.
2. **Niederschlag**: bevorzugt **Radar-mm** (aus `radar.observed.hours[]` per ISO-Match), fallback SMN-`precip_mm`. `source = "observed_radar"` bzw. `"observed_smn"`. `p_spread` auf 0 setzen.
3. **Sonne (`s`)**: bleibt Modellwert (SMN liefert keine Sonnenscheindauer in unserem Setup) — markiert mit `source = "observed_blend"` falls Temp/Wind aus Beobachtung, sonst Modell.

Für die aktuelle Stunde + nächste Stunde:

4. **Smoothing**: linear blendet zwischen letzter Beobachtung und Modell-Median. `source = "model_blend"`, `confidence ≈ 0.6`.

Alle anderen Stunden bleiben Modell-Median wie bisher.

### C) Aufruf-Stellen

In `forecast.functions.ts` an den zwei Stellen wo Tag 0 verarbeitet wird (Zeile ~1766 ff. und ~1895 ff.):

- `nowcastInputs` (enthält bereits `smn` + `radar`) liegt schon vor.
- Direkt nach `applyNowcastToDay(out, nc)` zusätzlich:
  ```text
  if (out.hourly_profile && nowcastInputs) {
    out.hourly_profile = applyObservedOverlay(
      out.hourly_profile,
      nowcastInputs.smn,
      nowcastInputs.radar,
      new Date(),
    );
  }
  ```
- `formatHourlyProfileTable` erweitert die Tabelle um eine Spalte `Quelle` (`obs` / `mix` / `mod`), nur für Tag 0.

### D) KI-Prompt-Regel (additiv)

Im bestehenden `STUNDENPROFIL`-Block ergänzen:

> Stunden mit `Quelle = obs` sind reale Messungen (SwissMetNet / Radar). Diese Werte sind **verbindlich** und müssen im Text als „gemessen" / „beobachtet" beschrieben werden, nicht als Modellprognose. `Quelle = mix` ist ein Übergang Beobachtung→Modell für die aktuelle Stunde.

## Was *nicht* Teil dieses Schritts ist

- Stundenweiser Stations-Bias (Schritt 3 — kommt danach).
- Plausibilitätsfilter (Schritt 4).
- Tag 1 Overlay (per Definition keine Beobachtung verfügbar).
- Änderungen an den Tages-Aggregaten (`tmin/tmax/precip_sum/...`) — die kommen weiterhin aus dem bisherigen Multi-Modell-Pfad. Der Effekt landet zunächst nur im Stundenprofil und damit im Prosa-Text der KI.

## Risiken / Hinweise

- **SMN-Stunden sind UTC**, das Profil läuft in lokaler Zeit (Europa/Zürich). Beim Match exakt mit ISO-String der jeweiligen Profilstunde (lokal → UTC umrechnen) abgleichen, sonst verschieben sich die Werte um 1 h.
- **Radar-Niederschlag** deckt nur ~3 h vergangen ab. Stunden davor bekommen `precip` aus SMN; SMN-`rre150h0` ist 1-h-Summe, passt direkt.
- **Bewölkung in Achteln** (SMN) ist nicht überall verfügbar — bei `null` Modellwert behalten.
- **Konsistenz mit Aggregat**: Wenn SMN heute deutlich kühler war als das Tagesmodell-tmin, kann der Profil-Min unter dem Aggregat-tmin liegen. Das ist erwünscht und beabsichtigt — die KI darf den niedrigeren Profil-Wert bevorzugen.

## Reihenfolge der Implementierung

1. Helper `applyObservedOverlay` + Erweiterung von `buildHourlyProfile`-Rückgabe um `source`/`confidence`.
2. `formatHourlyProfileTable` mit Quelle-Spalte.
3. Aufruf an beiden Tag-0-Stellen einbauen.
4. Prompt-Regel ergänzen.
5. Eine Prognose generieren und Tag-0-Text gegen die SMN-Realität prüfen.

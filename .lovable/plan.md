## Ziel

Verhindern, dass die KI Tage als „recht sonnig" beschreibt, wenn die Modelle klar auf Schauer/Bedeckung deuten — wie bei So 10.5. (cloudcover 89 %, precip_prob 79 %, weathercode 57, CAPE 230, aber im Text „rasche Auflösung, danach recht sonnig").

## Ursachen (am Beispiel 10.5. verifiziert)

1. `sky_label` und `sky_pattern` sind im `weather_data` `null` — die KI hat keine harte Vorgabe.
2. `isClearSkyDay()` ist sehr eng (nur „Sonnig und wolkenlos" bei cloud≤5 % UND sun≥10h) und liefert sonst gar nichts.
3. Der Sky-Prompt erlaubt der KI, allein aus `sunshine_h` (5.8 h ≈ „wechselnd bewölkt") eine sonnige Erzählung zu basteln, obwohl `cloudcover.avg = 89`, `precip_prob = 79 %`, `weathercode = 57` und `thunderstorm = isolated` deutlich dagegen sprechen.

## (a) Deterministische Himmels-Klassifikation für ALLE Tage

In `src/server/forecast.functions.ts` neue Helper `classifySky(day)` einführen, die immer ein `sky_label` (Text) **und** ein `sky_pattern` (Enum) liefert. Klassifikation in dieser Reihenfolge:

| Bedingung | sky_pattern | sky_label |
|---|---|---|
| cloud ≤ 5 % UND sun ≥ 10h | `sonnig_klar` | „Sonnig und wolkenlos" |
| Nebel-Auflösung erkannt (bestehende Logik, nur Tag 0/1) | `nebel_aufloesung` | „Morgens Nebel-/Hochnebelfelder, im Tagesverlauf Auflösung, am Nachmittag sonnig" |
| weathercode ≥ 80 ODER (precip_prob ≥ 70 % UND weathercode ≥ 60) | `schauer_dominant` | „Stark bewölkt mit Schauern" (+ „und Gewitterneigung" wenn `thunderstorm.class != "none"`) |
| precip_prob ≥ 60 % UND weathercode ≥ 51 | `regnerisch_bewoelkt` | „Stark bewölkt mit zeitweisem Regen" |
| cloud ≥ 80 % UND sun ≤ 4h | `bedeckt` | „Stark bewölkt bis bedeckt" |
| cloud ≥ 60 % ODER sun < 4h | `wechselnd_bewoelkt` | „Wechselnd bewölkt" |
| sun ≥ 8h UND cloud ≤ 30 % | `ueberwiegend_sonnig` | „Ziemlich sonnig" |
| sonst | `heiter_bis_wolkig` | „Heiter bis wolkig" |

Die bestehende Nebel-Auflösung-Erkennung (`detectFogDissipation`) bleibt für Tag 0/1 als Sonderfall erhalten und überschreibt die obige Tabelle.

`buildDay` (ca. Zeile 1674, 1704, 1711) wird so umgestellt, dass `sky_label` und `sky_pattern` IMMER (auch Tag 2+) gesetzt werden — nicht nur bei Klar oder Nebel.

## (b) Sky-Prompt härten

`DEFAULT_SKY_RULES` (ab Zeile 2182) erweitern um harte Verbote und eine klare Hierarchie:

1. **Höchste Priorität:** Wenn `sky_label` gesetzt ist → wörtlich übernehmen (gilt schon, wird verstärkt).
2. **Verbots-Klausel:** Wenn `precip_prob.avg ≥ 60` ODER `weathercode.avg ≥ 51` ODER `sky_pattern ∈ {schauer_dominant, regnerisch_bewoelkt, bedeckt}` → die Wörter „sonnig", „recht sonnig", „meist sonnig", „ziemlich sonnig", „heiter", „freundlich", „rasche Auflösung" sind ABSOLUT VERBOTEN. Erlaubt sind nur „sonnige Lücken", „Aufhellungen", „kurze trockene Phasen".
3. **Konsistenzregel:** Wenn `wind_gusts.class ∈ {strong, severe}` UND der Text die Phrase „in Schauernähe" enthält, MUSS der Hauptsatz Schauer/Regen erwähnen — Widersprüche wie „recht sonnig … in Schauernähe" sind verboten.
4. **Gewitter-Pflicht:** Wenn `thunderstorm.class ∈ {isolated, scattered, widespread}`, MUSS der Sky-Absatz „Gewitterneigung" / „lokale Gewitter" / „Gewitter" enthalten.
5. **Hierarchie der Datenfelder explizit:** `sky_label` > `sky_pattern` > `weathercode.avg` + `precip_prob.avg` > `cloudcover.avg` > `sunshine_h.avg`. `sunshine_h` darf NIE allein eine sonnige Beschreibung rechtfertigen, wenn `precip_prob.avg ≥ 50`.

## Technische Details

- Datei: `src/server/forecast.functions.ts`
- Neue Funktion `classifySky(day): { sky_label: string; sky_pattern: string }` neben `isClearSkyDay` (Zeile 163).
- `isClearSkyDay` bleibt als Spezialfall erhalten (in `classifySky` gekapselt) — Aufrufer in Zeile 238 und 2302 unverändert.
- `buildDay` Rückgabeobjekt: `sky_label` und `sky_pattern` werden immer aus `classifySky` befüllt; Nebel-Auflösung überschreibt `sky_pattern` für Tag 0/1.
- `DEFAULT_SKY_RULES`: 5 neue Pflicht-/Verbots-Klauseln am Anfang einfügen, vor den bestehenden Regeln.
- Keine DB-Migration, kein Settings-Update nötig — die neuen Regeln greifen automatisch, weil bestehende Settings den Standard-Prompt verwenden.
- Bestehende Forecasts werden NICHT neu generiert; nur die nächste Generierung profitiert.

## Validierung

- Neuen Forecast für 10.5. generieren → Erwartung: erster Sky-Satz beschreibt Bedeckung + Schauer + Gewitterneigung, NICHT „rasche Auflösung, danach recht sonnig".
- Sonnige Tage (z.B. „klar/sonnig") aus dem aktuellen Forecast prüfen → keine Regression.

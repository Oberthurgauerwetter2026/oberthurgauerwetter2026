Ich habe geprüft: Der Eintrag wurde zwar um 12:16 neu gespeichert und enthält jetzt `sky_label = Stark bewölkt mit zeitweisem Regen und lokaler Gewitterneigung`, aber der sichtbare Text blieb alt. Ursache: Eine bestehende Nachbearbeitung (`buildDeterministicSkyParagraph`) überschreibt bei Tag 1 den KI-Text anhand des Stundenprofils und ignoriert dabei Niederschlagswahrscheinlichkeit, Weathercode, Gewitter und `sky_label`.

Plan:

1. `buildDeterministicSkyParagraph` absichern
   - Diese Funktion darf nur noch reine Nebel-/Hochnebel-Auflösung oder wirklich trockene sonnige Tagesgänge überschreiben.
   - Bei `precip_prob.avg >= 50`, `weathercode.avg >= 51`, relevantem Niederschlag oder `thunderstorm.class != none` darf sie keine sonnige Ersatzformulierung mehr setzen.
   - Wenn `sky_label` bereits ein Regen-/Schauer-/Gewittersignal enthält, bleibt dieses massgebend.

2. Tagesgang-Mischfälle ergänzen
   - Für Tag 0/1 aus dem Stundenprofil ableiten:
     - sonniger/trockener Vormittag + Gewitter/Regen am Nachmittag → Verlauf mit sonnigem Beginn und späterem Niederschlag.
     - bewölkter/nasser Tagesgang → regnerisch/schauer-dominant wie bisher.
   - Für Tag 2+ vorsichtig über Gewitterklasse, Peak-Hour, CAPE und Wetterregime ableiten.

3. Prompt-Pflichtregeln anpassen
   - `sonnig_dann_gewitter` und `sonnig_dann_regen` erlauben sonnigen Beginn ausdrücklich.
   - Pauschale Formulierungen wie „recht sonnig“ ohne Regen-/Gewitterhinweis bleiben verboten, wenn die Daten Regen/Gewitter zeigen.

4. Regeneration wirksam machen
   - `regenerateEntry` soll nicht nur den Text mit alter `weather_data` neu formulieren, sondern die Sky-Nachbearbeitung korrekt anwenden.
   - Optional: Für den aktuellen Sonntagseintrag kann ich danach den gespeicherten Text nochmals regenerieren, damit die Änderung sofort sichtbar wird.
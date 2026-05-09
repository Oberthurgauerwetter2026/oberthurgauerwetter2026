Ich habe den aktuellen Eintrag geprüft: Der Text steht noch in der Datenbank im bestehenden Entwurf. Zusätzlich greift die Regel bei „Text neu generieren“ für einzelne Einträge noch nicht, weil `regenerateEntry` den neuen Temperatur-Hinweis nicht mitgibt.

Plan:
1. **Gemeinsame Tag-0-Regel erstellen**
   - Eine kleine Hilfsfunktion erkennt Titel wie `Heute Nachmittag & Abend`.
   - Dafür wird ein verbindlicher Prompt-Zusatz erzeugt: keine `Tiefstwerte`, keine Nacht-Temperaturen, keine Senken-/Bodenfrost-Notiz.

2. **Alle Generierungswege absichern**
   - `generateForecast`: nutzt die gemeinsame Regel.
   - `regenerateForecast`: nutzt die gemeinsame Regel.
   - `regenerateEntry`: nutzt die Regel ebenfalls, damit der Button **Text neu generieren** den Satz nicht wieder erzeugt.

3. **Nachbearbeitungs-Schutz einbauen**
   - Nach der KI-Generierung wird bei Tag-0-Nachmittagseinträgen ein Sanitizer angewendet.
   - Er entfernt Absätze/Sätze mit `Tiefstwerte`, `tiefste Werte`, `Minimum`, `Bodenfrost`, `Senken`, wenn der Titel `Heute Nachmittag & Abend` ist.
   - Wenn im selben Absatz auch `Höchstwerte` steht, bleibt der Höchstwerte-Satz erhalten.

4. **Bestehenden aktuellen Entwurf korrigieren**
   - Den bereits gespeicherten Eintrag `Heute Nachmittag & Abend` in dieser Prognose bereinigen, damit die Änderung sofort sichtbar ist, ohne nochmals komplett neu generieren zu müssen.

5. **Validierung**
   - Den aktuellen Forecast-Eintrag erneut aus der Datenbank lesen und prüfen, dass bei `Heute Nachmittag & Abend` kein Tiefstwerte-Satz mehr vorhanden ist.
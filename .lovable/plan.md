Ich habe die Ursache gefunden: Die Neuerstellung nutzt aktuell zuerst den direkt hinterlegten Gemini-Key (`GEMINI_API_KEY`). Wenn dieser wegen Tageslimit mit 429 antwortet, wird der Fehler sofort an die Oberfläche gegeben – obwohl `LOVABLE_API_KEY` ebenfalls vorhanden ist und bereits eine Lovable-AI-Funktion im Code existiert. Der Fallback wird aktuell nur genutzt, wenn gar kein Gemini-Key vorhanden ist, nicht wenn Gemini limitiert ist.

Plan zur Behebung:

1. `src/server/forecast.functions.ts` anpassen
   - `generateText()` so ändern, dass bei Gemini-429 automatisch auf Lovable AI gewechselt wird.
   - Auch bei temporären Gemini-Problemen sinnvoll fallbacken, statt die Prognose abzubrechen.
   - Den Lovable-AI-Default auf ein schnelles Modell setzen (`google/gemini-3-flash-preview`), damit komplette Neuerstellungen mit mehreren Texten weniger wahrscheinlich erneut in Limits laufen.
   - Fehlertexte klarer machen: Nur wenn auch der Fallback fehlschlägt, wird ein echter KI-Fehler angezeigt.

2. `src/server/forecast.auto.ts` ebenfalls anpassen
   - Die automatische Tagesprognose nutzt eine separate, ähnliche KI-Implementierung. Dort denselben Fallback einbauen, damit geplante/automatische Generierungen nicht am Gemini-Free-Limit scheitern.
   - Lovable-AI-Fehler 402/429 dort ebenfalls verständlich behandeln.

3. Optionales Logging ergänzen
   - Bei Gemini-429 serverseitig eine Warnung loggen: „Gemini limitiert, wechsle auf Lovable AI“.
   - Keine Secrets ausgeben.

4. Keine Datenbankänderung nötig
   - Beide benötigten Secrets sind bereits vorhanden: `GEMINI_API_KEY` und `LOVABLE_API_KEY`.
   - Keine neuen Tabellen oder Einstellungen erforderlich.

Erwartetes Ergebnis:
- „Neue Prognose generieren“, „Komplett neu generieren“ und einzelne Einträge neu generieren brechen nicht mehr mit „KI-Tageslimit (Gemini Free) erreicht“ ab.
- Wenn Gemini Free limitiert ist, generiert die App automatisch über Lovable AI weiter.
- Nur falls auch Lovable AI limitiert oder Guthaben fehlt, erscheint eine entsprechende Meldung.
# "Eingeschränkter Modus" bei Prognosegenerierung beheben

## Was passiert aktuell

Bei der Prognosegenerierung kommt manchmal die Warnung **„Open-Meteo Tageslimit erreicht — nur DWD-MOSMIX (Tag 1 + 2) verfügbar"**, obwohl wir das Tageslimit überhaupt nicht ausgereizt haben. Die Datenbank zeigt für heute nur **19 Calls** (Limit: 10 000) — wir sind also weit weg von einer echten Erschöpfung.

## Ursache

Open-Meteo läuft im Hintergrund über einen geteilten Cloudflare-Server. Wenn andere Projekte auf derselben Cloudflare-IP das Tageslimit ausreizen, bekommen wir ebenfalls einen Tageslimit-Fehler („shared-IP throttle"). Die aktuelle Logik in der Prognose-Generierung glaubt diesem Fehler blind und schaltet bis Mitternacht UTC in den eingeschränkten Modus, obwohl unsere eigene Nutzung minimal ist.

Für die **Druckkarten-Generierung** ist dieser Fall bereits clever behandelt (Self-Heal + 45-Min-Pause statt Ganztagspause). Für die **Prognose-Generierung** fehlt diese Behandlung.

## Lösung

Dieselbe „Shared-IP-Throttle"-Erkennung, die schon in `pressure-map.server.ts` existiert, in den Prognose-Pfad (`forecast.functions.ts`) übernehmen:

1. **Bevor** ein Open-Meteo-Marker als „daily" gesetzt wird: prüfen, wie viele Calls wir heute selbst gemacht haben.
   - Eigene Nutzung < 500 Calls → es ist ein Shared-IP-Throttle, kein echtes Tageslimit. Marker nur für **45 Minuten** setzen, nicht bis Mitternacht.
   - Eigene Nutzung ≥ 500 → echter Verdacht auf Tageslimit, Marker bis Mitternacht UTC (wie bisher).
2. **Bei jedem Lese-Zugriff** auf einen aktiven „daily"-Marker: prüfen, ob die eigene Tagesnutzung unter 9 000 liegt. Wenn ja → stale Marker löschen und neu probieren („Self-Heal").
3. Die Warnung im Prognose-Text bleibt unverändert — sie wird damit nur noch dann angezeigt, wenn wir tatsächlich Pech mit Open-Meteo haben.

## Effekt

- Bei der nächsten Generierung greift die Self-Heal-Logik sofort: der stale Marker wird gelöscht, Open-Meteo wird normal abgefragt, die volle Prognose (Tag 0–10) ist wieder verfügbar.
- Künftige Shared-IP-Throttles legen die Prognose maximal 45 Minuten lahm statt bis Mitternacht.
- Echte Tageslimit-Erschöpfung (>9 000 eigene Calls) wird weiterhin korrekt erkannt und respektiert.

## Technische Details

- Neue Helper-Funktionen `isOmDailyMarkerStale()` und `isOmLikelySharedIpThrottle()` in `src/server/forecast.functions.ts` (Logik 1:1 aus `pressure-map.server.ts` portiert, gleicher 500/9000-Schwellwert).
- Anpassung in `fetchOpenMeteoOptional()`:
  - Beim Cache-Lookup: bei aktivem `RATE_LIMIT_DAILY`-Marker zusätzlich Self-Heal-Check.
  - Beim Setzen eines `RATE_LIMIT_DAILY`-Markers: bei niedriger Eigen-Nutzung Tier auf „hourly" (45 min TTL) downgraden.
- Keine Datenbank-Migrationen, keine UI-Änderungen, keine neuen Abhängigkeiten.

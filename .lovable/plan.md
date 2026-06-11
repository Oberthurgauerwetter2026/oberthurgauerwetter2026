# Falscher Starttag der Prognose beheben

## Befund

Die Prognose `9774…2839` wurde heute (11.06.2026, 19:16 Uhr CH-Zeit) erstellt, ist aber auf `forecast_date = 2026-06-10` gespeichert. Eintrag 1 ist deshalb "Heute Abend & Nacht" (= Mittwoch), Eintrag 2 "Morgen, Donnerstag 11. Juni" — aus deiner Sicht müsste der Donnerstag bereits Tag 1 sein.

**Ursache:** Der R2-Cache `openmeteo/forecast.json` ist **rund 20 Stunden alt** (`generatedAt: 2026-06-10T21:22:35Z`, `age_minutes: 1196`). Die Prognose-Generierung übernimmt blind `weather.daily.time[0]` aus dem Cache — und das ist eben noch der 10.06.

Der GitHub-Action-Workflow `Open-Meteo Cache Ingest` (alle 5 min) hat den Cache also seit gestern Abend nicht mehr aktualisiert. Vermutlich Workflow-Fehler oder GitHub-Actions-Schedule pausiert (Schedules werden bei Inaktivität im Repo automatisch deaktiviert).

## Plan

### 1. Tagesfilter beim Prognose-Generieren (Code-Fix)
In `src/lib/forecast.functions.ts` (zwei Stellen: `generateForecast` und `regenerateForecast`) und in `src/server/forecast.auto.ts` (Auto-Job):
- Statt `weather.daily.time[0]` blind zu nehmen, den heutigen Tag in `Europe/Zurich` bestimmen und im `daily.time`-Array suchen.
- Falls Cache veraltet ist (heutiger Tag fehlt), klare Fehlermeldung statt falsches Datum.
- Damit kann auch ein leicht veralteter Cache (z. B. 2 h alt nach Mitternacht) nie mehr mit Vortagsdaten starten.

### 2. R2-Cache-Frische in der UI sichtbar machen
In `src/components/OpenMeteoUsageCard.tsx` (oder neuer Karte) das `age_minutes` aus `/api/public/debug/r2-cache` anzeigen, mit Warn-Badge ab > 30 min. So fällt ein hängender Ingest sofort auf.

### 3. GitHub-Action wieder anstossen (manuelle Aktion ausserhalb des Codes)
- Im Repo unter Actions → "Open-Meteo Cache Ingest" → Run workflow.
- Letzte fehlgeschlagenen Runs prüfen (Schedule-Deaktivierung passiert nach 60 Tagen Repo-Inaktivität; oder Secrets `R2_*` fehlen/abgelaufen).
- Optional: zweiten Trigger einbauen (Cron-Hit auf `/api/public/hooks/...`) als Fallback, falls GitHub Actions ausfällt.

### 4. Bestehende Falsch-Prognose
Die aktuelle Prognose vom 10.06. löschen und nach Cache-Refresh neu generieren — oder einfach "Komplett neu generieren" drücken, sobald Cache wieder frisch ist.

## Technische Details

Betroffene Stellen:
```text
src/lib/forecast.functions.ts:3332   const today = weather.daily.time[0];   // generateForecast
src/lib/forecast.functions.ts:3501   const today = weather.daily.time[0];   // regenerateForecast
src/server/forecast.auto.ts:844      const today = weather.daily.time[0];   // auto-job
```

Neue Helper-Logik (Skizze):
```ts
const todayZurich = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date()); // "YYYY-MM-DD"
const todayIdx = weather.daily.time.indexOf(todayZurich);
if (todayIdx < 0) throw new Error(`Wetterdaten veraltet — kein Eintrag für ${todayZurich}. R2-Cache prüfen.`);
const today = weather.daily.time[todayIdx];
// alle nachfolgenden withTopo(i)-Aufrufe ab `todayIdx + i` statt `i`.
```

Bestätige den Plan, dann setze ich Schritt 1 + 2 im Code um. Schritt 3 musst du im GitHub-Repo selbst auslösen (Actions-UI), das geht nicht von hier aus.
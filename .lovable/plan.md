## Problem

Der 03:00-UTC-Cron läuft genau zur Open-Meteo-Reset-Sekunde und feuert 4× parallel × 16 Batches gegen die API. Open-Meteo antwortet mit minutely-429s. Der Code stuft das nach 3 consecutive 429 fälschlich auf `daily` hoch, setzt einen Negative-Cache-Marker bis Mitternacht UTC, und die geplanten Retry-Slots (05:30 / 07:30 / 10:30) skippen den Aufruf komplett. Tageskontingent ist dabei real bei 18/10 000.

## Plan

### Baustein 1 — 429-Klassifizierung schärfen (`pressure-map.server.ts`)
- `classify429Body`: nur „daily" wenn der Body **explizit** „daily" sagt. Bisher fällt **alles ohne Schlüsselwort** durch zu „minutely" — das ist ok, aber:
- Z. 163-167 entfernen: die „nach 3 consecutive 429s → daily-Marker" Regel kippt minutely/unklassifizierte 429s in einen Tagesbann. Stattdessen: nach 3 consecutive 429s **abbrechen ohne Marker** (bleibt transient, nächster Cron-Slot versucht es neu).
- Z. 248-252: `setRateLimited` nur, wenn `lastTier === "daily"` **und** der Body wirklich `daily` enthielt. Hourly bleibt (30 min Marker ist ok).

### Baustein 2 — Burst entschärfen (`fetchGrids`)
- `CONCURRENCY` von 4 → **2**.
- Zwischen aufeinanderfolgenden Batches eines Workers ein kleines Throttle (~150 ms) einbauen, damit die OM-Minutely-Bucket nicht in 1–2 s leergeräumt wird.
- 16 Batches × 2 parallel × 150 ms ≈ ~3–4 s mehr Laufzeit, weit unter Edge-Timeout.

### Baustein 3 — Cron-Slots umlegen
Aktuell: 03:00 / 05:30 / 07:30 / 10:30 UTC. Probleme: 03:00 ist OM-Reset-Sekunde; nach 10:30 gibt es **keinen** weiteren Versuch.
Neu (per `cron.unschedule` + `cron.schedule`):
- Primär: **04:15 UTC** (06:15 CEST, weg vom Reset).
- Retries: **06:15, 09:15, 13:15, 17:15 UTC** — fünf Versuche über den Tag verteilt.

### Baustein 4 — Smart-Retry: false-positive `daily`-Marker selbstheilen
Im Route-Handler `/api/public/hooks/generate-pressure-map`: vor `generatePressureMap()` prüfen, ob der Marker `daily` ist **und** `openmeteo_usage.total < 9 000` für heute. Wenn ja: Marker löschen und es erneut versuchen. So heilen sich falsche Tagesbänne automatisch beim nächsten Cron-Slot.

### Baustein 5 — Status sichtbarer machen
Im Status-Text aufnehmen, ob der Lauf wegen Marker geskippt wurde **vs.** echter 429, plus Anzahl Calls heute. Hilft beim Debug ohne SQL.

## Nicht im Scope
- Wechsel zu einem anderen Provider/Modell.
- Vorgenerierung im Cron-SQL.
- Reduktion der Auflösung (STEP / Grid).

## Verifikation
1. Marker manuell löschen und Cron-Endpoint einmalig per `invoke-server-function` triggern → SVG aktualisiert sich, `pressure_map_last_status` enthält Call-Anzahl.
2. Künstlicher 429 (z. B. mit unbekanntem Modell) → kein `daily`-Marker mehr, sondern transient.
3. Nächste Tage beobachten: `cron.job_run_details` zeigt 5 Slots, mindestens einer davon erfolgreich.

## Frage vor Umsetzung
**Slot-Strategie für Baustein 3:** OK mit 04:15 / 06:15 / 09:15 / 13:15 / 17:15 UTC, oder lieber andere Zeiten (z. B. an Schweizer Tagesabläufe ankoppeln, etwa 06:00 / 09:00 / 12:00 / 15:00 / 18:00 lokal)?

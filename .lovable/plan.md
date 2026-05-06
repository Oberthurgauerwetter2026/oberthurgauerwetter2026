## Tag-0-Gewichte in den Einstellungen sichtbar/änderbar machen

Die DB-Spalten `tag0_weight_mosmix` und `tag0_weight_om` existieren bereits und werden im Forecast-Code gelesen. In der Settings-Seite (`src/routes/_app.settings.tsx`) und in der `updateSettings` Server-Function fehlt aber das Gegenstück, daher kann man die Gewichte aktuell nicht über das UI ändern.

### Änderungen

**1. `src/routes/_app.settings.tsx`**
- `form`-State und Default um zwei Felder erweitern: `tag0_weight_mosmix: 40`, `tag0_weight_om: 60`.
- In `load()` aus `settings` übernehmen (Fallback 40/60).
- Im MOSMIX-Card-Block (oder direkt darunter) zwei Slider 0–100 % anzeigen:
  - "Tag 0 — Gewicht MOSMIX (%)"
  - "Tag 0 — Gewicht Open-Meteo Modelle (%)"
  - Kurzer Hinweistext: "Summe wird intern normalisiert. Default 40/60. Niedrigeres MOSMIX-Gewicht = stärkerer Einfluss von ICON-CH1/CH2 & Co. auf den heutigen Tag. Stations-Bias, Nowcast und Radar wirken zusätzlich on top."
  - Optional: kleiner Live-Hinweis, was die normalisierte Aufteilung ergibt (z. B. `40 % / 60 %`).

**2. `src/server/forecast.functions.ts` — `updateSettings`**
- Im Zod-Schema zwei optionale Felder ergänzen:
  - `tag0_weight_mosmix: z.number().int().min(0).max(100).optional()`
  - `tag0_weight_om: z.number().int().min(0).max(100).optional()`

Der Rest (DB-Default, Lesen in `buildDay`) ist bereits vorhanden — keine weitere Migration nötig.

### Erwartetes Verhalten

Admins können die Gewichte direkt in `/settings` ändern, neue Forecasts nehmen den geänderten Mix sofort beim nächsten Build auf. Default bleibt 40/60.

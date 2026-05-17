# Schlüssel-Anzeige reparieren

## Problem

Die Seite `/admin/reveal-key` lädt zwar, aber der Klick auf **„Schlüssel anzeigen“** erreicht die geschützte Server-Funktion weiterhin ohne gültigen Login-Header. Deshalb kommt serverseitig **401 Unauthorized** zurück und die Felder bleiben leer.

## Ursache

Die neue Seite ruft `revealServiceRoleKey` über `useServerFn()` auf. In diesem Projekt funktionieren die bestehenden geschützten Aktionen aber anders: sie rufen die Server-Funktion direkt auf und übergeben dort den `Authorization`-Header. Bei der Schlüssel-Seite wird dieser Header offenbar nicht zuverlässig an den Server weitergereicht.

## Umsetzung

1. In `src/routes/_app.admin.reveal-key.tsx` den Aufruf von `useServerFn(revealServiceRoleKey)` entfernen.
2. Den Button direkt `revealServiceRoleKey({ headers: { Authorization: ... } })` aufrufen lassen, analog zu den bestehenden funktionierenden Admin-/Forecast-Aktionen.
3. Die Fehleranzeige so lassen bzw. leicht verbessern, damit bei 401/500 sofort sichtbar ist, was zurückkommt, statt leere Felder zu zeigen.
4. Optional die Diagnose-Ausgabe beibehalten, bis die Werte sichtbar sind.

## Ergebnis

Nach Reload von `/admin/reveal-key` sollte der Klick dieselbe Auth-Übergabe nutzen wie die funktionierenden Admin-Aktionen und die Werte anzeigen oder zumindest eine klare Fehlermeldung ausgeben.

# Druckkarten-Generator: Skip-Logik gegen Doppel-Calls

## Problem

Der GitHub-Workflow läuft jetzt 3× pro Tag (04:15 / 07:15 / 17:15 UTC), damit die Karte zuverlässig erscheint. Aber: der Generator (`pressure-map-generator/generate.mjs`) hat **keine** Skip-Prüfung. Jeder Lauf ruft Open-Meteo voll ab — also bis zu 3× so viele Calls wie nötig, obwohl die Karte für denselben Zieltag schon existiert.

Beispiel: Wenn der 04:15-Slot die Karte für den Folgetag erfolgreich erzeugt, würden 07:15 und 17:15 sie unnötig nochmal generieren.

## Ziel

Pro Zieltag soll Open-Meteo **nur einmal** abgefragt werden. Die zusätzlichen Cron-Slots dienen nur als Backup, falls der erste fehlgeschlagen ist.

## Lösung

Skip-Check ganz am Anfang von `main()` in `generate.mjs`, **bevor** der erste Open-Meteo-Fetch passiert:

1. Zieltag bestimmen (`pickTargetTime()` — macht der Code schon).
2. `app_settings.pressure_map_last_status` lesen.
3. Wenn der Status mit `OK ·` beginnt **und** das Ziel-Datum darin (`target YYYY-MM-DD`) gleich dem aktuellen Zieltag ist → sofort beenden, Status auf `Skip · bereits aktuell für <target>` setzen, **keine** Open-Meteo-Calls.
4. Manueller Trigger (`workflow_dispatch`) soll die Skip-Logik überspringen können — via Env-Variable `FORCE_REGENERATE=1` aus dem Workflow.

## Erwartetes Ergebnis

- Normalfall: 1 erfolgreicher Lauf/Tag mit ~1–3 Open-Meteo-Calls. Die anderen 2 Slots beenden in <2 Sekunden mit 0 Calls.
- Fehlerfall: Wenn 04:15 schiefging (kein `OK ·` Status), läuft 07:15 normal durch und versucht es neu — das ist der Backup-Zweck.
- Open-Meteo-Tagesnutzung für die Druckkarte fällt von potenziell ~9 auf ~3 Calls.

## Technische Details

**Datei 1: `pressure-map-generator/generate.mjs`** — am Anfang von `main()`, direkt nach `client-init`:

```js
const targetUtc = pickTargetTime();
const targetDay = targetUtc.slice(0, 10);

if (!process.env.FORCE_REGENERATE) {
  const { data: cur } = await supabase
    .from("app_settings")
    .select("id, pressure_map_last_status")
    .limit(1)
    .maybeSingle();
  const status = cur?.pressure_map_last_status ?? "";
  const match = status.match(/target (\d{4}-\d{2}-\d{2})/);
  if (status.startsWith("OK ·") && match?.[1] === targetDay) {
    console.log(`[gen] skip: Karte für ${targetDay} bereits aktuell`);
    if (cur?.id) {
      await supabase.from("app_settings").update({
        pressure_map_last_run: new Date().toISOString(),
        pressure_map_last_status: `Skip · external-gen · bereits aktuell für ${targetDay}`,
      }).eq("id", cur.id);
    }
    return;
  }
}
```

**Datei 2: `.github/workflows/pressure-map.yml`** — beim `workflow_dispatch`-Lauf `FORCE_REGENERATE=1` setzen, damit manuelle Trigger immer neu rendern:

```yaml
env:
  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
  LOVABLE_API_KEY: ${{ secrets.LOVABLE_API_KEY }}
  FORCE_REGENERATE: ${{ github.event_name == 'workflow_dispatch' && '1' || '' }}
```

Keine DB-Migration, keine neuen Secrets, keine Frontend-Änderungen.

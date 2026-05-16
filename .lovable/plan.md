# Option A — Eigenes GitHub-Repo für den Druckkarten-Generator

Du legst ein neues, leeres GitHub-Repo an und kopierst dort die fertigen Generator-Dateien rein. Lovable bleibt komplett unverändert — das Repo schreibt nur in den bestehenden Supabase Storage Bucket `weather-maps`, den die App ohnehin liest.

## Schritt 1 — Neues Repo anlegen

1. Auf github.com einloggen → oben rechts **+** → **New repository**
2. Name z. B. `pressure-map-generator`
3. **Public** oder **Private** ist egal (GitHub Actions sind in beiden Fällen kostenlos für dieses Volumen)
4. Haken bei **Add a README** setzen, damit das Repo nicht leer ist
5. **Create repository**

## Schritt 2 — Dateien aus Lovable ins Repo kopieren

Du brauchst genau diese vier Dateien aus dem Lovable-Projekt:

```text
pressure-map-generator/generate.mjs
pressure-map-generator/package.json
.github/workflows/pressure-map.yml
src/data/europe-countries.json
src/data/europe-ocean.json
src/data/europe-lakes.json
```

Wichtig: Der Generator liest die Geo-Daten aus `../src/data/`. Im neuen Repo legst du sie deshalb als `data/europe-*.json` ab und ich passe die drei Pfade in `generate.mjs` minimal an (`../src/data` → `../data`).

Ziel-Struktur im neuen Repo:

```text
pressure-map-generator/
  ├─ .github/workflows/pressure-map.yml
  ├─ data/
  │   ├─ europe-countries.json
  │   ├─ europe-ocean.json
  │   └─ europe-lakes.json
  └─ generator/
      ├─ generate.mjs
      └─ package.json
```

Hochladen geht in GitHub direkt im Browser: **Add file → Upload files**, Ordner per Drag-and-Drop. Kein Git nötig.

## Schritt 3 — Secrets im neuen Repo setzen

Im neuen Repo: **Settings → Secrets and variables → Actions → New repository secret**

- `SUPABASE_URL` = `https://kdolnotjbhgjieznmpgf.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (Service-Role-Key, gibt dir Lovable im Backend → API Keys)

## Schritt 4 — Workflow starten

Im neuen Repo: **Actions** → „Generate pressure map" → **Run workflow**. Danach läuft er automatisch 5×/Tag (04:15 / 06:15 / 09:15 / 13:15 / 17:15 UTC).

## Schritt 5 — Alten Lovable-Cron abschalten

Sobald der GitHub-Job stabil läuft, deaktiviere ich den alten pg_cron-Job in Lovable, damit nicht beides parallel rennt. Die Route `/api/public/hooks/generate-pressure-map` bleibt als manueller Fallback.

## Was ich für dich vorbereite

Wenn du diesen Plan freigibst:

1. Ich passe `pressure-map-generator/generate.mjs` so an, dass die Geo-Daten aus `../data/` statt `../src/data/` geladen werden (damit du sie im neuen Repo nicht im `src`-Ordner liegen haben musst).
2. Ich poste dir danach den vollständigen Inhalt aller 4 Dateien + Links zu den 3 Geo-JSONs als Copy-Paste-Block in den Chat, damit du sie 1:1 ins neue Repo übernehmen kannst.
3. Du sagst Bescheid, wenn der erste Workflow-Lauf grün war — dann schalte ich den alten pg_cron-Job ab.

Im Lovable-Codebase ändert sich nur diese eine Zeilen-Anpassung in `generate.mjs`. Keine App-Änderungen.

## "Mini-SuperHD" auf Bischofszell + Güttingen reduzieren

Die SMN-Bias-Korrektur (intern "SuperHD-light") nutzt aktuell **GUT, STG, TAE** als Referenzstationen. Du willst sie auf **Bischofszell + Güttingen** beschränken — das ist deutlich näher am Oberthurgau und vermeidet Verzerrungen durch St. Gallen (776 m, Hügellage) und Tänikon (Westthurgau).

### Änderungen

1. **`src/server/swissmetnet.server.ts`** — `KNOWN_SMN` um Bischofszell ergänzen:
   ```ts
   BIZ: { name: "Bischofszell",   lat: 47.495, lon: 9.226, elev: 506 },
   ```
   (SMN-Kürzel `BIZ`, MeteoSchweiz-Standardstation Bischofszell.)

2. **`src/routes/_app.settings.tsx`** — Default + UI-Hinweis anpassen:
   - `bias_stations`-Default beider Vorkommen: `"GUT,STG,TAE"` → `"BIZ,GUT"`
   - Helper-Text: "Verfügbar u.a.: BIZ (Bischofszell), GUT (Güttingen), STG (St. Gallen), TAE (Aadorf/Tänikon), SMA (Zürich-Fluntern), KLO (Kloten)."

3. **DB-Migration** — neuen Default für `app_settings.bias_stations` setzen:
   ```sql
   ALTER TABLE public.app_settings
     ALTER COLUMN bias_stations SET DEFAULT 'BIZ,GUT';
   ```

4. **Bestehende Einstellung aktualisieren** (separate Insert-Operation):
   ```sql
   UPDATE public.app_settings SET bias_stations = 'BIZ,GUT';
   ```

### Was bleibt unverändert

- Bias-Logik (`bias-correction.server.ts`), Lookback (7 Tage), Strength (70 %) und der Schalter `bias_enabled` bleiben wie konfiguriert.
- Cache (1 h pro Station) lädt BIZ beim ersten Aufruf automatisch.

### Risiken

- Falls das Kürzel `BIZ` bei MeteoSchweiz nicht existiert (Stationsumbenennung), liefert Open Data `404`, der Fetch wird im Server-Log als Warnung sichtbar, und die Bias-Korrektur fällt auf GUT alleine zurück — kein Crash. Validierung: nach Deploy einmal `/forecast/...` öffnen und im Server-Log nach `SMN BIZ` schauen.
- Mit nur 2 Stationen ist die Bias-Korrektur weniger robust gegen Ausreißer. Falls einer der CSVs ausfällt, bleibt nur eine Station — das ist ok, aber im Debug sichtbar.

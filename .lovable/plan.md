## Ziel

BIZ (Bischofszell) bleibt als technischer Cold-Anchor erhalten, aber im KI-Output werden die Senken konsequent als **„Aach- und Sittertal"** benannt – nicht mehr als „Hudelmoos / Riedflächen / Thurtal bei Bischofszell".

## Änderungen in `src/server/forecast.functions.ts`

### 1. System-Prompt: Senken-Bezeichnung vereinheitlichen (Z. 1889, 1896)

**Z. 1889** – Beschreibung der BIZ-Stationsrolle:
- alt: `"stations.BIZ" (Bischofszell, Thurtal-Senke): Anker für den KÄLTESTEN Punkt im Radius.`
- neu: `"stations.BIZ" (Bischofszell, repräsentativ für die Senken im Aach- und Sittertal): Anker für den KÄLTESTEN Punkt im Perimeter. Der Stationsname "Bischofszell" wird im Fliesstext NICHT genannt – stattdessen "Aach- und Sittertal".`

**Z. 1896** – Senken-Satz-Format:
- alt: `Format: "In den Senken (z. B. Hudelmoos, Riedflächen, Bodensee-nahe Mulden, Thurtal bei Bischofszell) lokal bis X Grad."`
- neu: `Format: "In den Senken im Aach- und Sittertal lokal bis X Grad." (X = Wert auf ganze Grad gerundet, ohne weitere Ortsnamen).`

**Z. 1900** – Schluss-Direktive:
- alt: `Den Senken-Wert NIEMALS in den Haupt-Tiefstwert-Satz mischen — der Hauptsatz nennt den Bereich GUT/BIZ.`
- neu: `Den Senken-Wert NIEMALS in den Haupt-Tiefstwert-Satz mischen — der Hauptsatz nennt den Bereich Bodenseeufer–Aach-/Sittertal (intern: GUT/BIZ, NIE als Stationskürzel oder Ortsname Bischofszell ausgeben).`

### 2. Topo-Label angleichen (Z. 384)

- alt: `tmin_cold_label: classification === "strahlungsnacht" ? "Senken (Hudelmoos, Riedflächen)" : "Tiefste Lagen (Bodensee-Ufer)"`
- neu: `tmin_cold_label: classification === "strahlungsnacht" ? "Senken im Aach- und Sittertal" : "Tiefste Lagen (Bodenseeufer)"`

### 3. Negativ-Liste: „Bischofszell" verbieten

Im bestehenden Perimeter-Verbotsblock (Z. 1964 – Föhn-Direktive) bzw. im allgemeinen Stil-Block ergänzen:
- `Bischofszell, Hudelmoos, Riedflächen, Thurtal NIEMALS namentlich nennen – Senken-Lagen ausschliesslich als "Aach- und Sittertal" beschreiben.`

## Was unverändert bleibt

- BIZ bleibt in `STATIONS` (Z. 400-403) und Default-`bias_stations` (`GUT,STG,TAE` → BIZ kommt über STATIONS-Konstante separat dazu, Bias-Logik unverändert)
- BIZ-Messdaten fliessen weiter in `corrected_tmin` ein
- Backend-Logik / Datenfluss / Settings-UI: keine Änderung
- 6 Generierungsstellen (generate + regenerate × firstEntry/day/trend): kein Eingriff nötig, da sie alle denselben System-Prompt nutzen

## Akzeptanzkriterien

- Generierter Text enthält bei Strahlungsnächten den Satz **„In den Senken im Aach- und Sittertal lokal bis X Grad."**
- Wörter „Bischofszell", „Hudelmoos", „Riedflächen", „Thurtal" tauchen im Output **nicht** mehr auf
- Tmin-Bandbreite (Hauptsatz) nutzt weiterhin BIZ-Korrekturwert als unteren Anker

## Aufwand

3 Prompt-Strings + 1 Label-Konstante. ~10 Zeilen. Keine neuen Dateien, keine API-Calls, keine Migration.

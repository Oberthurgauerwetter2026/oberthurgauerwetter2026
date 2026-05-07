Ich habe den konkreten Freitag-Datensatz geprüft: `sky_pattern` ist weiterhin leer, weil die Nebelerkennung 06–08 Uhr mittelt und die Sonne um 08 Uhr bereits 55 Minuten liefert. Dadurch fällt `morningSun <= 10` durch, obwohl 06/07 Uhr klar Nebel/Hochnebel zeigen und ICON-D2 Code 45 liefert. Zusätzlich überschreibt ein gespeicherter eigener `prompt_sky` die verbesserten Standardregeln, daher greifen die neuen Nebel-Pflichten nicht zuverlässig.

Plan:

1. Frühnnebel robuster erkennen
   - Nebelstart nur über 06/07 Uhr bewerten statt 06–08 Uhr.
   - Bei Wettercode 45/48 plus 06/07 Uhr kaum Sonne und sehr hohe Bewölkung `sky_pattern = "nebel_aufloesung"` setzen.
   - Auflösung bereits ab 08 Uhr akzeptieren, wenn die Sonne deutlich einsetzt, auch wenn Cloudcover formal noch hoch bleibt.

2. Sonnengewicht aus Stundenprofil stärker machen
   - Zusätzlich ein kompaktes Feld wie `sky_timeline`/`sunny_hours_summary` ableiten: Morgen Nebel/Hochnebel, ab Vormittag sonnig, Nachmittag trotz Wolkenfeldern weiterhin lange sonnige Abschnitte.
   - Tagesmittel der Bewölkung darf bei 11.9 h Sonne nicht zu „zunehmend bewölkt“ dominieren.

3. Prompt-Regeln gegen benutzerdefinierte Überschreibung absichern
   - Die Pflichtregel für Nebel/Hochnebel-Auflösung als nicht überschreibbare Systemregel nach dem gespeicherten `prompt_sky` ergänzen.
   - Damit steht bei `sky_pattern = "nebel_aufloesung"` zwingend „Nebel-/Hochnebelfelder“ im Text und bei ≥10 h Sonne zwingend „ziemlich/meist/recht sonnig“ statt nur „sonnige Abschnitte“.

4. Ergebnis nach Änderung prüfen
   - Die Freitag-Daten erneut auswerten und sicherstellen, dass `sky_pattern` gesetzt wird.
   - Zieltext sinngemäss: „Am Morgen lokale Nebel- oder Hochnebelfelder, rasch Auflösung. Danach recht/ziemlich sonnig, am Nachmittag zeitweise dichtere Wolkenfelder, daneben weiterhin längere sonnige Abschnitte.“
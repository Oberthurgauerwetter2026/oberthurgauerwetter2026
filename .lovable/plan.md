## Plan

1. **Sky-Erkennung stabilisieren**
   - Die Nebel-/Hochnebel-Erkennung nicht nur beim ersten Roh-Datensatz berechnen, sondern nach allen Mischungen/Korrekturen nochmals normalisieren.
   - Sobald 06–07 Uhr sehr dicht bewölkt und ein Modell Code 45/48 liefert, wird `sky_pattern = "nebel_aufloesung"` gesetzt, auch wenn Tagesmittel oder spätere MOSMIX-Mischwerte dagegen wirken.

2. **Sonnigen Tagescharakter als eigenes Signal ableiten**
   - Aus dem Stundenprofil zusätzlich ein Feld wie `sky_summary` erzeugen, z. B.:
     - morgens: Nebel/Hochnebel bzw. stark bewölkt
     - ab Vormittag/Mittag: Auflockerungen, recht/ziemlich sonnig
     - Nachmittag/Abend: mehr Wolken, aber weiterhin sonnige Abschnitte
   - Bei rund 12 Sonnenstunden darf der Text nicht bei „zeitweise sonnig“ stehen bleiben.

3. **KI-Ausgabe deterministisch korrigieren**
   - `enforceSkyConsistency()` erweitern: Wenn `sky_pattern = "nebel_aufloesung"` oder ein sehr sonniges Stundenprofil vorliegt, wird der erste Wetterverlauf-Absatz nach klaren Regeln ersetzt/angepasst.
   - Für diesen Fall soll der Satz sinngemäss lauten: „Am Morgen Nebel- oder Hochnebelfelder bzw. stark bewölkt, im Tagesverlauf Auflockerungen und danach recht/ziemlich sonnig. Am Nachmittag und Abend zeitweise dichtere Wolkenfelder, daneben weiterhin sonnige Abschnitte.“

4. **Bestehenden Freitag prüfen**
   - Nach der Änderung den Freitag-Datensatz neu generieren bzw. die Logik gegen das gespeicherte Stundenprofil prüfen.
   - Ziel: keine pauschale Formulierung „Am Morgen stark bewölkt, im Tagesverlauf Auflockerungen und zeitweise sonnig“ mehr, sondern eine Beschreibung mit Nebel-/Hochnebelbezug und deutlich sonnigerem Tagescharakter.
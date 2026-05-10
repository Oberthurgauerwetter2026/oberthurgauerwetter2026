# Testbild der angepassten Karte erzeugen

1. Server-Funktion `triggerPressureMap` mit Admin-Auth aufrufen, damit die Karte mit den neuen Code-Änderungen (Landfarbe `#D3EAC2`, grössere H/T, neues Legenden-Layout) frisch generiert und ins Storage-Bucket hochgeladen wird.
2. Die frische SVG von der öffentlichen URL nach `/mnt/documents/europe-pressure-v2.svg` herunterladen.
3. Nach PNG konvertieren (`/mnt/documents/europe-pressure-v2.png`) für direkte Vorschau und als `<lov-artifact>` ausliefern.
4. Visuell prüfen: Landfarbe korrekt, H/T deutlich grösser, Niederschlag-Legende und Quellenangabe ohne Überlappung.

Keine weiteren Code-Änderungen.

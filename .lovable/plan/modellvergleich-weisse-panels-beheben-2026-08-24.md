# Modellvergleich: weisse Panels beheben

## Befund (geprüft)

- Die Daten sind vorhanden: `/api/public/model-grid/index.json` und die Modellgitter antworten mit Status 200 (Lauf 24.08., 09:27 UTC) – sowohl lokal als auch auf der veröffentlichten Seite und im Netzwerk-Log deines Browsers.
- Im Test-Browser (Chromium) rendern alle vier Panels korrekt: swisstopo-Relief plus Niederschlagsflächen.
- Bei dir sind die Panels komplett weiss – also fehlt auch der Kartenhintergrund. Das heisst: nicht die Daten sind das Problem, sondern die Karten-Engine bricht in deinem Browser ab.
- Verdacht (noch nicht bestätigt): Das Niederschlags-Overlay wird über eine MapLibre-„canvas“-Quelle mit einem Canvas gezeichnet, das nie im DOM hängt. In Chromium funktioniert das, in Safari/WebKit ist das eine bekannte Fehlerquelle – schlägt das Hochladen der Textur fehl, stirbt der ganze WebGL-Renderer und das Panel bleibt weiss (inklusive Basiskarte).

## Vorgehen

1. **Ursache bestätigen**: Seite mit WebKit (Safari-Engine) im Testbrowser öffnen, Konsolenfehler und Screenshot auswerten. Damit steht fest, ob es die Canvas-Quelle, WebGL allgemein oder etwas anderes ist.
2. **Overlay robust machen**: Statt der „canvas“-Quelle das Feld als Bild-Quelle (`image`-Source mit Data-URL aus dem Offscreen-Canvas) einbinden und bei Zeit-/Variablenwechsel per `updateImage` austauschen. Das ist in allen Browsern unterstützt und braucht kein DOM-Canvas.
3. **Fehler sichtbar machen statt weiss**: `map.on("error")` abfangen; wenn die Karte nicht initialisieren kann, im Panel eine Hinweisbox anzeigen (statt einer leeren weissen Fläche). Zusätzlich WebGL-Verfügbarkeit prüfen und in diesem Fall einen klaren Hinweis anzeigen.
4. **Basiskarte absichern**: Falls sich im Test zeigt, dass die swisstopo-Kacheln in deinem Kontext blockiert sind, einen zweiten Kachel-Layer als Fallback ergänzen, damit immer ein Hintergrund erscheint.
5. **Verifizieren**: Nach dem Umbau in Chromium *und* WebKit erneut prüfen (Screenshots je Panel), zusätzlich Variablenwechsel und Zeitschieber testen.

## Technische Details

- Betroffen: `src/components/model-compare/ModelPanel.tsx` (Karteninitialisierung, `field`-Source, Zeichnen des Feldes und der Windpfeile).
- Umstellung: `addSource({type:"canvas"})` → `addSource({type:"image", url: dataUrl, coordinates})`; Redraw-Effekt erzeugt `canvas.toDataURL("image/png")` und ruft `getSource("field").updateImage({url})`. Windpfeile bleiben Teil des gleichen Canvas-Bildes.
- Keine Änderungen am Ingest, an R2 oder am API-Proxy nötig – die Datenkette ist verifiziert in Ordnung.

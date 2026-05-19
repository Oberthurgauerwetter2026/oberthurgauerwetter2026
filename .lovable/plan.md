# Plan: GitHub-Workflow-Fix für Node/WebSocket-Fehler

## Ursache

Der Fehler entsteht beim Initialisieren des Storage-Clients im Generator. Die aktuell installierte Client-Version initialisiert intern Realtime/WebSocket. Unter Node 20 fehlt dafür die native WebSocket-Unterstützung, deshalb bricht `createClient(...)` schon vor dem Upload ab.

## Änderung

1. Im Generator-Paket die kleine `ws`-Abhängigkeit hinzufügen.
2. In `pressure-map-generator/generate.mjs` `ws` importieren.
3. Beim `createClient(...)` die Realtime-Option so setzen, dass unter Node 20 der `ws`-Transport verwendet wird.
4. Den Workflow unverändert lassen: Er kann weiterhin Node 20 nutzen; der Node-20-Deprecation-Hinweis der GitHub-Actions wurde bereits separat über Actions v5/Node-24-Runtime adressiert.

## Technischer Zielzustand

```text
import ws from "ws";

createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});
```

## Prüfung danach

Nach der Änderung den GitHub-Workflow manuell starten. Erwartung: Der Schritt kommt über `phase=client-init` hinaus und schlägt, falls überhaupt, nicht mehr mit dem Node/WebSocket-Fehler fehl.

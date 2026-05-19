// FU-Berlin "Aktion Wetterpate" name resolver.
//
// Lädt das aktuelle Prognose-GIF von page.met.fu-berlin.de, schickt es an
// das Lovable AI Gateway (Gemini Flash, Vision) und bittet um eine JSON-
// Liste aller beschrifteten Hoch-/Tiefdruckzentren samt geschätzter Lon/Lat.
// Anschließend wird jedem von uns erkannten Druckzentrum der nächstgelegene
// FU-Berlin-Name zugeordnet.
//
// Fallback-Verhalten: jeder Fehler (kein Key, Netzwerk, ungültige Antwort,
// kein Treffer im Umkreis) → leere Map; der SVG-Render läuft dann wie bisher
// ohne Namen weiter. Der Gesamtlauf darf daran nie scheitern.

const FU_BERLIN_GIF =
  "https://page.met.fu-berlin.de/wetterpate/static/emtbkna.gif";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
// Maximaler Geo-Abstand zwischen unserem Zentrum und dem OCR-Label, damit
// noch zugeordnet wird (grobe Grad-Distanz, ~6° ≈ 500–700 km in Europa).
const MAX_MATCH_DEGREES = 6.0;

function haversineDeg(a, b) {
  // Schnelle „Pseudo-Distanz" in Grad — reicht für nearest-match in Europa.
  const dLon = (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dLat = a.lat - b.lat;
  return Math.hypot(dLon, dLat);
}

async function fetchGifAsBase64() {
  const res = await fetch(FU_BERLIN_GIF, {
    headers: { "User-Agent": "OberthurgauerWetter/1.0 (+lovable.app)" },
  });
  if (!res.ok) throw new Error(`FU-Berlin GIF: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

async function askGemini(base64Gif, apiKey) {
  const prompt = `Du siehst die Bodendruck-Prognosekarte der FU Berlin („Aktion Wetterpate"). Auf der Karte sind Hoch- und Tiefdruckzentren mit einem großen Buchstaben (H = Hoch, T = Tief) und einem darüber/daneben gesetzten Vornamen beschriftet (z. B. „Zeno", „Inga", „Henriette").

Extrahiere ALLE klar erkennbaren beschrifteten Druckzentren und schätze für jedes die geografische Position (Längengrad lon, Breitengrad lat) so gut wie möglich anhand der eingezeichneten Küstenlinien und Gradnetzlinien. Karte deckt ungefähr Europa + Nordatlantik ab (etwa −60° bis +45° Längengrad, +30° bis +75° Breitengrad).

Antworte AUSSCHLIESSLICH mit gültigem JSON in genau diesem Format, ohne Markdown, ohne Kommentar:

{"centers":[{"name":"Zeno","type":"H","lon":12.3,"lat":48.1}, ...]}

- "type" ist exakt "H" oder "T".
- "name" ist nur der Vorname, ohne Zusätze.
- Wenn du dir bei einem Eintrag unsicher bist, lass ihn weg.`;

  const body = {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:image/gif;base64,${base64Gif}` },
          },
        ],
      },
    ],
  };

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gateway HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Gateway: kein content");
  // Robuste JSON-Extraktion, falls das Modell Code-Fences schickt.
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gateway: kein JSON erkannt");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed?.centers)) throw new Error("Gateway: centers fehlt");
  return parsed.centers
    .filter(
      (c) =>
        c &&
        typeof c.name === "string" &&
        (c.type === "H" || c.type === "T") &&
        Number.isFinite(c.lon) &&
        Number.isFinite(c.lat),
    )
    .map((c) => ({
      name: c.name.trim().split(/\s+/)[0],
      type: c.type,
      lon: Number(c.lon),
      lat: Number(c.lat),
    }));
}

/**
 * @param {Array<{type:"H"|"T",lon:number,lat:number,value:number}>} centers
 * @returns {Promise<Array<{type:"H"|"T",lon:number,lat:number,value:number,name?:string}>>}
 */
export async function attachFuBerlinNames(centers) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.log("[fu-berlin] LOVABLE_API_KEY fehlt – überspringe Namens-Layer");
    return centers;
  }
  try {
    const t0 = Date.now();
    const gifB64 = await fetchGifAsBase64();
    const labels = await askGemini(gifB64, apiKey);
    console.log(`[fu-berlin] ${labels.length} Labels erkannt (${Date.now() - t0} ms)`);
    if (!labels.length) return centers;

    // Greedy nearest-match: jedes Label nur einmal vergeben, jeweils Typ-gleich.
    const used = new Set();
    return centers.map((c) => {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < labels.length; i++) {
        if (used.has(i)) continue;
        const l = labels[i];
        if (l.type !== c.type) continue;
        const d = haversineDeg(c, l);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD <= MAX_MATCH_DEGREES) {
        used.add(best);
        return { ...c, name: labels[best].name };
      }
      return c;
    });
  } catch (e) {
    console.warn(`[fu-berlin] Namen-Layer fehlgeschlagen: ${e?.message ?? e}`);
    return centers;
  }
}

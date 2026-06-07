// Lädt die offizielle DWD-Bodenanalyse (Europa/Nordatlantik, mit Fronten)
// und speichert sie dauerhaft im Karten-Speicher als
// `dwd-bodenanalyse-latest.png`. Wird vom selben Cron-Hook wie die
// modellbasierte Druckkarte aufgerufen.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DWD_URL =
  "https://www.dwd.de/DWD/wetter/wv_spez/hobbymet/wetterkarten/bwk_bodendruck_na_ana.png";

const STORAGE_BUCKET = "weather-maps";
const STORAGE_PATH = "dwd-bodenanalyse-latest.png";

export async function refreshDwdBodenanalyse(): Promise<{
  bytes: number;
  source: string;
}> {
  const upstream = await fetch(DWD_URL, {
    headers: {
      // DWD blockt nicht-Browser-User-Agents mit 400 — daher Browser-kompatibel.
      "User-Agent":
        "Mozilla/5.0 (compatible; oberthurgauerwetter2026/1.0; +https://oberthurgauerwetter2026.lovable.app)",
      Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
      Referer: "https://www.dwd.de/",
    },
  });
  if (!upstream.ok) {
    throw new Error(`DWD upstream ${upstream.status}`);
  }
  const buf = await upstream.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_PATH, bytes, {
      contentType: "image/png",
      cacheControl: "900",
      upsert: true,
    });
  if (error) throw new Error(`DWD upload fehlgeschlagen: ${error.message}`);

  return { bytes: bytes.byteLength, source: "dwd.de" };
}

export const DWD_STORAGE_BUCKET = STORAGE_BUCKET;
export const DWD_STORAGE_PATH = STORAGE_PATH;

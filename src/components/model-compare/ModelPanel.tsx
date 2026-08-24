import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Badge } from "@/components/ui/badge";
import {
  MODEL_LABELS,
  MODEL_RANGE_HOURS,
  buildField,
  colorFor,
  gridValue,
  loadGrid,
  type GridIndex,
  type VariableDef,
  type VariableGrid,
} from "@/lib/model-grid";

const SWISSTOPO_GREY =
  "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg";
const OSM_FALLBACK = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export type PanelView = { lng: number; lat: number; zoom: number };

type Props = {
  model: string;
  def: VariableDef;
  index: GridIndex;
  timeIndex: number;
  view: PanelView;
  hover: { lat: number; lon: number } | null;
  onView: (v: PanelView, from: string) => void;
  onHover: (p: { lat: number; lon: number } | null) => void;
  viewOwner: string | null;
};

/** Prüft, ob der Browser überhaupt einen WebGL-Kontext liefert. */
function detectWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(
      c.getContext("webgl2") ||
        c.getContext("webgl") ||
        (c.getContext as unknown as (t: string) => unknown).call(c, "experimental-webgl"),
    );
  } catch {
    return false;
  }
}

export function ModelPanel({ model, def, index, timeIndex, view, hover, onView, onHover, viewOwner }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const styleReadyRef = useRef(false);
  const fallbackAddedRef = useRef(false);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [grids, setGrids] = useState<{
    primary: VariableGrid | null;
    direction: VariableGrid | null;
    snowfall: VariableGrid | null;
    precipitation: VariableGrid | null;
  }>({ primary: null, direction: null, snowfall: null, precipitation: null });
  const [loading, setLoading] = useState(true);

  const { nlat, nlon, minLat, maxLat, minLon, maxLon } = index.grid;

  // Offscreen-Canvas für das Feld (wird als Bild in die Karte gelegt)
  if (!canvasRef.current && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = nlon * 8;
    c.height = nlat * 8;
    canvasRef.current = c;
  }

  useEffect(() => {
    setWebglOk(detectWebGL());
  }, []);

  // Daten laden
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const source = def.sourceVariable ?? def.key;
    const needsDir = Boolean(def.arrows);
    const needsType = def.key === "precipitation_type";
    Promise.all([
      needsType ? loadGrid(model, "precipitation") : loadGrid(model, source),
      needsDir ? loadGrid(model, "wind_direction_10m") : Promise.resolve(null),
      needsType ? loadGrid(model, "snowfall") : Promise.resolve(null),
      needsType ? loadGrid(model, "precipitation") : Promise.resolve(null),
    ]).then(([primary, direction, snowfall, precipitation]) => {
      if (cancelled) return;
      setGrids({ primary, direction, snowfall, precipitation });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [model, def.key, def.sourceVariable, def.arrows]);

  // Karte initialisieren (nur wenn WebGL verfügbar)
  useEffect(() => {
    if (webglOk !== true) return;
    if (!containerRef.current || mapRef.current || !canvasRef.current) return;

    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            base: { type: "raster", tiles: [SWISSTOPO_GREY], tileSize: 256, attribution: "© swisstopo", maxzoom: 18 },
          },
          layers: [{ id: "base", type: "raster", source: "base" }],
        },
        center: [view.lng, view.lat],
        zoom: view.zoom,
        attributionControl: { compact: true },
      });
    } catch {
      setMapFailed(true);
      return;
    }
    mapRef.current = map;

    map.on("load", () => {
      styleReadyRef.current = true;
      map.addSource("field", {
        type: "image",
        // 1x1 transparentes PNG als Platzhalter, bis das Feld gezeichnet ist
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        coordinates: [
          [minLon, maxLat],
          [maxLon, maxLat],
          [maxLon, minLat],
          [minLon, minLat],
        ],
      });
      map.addLayer({
        id: "field",
        type: "raster",
        source: "field",
        paint: { "raster-opacity": 0.78, "raster-resampling": "linear" },
      });
      // Falls das Feld schon gerendert wurde, sofort übernehmen
      if (fallbackUrlRef.current) {
        (map.getSource("field") as maplibregl.ImageSource | undefined)?.updateImage({ url: fallbackUrlRef.current });
      }
    });

    map.on("error", (e) => {
      const msg = String((e as { error?: Error }).error?.message ?? "");
      // Kachelfehler: einmalig auf OSM-Kacheln als Hintergrund ausweichen
      if (/tile|fetch|network|Failed/i.test(msg) && !fallbackAddedRef.current && styleReadyRef.current) {
        fallbackAddedRef.current = true;
        try {
          map.addSource("base-fallback", { type: "raster", tiles: [OSM_FALLBACK], tileSize: 256, attribution: "© OpenStreetMap", maxzoom: 19 });
          map.addLayer({ id: "base-fallback", type: "raster", source: "base-fallback" }, "base");
        } catch {
          /* ignorieren */
        }
        return;
      }
      if (/WebGL|context|shader/i.test(msg)) setMapFailed(true);
    });

    const emit = () => {
      const c = map.getCenter();
      onView({ lng: c.lng, lat: c.lat, zoom: map.getZoom() }, model);
    };
    map.on("moveend", emit);
    map.on("mousemove", (e) => onHover({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    map.on("mouseout", () => onHover(null));

    return () => {
      styleReadyRef.current = false;
      fallbackAddedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglOk]);

  // View-Synchronisation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || viewOwner === model) return;
    const c = map.getCenter();
    if (Math.abs(c.lng - view.lng) < 1e-6 && Math.abs(c.lat - view.lat) < 1e-6 && Math.abs(map.getZoom() - view.zoom) < 1e-6) return;
    map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });
  }, [view, viewOwner, model]);


  // Feld zeichnen und als Bild in die Karte legen
  useEffect(() => {
    const canvas = canvasRef.current;
    const g = grids.primary;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const publish = () => {
      let url: string;
      try {
        url = canvas.toDataURL("image/png");
      } catch {
        return;
      }
      fallbackUrlRef.current = url;
      setFallbackUrl(url);
      const map = mapRef.current;
      if (map && styleReadyRef.current) {
        (map.getSource("field") as maplibregl.ImageSource | undefined)?.updateImage({ url });
      }
    };

    if (!g) {
      publish();
      return;
    }

    const field = buildField(def, g, timeIndex, { snowfall: grids.snowfall, precipitation: grids.precipitation });

    const small = document.createElement("canvas");
    small.width = nlon;
    small.height = nlat;
    const sctx = small.getContext("2d");
    if (!sctx) return;
    const img = sctx.createImageData(nlon, nlat);
    for (let iLat = 0; iLat < nlat; iLat++) {
      for (let iLon = 0; iLon < nlon; iLon++) {
        const v = field[iLat * nlon + iLon];
        // Bildzeile 0 = Norden -> Gitterzeile umkehren
        const px = ((nlat - 1 - iLat) * nlon + iLon) * 4;
        if (v === null || v === undefined) {
          img.data[px + 3] = 0;
          continue;
        }
        const [r, gg, b, a] = colorFor(def, v);
        img.data[px] = r;
        img.data[px + 1] = gg;
        img.data[px + 2] = b;
        img.data[px + 3] = a;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);

    // Windpfeile
    const dir = grids.direction;
    if (def.arrows && dir) {
      const step = 2;
      const cw = canvas.width / nlon;
      const ch = canvas.height / nlat;
      ctx.strokeStyle = "rgba(20,25,40,0.75)";
      ctx.fillStyle = "rgba(20,25,40,0.75)";
      ctx.lineWidth = 1.6;
      for (let iLat = 0; iLat < nlat; iLat += step) {
        for (let iLon = 0; iLon < nlon; iLon += step) {
          const d = gridValue(dir, timeIndex, iLat, iLon);
          if (d === null) continue;
          const x = (iLon + 0.5) * cw;
          const y = (nlat - 1 - iLat + 0.5) * ch;
          // meteorologische Richtung: woher der Wind kommt
          const rad = ((d + 180) * Math.PI) / 180;
          const len = Math.min(cw, ch) * 0.9;
          const dx = Math.sin(rad) * len;
          const dy = -Math.cos(rad) * len;
          ctx.beginPath();
          ctx.moveTo(x - dx / 2, y - dy / 2);
          ctx.lineTo(x + dx / 2, y + dy / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x + dx / 2, y + dy / 2, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    publish();
  }, [grids, def, timeIndex, nlat, nlon, webglOk]);

  const hoverValue = useMemo(() => {
    const g = grids.primary;
    if (!g || !hover) return null;
    const iLat = Math.round(((hover.lat - minLat) / (maxLat - minLat)) * (nlat - 1));
    const iLon = Math.round(((hover.lon - minLon) / (maxLon - minLon)) * (nlon - 1));
    if (iLat < 0 || iLon < 0 || iLat >= nlat || iLon >= nlon) return null;
    const field = buildField(def, g, timeIndex, { snowfall: grids.snowfall, precipitation: grids.precipitation });
    const v = field[iLat * nlon + iLon];
    return v === null || v === undefined ? null : v;
  }, [grids, hover, def, timeIndex, minLat, maxLat, minLon, maxLon, nlat, nlon]);

  const range = MODEL_RANGE_HOURS[model];
  const outOfRange = grids.primary ? timeIndex >= grids.primary.nt : false;
  const beyondModel = range !== undefined && timeIndex >= range;
  const noMap = webglOk === false || mapFailed;

  return (
    <div className="relative overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{MODEL_LABELS[model] ?? model}</span>
          {grids.primary && (
            <span className="text-[11px] text-muted-foreground">
              Lauf {new Date(grids.primary.generatedAt).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div className="text-xs tabular-nums">
          {hoverValue !== null ? (
            <span className="font-medium">
              {def.key === "precipitation_type"
                ? `${Math.round(hoverValue * 100)} % Schnee`
                : `${hoverValue.toFixed(def.unit === "%" || def.unit === "°" ? 0 : 1)} ${def.unit}`}
            </span>
          ) : (
            <span className="text-muted-foreground">–</span>
          )}
        </div>
      </div>

      {noMap ? (
        // Fallback ohne WebGL: Feld als Bild über neutralem Hintergrund
        <div className="relative h-[300px] w-full bg-muted/50">
          {fallbackUrl && (
            <img
              src={fallbackUrl}
              alt={`${MODEL_LABELS[model] ?? model} – ${def.label}`}
              className="absolute inset-0 h-full w-full object-contain opacity-90"
            />
          )}
          <div className="absolute inset-x-0 bottom-2 flex justify-center px-2">
            <Badge variant="outline" className="bg-background/90 text-center text-[11px] leading-tight">
              Kartenhintergrund nicht verfügbar (WebGL blockiert) – Modellfeld ohne Karte dargestellt
            </Badge>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="h-[300px] w-full" />
      )}

      {!noMap && (loading || !grids.primary || outOfRange || beyondModel) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
          <Badge variant={loading ? "secondary" : "outline"} className="bg-background/90">
            {loading
              ? "Lädt…"
              : !grids.primary
                ? "Keine Daten für dieses Modell"
                : "Ausserhalb der Modellreichweite"}
          </Badge>
        </div>
      )}
    </div>
  );
}

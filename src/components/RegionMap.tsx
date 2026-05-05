import { useEffect, useRef } from "react";
import maplibregl, { Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Station = { name: string; lat: number; lon: number; color?: string; role?: string };

type Props = {
  lat: number;
  lon: number;
  locationName?: string;
  radiusKm?: number;
  stations?: Station[];
  className?: string;
};

const SWISSTOPO_BASE = "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg";
const SWISSTOPO_RELIEF = "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/3857/{z}/{x}/{y}.png";

// Approx. Polygon-Kreis in GeoJSON-Koordinaten erzeugen.
function circlePolygon(lat: number, lon: number, radiusKm: number, points = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    coords.push([lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
}

export function RegionMap({ lat, lon, locationName = "Standort", radiusKm = 15, stations = [], className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          base: {
            type: "raster",
            tiles: [SWISSTOPO_BASE],
            tileSize: 256,
            attribution: "© swisstopo",
            maxzoom: 18,
          },
          relief: {
            type: "raster",
            tiles: [SWISSTOPO_RELIEF],
            tileSize: 256,
            maxzoom: 17,
          },
        },
        layers: [
          { id: "base", type: "raster", source: "base" },
          { id: "relief", type: "raster", source: "relief", paint: { "raster-opacity": 0.4 } },
        ],
      },
      center: [lon, lat],
      zoom: 10,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      // Radius
      map.addSource("radius", { type: "geojson", data: circlePolygon(lat, lon, radiusKm) });
      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "radius",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "radius-line",
        type: "line",
        source: "radius",
        paint: { "line-color": "#3b82f6", "line-width": 1.5, "line-dasharray": [2, 2] },
      });

      // Hauptstandort
      new Marker({ color: "#dc2626" }).setLngLat([lon, lat])
        .setPopup(new maplibregl.Popup().setText(locationName))
        .addTo(map);

      // Stationen
      for (const s of stations) {
        new Marker({ color: s.color ?? "#2563eb" }).setLngLat([s.lon, s.lat])
          .setPopup(new maplibregl.Popup().setText(`${s.name}${s.role ? ` (${s.role})` : ""}`))
          .addTo(map);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lon, locationName, radiusKm, JSON.stringify(stations)]);

  return <div ref={containerRef} className={className ?? "h-[360px] w-full rounded-md border overflow-hidden"} />;
}

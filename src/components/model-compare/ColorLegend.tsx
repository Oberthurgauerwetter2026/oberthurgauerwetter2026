import { colorFor, type VariableDef } from "@/lib/model-grid";

export function ColorLegend({ def }: { def: VariableDef }) {
  const stops = def.stops;
  const min = def.transparentBelow ?? stops[0].v;
  const max = stops[stops.length - 1].v;
  const steps = 48;
  const gradient = Array.from({ length: steps }, (_, i) => {
    const v = min + ((max - min) * i) / (steps - 1);
    const [r, g, b] = colorFor(def, Math.max(v, min));
    return `rgb(${r},${g},${b}) ${(i / (steps - 1)) * 100}%`;
  }).join(", ");

  return (
    <div className="space-y-1">
      <div className="h-3 w-full rounded" style={{ background: `linear-gradient(to right, ${gradient})` }} />
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        {stops.map((s) => (
          <span key={s.v}>
            {s.v}
            {def.key === "precipitation_type" ? "" : ""}
          </span>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {def.label}
        {def.unit ? ` in ${def.unit}` : ""}
        {def.key === "precipitation_type" ? " (0 = Regen, 1 = Schnee)" : ""}
      </div>
    </div>
  );
}

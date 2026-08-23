import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ChevronLeft, ChevronRight, Clock, Pause, Play } from "lucide-react";
import { formatHour } from "@/lib/model-grid";

type Props = {
  times: string[];
  index: number;
  playing: boolean;
  onIndex: (i: number) => void;
  onPlaying: (p: boolean) => void;
  nowIndex: number;
};

export function TimelineBar({ times, index, playing, onIndex, onPlaying, nowIndex }: Props) {
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      onIndex(index + 1 >= times.length ? 0 : index + 1);
    }, 700);
    return () => clearInterval(id);
  }, [playing, index, times.length, onIndex]);

  const clamp = (i: number) => Math.max(0, Math.min(times.length - 1, i));

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant={playing ? "default" : "outline"} onClick={() => onPlaying(!playing)}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="outline" onClick={() => onIndex(clamp(index - 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="outline" onClick={() => onIndex(clamp(index + 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onIndex(clamp(nowIndex))}>
          <Clock className="mr-1 h-4 w-4" /> Jetzt
        </Button>
        <div className="ml-auto rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground tabular-nums">
          {times[index] ? formatHour(times[index]) : "–"}
          <span className="ml-2 opacity-80">+{index} h</span>
        </div>
      </div>
      <div className="mt-3">
        <Slider
          value={[index]}
          min={0}
          max={Math.max(0, times.length - 1)}
          step={1}
          onValueChange={(v) => onIndex(v[0] ?? 0)}
        />
      </div>
    </div>
  );
}

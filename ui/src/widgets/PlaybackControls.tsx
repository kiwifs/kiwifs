import { Button } from "@kw/components/ui/button";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";

interface Props {
  currentStep: number;
  totalSteps: number;
  playing: boolean;
  speed: number;
  onPlay: () => void;
  onStop: () => void;
  onStepForward: () => void;
  onStepBack: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (step: number) => void;
}

export function PlaybackControls({
  currentStep,
  totalSteps,
  playing,
  speed,
  onPlay,
  onStop,
  onStepForward,
  onStepBack,
  onReset,
  onSpeedChange,
  onSeek,
}: Props) {
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onReset} title="Reset">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onStepBack} disabled={currentStep === 0} title="Step back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {playing ? (
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={onStop} title="Pause">
            <Pause className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={onPlay} disabled={currentStep >= totalSteps - 1} title="Play">
            <Play className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onStepForward} disabled={currentStep >= totalSteps - 1} title="Step forward">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          Step {currentStep} / {totalSteps - 1}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={totalSteps - 1}
        value={currentStep}
        onChange={(e) => {
          onStop();
          onSeek(Number(e.target.value));
        }}
        className="w-full accent-primary"
      />

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Speed:</span>
        {[0.5, 1, 2, 4].map((s) => (
          <Button
            key={s}
            variant={speed === s ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onSpeedChange(s)}
          >
            {s}x
          </Button>
        ))}
      </div>
    </div>
  );
}

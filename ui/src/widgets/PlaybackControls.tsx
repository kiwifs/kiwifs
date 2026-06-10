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
  onSeek: (step: number) => void;
  /** Cycle speed (1x → 2x → 4x → 1x). If omitted, speed badge is hidden. */
  onCycleSpeed?: () => void;
  /** @deprecated Use onCycleSpeed instead. Kept for backward compat. */
  onSpeedChange?: (speed: number) => void;
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
  onSeek,
  onCycleSpeed,
}: Props) {
  const atStart = currentStep === 0;
  const atEnd = currentStep >= totalSteps - 1;

  return (
    <div
      className="flex flex-col gap-2 select-none"
      tabIndex={0}
      role="toolbar"
      aria-label="Playback controls"
    >
      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={totalSteps - 1}
        value={currentStep}
        onChange={(e) => {
          onStop();
          onSeek(Number(e.target.value));
        }}
        className="w-full accent-primary h-1.5 cursor-pointer"
        aria-label={`Step ${currentStep + 1} of ${totalSteps}`}
      />

      {/* Transport row */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onReset} disabled={atStart} title="Reset (r)">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStepBack} disabled={atStart} title="Step back (←)">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {playing ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStop} title="Pause (space)">
            <Pause className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPlay} disabled={atEnd} title="Play (space)">
            <Play className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStepForward} disabled={atEnd} title="Step forward (→)">
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Step counter */}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {currentStep + 1}/{totalSteps}
        </span>

        {/* Speed badge — single click cycles */}
        {onCycleSpeed && (
          <button
            onClick={onCycleSpeed}
            className="ml-1 text-[10px] font-medium text-muted-foreground hover:text-foreground bg-muted rounded px-1.5 py-0.5 tabular-nums transition-colors"
            title="Cycle speed"
          >
            {speed}x
          </button>
        )}
      </div>
    </div>
  );
}

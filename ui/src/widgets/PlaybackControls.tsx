import { Button } from "@kw/components/ui/button";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import type { PlaybackControlsBinding } from "./usePlayback";

interface Props {
  /** The object returned by usePlayback; replaces every prop below. */
  pb?: { controls: PlaybackControlsBinding };
  currentStep?: number;
  totalSteps?: number;
  playing?: boolean;
  speed?: number;
  onPlay?: () => void;
  onStop?: () => void;
  onStepForward?: () => void;
  onStepBack?: () => void;
  onReset?: () => void;
  onSeek?: (step: number) => void;
  /** Cycle speed (1x → 2x → 4x → 1x). If omitted, speed badge is hidden. */
  onCycleSpeed?: () => void;
  /** @deprecated Use onCycleSpeed instead. Kept for backward compat. */
  onSpeedChange?: (speed: number) => void;
}

const noop = () => {};

export function PlaybackControls({ pb, ...props }: Props) {
  const b = { ...pb?.controls, ...stripUndefined(props) };
  const currentStep = b.currentStep ?? 0;
  const totalSteps = b.totalSteps ?? 1;
  const playing = b.playing ?? false;
  const speed = b.speed ?? 1;
  const onPlay = b.onPlay ?? noop;
  const onStop = b.onStop ?? noop;
  const onStepForward = b.onStepForward ?? noop;
  const onStepBack = b.onStepBack ?? noop;
  const onReset = b.onReset ?? noop;
  const onSeek = b.onSeek ?? noop;
  const onCycleSpeed = b.onCycleSpeed;
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
        className="w-full h-1.5 cursor-pointer"
        style={{
          ["--kw-range-progress" as string]: `${
            totalSteps > 1 ? (currentStep / (totalSteps - 1)) * 100 : 0
          }%`,
        }}
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

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

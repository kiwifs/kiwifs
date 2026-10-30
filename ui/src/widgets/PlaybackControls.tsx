import { useEffect, useRef, useState } from "react";
import { Button } from "@kw/components/ui/button";
import { Check, ChevronLeft, ChevronRight, Download, Link, Pause, Play, RotateCcw } from "lucide-react";
import type { PlaybackControlsBinding } from "./usePlayback";
import { clockStepLink } from "./playbackClock";
import { downloadSnapshot } from "./snapshot";

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
  /** Clock to build the "copy link to this step" URL from. */
  clockId?: string;
  /** Widget root to snapshot, and the filename to offer. */
  snapshot?: { root: React.RefObject<HTMLElement | null>; name: string };
  /**
   * Hold the transport: the current step is waiting on the reader. Stepping
   * back and resetting still work — being stuck is not the same as being
   * trapped.
   */
  blocked?: boolean;
  /** @deprecated Use onCycleSpeed instead. Kept for backward compat. */
  onSpeedChange?: (speed: number) => void;
}

const noop = () => {};

export function PlaybackControls({ pb, ...props }: Props) {
  const [copied, setCopied] = useState(false);
  const [snapshotNote, setSnapshotNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);
  const flashSnapshotNote = (note: string | null) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setSnapshotNote(note);
    if (note) noteTimer.current = setTimeout(() => setSnapshotNote(null), 4000);
  };
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
  const clockId = b.clockId;
  const snapshot = b.snapshot;
  const blocked = b.blocked ?? false;
  const atStart = currentStep === 0;
  const atEnd = currentStep >= totalSteps - 1 || blocked;

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
          const next = Number(e.target.value);
          // Scrubbing forward past a step that is waiting on the reader would
          // skip the question; scrubbing back is always allowed.
          onSeek(blocked ? Math.min(next, currentStep) : next);
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

        {/* Deep link to the step the reader is looking at */}
        {clockId && (
          <button
            onClick={() => {
              const url = clockStepLink(clockId);
              if (!url) return;
              navigator.clipboard?.writeText(url).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => {},
              );
            }}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy link to this step"
            aria-label="Copy link to this step"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Link className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* Download the frame the reader is looking at */}
        {snapshot && (
          <>
            <button
              onClick={(e) => {
                const el = snapshot.root.current;
                if (!el) return;
                // Shift-click gives SVG, which stays sharp and stays editable.
                const format = e.shiftKey ? "svg" : "png";
                downloadSnapshot(el, snapshot.name, format).then(
                  (saved) => flashSnapshotNote(saved === format ? null : "Saved as SVG"),
                  (err: unknown) =>
                    flashSnapshotNote(`Snapshot failed${err instanceof Error && err.message ? `: ${err.message}` : ""}`),
                );
              }}
              className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Download this step as PNG (Shift-click for SVG)"
              aria-label="Download this step as an image"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            {snapshotNote && (
              <span role="status" className="ml-1 text-[10px] text-muted-foreground" title={snapshotNote}>
                {snapshotNote}
              </span>
            )}
          </>
        )}

        {/* Speed badge — single click cycles */}
        {onCycleSpeed && (
          <button
            onClick={onCycleSpeed}
            className="ml-1 text-[10px] font-medium text-foreground/75 hover:text-foreground bg-muted rounded px-1.5 py-0.5 tabular-nums transition-colors"
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

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ensureRootTracking, keyBelongsTo, useWidgetRoot } from "./widgetRoot";

export interface Step<T> {
  state: T;
  label: string;
  /** If true, auto-play pauses when reaching this step. */
  breakpoint?: boolean;
  /** How long auto-play lingers on this step at 1x, in ms. */
  duration?: number;
}

export interface PlaybackControlsBinding {
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
  onCycleSpeed: () => void;
}

export interface PlaybackReturn<T> {
  current: Step<T>;
  currentStep: number;
  totalSteps: number;
  playing: boolean;
  speed: number;
  play: () => void;
  stop: () => void;
  stepForward: () => void;
  stepBack: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  setCurrentStep: (step: number) => void;
  /** Cycle through speed presets: 1 → 2 → 4 → 1 */
  cycleSpeed: () => void;
  /** Spread into PlaybackControls, or pass the whole object as `pb`. */
  controls: PlaybackControlsBinding;
}

export interface PlaybackOptions {
  /** Ref scoping keyboard events. Defaults to the enclosing widget. */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Default ms per step at 1x. Defaults to 600. */
  interval?: number;
  /** Start playing on mount. */
  autoPlay?: boolean;
  /** Wrap to the first step instead of stopping at the end. */
  loop?: boolean;
}

const SPEED_PRESETS = [1, 2, 4];
const EMPTY_STEP: Step<never> = { state: {} as never, label: "" };

/**
 * A step written flat as `{ ...fields, label }` keeps its fields on
 * `current` and also exposes itself as `current.state`.
 */
function normalizeStep<T>(raw: unknown): Step<T> {
  if (raw && typeof raw === "object" && "state" in raw) return raw as Step<T>;
  if (raw && typeof raw === "object") {
    const flat = raw as Record<string, unknown>;
    return { ...flat, state: raw as T, label: flat.label == null ? "" : String(flat.label) } as Step<T>;
  }
  return { state: raw as T, label: "" };
}

function isRef(v: unknown): v is React.RefObject<HTMLElement | null> {
  return typeof v === "object" && v !== null && "current" in v && Object.keys(v).length === 1;
}

function readHashStep(total: number): number {
  if (typeof window === "undefined") return 0;
  const match = window.location.hash.match(/[?&]step=(\d+)/);
  if (!match) return 0;
  const s = parseInt(match[1]!, 10);
  return isNaN(s) ? 0 : Math.max(0, Math.min(s, total - 1));
}

export function usePlayback<T>(
  steps: Step<T>[],
  /** A container ref (legacy) or options. */
  arg?: React.RefObject<HTMLElement | null> | PlaybackOptions,
): PlaybackReturn<T> {
  const opts: PlaybackOptions = isRef(arg) ? { containerRef: arg } : (arg ?? {});
  const { containerRef, interval = 600, autoPlay = false, loop = false } = opts;
  const list = Array.isArray(steps) ? steps : [];
  const total = Math.max(1, list.length);
  const widgetRoot = useWidgetRoot();

  const [rawStep, setRawStep] = useState(() => readHashStep(list.length));
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(1);
  const currentStep = Math.max(0, Math.min(rawStep, total - 1));

  const stop = useCallback(() => setPlaying(false), []);
  const play = useCallback(() => {
    setRawStep((s) => (!loop && s >= total - 1 ? 0 : s));
    setPlaying(true);
  }, [loop, total]);

  const stepForward = useCallback(() => {
    setRawStep((s) => Math.min(Math.min(s, total - 1) + 1, total - 1));
  }, [total]);

  const stepBack = useCallback(() => {
    setRawStep((s) => Math.max(Math.min(s, total - 1) - 1, 0));
  }, [total]);

  const reset = useCallback(() => {
    setPlaying(false);
    setRawStep(0);
  }, []);

  const seek = useCallback((s: number) => {
    setRawStep(Math.max(0, Math.min(Math.round(s), total - 1)));
  }, [total]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEED_PRESETS.indexOf(prev);
      return SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length]!;
    });
  }, []);

  const current = useMemo(
    () => (list.length ? normalizeStep<T>(list[currentStep]) : (EMPTY_STEP as Step<T>)),
    [list, currentStep],
  );

  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    if (!playing) return;
    if (currentStep >= total - 1 && !loop) {
      setPlaying(false);
      return;
    }
    const here = normalizeStep<T>(listRef.current[currentStep]);
    const ms = (here.duration ?? interval) / speed;
    const timer = setTimeout(() => {
      const next = currentStep >= total - 1 ? 0 : currentStep + 1;
      setRawStep(next);
      if (normalizeStep(listRef.current[next]).breakpoint) setPlaying(false);
    }, ms);
    return () => clearTimeout(timer);
  }, [playing, currentStep, total, loop, interval, speed]);

  useEffect(() => {
    ensureRootTracking();
    const scoped = containerRef?.current;
    const target: EventTarget = scoped ?? document;
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.defaultPrevented || ke.metaKey || ke.ctrlKey || ke.altKey) return;
      const el = ke.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (!scoped && widgetRoot?.current && !keyBelongsTo(widgetRoot.current, ke.target)) return;

      switch (ke.key) {
        case " ":
          if (tag === "BUTTON") return;
          ke.preventDefault();
          setPlaying((p) => !p);
          break;
        case "ArrowRight":
          ke.preventDefault();
          setPlaying(false);
          stepForward();
          break;
        case "ArrowLeft":
          ke.preventDefault();
          setPlaying(false);
          stepBack();
          break;
        case "r":
          ke.preventDefault();
          reset();
          break;
      }
    };
    target.addEventListener("keydown", handler);
    return () => target.removeEventListener("keydown", handler);
  }, [containerRef, widgetRoot, stepForward, stepBack, reset]);

  const controls = useMemo<PlaybackControlsBinding>(() => ({
    currentStep,
    totalSteps: total,
    playing,
    speed,
    onPlay: play,
    onStop: stop,
    onStepForward: stepForward,
    onStepBack: stepBack,
    onReset: reset,
    onSeek: seek,
    onCycleSpeed: cycleSpeed,
  }), [currentStep, total, playing, speed, play, stop, stepForward, stepBack, reset, seek, cycleSpeed]);

  return {
    current,
    currentStep,
    totalSteps: total,
    playing,
    speed,
    play,
    stop,
    stepForward,
    stepBack,
    reset,
    setSpeed,
    setCurrentStep: seek,
    cycleSpeed,
    controls,
  };
}

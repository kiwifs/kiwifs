import {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";
import { ensureRootTracking, keyBelongsTo, partHasFocus, useWidgetRoot } from "./widgetRoot";
import {
  anonymousClockId,
  clockSnapshot,
  consumeDeepLink,
  joinClock,
  leaveClock,
  playClock,
  privateClockId,
  seekClock,
  setClockPlaying,
  setClockSpeed,
  stepClock,
  subscribeClock,
  type ClockKind,
  type ClockSnapshot,
  type StepTiming,
} from "./playbackClock";
import { useClockId } from "./clockContext";

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
  /** Identifies the clock for "copy link to this step". */
  clockId?: string;
  /** A member of the clock is waiting on the reader. */
  blocked?: boolean;
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
  /** The clock this playback is driven by. Empty until the first commit. */
  clockId: string;
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
  /**
   * Share a step counter with every other playback naming the same clock, and
   * persist it as `#?step.<id>=N`. Without one, this playback gets its own
   * clock, as it always had. `null` opts out of the page entirely: no sharing,
   * no URL key, no deep-link scroll — for a figure with nothing to play.
   */
  clock?: string | null;
  /**
   * The current step is waiting on the reader. Autoplay pauses and stepping
   * forward is refused; stepping back, seeking and resetting still work.
   */
  blocked?: boolean;
}

const SPEED_PRESETS = [1, 2, 4];
const EMPTY_STEP: Step<never> = { state: {} as never, label: "" };
const noopUnsubscribe = () => {};

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

/** Every key a playback answers to. kiwi-app's runtime.js forwards this same set. */
export const PLAYBACK_KEYS: readonly string[] = [" ", "ArrowRight", "ArrowLeft", "Home", "End", "r"];

/**
 * Apply a playback key to a clock. Returns false for a key that is not one,
 * so the caller can leave the event alone. Focus checks are the caller's.
 */
export function playbackKeyAction(key: string, clockId: string): boolean {
  if (!clockId) return false;
  switch (key) {
    case " ":
      if (clockSnapshot(clockId).playing) setClockPlaying(clockId, false);
      else playClock(clockId);
      return true;
    case "ArrowRight":
    case "ArrowLeft":
      setClockPlaying(clockId, false);
      stepClock(clockId, key === "ArrowRight" ? 1 : -1, { persist: true });
      return true;
    case "Home":
    case "End":
      setClockPlaying(clockId, false);
      seekClock(clockId, key === "Home" ? 0 : clockSnapshot(clockId).total - 1, { persist: true });
      return true;
    case "r":
      setClockPlaying(clockId, false);
      seekClock(clockId, 0, { persist: true });
      return true;
  }
  return false;
}

function isRef(v: unknown): v is React.RefObject<HTMLElement | null> {
  return typeof v === "object" && v !== null && "current" in v && Object.keys(v).length === 1;
}

export function usePlayback<T>(
  steps: Step<T>[],
  /** A container ref (legacy) or options. */
  arg?: React.RefObject<HTMLElement | null> | PlaybackOptions,
): PlaybackReturn<T> {
  const opts: PlaybackOptions = isRef(arg) ? { containerRef: arg } : (arg ?? {});
  const { containerRef, interval = 600, autoPlay = false, loop = false, blocked = false } = opts;
  const list = Array.isArray(steps) ? steps : [];
  const total = Math.max(1, list.length);
  const widgetRoot = useWidgetRoot();
  const inheritedClock = useClockId();

  const optedOut = opts.clock === null;
  const namedId = optedOut ? null : (opts.clock ?? inheritedClock ?? null);
  const kind: ClockKind = optedOut ? "private" : namedId ? "named" : "anonymous";

  // One token per hook instance: the clock's member identity, and the key an
  // unnamed clock's id is allocated against.
  const [member] = useState<object>(() => ({}));
  // Unnamed ids are handed out in commit order, which is document order, so
  // the first stepped widget on a page owns the legacy `#?step=` key. Doing
  // that during render would let a discarded render burn an id.
  const [ownId, setOwnId] = useState<string | null>(null);
  const clockId = namedId ?? ownId;

  useLayoutEffect(() => {
    if (namedId) return;
    const id = optedOut ? privateClockId(member) : anonymousClockId(member);
    if (id !== ownId) setOwnId(id);
  }, [namedId, optedOut, ownId, member]);

  const listRef = useRef(list);
  listRef.current = list;
  const stepAt = useCallback((i: number): StepTiming | undefined => {
    const raw = listRef.current[i];
    return raw === undefined ? undefined : normalizeStep(raw);
  }, []);

  const subscribe = useCallback(
    (fn: () => void) => (clockId ? subscribeClock(clockId, kind, fn) : noopUnsubscribe),
    [clockId, kind],
  );
  // Before the first commit nothing is registered; render a still frame
  // rather than touching the store from render.
  const local = useMemo<ClockSnapshot>(
    () => ({ id: "", step: 0, playing: false, speed: 1, total, blocked }),
    [total, blocked],
  );
  const read = useCallback(() => (clockId ? clockSnapshot(clockId) : local), [clockId, local]);
  const snapshot = useSyncExternalStore(subscribe, read, read);

  // Joining can move the step (a deep link, a longer member). The store only
  // notifies subscribers, and the subscription is a passive effect, so pull
  // the new frame in before paint instead of flashing the old one.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    if (!clockId) return;
    const after = joinClock(clockId, kind, member, { total, stepAt, interval, loop, blocked });
    if (after !== snapshot) rerender();
    // `snapshot` is read for this commit only; it must not re-run the join.
  }, [clockId, kind, member, total, stepAt, interval, loop, blocked]);

  useLayoutEffect(() => {
    if (!clockId) return;
    return () => leaveClock(clockId, member);
  }, [clockId, member]);

  const currentStep = Math.max(0, Math.min(snapshot.step, total - 1));
  const clockTotal = Math.max(total, snapshot.total);
  const playing = snapshot.playing;
  const speed = snapshot.speed;

  const stop = useCallback(() => {
    if (clockId) setClockPlaying(clockId, false);
  }, [clockId]);

  const play = useCallback(() => {
    if (clockId) playClock(clockId);
  }, [clockId]);

  const stepForward = useCallback(() => {
    if (clockId) stepClock(clockId, 1, { persist: true });
  }, [clockId]);

  const stepBack = useCallback(() => {
    if (clockId) stepClock(clockId, -1, { persist: true });
  }, [clockId]);

  const reset = useCallback(() => {
    if (!clockId) return;
    setClockPlaying(clockId, false);
    seekClock(clockId, 0, { persist: true });
  }, [clockId]);

  const seek = useCallback(
    (s: number) => {
      if (clockId) seekClock(clockId, s, { persist: true });
    },
    [clockId],
  );

  const setSpeed = useCallback(
    (s: number) => {
      if (clockId) setClockSpeed(clockId, s);
    },
    [clockId],
  );

  const cycleSpeed = useCallback(() => {
    if (!clockId) return;
    const idx = SPEED_PRESETS.indexOf(clockSnapshot(clockId).speed);
    setClockSpeed(clockId, SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length]!);
  }, [clockId]);

  const current = useMemo(
    () => (list.length ? normalizeStep<T>(list[Math.min(currentStep, list.length - 1)]) : (EMPTY_STEP as Step<T>)),
    [list, currentStep],
  );

  useEffect(() => {
    if (autoPlay && clockId) playClock(clockId);
  }, [autoPlay, clockId]);

  /** Scroll a deep-linked widget into view once, so the link lands on it. */
  useEffect(() => {
    if (!clockId || optedOut || !consumeDeepLink(clockId)) return;
    const el = containerRef?.current ?? widgetRoot?.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("kiwi-widget-flash");
      setTimeout(() => el.classList.remove("kiwi-widget-flash"), 1200);
    }, 120);
    return () => clearTimeout(timer);
  }, [clockId, optedOut, containerRef, widgetRoot]);

  useEffect(() => {
    if (!clockId) return;
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
      // A focused cell owns Space and the arrows; it is moving the reader's
      // cursor or selecting, not driving the clock. The native listener runs
      // before React's, so the part's own preventDefault arrives too late.
      const root = scoped ?? widgetRoot?.current;
      const partFocused = root ? partHasFocus(root, ke.target) : false;

      if (!PLAYBACK_KEYS.includes(ke.key)) return;
      if (partFocused && ke.key !== "r") return;
      if (ke.key === " " && tag === "BUTTON") return;
      ke.preventDefault();
      playbackKeyAction(ke.key, clockId);
    };
    target.addEventListener("keydown", handler);
    return () => target.removeEventListener("keydown", handler);
  }, [containerRef, widgetRoot, clockId]);

  const linkId = optedOut ? undefined : (clockId ?? undefined);
  const controls = useMemo<PlaybackControlsBinding>(() => ({
    currentStep,
    totalSteps: clockTotal,
    playing,
    speed,
    onPlay: play,
    onStop: stop,
    onStepForward: stepForward,
    onStepBack: stepBack,
    onReset: reset,
    onSeek: seek,
    onCycleSpeed: cycleSpeed,
    clockId: linkId,
    blocked: snapshot.blocked,
  }), [currentStep, clockTotal, playing, speed, play, stop, stepForward, stepBack, reset, seek, cycleSpeed, linkId, snapshot.blocked]);

  return {
    current,
    currentStep,
    totalSteps: clockTotal,
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
    clockId: clockId ?? "",
    controls,
  };
}

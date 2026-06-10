import { useState, useRef, useCallback, useEffect } from "react";

export interface Step<T> {
  state: T;
  label: string;
  /** If true, auto-play pauses when reaching this step. */
  breakpoint?: boolean;
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
}

const SPEED_PRESETS = [1, 2, 4];

export function usePlayback<T>(
  steps: Step<T>[],
  /** Optional ref to the container element for scoping keyboard events. */
  containerRef?: React.RefObject<HTMLElement | null>,
): PlaybackReturn<T> {
  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    stop();
    setPlaying(true);
  }, [stop]);

  const stepForward = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  }, [steps.length]);

  const stepBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const reset = useCallback(() => {
    stop();
    setCurrentStep(0);
  }, [stop]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEED_PRESETS.indexOf(prev);
      return SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length]!;
    });
  }, []);

  useEffect(() => {
    if (!playing) return;
    const interval = 600 / speed;
    timerRef.current = setInterval(() => {
      setCurrentStep((s) => {
        if (s >= steps.length - 1) {
          stop();
          return s;
        }
        const next = s + 1;
        if (steps[next]?.breakpoint) {
          stop();
        }
        return next;
      });
    }, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, steps.length, stop, steps]);

  // Keyboard controls scoped to container (or document if no container)
  useEffect(() => {
    const target = containerRef?.current ?? document;
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      const tag = (ke.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (ke.key) {
        case " ":
          ke.preventDefault();
          setPlaying((p) => {
            if (p) {
              stop();
              return false;
            }
            play();
            return true;
          });
          break;
        case "ArrowRight":
          ke.preventDefault();
          stop();
          stepForward();
          break;
        case "ArrowLeft":
          ke.preventDefault();
          stop();
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
  }, [containerRef, play, stop, stepForward, stepBack, reset]);

  return {
    current: steps[currentStep]!,
    currentStep,
    totalSteps: steps.length,
    playing,
    speed,
    play,
    stop,
    stepForward,
    stepBack,
    reset,
    setSpeed,
    setCurrentStep,
    cycleSpeed,
  };
}

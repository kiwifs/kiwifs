import { useState, useRef, useCallback, useEffect } from "react";

export interface Step<T> {
  state: T;
  label: string;
}

export function usePlayback<T>(steps: Step<T>[]) {
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

  useEffect(() => {
    if (!playing) return;
    const interval = 600 / speed;
    timerRef.current = setInterval(() => {
      setCurrentStep((s) => {
        if (s >= steps.length - 1) {
          stop();
          return s;
        }
        return s + 1;
      });
    }, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, steps.length, stop]);

  return {
    current: steps[currentStep],
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
  };
}

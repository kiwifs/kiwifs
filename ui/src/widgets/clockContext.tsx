import { createContext, useContext, type ReactNode } from "react";

/**
 * The clock every `usePlayback` in this subtree joins unless it names one
 * itself. Lets a `widget:live` block put two views and one scrubber in a
 * `WidgetLayout` without threading a clock id through every component.
 */
const ClockIdContext = createContext<string | null>(null);

export const PlaybackClockProvider = ClockIdContext.Provider;

export function useClockId(): string | null {
  return useContext(ClockIdContext);
}

export interface PlaybackClockProps {
  /** Clock name. Scoped to the page; the same name elsewhere is unrelated. */
  id: string;
  /** Every playback inside steps on this clock. */
  children: ReactNode;
}

/**
 * Put two views and one scrubber on the same step counter:
 *
 *   <PlaybackClock id="a">
 *     <WidgetLayout>…</WidgetLayout>
 *   </PlaybackClock>
 */
export function PlaybackClock({ id, children }: PlaybackClockProps) {
  return <PlaybackClockProvider value={id}>{children}</PlaybackClockProvider>;
}

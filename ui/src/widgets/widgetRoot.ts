import { createContext, useContext, type RefObject } from "react";

/**
 * The DOM root of the widget a hook is rendered in. Playback keys only act on
 * the widget the reader is working with, not on every widget on the page.
 */
export const WidgetRootContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useWidgetRoot(): RefObject<HTMLElement | null> | null {
  return useContext(WidgetRootContext);
}

const ROOT_SELECTOR = ".kiwi-widget";
let lastActiveRoot: Element | null = null;
let tracking = false;

function track(e: Event) {
  const t = e.target as Element | null;
  lastActiveRoot = t && typeof t.closest === "function" ? t.closest(ROOT_SELECTOR) : null;
}

export function ensureRootTracking() {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener("pointerdown", track, true);
  document.addEventListener("focusin", track, true);
}

/**
 * True when a key event should drive the widget rooted at `root`: focus is
 * inside it, or nothing is focused and the reader last touched this widget.
 */
export function keyBelongsTo(root: Element, target: EventTarget | null): boolean {
  const node = target as Node | null;
  if (node && root.contains(node)) return true;
  const idle = !node || node === document.body || node === document.documentElement || node === document;
  return idle && lastActiveRoot === root;
}

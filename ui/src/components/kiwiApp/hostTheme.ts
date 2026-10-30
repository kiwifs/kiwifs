/**
 * The host theme as kiwi-apps see it: one reader and one observer per page,
 * however many apps it holds, so a theme toggle costs one getComputedStyle.
 */

import { THEME_CHANGE_EVENT } from "@kw/lib/kiwiTheme";

/** Every host variable forwarded into a kiwi-app. Tests hold this against kiwi-theme.css. */
export const KIWI_APP_TOKENS = [
  "--background",
  "--foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--primary",
  "--primary-foreground",
  "--card",
  "--card-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--ring",
  "--radius",
  "--font-sans",
  "--font-mono",
  "--font-serif",
  "--kw-widget-text",
  "--kw-widget-dim",
  "--kw-widget-border",
  "--kw-widget-active",
  "--kw-widget-active-foreground",
  "--kw-widget-highlight",
  "--kw-widget-water",
  "--kw-widget-bar",
  "--kw-widget-surface",
  "--kw-widget-surface-raised",
  "--kw-widget-accent-red",
  "--kw-widget-accent-amber",
  "--kw-widget-accent-blue",
  "--kw-widget-accent-indigo",
  "--kw-widget-group-0",
  "--kw-widget-group-1",
  "--kw-widget-group-2",
  "--kw-widget-group-3",
  "--kw-widget-group-4",
  "--kw-widget-group-5",
  "--kw-widget-value-string",
  "--kw-widget-value-number",
  "--kw-widget-value-boolean",
  "--kw-widget-value-object",
] as const;

export interface HostTheme {
  vars: Record<string, string>;
  dark: boolean;
}

export function readHostTheme(): HostTheme {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const vars: Record<string, string> = {};
  for (const name of KIWI_APP_TOKENS) {
    // A value lands inside a <style> in the app's srcdoc; no markup may ride along.
    const value = computed.getPropertyValue(name).trim().replace(/[<>]/g, "");
    if (value) vars[name] = value;
  }
  return { vars, dark: root.classList.contains("dark") };
}

export function themeCss({ vars, dark }: HostTheme): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n  color-scheme: ${dark ? "dark" : "light"};\n}`;
}

type Listener = (theme: HostTheme) => void;
const listeners = new Set<Listener>();
let current: HostTheme | null = null;
let currentKey = "";
let frame = 0;
let stop: (() => void) | null = null;

function flush() {
  frame = 0;
  const next = readHostTheme();
  const key = JSON.stringify(next);
  if (key === currentKey) return;
  current = next;
  currentKey = key;
  for (const fn of listeners) fn(next);
}

function schedule() {
  if (frame) return;
  frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
}

function start() {
  current = readHostTheme();
  currentKey = JSON.stringify(current);
  // `.dark` and inline palette overrides land on <html>; palettes injected as a
  // <style> (applyKiwiTheme, the theme editor, listenForKiwiTheme) announce
  // themselves with the event instead.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  window.addEventListener(THEME_CHANGE_EVENT, schedule);
  stop = () => {
    observer.disconnect();
    window.removeEventListener(THEME_CHANGE_EVENT, schedule);
    if (frame) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      clearTimeout(frame);
    }
    frame = 0;
    stop = null;
  };
}

export function subscribeHostTheme(fn: Listener): () => void {
  if (listeners.size === 0) start();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop?.();
  };
}

/** The theme as of the last frame, or a fresh read when nothing is subscribed. */
export function currentHostTheme(): HostTheme {
  return stop && current ? current : readHostTheme();
}

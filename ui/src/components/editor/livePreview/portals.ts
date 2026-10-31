import type { ReactNode } from "react";

/**
 * React content for CodeMirror widget DOM. A widget registers its container
 * here and the editor component renders each entry with `createPortal`, so a
 * widget is part of the page's React tree (its providers, theme and error
 * boundaries) instead of a separate root per widget.
 */
export class WidgetPortals {
  private entries = new Map<HTMLElement, { key: number; node: ReactNode }>();
  private listeners = new Set<() => void>();
  private snapshot: { key: number; dom: HTMLElement; node: ReactNode }[] = [];
  private nextKey = 0;

  set(dom: HTMLElement, node: ReactNode) {
    const key = this.entries.get(dom)?.key ?? this.nextKey++;
    this.entries.set(dom, { key, node });
    this.emit();
  }

  delete(dom: HTMLElement) {
    if (this.entries.delete(dom)) this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = [...this.entries].map(([dom, { key, node }]) => ({ key, dom, node }));
    this.listeners.forEach((l) => l());
  }
}

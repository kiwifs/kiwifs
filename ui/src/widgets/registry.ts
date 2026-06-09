import type { FC } from "react";

export type WidgetProps = { config: Record<string, unknown> };
export type WidgetComponent = FC<WidgetProps>;

const widgets = new Map<string, WidgetComponent>();

export function registerWidget(name: string, component: WidgetComponent): void {
  widgets.set(name, component);
}

export function unregisterWidget(name: string): boolean {
  return widgets.delete(name);
}

export function getWidget(name: string): WidgetComponent | undefined {
  return widgets.get(name);
}

export function getRegisteredWidgets(): string[] {
  return Array.from(widgets.keys());
}

export function clearWidgets(): void {
  widgets.clear();
}

/**
 * Host embed configuration for KiwiFS UI (self-host, cloud shell, iframes).
 *
 * Set before boot:
 *   window.__KIWIFS_CONFIG__ = {
 *     toolbar: {
 *       builtins: ["graph", "kanban"],
 *       actions: [{ id: "my-tool", icon: "Wand2", label: "My tool" }],
 *     },
 *     pageActions: [{ id: "watch", icon: "Eye", activeIcon: "EyeOff", label: "Watch", activeLabel: "Unwatch" }],
 *   };
 *
 * Listen for clicks:
 *   window.addEventListener("kiwifs-toolbar-action", (e) => {
 *     if (e.detail.id === "my-tool") { ... }
 *   });
 *   window.addEventListener("kiwifs-page-action", (e) => {
 *     if (e.detail.id === "watch") { console.log(e.detail.path); }
 *   });
 *
 * Optional active/disabled styling from the host:
 *   window.dispatchEvent(new CustomEvent("kiwifs-host-toolbar-state", {
 *     detail: { "my-tool": { active: true } },
 *   }));
 *   window.dispatchEvent(new CustomEvent("kiwifs-host-page-action-state", {
 *     detail: { "watch": { active: true } },
 *   }));
 */

export type KiwiToolbarAction = {
  /** Stable id; emitted in kiwifs-toolbar-action detail */
  id: string;
  /** Lucide icon export name, e.g. "BotMessageSquare" */
  icon: string;
  /** Tooltip + aria-label */
  label: string;
  disabled?: boolean;
};

export type KiwiPageAction = {
  /** Stable id; emitted in kiwifs-page-action detail */
  id: string;
  /** Lucide icon export name for default state */
  icon: string;
  /** Lucide icon export name when active (optional) */
  activeIcon?: string;
  /** Tooltip + aria-label */
  label: string;
  /** Tooltip when active (optional) */
  activeLabel?: string;
  disabled?: boolean;
};

export type KiwiToolbarActionState = {
  active?: boolean;
  disabled?: boolean;
};

export type KiwiPageActionState = {
  active?: boolean;
  disabled?: boolean;
};

export type KiwiToolbarConfig = {
  /** Built-in view button ids to show, in order (e.g. "graph", "kanban"). */
  builtins?: string[];
  /** Host-injected toolbar buttons rendered after built-ins. */
  actions?: KiwiToolbarAction[];
};

export type KiwiDemoViewId =
  | "graph"
  | "kanban"
  | "bases"
  | "timeline"
  | "calendar"
  | "canvas"
  | "whiteboard"
  | "data";

export type KiwiDemoConfig = {
  /** Template slug shown in the gallery, e.g. "adr". */
  slug: string;
  /** Page to open on load. */
  initialPath?: string;
  /** Full-screen view to open on load (toolbar views). */
  initialView?: KiwiDemoViewId;
};

export type KiwiHostConfig = {
  allowedOrigins?: string[];
  toolbar?: KiwiToolbarConfig;
  /** @deprecated Use toolbar.actions */
  toolbarActions?: KiwiToolbarAction[];
  pageActions?: KiwiPageAction[];
  /** Static demo gallery mode — disables /page/* URL rewriting. */
  demo?: KiwiDemoConfig;
};

export const KIWI_TOOLBAR_ACTION_EVENT = "kiwifs-toolbar-action";
export const KIWI_TOOLBAR_STATE_EVENT = "kiwifs-host-toolbar-state";
export const KIWI_PAGE_ACTION_EVENT = "kiwifs-page-action";
export const KIWI_PAGE_ACTION_STATE_EVENT = "kiwifs-host-page-action-state";
export const KIWI_PAGE_CHANGED_EVENT = "kiwifs-page-changed";

declare global {
  interface Window {
    __KIWIFS_CONFIG__?: KiwiHostConfig;
  }
}

export function getHostConfig(): KiwiHostConfig {
  if (typeof window === "undefined") return {};
  return window.__KIWIFS_CONFIG__ ?? {};
}

export function getToolbarActions(): KiwiToolbarAction[] {
  const cfg = getHostConfig();
  return cfg.toolbar?.actions ?? cfg.toolbarActions ?? [];
}

export function getToolbarBuiltinViews(): string[] | undefined {
  return getHostConfig().toolbar?.builtins;
}

export function getPageActions(): KiwiPageAction[] {
  return getHostConfig().pageActions ?? [];
}

export function dispatchToolbarAction(id: string): void {
  window.dispatchEvent(
    new CustomEvent(KIWI_TOOLBAR_ACTION_EVENT, { detail: { id } }),
  );
}

export function dispatchPageAction(id: string, path: string): void {
  window.dispatchEvent(
    new CustomEvent(KIWI_PAGE_ACTION_EVENT, { detail: { id, path } }),
  );
}

export function dispatchPageChanged(path: string | null): void {
  window.dispatchEvent(
    new CustomEvent(KIWI_PAGE_CHANGED_EVENT, { detail: { path } }),
  );
}

export type ToolbarActionEvent = CustomEvent<{ id: string }>;
export type ToolbarStateEvent = CustomEvent<Record<string, KiwiToolbarActionState>>;
export type PageActionEvent = CustomEvent<{ id: string; path: string }>;
export type PageActionStateEvent = CustomEvent<Record<string, KiwiPageActionState>>;
export type PageChangedEvent = CustomEvent<{ path: string | null }>;

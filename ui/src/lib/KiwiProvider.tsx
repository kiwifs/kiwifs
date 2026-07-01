/**
 * KiwiProvider — React context that decouples KiwiFS components from the
 * Go sidecar.  Three operating modes:
 *
 *   connected — components fetch from a KiwiFS server (default, current behaviour)
 *   static    — host passes content directly; no network calls
 *   custom    — host supplies a fetcher function
 *
 * Also handles theme passthrough so embedded KiwiFS components inherit the
 * host app's design tokens.
 */

import React, { createContext, useContext, useEffect, useMemo } from "react";
import { type TreeEntry } from "./api";
import { type LinkResolver, buildResolver } from "./wikiLinks";
import { applyKiwiTheme, type KiwiThemeOverrides, type KiwiTokens } from "./kiwiTheme";

// ── Public types ────────────────────────────────────────────────────────────

export type KiwiFetcher = {
  readFile: (path: string) => Promise<{ content: string; lastModified?: string | null }>;
  tree?: (root: string) => Promise<TreeEntry>;
};

export type KiwiThemeProp =
  | "inherit"
  | KiwiTokens
  | { light?: KiwiTokens; dark?: KiwiTokens };

export type KiwiProviderProps = {
  children: React.ReactNode;

  /** KiwiFS server endpoint. Enables "connected" mode. */
  endpoint?: string;

  /** Pass markdown content directly. Enables "static" mode. */
  content?: string;

  /** Bring-your-own content source. Enables "custom" mode. */
  fetcher?: KiwiFetcher;

  /**
   * Tree data for wiki-link resolution and the KiwiTree component.
   * In connected mode this is fetched automatically if not provided.
   */
  tree?: TreeEntry | null;

  /**
   * Theme passthrough:
   * - `"inherit"` — skip KiwiFS theme injection, inherit host CSS vars
   * - `KiwiTokens` — override specific design tokens
   * - `{ light, dark }` — separate light/dark overrides
   */
  theme?: KiwiThemeProp;
};

// ── Context shape ───────────────────────────────────────────────────────────

export type KiwiContextValue = {
  mode: "connected" | "static" | "custom";

  /** API base URL. Only set in connected mode. */
  endpoint: string | null;

  /** Static content string. Only set in static mode. */
  staticContent: string | null;

  /** Custom fetcher. Only set in custom mode. */
  fetcher: KiwiFetcher | null;

  /** Tree data (for wiki-link resolution). */
  tree: TreeEntry | null;

  /** Pre-built link resolver from the tree. */
  resolver: LinkResolver;

  /** Theme mode — "inherit" means no KiwiFS tokens injected. */
  themeMode: "inherit" | "custom" | "default";
};

const KiwiContext = createContext<KiwiContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export function KiwiProvider({
  children,
  endpoint,
  content,
  fetcher,
  tree = null,
  theme,
}: KiwiProviderProps) {
  const mode = content != null ? "static" : fetcher ? "custom" : "connected";

  const resolver = useMemo(() => buildResolver(tree), [tree]);

  // Apply theme overrides
  useEffect(() => {
    if (!theme || theme === "inherit") return;

    const overrides: KiwiThemeOverrides = {};
    if (typeof theme === "object" && ("light" in theme || "dark" in theme)) {
      overrides.light = (theme as { light?: KiwiTokens; dark?: KiwiTokens }).light;
      overrides.dark = (theme as { light?: KiwiTokens; dark?: KiwiTokens }).dark;
    } else if (typeof theme === "object") {
      overrides.light = theme as KiwiTokens;
    }
    applyKiwiTheme(overrides);
  }, [theme]);

  const value = useMemo<KiwiContextValue>(
    () => ({
      mode,
      endpoint: mode === "connected" ? (endpoint ?? null) : null,
      staticContent: mode === "static" ? (content ?? null) : null,
      fetcher: mode === "custom" ? (fetcher ?? null) : null,
      tree,
      resolver,
      themeMode: theme === "inherit" ? "inherit" : theme ? "custom" : "default",
    }),
    [mode, endpoint, content, fetcher, tree, resolver, theme],
  );

  return <KiwiContext.Provider value={value}>{children}</KiwiContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useKiwi(): KiwiContextValue {
  const ctx = useContext(KiwiContext);
  if (!ctx) {
    throw new Error(
      "useKiwi() must be used inside <KiwiProvider>. " +
        "Wrap your component tree with <KiwiProvider> or pass props directly.",
    );
  }
  return ctx;
}

/**
 * Optional hook — returns context if available, null otherwise.
 * Components that work both inside and outside a provider can use this.
 */
export function useKiwiOptional(): KiwiContextValue | null {
  return useContext(KiwiContext);
}

import { useEffect, useState } from "react";
import { getHighlighter, hasLang } from "@kw/lib/shiki";
import { alpha } from "./colors";
import { toSet, type Many } from "./sets";

export interface CodeHighlightProps {
  /** The source code to display (plain text, one line per array entry or newline-separated string). */
  code: string | string[];
  /** 0-based line index (or indices) to highlight. -1 or undefined means no highlight. */
  activeLine?: number | number[];
  /** 0-based lines given a softer secondary highlight — the branch not taken, the lines a value came from. */
  highlightLines?: Many<number>;
  /** Values shown at the end of a line, keyed by 0-based line: `{ 2: "take = 12" }`. */
  annotations?: Record<number, string | number | null | undefined> | (string | number | null | undefined)[];
  /** Optional label above the code block. */
  title?: string;
  /** Language for syntax highlighting (default: "python"). */
  lang?: string;
}

interface TokenSpan {
  content: string;
  color?: string;
}

function useIsDark(): boolean {
  const read = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setDark(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function CodeHighlight({ code, activeLine, highlightLines, annotations, title, lang = "python" }: CodeHighlightProps) {
  const lines = Array.isArray(code) ? code : code.split("\n");
  const source = lines.join("\n");
  const activeSet = toSet(activeLine);
  const softSet = toSet(highlightLines);

  const isDark = useIsDark();

  const [tokenLines, setTokenLines] = useState<TokenSpan[][] | null>(null);

  useEffect(() => {
    if (!hasLang(lang)) return;
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      try {
        const result = hl.codeToTokens(source, {
          lang: lang as Parameters<typeof hl.codeToTokens>[1]["lang"],
          theme: isDark ? "github-dark" : "github-light",
        });
        setTokenLines(
          result.tokens.map((line) =>
            line.map((token) => ({
              content: token.content,
              color: token.color,
            }))
          )
        );
      } catch {
        /* fall back to plain text */
      }
    });
    return () => { cancelled = true; };
  }, [source, lang, isDark]);

  return (
    <div style={{
      borderRadius: 8,
      border: "1px solid var(--kw-widget-border, #3f3f46)",
      overflow: "hidden",
      fontSize: "0.8rem",
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
    }}>
      {title && (
        <div style={{
          padding: "4px 12px",
          fontSize: "0.7rem",
          fontWeight: 600,
          color: "var(--kw-widget-dim, #94a3b8)",
          borderBottom: "1px solid var(--kw-widget-border, #3f3f46)",
          background: alpha("var(--kw-widget-border, #3f3f46)", 20),
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: "8px 0" }}>
        {lines.map((line, i) => {
          const active = activeSet.has(i);
          const soft = !active && softSet.has(i);
          const note = annotations?.[i as keyof typeof annotations] as string | number | null | undefined;
          const tokens = tokenLines?.[i];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                padding: "1px 12px",
                background: active
                  ? alpha("var(--kw-widget-active, #a78bfa)", 13)
                  : soft ? alpha("var(--kw-widget-highlight, #22c55e)", 8) : "transparent",
                borderLeft: active
                  ? "3px solid var(--kw-widget-active, #a78bfa)"
                  : soft ? `3px solid ${alpha("var(--kw-widget-highlight, #22c55e)", 60)}` : "3px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{
                width: 28,
                textAlign: "right",
                marginRight: 12,
                color: active
                  ? "var(--kw-widget-active, #a78bfa)"
                  : "var(--kw-widget-dim, #64748b)",
                userSelect: "none",
                flexShrink: 0,
              }}>
                {i + 1}
              </span>
              <span style={{ whiteSpace: "pre" }}>
                {tokens ? (
                  tokens.map((tok, j) => (
                    <span key={j} style={{ color: active ? undefined : tok.color }}>
                      {tok.content}
                    </span>
                  ))
                ) : (
                  <span style={{
                    color: active
                      ? "var(--kw-widget-text, #e5e7eb)"
                      : "var(--kw-widget-dim, #94a3b8)",
                  }}>
                    {line}
                  </span>
                )}
              </span>
              {note != null && note !== "" && (
                <span style={{
                  marginLeft: "auto",
                  paddingLeft: 16,
                  color: active ? "var(--kw-widget-active, #a78bfa)" : "var(--kw-widget-dim, #94a3b8)",
                  fontSize: "0.72rem",
                  fontStyle: "italic",
                  whiteSpace: "nowrap",
                }}>
                  {"← " + String(note)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

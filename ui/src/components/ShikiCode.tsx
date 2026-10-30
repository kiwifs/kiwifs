import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getHighlighter, hasLang } from "@kw/lib/shiki";
import {
  hasNotation,
  notationClass,
  parseNotation,
  withSourceHighlights,
  type NotatedCode,
} from "@kw/lib/codeNotation";

type Props = {
  code: string;
  lang?: string;
  title?: string;
  highlightLines?: Set<number>;
};

/** Apply line highlighting by wrapping lines in spans with a highlight class. */
function applyLineHighlights(html: string, highlightLines: Set<number>): string {
  return html.replace(
    /(<code[^>]*>)([\s\S]*?)(<\/code>)/,
    (_match, openCode, content, closeCode) => {
      const lines = content.split("\n");
      const wrapped = lines.map((line: string, i: number) => {
        const lineNum = i + 1;
        if (highlightLines.has(lineNum)) {
          return `<span class="kiwi-line-highlight">${line}</span>`;
        }
        return `<span class="kiwi-line">${line}</span>`;
      }).join("\n");
      return `${openCode}${wrapped}${closeCode}`;
    }
  );
}

/**
 * Apply the classes a `[!code …]` notation pass decided on. The markers are
 * stripped from the source before highlighting, so the line numbers here are
 * the ones a reader sees.
 */
function applyNotation(html: string, notated: NotatedCode): string {
  return html.replace(
    /(<code[^>]*>)([\s\S]*?)(<\/code>)/,
    (_match, openCode, content, closeCode) => {
      const wrapped = content
        .split("\n")
        .map((line: string, i: number) => `<span class="${notationClass(i + 1, notated)}">${line}</span>`)
        .join("\n");
      return `${openCode}${wrapped}${closeCode}`;
    },
  );
}

/** Apply diff line styling for ```diff blocks. */
function applyDiffStyles(html: string): string {
  return html.replace(
    /(<code[^>]*>)([\s\S]*?)(<\/code>)/,
    (_match, openCode, content, closeCode) => {
      const lines = content.split("\n");
      const wrapped = lines.map((line: string) => {
        const plainStart = line.replace(/<[^>]*>/g, "").trimStart();
        if (plainStart.startsWith("+")) {
          return `<span class="kiwi-diff-add">${line}</span>`;
        }
        if (plainStart.startsWith("-")) {
          return `<span class="kiwi-diff-del">${line}</span>`;
        }
        return `<span class="kiwi-line">${line}</span>`;
      }).join("\n");
      return `${openCode}${wrapped}${closeCode}`;
    }
  );
}

function formatLangLabel(lang: string): string {
  const labels: Record<string, string> = {
    js: "JavaScript", ts: "TypeScript", jsx: "JSX", tsx: "TSX",
    py: "Python", rb: "Ruby", rs: "Rust", go: "Go",
    sh: "Shell", bash: "Bash", zsh: "Zsh",
    yml: "YAML", yaml: "YAML", json: "JSON",
    md: "Markdown", html: "HTML", css: "CSS", scss: "SCSS",
    sql: "SQL", graphql: "GraphQL", dockerfile: "Dockerfile",
    diff: "Diff", toml: "TOML", ini: "INI",
    cpp: "C++", c: "C", java: "Java", kt: "Kotlin", swift: "Swift",
    cs: "C#", php: "PHP", lua: "Lua", r: "R",
  };
  return labels[lang.toLowerCase()] || lang;
}

function CopyIcon({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center text-muted-foreground/50 hover:text-foreground transition-colors"
      aria-label="Copy code"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function ShikiCode({ code, lang, title, highlightLines }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  // `// [!code highlight]` and friends are stripped before highlighting, so
  // the marker never shows up as a comment in the rendered block.
  const notated = useMemo(() => (hasNotation(code) ? parseNotation(code) : null), [code]);
  const source = notated?.code ?? code;
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  useEffect(() => {
    let cancelled = false;
    if (!lang || !hasLang(lang)) return;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      try {
        let rendered = hl.codeToHtml(source, {
          lang,
          theme: isDark ? "github-dark" : "github-light",
        });
        if (lang === "diff") {
          rendered = applyDiffStyles(rendered);
        }
        if (notated) {
          rendered = applyNotation(
            rendered,
            highlightLines ? withSourceHighlights(notated, highlightLines) : notated,
          );
        } else if (highlightLines && highlightLines.size > 0) {
          rendered = applyLineHighlights(rendered, highlightLines);
        }
        setHtml(rendered);
      } catch {
        /* ignore; fall back to plaintext <pre> */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source, notated, lang, isDark, highlightLines]);

  const langLabel = lang ? formatLangLabel(lang) : undefined;

  const headerEl = (
    <div className="kiwi-code-header">
      <div>
        {title && <span className="kiwi-code-title">{title}</span>}
        {langLabel && !title && <span className="kiwi-code-lang">{langLabel}</span>}
        {title && langLabel && <span className="kiwi-code-lang ml-2">{langLabel}</span>}
      </div>
      <CopyIcon code={source} />
    </div>
  );

  if (html) {
    return (
      <div className="kiwi-shiki my-4 text-sm rounded-lg overflow-hidden">
        {headerEl}
        {/* Focusable so a long line can be scrolled from the keyboard. */}
        <div
          className="overflow-x-auto [&>pre]:p-4"
          tabIndex={0}
          role="region"
          aria-label={title || langLabel || "Code"}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }
  return (
    <div className="kiwi-shiki my-4 text-sm rounded-lg overflow-hidden">
      {headerEl}
      <pre className="p-4 overflow-x-auto" tabIndex={0} aria-label={title || langLabel || "Code"}>
        <code>{source}</code>
      </pre>
    </div>
  );
}

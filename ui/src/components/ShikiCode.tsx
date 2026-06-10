import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getHighlighter, hasLang } from "@kw/lib/shiki";

type Props = {
  code: string;
  lang?: string;
  title?: string;
  highlightLines?: Set<number>;
};

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border text-muted-foreground hover:text-foreground transition-opacity opacity-0 group-hover:opacity-100"
      aria-label="Copy code"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

/** Apply line highlighting by wrapping lines in spans with a highlight class. */
function applyLineHighlights(html: string, highlightLines: Set<number>): string {
  // Shiki outputs <pre><code>...lines...</code></pre>
  // We wrap each line in a span for highlighting
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

/** Apply diff line styling for ```diff blocks. */
function applyDiffStyles(html: string): string {
  return html.replace(
    /(<code[^>]*>)([\s\S]*?)(<\/code>)/,
    (_match, openCode, content, closeCode) => {
      const lines = content.split("\n");
      const wrapped = lines.map((line: string) => {
        // Strip HTML to check leading character
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

export function ShikiCode({ code, lang, title, highlightLines }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  useEffect(() => {
    let cancelled = false;
    if (!lang || !hasLang(lang)) return;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      try {
        let rendered = hl.codeToHtml(code, {
          lang,
          theme: isDark ? "github-dark" : "github-light",
        });
        // Apply diff styling for diff blocks
        if (lang === "diff") {
          rendered = applyDiffStyles(rendered);
        }
        // Apply line highlights if specified
        if (highlightLines && highlightLines.size > 0) {
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
  }, [code, lang, isDark, highlightLines]);

  const langLabel = lang ? formatLangLabel(lang) : undefined;
  const headerBar = (title || langLabel) ? (
    <div className="kiwi-code-header">
      {title && <span className="kiwi-code-title">{title}</span>}
      {langLabel && !title && <span className="kiwi-code-lang">{langLabel}</span>}
      {title && langLabel && <span className="kiwi-code-lang">{langLabel}</span>}
    </div>
  ) : null;

  if (html) {
    return (
      <div className="relative group my-4">
        {headerBar}
        <div
          className={`kiwi-shiki text-sm overflow-hidden [&>pre]:p-4 [&>pre]:overflow-x-auto${headerBar ? " kiwi-shiki-with-header" : ""}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <CopyButton code={code} />
      </div>
    );
  }
  return (
    <div className="relative group my-4">
      {headerBar}
      <pre>
        <code>{code}</code>
      </pre>
      <CopyButton code={code} />
    </div>
  );
}

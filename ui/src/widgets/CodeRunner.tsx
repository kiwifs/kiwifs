import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import { Check, Copy, Loader2, Play, RotateCcw } from "lucide-react";
import { getHighlighter } from "@kw/lib/shiki";
import { getPyodide, type PyodideInterface } from "@kw/lib/pyodide";

interface Props {
  source: string;
  lang: string;
}

type RunState = "idle" | "loading" | "running";

const LANG_LABELS: Record<string, string> = {
  python: "Python", py: "Python",
  javascript: "JavaScript", js: "JavaScript",
};

function normalizeShikiLang(lang: string): string {
  if (lang === "py") return "python";
  if (lang === "js") return "javascript";
  return lang;
}

function captureJsOutput(code: string): { output: string; error?: string } {
  const logs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => logs.push(`⚠ ${a.map(String).join(" ")}`);
  console.error = (...a: unknown[]) => logs.push(`✗ ${a.map(String).join(" ")}`);
  try {
    const result = new Function(code)();
    if (result !== undefined) logs.push(String(result));
    return { output: logs.join("\n") };
  } catch (e: unknown) {
    return { output: logs.join("\n"), error: e instanceof Error ? e.message : String(e) };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
  }
}

async function runPython(code: string, pyodide: PyodideInterface): Promise<{ output: string; error?: string }> {
  pyodide.runPython("import sys, io\nsys.stdout = io.StringIO()\nsys.stderr = io.StringIO()");
  try {
    await pyodide.runPythonAsync(code);
    const stdout = String(pyodide.runPython("sys.stdout.getvalue()"));
    const stderr = String(pyodide.runPython("sys.stderr.getvalue()"));
    return { output: (stdout + (stderr ? `\n${stderr}` : "")).trimEnd() };
  } catch (e: unknown) {
    const stdout = String(pyodide.runPython("sys.stdout.getvalue()"));
    const msg = e instanceof Error ? e.message : String(e);
    const lines = msg.split("\n");
    return { output: stdout, error: lines.length > 3 ? lines.slice(-3).join("\n") : msg };
  }
}

function useShikiHighlight(code: string, lang: string) {
  const [html, setHtml] = useState("");
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      try {
        const rendered = hl.codeToHtml(code, {
          lang: normalizeShikiLang(lang),
          theme: isDark ? "github-dark" : "github-light",
        });
        const match = rendered.match(/<code[^>]*>([\s\S]*?)<\/code>/);
        setHtml(match ? match[1] : code);
      } catch {
        setHtml("");
      }
    });
    return () => { cancelled = true; };
  }, [code, lang, isDark]);

  return html;
}

export function CodeRunner({ source, lang }: Props) {
  const [code, setCode] = useState(source);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);
  const pyodideRef = useRef<PyodideInterface | null>(null);

  const isPython = lang === "python" || lang === "py";
  const isModified = code !== source;
  const hasRun = output !== "" || error !== "";
  const highlightedHtml = useShikiHighlight(code, lang);
  const langLabel = LANG_LABELS[lang] || lang;

  useEffect(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    ta.style.height = "auto";
    const h = Math.max(ta.scrollHeight, mirror.scrollHeight);
    ta.style.height = `${h}px`;
  }, [code, highlightedHtml]);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && mirrorRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop;
      mirrorRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleRun = useCallback(async () => {
    setOutput("");
    setError("");
    if (isPython) {
      if (!pyodideRef.current) {
        setRunState("loading");
        try {
          pyodideRef.current = await getPyodide();
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Failed to load Python runtime");
          setRunState("idle");
          return;
        }
      }
      setRunState("running");
      const result = await runPython(code, pyodideRef.current);
      setOutput(result.output);
      if (result.error) setError(result.error);
    } else {
      setRunState("running");
      const result = captureJsOutput(code);
      setOutput(result.output);
      if (result.error) setError(result.error);
    }
    setRunState("idle");
  }, [code, isPython]);

  const handleReset = useCallback(() => {
    setCode(source);
    setOutput("");
    setError("");
  }, [source]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      setCode(ta.value.substring(0, start) + "    " + ta.value.substring(end));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
    }
  }, [handleRun]);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
  }, []);

  return (
    <div className="kiwi-shiki kiwi-code-runner relative group my-4 text-sm rounded-lg overflow-hidden">
      {/* Header — language left, actions right, always visible */}
      <div className="kiwi-code-header">
        <span className="kiwi-code-lang">{langLabel}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="inline-flex items-center text-muted-foreground/50 hover:text-foreground transition-colors"
            aria-label="Copy code"
            title="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {isModified && (
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              title="Reset to original"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={runState !== "idle"}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            title="Run (⌘↵)"
          >
            {runState !== "idle" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            <span>{runState === "loading" ? "Loading…" : runState === "running" ? "Running…" : "Run"}</span>
          </button>
        </div>
      </div>

      {/* Editor: highlighted mirror + transparent textarea overlay */}
      <div className="relative">
        <pre
          ref={mirrorRef}
          className="p-4 overflow-hidden pointer-events-none select-none"
          aria-hidden
        >
          <code
            dangerouslySetInnerHTML={{
              __html: highlightedHtml || escapeHtml(code),
            }}
          />
          {"\n"}
        </pre>
        <textarea
          ref={textareaRef}
          value={code}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={`${langLabel} code`}
          className="absolute inset-0 w-full h-full p-4 font-mono text-sm bg-transparent text-transparent caret-foreground resize-none outline-none overflow-auto"
          style={{ tabSize: 4, WebkitTextFillColor: "transparent" }}
        />
      </div>

      {/* Output */}
      <div className="border-t border-border">
        <pre className="px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed min-h-[1.5rem]">
          {hasRun ? (
            <>
              {output && <span className="text-foreground">{output}</span>}
              {output && error && "\n"}
              {error && <span className="text-destructive">{error}</span>}
            </>
          ) : (
            <span className="text-muted-foreground select-none text-xs">
              ▸ output appears here
            </span>
          )}
        </pre>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

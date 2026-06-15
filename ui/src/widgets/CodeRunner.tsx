import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import { Check, Copy, Play, Loader2, RotateCcw } from "lucide-react";
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
  const [pyodideProgress, setPyodideProgress] = useState<string | null>(null);
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
        setPyodideProgress("Downloading Python runtime…");
        try {
          pyodideRef.current = await getPyodide();
          setPyodideProgress(null);
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Failed to load Python runtime");
          setRunState("idle");
          setPyodideProgress(null);
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
      {/* Header — matches kiwi-code-header style */}
      <div className="kiwi-code-header">
        <span className="kiwi-code-lang">{langLabel}</span>
        <span className="text-muted-foreground/50 text-[10px] font-normal hidden sm:inline">editable · ⌘↵ to run</span>
      </div>

      {/* Pyodide loading progress bar */}
      {pyodideProgress && (
        <div className="relative h-1 bg-muted/50 overflow-hidden">
          <div className="absolute inset-0 bg-primary/40 animate-pulse" />
        </div>
      )}

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
          {/* Invisible trailing newline keeps pre height in sync */}
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
          className="absolute inset-0 w-full h-full p-4 font-mono text-sm bg-transparent text-transparent caret-foreground resize-none outline-none overflow-auto"
          style={{ tabSize: 4, WebkitTextFillColor: "transparent" }}
        />
      </div>

      {/* Action buttons — hover to reveal, like ShikiCode's copy button */}
      <div className="absolute top-[calc(theme(spacing.8)+1px)] right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isModified && (
          <button
            onClick={handleReset}
            className="p-1.5 rounded-md bg-background/80 border border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Reset to original"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md bg-background/80 border border-border text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleRun}
          disabled={runState !== "idle"}
          className="p-1.5 rounded-md bg-primary/90 border border-primary/20 text-primary-foreground hover:bg-primary disabled:opacity-50 transition-colors"
          title="Run (⌘↵)"
        >
          {runState !== "idle" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Output — always reserved space to prevent layout shift */}
      <div className="border-t border-border">
        <div className="px-4 py-1.5 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Output
          </span>
          {pyodideProgress && (
            <span className="text-[10px] text-muted-foreground/70 animate-pulse">
              {pyodideProgress}
            </span>
          )}
        </div>
        <pre className="px-4 pb-3 pt-0 text-sm font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed min-h-[1.5rem]">
          {hasRun ? (
            <>
              {output && <span className="text-foreground">{output}</span>}
              {output && error && "\n"}
              {error && <span className="text-destructive">{error}</span>}
            </>
          ) : (
            <span className="text-muted-foreground/40 italic text-xs select-none">
              Click ▶ or press ⌘↵ to run
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

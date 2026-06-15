import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import { Play, Loader2, RotateCcw, Square } from "lucide-react";
import { getPyodide, type PyodideInterface } from "@kw/lib/pyodide";

interface Props {
  source: string;
  lang: string;
}

type RunState = "idle" | "loading" | "running";

function formatLangLabel(lang: string): string {
  const labels: Record<string, string> = {
    python: "Python", py: "Python",
    javascript: "JavaScript", js: "JavaScript",
  };
  return labels[lang] || lang;
}

function captureJsOutput(code: string): { output: string; error?: string } {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logs.push(`⚠ ${args.map(String).join(" ")}`);
  console.error = (...args: unknown[]) => logs.push(`✗ ${args.map(String).join(" ")}`);
  try {
    const result = new Function(code)();
    if (result !== undefined) logs.push(String(result));
    return { output: logs.join("\n") };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { output: logs.join("\n"), error: msg };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

async function runPython(code: string, pyodide: PyodideInterface): Promise<{ output: string; error?: string }> {
  pyodide.runPython(`
import sys, io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
`);
  try {
    await pyodide.runPythonAsync(code);
    const stdout = String(pyodide.runPython("sys.stdout.getvalue()"));
    const stderr = String(pyodide.runPython("sys.stderr.getvalue()"));
    const output = stdout + (stderr ? `\n${stderr}` : "");
    return { output: output.trimEnd() };
  } catch (e: unknown) {
    const stdout = String(pyodide.runPython("sys.stdout.getvalue()"));
    const msg = e instanceof Error ? e.message : String(e);
    const lines = msg.split("\n");
    const short = lines.length > 3 ? lines.slice(-3).join("\n") : msg;
    return { output: stdout, error: short };
  }
}

export function CodeRunner({ source, lang }: Props) {
  const [code, setCode] = useState(source);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [pyodideStatus, setPyodideStatus] = useState<"none" | "loading" | "ready">("none");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pyodideRef = useRef<PyodideInterface | null>(null);

  const isPython = lang === "python" || lang === "py";

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [code]);

  const handleRun = useCallback(async () => {
    setOutput("");
    setError("");

    if (isPython) {
      if (!pyodideRef.current) {
        setRunState("loading");
        setPyodideStatus("loading");
        try {
          pyodideRef.current = await getPyodide();
          setPyodideStatus("ready");
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
      const val = ta.value;
      setCode(val.substring(0, start) + "    " + val.substring(end));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 4;
      });
    }
  }, [handleRun]);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
  }, []);

  const hasOutput = output || error;
  const isModified = code !== source;

  return (
    <div className="kiwi-code-runner my-4 rounded-lg border border-border overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground">
          {formatLangLabel(lang)}
          {isPython && pyodideStatus === "loading" && (
            <span className="ml-2 text-muted-foreground/70">Loading Python runtime…</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {isModified && (
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Reset to original"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={runState !== "idle"}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            title="Run (⌘↵)"
          >
            {runState === "idle" ? (
              <>
                <Play className="h-3 w-3" />
                Run
              </>
            ) : runState === "loading" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <Square className="h-3 w-3" />
                Running…
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={code}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="w-full px-4 py-3 font-mono text-sm bg-transparent resize-none outline-none text-foreground leading-relaxed"
          style={{ minHeight: "3rem", tabSize: 4 }}
        />
      </div>

      {/* Output */}
      {hasOutput && (
        <div className="border-t border-border">
          <div className="px-3 py-1 bg-muted/30">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Output</span>
          </div>
          <pre className="px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {output && <span className="text-foreground">{output}</span>}
            {output && error && "\n"}
            {error && <span className="text-destructive">{error}</span>}
          </pre>
        </div>
      )}
    </div>
  );
}

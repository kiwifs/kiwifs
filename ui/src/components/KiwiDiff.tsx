/**
 * KiwiDiff — Annotated inline code diffs for ```kiwi-diff blocks.
 *
 * Renders rich side-by-side or unified diffs using react-diff-viewer-continued.
 * Supports a YAML header with annotations (line-specific notes with severity).
 *
 * Formats:
 *
 * 1. Unified diff format (with optional YAML header):
 * ```kiwi-diff
 * title: Auth refactor
 * language: typescript
 * splitView: true
 * ---
 * - const old = "foo";
 * + const new = "bar";
 * ```
 *
 * 2. Simple two-block format (separated by ===):
 * ```kiwi-diff language=python
 * def greet(name):
 *     print("Hello " + name)
 * ===
 * def greet(name: str) -> None:
 *     print(f"Hello {name}")
 * ```
 */

import { useMemo, useEffect, useState } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@kw/components/ui/tooltip";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  line: number;
  side?: "left" | "right";
  severity?: "info" | "warning" | "error";
  text: string;
}

interface DiffConfig {
  title?: string;
  language?: string;
  splitView?: boolean;
  annotations?: Annotation[];
  leftTitle?: string;
  rightTitle?: string;
}

// ── Parser ───────────────────────────────────────────────────────────────────

function parseDiffSource(source: string, meta?: string): {
  config: DiffConfig;
  oldValue: string;
  newValue: string;
} {
  // Parse meta string for inline options: language=python splitView=false
  const metaConfig: Partial<DiffConfig> = {};
  if (meta) {
    const langMatch = meta.match(/language=(\S+)/);
    if (langMatch) metaConfig.language = langMatch[1];
    const splitMatch = meta.match(/splitView=(true|false)/);
    if (splitMatch) metaConfig.splitView = splitMatch[1] === "true";
  }

  // Check for === separator (simple two-block format)
  const eqSplit = source.split(/\n===\n/);
  if (eqSplit.length === 2) {
    return {
      config: { splitView: true, ...metaConfig },
      oldValue: eqSplit[0].trim(),
      newValue: eqSplit[1].trim(),
    };
  }

  // Check for YAML header (separated by ---)
  const headerSplit = source.split(/\n---\n/);
  let config: DiffConfig = { ...metaConfig };
  let diffBody: string;

  if (headerSplit.length >= 2) {
    // First part is YAML config, rest is diff body
    config = { ...parseYamlHeader(headerSplit[0]), ...metaConfig };
    diffBody = headerSplit.slice(1).join("\n---\n").trim();
  } else {
    diffBody = source.trim();
  }

  // Parse unified diff format
  const { oldValue, newValue } = parseUnifiedDiff(diffBody);

  return { config, oldValue, newValue };
}

function parseYamlHeader(header: string): DiffConfig {
  const config: DiffConfig = {};
  const annotations: Annotation[] = [];

  let inAnnotations = false;
  let currentAnnotation: Partial<Annotation> = {};

  for (const line of header.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;

    if (l.startsWith("title:")) {
      config.title = l.slice(6).trim().replace(/^["']|["']$/g, "");
      inAnnotations = false;
    } else if (l.startsWith("language:")) {
      config.language = l.slice(9).trim();
      inAnnotations = false;
    } else if (l.startsWith("splitView:")) {
      config.splitView = l.slice(10).trim() === "true";
      inAnnotations = false;
    } else if (l.startsWith("leftTitle:")) {
      config.leftTitle = l.slice(10).trim().replace(/^["']|["']$/g, "");
      inAnnotations = false;
    } else if (l.startsWith("rightTitle:")) {
      config.rightTitle = l.slice(11).trim().replace(/^["']|["']$/g, "");
      inAnnotations = false;
    } else if (l === "annotations:") {
      inAnnotations = true;
    } else if (inAnnotations) {
      if (l.startsWith("- ")) {
        if (currentAnnotation.text && currentAnnotation.line != null) {
          annotations.push(currentAnnotation as Annotation);
        }
        currentAnnotation = {};
        const inlineKv = l.slice(2).trim();
        const kvMatch = inlineKv.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) setAnnotationField(currentAnnotation, kvMatch[1], kvMatch[2]);
      } else {
        const kvMatch = l.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) setAnnotationField(currentAnnotation, kvMatch[1], kvMatch[2]);
      }
    }
  }
  if (currentAnnotation.text && currentAnnotation.line != null) {
    annotations.push(currentAnnotation as Annotation);
  }
  if (annotations.length > 0) config.annotations = annotations;

  return config;
}

function setAnnotationField(ann: Partial<Annotation>, key: string, val: string) {
  const v = val.trim().replace(/^["']|["']$/g, "");
  switch (key) {
    case "line": ann.line = parseInt(v, 10); break;
    case "side": ann.side = v as "left" | "right"; break;
    case "severity": ann.severity = v as "info" | "warning" | "error"; break;
    case "text": ann.text = v; break;
  }
}

/**
 * Parse unified diff format into old/new strings.
 * Lines starting with - are old, + are new, space are context (both).
 */
function parseUnifiedDiff(body: string): { oldValue: string; newValue: string } {
  const lines = body.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];

  let hasUnifiedMarkers = false;

  for (const line of lines) {
    if (line.startsWith("- ") || line.startsWith("-\t") || line === "-") {
      oldLines.push(line.slice(2) || line.slice(1) || "");
      hasUnifiedMarkers = true;
    } else if (line.startsWith("+ ") || line.startsWith("+\t") || line === "+") {
      newLines.push(line.slice(2) || line.slice(1) || "");
      hasUnifiedMarkers = true;
    } else if (line.startsWith("  ") || line === " " || line === "") {
      // Context line — both sides
      const content = line.startsWith("  ") ? line.slice(2) : (line === " " ? "" : line);
      oldLines.push(content);
      newLines.push(content);
    } else if (!hasUnifiedMarkers) {
      // Not a unified diff — treat the whole thing as both old and new (unchanged)
      oldLines.push(line);
      newLines.push(line);
    } else {
      // Unrecognized prefix in unified mode — add to both
      oldLines.push(line);
      newLines.push(line);
    }
  }

  return {
    oldValue: oldLines.join("\n"),
    newValue: newLines.join("\n"),
  };
}

// ── Severity icons ───────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950", border: "border-blue-200 dark:border-blue-800" },
  warning: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950", border: "border-amber-200 dark:border-amber-800" },
  error: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950", border: "border-red-200 dark:border-red-800" },
} as const;

// ── Component ────────────────────────────────────────────────────────────────

export function KiwiDiff({ source, meta }: { source: string; meta?: string }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const { config, oldValue, newValue } = useMemo(
    () => parseDiffSource(source, meta),
    [source, meta]
  );

  // Build annotation lookup map: line number → annotation
  const annotationMap = useMemo(() => {
    const map = new Map<string, Annotation>();
    for (const ann of config.annotations || []) {
      const key = `${ann.side || "right"}-${ann.line}`;
      map.set(key, ann);
    }
    return map;
  }, [config.annotations]);

  // Build highlight lines list from annotations
  const highlightLines = useMemo(() => {
    if (!config.annotations) return undefined;
    return config.annotations.map((ann) => {
      const prefix = ann.side === "left" ? "L" : "R";
      return `${prefix}-${ann.line}`;
    });
  }, [config.annotations]);

  return (
    <figure className="kiwi-diff not-prose my-4">
      {/* Title bar */}
      {config.title && (
        <div className="flex items-center gap-3 mb-2">
          <figcaption className="text-sm font-medium text-foreground">
            {config.title}
          </figcaption>
          {config.annotations && config.annotations.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {config.annotations.length} annotation{config.annotations.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Diff viewer */}
      <div className="rounded-md border border-border overflow-hidden text-xs">
        <TooltipProvider>
          <ReactDiffViewer
            oldValue={oldValue}
            newValue={newValue}
            splitView={config.splitView ?? true}
            useDarkTheme={isDark}
            leftTitle={config.leftTitle}
            rightTitle={config.rightTitle}
            highlightLines={highlightLines}
            disableWorker
            renderGutter={
              annotationMap.size > 0
                ? (data) => {
                    const prefix = data.prefix === "L" ? "left" : "right";
                    const key = `${prefix}-${data.lineNumber}`;
                    const ann = annotationMap.get(key);
                    if (!ann) return <td className="kiwi-diff-gutter" />;

                    const severity = ann.severity || "info";
                    const cfg = SEVERITY_CONFIG[severity];
                    const Icon = cfg.icon;

                    return (
                      <td className="kiwi-diff-gutter">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center cursor-help ${cfg.color}`}>
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className={`max-w-xs text-xs ${cfg.bg} ${cfg.border} border`}
                          >
                            <p>{ann.text}</p>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  }
                : undefined
            }
          />
        </TooltipProvider>
      </div>

      {/* Annotation legend */}
      {config.annotations && config.annotations.length > 0 && (
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          {(["info", "warning", "error"] as const)
            .filter((sev) => config.annotations!.some((a) => (a.severity || "info") === sev))
            .map((sev) => {
              const cfg = SEVERITY_CONFIG[sev];
              const Icon = cfg.icon;
              return (
                <span key={sev} className="flex items-center gap-1">
                  <Icon className={`h-3 w-3 ${cfg.color}`} />
                  {sev}
                </span>
              );
            })}
        </div>
      )}
    </figure>
  );
}

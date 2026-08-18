/**
 * Parse ```kiwi-steps fences: one mermaid source, a list of focus/dim/note
 * steps, and an optional code listing that steps in lockstep.
 */

import yaml from "js-yaml";

export type StepsKind = "flowchart" | "sequence";

export type StepSpec = {
  focus: string[];
  dim: string[];
  note: string;
  line?: number;
  /** Sequence diagrams: show the first N messages. 1-based. */
  messages?: number;
  breakpoint?: boolean;
};

export type StepsConfig = {
  diagram: string;
  kind: StepsKind;
  steps: StepSpec[];
  code?: string;
  lang?: string;
};

export class StepsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepsParseError";
  }
}

const MESSAGE_RE = /^\s*[A-Za-z0-9_][A-Za-z0-9_-]*\s*(->>|-->>|-->|->|-->>\+|->>\+|-->>-|->>-|-->>x|->>x|-x|--x|==>|==>>)\s*[A-Za-z0-9_]/;

export function detectStepsKind(diagram: string): StepsKind {
  const first = diagram.trim().split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("%%"));
  if (first && /^\s*sequenceDiagram\b/i.test(first)) return "sequence";
  return "flowchart";
}

export function isSequenceMessage(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("%%") || trimmed.startsWith("#")) return false;
  return MESSAGE_RE.test(trimmed);
}

export function countSequenceMessages(diagram: string): number {
  return diagram.split(/\r?\n/).filter(isSequenceMessage).length;
}

/** Keep participants / autonumber / notes; drop messages after `keep`. */
export function truncateSequence(diagram: string, keep: number): string {
  let seen = 0;
  return diagram.split(/\r?\n/).filter((line) => {
    if (!isSequenceMessage(line)) return true;
    seen += 1;
    return seen <= keep;
  }).join("\n");
}

function asStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value).split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
}

function parseStep(raw: unknown, index: number): StepSpec {
  if (typeof raw === "string") {
    return { focus: [], dim: [], note: raw };
  }
  if (!raw || typeof raw !== "object") {
    throw new StepsParseError(`steps[${index}] must be a mapping or a string`);
  }
  const rec = raw as Record<string, unknown>;
  const line = rec.line == null ? undefined : Number(rec.line);
  const messages = rec.messages == null ? undefined : Number(rec.messages);
  return {
    focus: asStringList(rec.focus),
    dim: asStringList(rec.dim),
    note: rec.note == null ? "" : String(rec.note),
    line: line != null && Number.isFinite(line) ? line : undefined,
    messages: messages != null && Number.isFinite(messages) ? messages : undefined,
    breakpoint: Boolean(rec.breakpoint),
  };
}

export function parseStepsConfig(source: string): StepsConfig {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (err) {
    throw new StepsParseError(err instanceof Error ? err.message : String(err));
  }
  if (!parsed || typeof parsed !== "object") {
    throw new StepsParseError("expected a YAML mapping with a diagram and steps");
  }
  const rec = parsed as Record<string, unknown>;
  const diagram = rec.diagram == null ? "" : String(rec.diagram).trim();
  if (!diagram) throw new StepsParseError("diagram is required");
  if (!Array.isArray(rec.steps) || rec.steps.length === 0) {
    throw new StepsParseError("steps must be a non-empty list");
  }
  const kind = rec.kind === "sequence" || rec.kind === "flowchart"
    ? rec.kind
    : detectStepsKind(diagram);
  return {
    diagram,
    kind,
    steps: rec.steps.map(parseStep),
    code: rec.code == null ? undefined : String(rec.code),
    lang: rec.lang == null ? undefined : String(rec.lang),
  };
}

/**
 * For sequence diagrams, fill in a missing `messages` so step i shows
 * i + 1 messages (clamped to the diagram). Flowcharts are unchanged.
 */
export function withDefaultMessageCounts(config: StepsConfig): StepSpec[] {
  if (config.kind !== "sequence") return config.steps;
  const total = countSequenceMessages(config.diagram);
  return config.steps.map((step, i) => ({
    ...step,
    messages: step.messages ?? Math.min(i + 1, Math.max(total, 1)),
  }));
}

/** First step that focuses `id`, or -1. */
export function stepIndexForNode(steps: StepSpec[], id: string): number {
  return steps.findIndex((step) => step.focus.includes(id));
}

import { describe, expect, it } from "vitest";
import {
  countSequenceMessages,
  detectStepsKind,
  parseStepsConfig,
  stepIndexForNode,
  truncateSequence,
  withDefaultMessageCounts,
} from "./stepsBlock";

const FLOW = `
diagram: |
  graph LR
    C[Client] --> A[API]
    A --> DB[(Postgres)]
steps:
  - focus: [C, A]
    note: write lands on the API
  - focus: [A, DB]
    dim: [C]
    note: then it commits
`;

const SEQ = `
diagram: |
  sequenceDiagram
    Client->>API: write
    API->>DB: commit
    API->>Q: enqueue
steps:
  - note: first hop
  - note: commit
    messages: 2
`;

describe("parseStepsConfig", () => {
  it("parses a flowchart and detects kind", () => {
    const cfg = parseStepsConfig(FLOW);
    expect(cfg.kind).toBe("flowchart");
    expect(cfg.steps).toHaveLength(2);
    expect(cfg.steps[0]?.focus).toEqual(["C", "A"]);
    expect(cfg.steps[1]?.dim).toEqual(["C"]);
  });

  it("rejects a missing diagram", () => {
    expect(() => parseStepsConfig("steps:\n  - note: x\n")).toThrow(/diagram/);
  });
});

describe("sequence helpers", () => {
  it("counts and truncates messages", () => {
    const src = `sequenceDiagram
    Client->>API: write
    Note over API: hold
    API->>DB: commit
    API->>Q: enqueue`;
    expect(detectStepsKind(src)).toBe("sequence");
    expect(countSequenceMessages(src)).toBe(3);
    const cut = truncateSequence(src, 1);
    expect(countSequenceMessages(cut)).toBe(1);
    expect(cut).toContain("Note over API");
    expect(cut).not.toContain("enqueue");
  });

  it("defaults messages to step index + 1", () => {
    const cfg = parseStepsConfig(SEQ);
    const steps = withDefaultMessageCounts(cfg);
    expect(steps[0]?.messages).toBe(1);
    expect(steps[1]?.messages).toBe(2);
  });
});

describe("stepIndexForNode", () => {
  it("returns the first focusing step", () => {
    const cfg = parseStepsConfig(FLOW);
    expect(stepIndexForNode(cfg.steps, "DB")).toBe(1);
    expect(stepIndexForNode(cfg.steps, "missing")).toBe(-1);
  });
});

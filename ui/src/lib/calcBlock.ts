/**
 * Parse and evaluate ```kiwi-calc blocks.
 *
 * Assumptions are named quantities (`dau: 10 million`). Derivations are
 * expressions over those names (`qps: dau * writes / day`). A handful of
 * unit words (day, KB, million) are first-class so the block matches how
 * people actually write back-of-envelope math.
 */

export type CalcBinding = {
  name: string;
  raw: string;
  comment?: string;
};

export type CalcDoc = {
  assumptions: CalcBinding[];
  derivations: CalcBinding[];
};

export type CalcValue = {
  name: string;
  raw: string;
  value: number;
  formatted: string;
  comment?: string;
  error?: string;
  kind: "assumption" | "derivation";
};

export type CalcResult = {
  values: Record<string, number>;
  rows: CalcValue[];
};

export class CalcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcParseError";
  }
}

const SCALE: Record<string, number> = {
  thousand: 1e3,
  thousands: 1e3,
  k: 1e3,
  million: 1e6,
  millions: 1e6,
  m: 1e6,
  billion: 1e9,
  billions: 1e9,
  b: 1e9,
  trillion: 1e12,
  t: 1e12,
};

const DATA: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
  pb: 1024 ** 5,
};

const TIME: Record<string, number> = {
  ms: 0.001,
  millisecond: 0.001,
  milliseconds: 0.001,
  s: 1,
  sec: 1,
  second: 1,
  seconds: 1,
  min: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  week: 86400 * 7,
  weeks: 86400 * 7,
  month: 86400 * 30,
  months: 86400 * 30,
  year: 86400 * 365,
  years: 86400 * 365,
};

const BUILTINS: Record<string, number> = { ...TIME, pi: Math.PI, e: Math.E };

function splitComment(line: string): { body: string; comment?: string } {
  const hash = line.indexOf("#");
  if (hash < 0) return { body: line.trim() };
  return { body: line.slice(0, hash).trim(), comment: line.slice(hash + 1).trim() || undefined };
}

function parseBinding(line: string): CalcBinding | null {
  const { body, comment } = splitComment(line);
  if (!body) return null;
  const colon = body.indexOf(":");
  if (colon < 0) throw new CalcParseError(`expected "name: value" — got ${line}`);
  const name = body.slice(0, colon).trim();
  const raw = body.slice(colon + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new CalcParseError(`invalid name "${name}"`);
  }
  if (!raw) throw new CalcParseError(`missing value for ${name}`);
  return { name, raw, comment };
}

export function parseCalcBlock(source: string): CalcDoc {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const assumptions: CalcBinding[] = [];
  const derivations: CalcBinding[] = [];
  let section: "assumptions" | "derivations" = "assumptions";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^-{3,}$/.test(trimmed)) {
      section = "derivations";
      continue;
    }
    const binding = parseBinding(trimmed);
    if (!binding) continue;
    (section === "assumptions" ? assumptions : derivations).push(binding);
  }
  if (assumptions.length === 0) throw new CalcParseError("need at least one assumption above ---");
  return { assumptions, derivations };
}

const NUMBER_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;

/**
 * Turn an assumption literal into a number.
 * `10 million` → 1e7, `1 KB` → 1024, `100 / user / day` → 100 / 86400.
 */
export function parseQuantity(raw: string): number {
  const text = raw.trim();
  const m = text.match(NUMBER_RE);
  if (!m) throw new CalcParseError(`cannot parse quantity "${raw}"`);
  let value = Number(m[1]);
  if (!Number.isFinite(value)) throw new CalcParseError(`cannot parse quantity "${raw}"`);

  const rest = (m[2] || "").trim();
  if (!rest) return value;

  const tokens = rest.split(/\s+/).filter(Boolean);
  let i = 0;
  if (tokens[0] && SCALE[tokens[0].toLowerCase()] != null) {
    value *= SCALE[tokens[0].toLowerCase()]!;
    i = 1;
  } else if (tokens[0] && DATA[tokens[0].toLowerCase()] != null) {
    value *= DATA[tokens[0].toLowerCase()]!;
    i = 1;
  } else if (tokens[0] && TIME[tokens[0].toLowerCase()] != null && tokens[0] !== "/") {
    // "5 minutes" as a duration
    value *= TIME[tokens[0].toLowerCase()]!;
    i = 1;
  }

  // `/ user / day` — ignore unknown words, divide/multiply by known units.
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok === "/" || tok === "per") {
      const next = tokens[i + 1];
      if (!next) break;
      const key = next.toLowerCase();
      if (TIME[key] != null) value /= TIME[key]!;
      else if (DATA[key] != null) value /= DATA[key]!;
      else if (SCALE[key] != null) value /= SCALE[key]!;
      // unknown words (`user`, `request`) are annotations
      i += 2;
      continue;
    }
    if (tok === "*") {
      const next = tokens[i + 1];
      if (!next) break;
      const key = next.toLowerCase();
      if (TIME[key] != null) value *= TIME[key]!;
      else if (DATA[key] != null) value *= DATA[key]!;
      i += 2;
      continue;
    }
    i += 1;
  }
  return value;
}

function formatGrouped(n: number, digits: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  // Bytes: if it looks like a round binary size, say so.
  if (abs >= 1024 && Number.isInteger(value)) {
    for (const [label, size] of [["PiB", 1024 ** 5], ["TiB", 1024 ** 4], ["GiB", 1024 ** 3], ["MiB", 1024 ** 2], ["KiB", 1024]] as const) {
      if (abs >= size && abs % (size / 16) < 1e-6) {
        return `${formatGrouped(value / size, 2)} ${label}`;
      }
    }
  }
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${formatGrouped(abs / 1e12, 2)} T`;
  if (abs >= 1e9) return `${sign}${formatGrouped(abs / 1e9, 2)} B`;
  if (abs >= 1e6) return `${sign}${formatGrouped(abs / 1e6, 2)} M`;
  if (abs >= 1e4) return `${sign}${formatGrouped(abs / 1e3, 2)} k`;
  if (abs >= 1) return `${sign}${formatGrouped(abs, abs >= 100 ? 1 : 2)}`;
  if (abs >= 0.01) return `${sign}${formatGrouped(abs, 3)}`;
  return value.toExponential(2);
}

const SAFE_EXPR = /^[A-Za-z_][A-Za-z0-9_]*|[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?|[+\-*/().,\s]+$/;

function tokenizeExpr(expr: string): string[] {
  return expr.match(/[A-Za-z_][A-Za-z0-9_]*|[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?|[+\-*/()]|\S/g) ?? [];
}

export function evaluateExpression(expr: string, scope: Record<string, number>): number {
  const tokens = tokenizeExpr(expr);
  if (tokens.some((t) => /[^A-Za-z0-9_+\-*/().eE]/.test(t) && !/^[+\-*/()]$/.test(t) && !/^[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?$/.test(t))) {
    // allow only identifiers, numbers, and + - * / ( )
    for (const t of tokens) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) continue;
      if (/^[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?$/.test(t)) continue;
      if (/^[+\-*/()]$/.test(t)) continue;
      throw new CalcParseError(`unsafe token "${t}" in ${expr}`);
    }
  }
  const replaced = tokens.map((t) => {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
      if (scope[t] != null) return String(scope[t]);
      if (BUILTINS[t] != null) return String(BUILTINS[t]);
      if (BUILTINS[t.toLowerCase()] != null) return String(BUILTINS[t.toLowerCase()]);
      throw new CalcParseError(`unknown name "${t}"`);
    }
    return t;
  }).join(" ");
  if (!/^[\d+\-*/().eE\s]+$/.test(replaced)) {
    throw new CalcParseError(`cannot evaluate "${expr}"`);
  }
  try {
    // Expression is digits and arithmetic only after substitution.
    const result = Function(`"use strict"; return (${replaced});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) {
      throw new CalcParseError(`"${expr}" did not produce a finite number`);
    }
    return result;
  } catch (err) {
    if (err instanceof CalcParseError) throw err;
    throw new CalcParseError(`cannot evaluate "${expr}"`);
  }
}

export function evaluateCalc(doc: CalcDoc, overrides: Record<string, number> = {}): CalcResult {
  const values: Record<string, number> = {};
  const rows: CalcValue[] = [];

  for (const a of doc.assumptions) {
    try {
      const value = overrides[a.name] != null ? overrides[a.name]! : parseQuantity(a.raw);
      values[a.name] = value;
      rows.push({
        name: a.name,
        raw: a.raw,
        value,
        formatted: formatQuantity(value),
        comment: a.comment,
        kind: "assumption",
      });
    } catch (err) {
      rows.push({
        name: a.name,
        raw: a.raw,
        value: NaN,
        formatted: "—",
        comment: a.comment,
        error: err instanceof Error ? err.message : String(err),
        kind: "assumption",
      });
    }
  }

  for (const d of doc.derivations) {
    try {
      const value = evaluateExpression(d.raw, values);
      values[d.name] = value;
      rows.push({
        name: d.name,
        raw: d.raw,
        value,
        formatted: formatQuantity(value),
        comment: d.comment,
        kind: "derivation",
      });
    } catch (err) {
      rows.push({
        name: d.name,
        raw: d.raw,
        value: NaN,
        formatted: "—",
        comment: d.comment,
        error: err instanceof Error ? err.message : String(err),
        kind: "derivation",
      });
    }
  }

  return { values, rows };
}

void SAFE_EXPR;

/**
 * Shared label helpers for widget cells, axis captions, and annotations.
 *
 * A caption is a sequence of plain-text and math islands. `$n^k$` is always
 * math. Bare `n^k`, `M'(0)`, `N(0,1)`, and `e^{t^2/2}` are treated as math so
 * live widgets can pass the ASCII form without dollars. Sentences stay
 * sentences: only the islands go through KaTeX.
 */

export type LabelSegment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string };

/** Longest header, in CSS px, so every row shares one gutter and nothing wraps. */
export function headerGutterPx(
  headers: (string | number | null | undefined)[] | undefined,
  options?: { charPx?: number; pad?: number; min?: number },
): number {
  if (!headers || headers.length === 0) return 0;
  const charPx = options?.charPx ?? 7.4;
  const pad = options?.pad ?? 16;
  const min = options?.min ?? 36;
  let maxChars = 0;
  for (const h of headers) {
    if (h == null) continue;
    maxChars = Math.max(maxChars, plainHeaderLength(String(h)));
  }
  if (maxChars === 0) return min;
  return Math.max(min, Math.ceil(maxChars * charPx) + pad);
}

/** Visible character count after stripping `$` and collapsing TeX groups. */
export function plainHeaderLength(text: string): number {
  return text
    .replace(/\$/g, "")
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[{}]/g, "")
    .length;
}

export function hasMath(text: string): boolean {
  return labelSegments(text).some((s) => s.kind === "math");
}

/**
 * TeX source to render when the *whole* string is one math island, or null
 * to leave it as ordinary text. Prefer `labelSegments` for mixed captions.
 */
export function mathSource(text: string): string | null {
  const segs = labelSegments(text);
  if (segs.length === 1 && segs[0]!.kind === "math") return segs[0]!.value;
  return null;
}

/** Split a caption into plain text and TeX islands, in order. */
export function labelSegments(text: string): LabelSegment[] {
  if (!text) return [];
  const raw = scanIslands(text);
  return mergeGlued(collapse(raw));
}

function collapse(segs: LabelSegment[]): LabelSegment[] {
  const out: LabelSegment[] = [];
  for (const seg of segs) {
    if (!seg.value) continue;
    const last = out[out.length - 1];
    if (last && last.kind === seg.kind) last.value += seg.value;
    else out.push({ kind: seg.kind, value: seg.value });
  }
  return out;
}

const GLUE = /^\s*[=∼~≈]\s*$/;

function mergeGlued(segs: LabelSegment[]): LabelSegment[] {
  const out: LabelSegment[] = segs.map((s) => ({ ...s }));

  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    if (cur.kind !== "text") continue;

    const next = out[i + 1];
    if (next?.kind === "math") {
      const peeled = peelTrailingAtom(cur.value);
      if (peeled && isGlue(peeled.glue)) {
        next.value = peeled.atom + peeled.glue + next.value;
        cur.value = peeled.head;
      }
    }

    const prev = out[i - 1];
    if (prev?.kind === "math") {
      const peeled = peelLeadingAtom(cur.value);
      if (peeled && isGlue(peeled.glue)) {
        prev.value = prev.value + peeled.glue + peeled.atom;
        cur.value = peeled.tail;
      }
    }
  }

  const merged: LabelSegment[] = [];
  for (const seg of collapse(out)) {
    const last = merged[merged.length - 1];
    if (last?.kind === "math" && seg.kind === "text" && isGlue(seg.value)) {
      last.value += seg.value;
      continue;
    }
    if (last?.kind === "math" && seg.kind === "math") {
      last.value += seg.value;
      continue;
    }
    if (last?.kind === "text" && isGlue(last.value) && seg.kind === "math") {
      last.kind = "math";
      last.value += seg.value;
      continue;
    }
    merged.push({ ...seg });
  }

  // A leftover glue-only text chunk between math should already be folded;
  // trim empty text created by peeling.
  return collapse(merged.filter((s) => s.value !== ""));
}

function isGlue(s: string): boolean {
  return GLUE.test(s);
}

function peelTrailingAtom(text: string): { head: string; atom: string; glue: string } | null {
  const m = /^(.*?)([A-Za-z]['′]{0,2})(\s*[=∼~≈]\s*)$/.exec(text);
  if (!m) return null;
  const head = m[1]!;
  if (head && /[A-Za-z0-9]$/.test(head)) return null;
  return { head, atom: m[2]!, glue: m[3]! };
}

function peelLeadingAtom(text: string): { glue: string; atom: string; tail: string } | null {
  const m = /^(\s*[=∼~≈]\s*)(-?\d+(?:\.\d+)?|[A-Za-z]['′]{0,2})(.*)$/.exec(text);
  if (!m) return null;
  return { glue: m[1]!, atom: m[2]!, tail: m[3]! };
}

function scanIslands(text: string): LabelSegment[] {
  const segs: LabelSegment[] = [];
  let i = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (end > textStart) segs.push({ kind: "text", value: text.slice(textStart, end) });
  };

  while (i < text.length) {
    const hit = matchIsland(text, i);
    if (hit) {
      flushText(i);
      segs.push({ kind: "math", value: hit.math });
      i = hit.end;
      textStart = i;
      continue;
    }
    i += 1;
  }
  flushText(text.length);
  return segs;
}

function matchIsland(text: string, i: number): { end: number; math: string } | null {
  return (
    matchDollars(text, i) ||
    matchParenTex(text, i) ||
    matchTexCommand(text, i) ||
    matchTildeDist(text, i) ||
    matchAssign(text, i) ||
    matchPrimeCall(text, i) ||
    matchCall(text, i) ||
    matchAbs(text, i) ||
    matchFactRatio(text, i) ||
    matchRatio(text, i) ||
    matchScriptToken(text, i)
  );
}

function matchDollars(text: string, i: number): { end: number; math: string } | null {
  if (text[i] !== "$") return null;
  const display = text.startsWith("$$", i);
  const delim = display ? "$$" : "$";
  const end = text.indexOf(delim, i + delim.length);
  if (end < 0) return null;
  const math = text.slice(i + delim.length, end).trim();
  if (!math) return null;
  return { end: end + delim.length, math };
}

function matchParenTex(text: string, i: number): { end: number; math: string } | null {
  if (text.startsWith("\\(", i)) {
    const end = text.indexOf("\\)", i + 2);
    if (end < 0) return null;
    const math = text.slice(i + 2, end).trim();
    return math ? { end: end + 2, math } : null;
  }
  if (text.startsWith("\\[", i)) {
    const end = text.indexOf("\\]", i + 2);
    if (end < 0) return null;
    const math = text.slice(i + 2, end).trim();
    return math ? { end: end + 2, math } : null;
  }
  return null;
}

function matchBrace(text: string, open: number): number {
  if (text[open] !== "{") return -1;
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function consumeTexCommand(text: string, i: number): number {
  const m = /^\\[a-zA-Z]+/.exec(text.slice(i));
  if (!m) return i;
  let j = i + m[0].length;
  if (text[j] === "*") j++;
  while (text[j] === "{") {
    const close = matchBrace(text, j);
    if (close < 0) break;
    j = close + 1;
  }
  return j;
}

function matchTexCommand(text: string, i: number): { end: number; math: string } | null {
  if (text[i] !== "\\") return null;
  if (text[i + 1] === "(" || text[i + 1] === "[") return null;
  const end = consumeTexCommand(text, i);
  if (end === i) return null;
  let j = end;
  const call = consumeCallArgs(text, j);
  if (call > j) j = call;
  return { end: j, math: text.slice(i, j) };
}

function consumeCallArgs(text: string, i: number): number {
  if (text[i] !== "(") return i;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j]!;
    if (c === " " || c === "\n" || c === "\t") return i;
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return i;
}

function isMathCallee(name: string): boolean {
  if (name.length === 1 && /[A-Za-z]/.test(name)) return true;
  if (name.length <= 5 && /^[A-Z][A-Za-z]+$/.test(name)) return true;
  return false;
}

function atTokenStart(text: string, i: number): boolean {
  return i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]!);
}

function matchCall(text: string, i: number): { end: number; math: string } | null {
  if (!atTokenStart(text, i)) return null;
  const name = /^[A-Za-z][A-Za-z0-9]*/.exec(text.slice(i));
  if (!name) return null;
  const argsEnd = consumeCallArgs(text, i + name[0].length);
  if (argsEnd === i + name[0].length) return null;
  const args = text.slice(i + name[0].length, argsEnd);
  if (!isMathCallee(name[0]) && !/[\^_]/.test(args)) return null;
  return { end: argsEnd, math: text.slice(i, argsEnd) };
}

function matchPrimeCall(text: string, i: number): { end: number; math: string } | null {
  if (!atTokenStart(text, i)) return null;
  const m = /^[A-Za-z][A-Za-z0-9]*['′]+/.exec(text.slice(i));
  if (!m) return null;
  let end = i + m[0].length;
  const argsEnd = consumeCallArgs(text, end);
  if (argsEnd > end) end = argsEnd;
  return { end, math: text.slice(i, end) };
}

function matchTildeDist(text: string, i: number): { end: number; math: string } | null {
  if (!atTokenStart(text, i)) return null;
  const m = /^[A-Za-z][A-Za-z0-9]*['′]{0,2}\s*[~∼]\s*/.exec(text.slice(i));
  if (!m) return null;
  const rest =
    matchCall(text, i + m[0].length) ||
    matchTexCommand(text, i + m[0].length) ||
    matchScriptToken(text, i + m[0].length);
  if (!rest) return null;
  return { end: rest.end, math: text.slice(i, rest.end) };
}

function matchAssign(text: string, i: number): { end: number; math: string } | null {
  if (!atTokenStart(text, i)) return null;
  const m = /^([A-Za-z][A-Za-z0-9]*['′]{0,2})(\s*)=(\s*)(-?\d+(?:\.\d+)?)/.exec(text.slice(i));
  if (!m) return null;
  // `t=0` is math; `node=3` in a call label is not. Longer names need spaces.
  if (m[1]!.length > 1 && (m[2] === "" || m[3] === "")) return null;
  return { end: i + m[0].length, math: m[0] };
}

function matchAbs(text: string, i: number): { end: number; math: string } | null {
  const prefixed = /^[A-Za-z]\|[A-Za-z0-9+\-]+\|/.exec(text.slice(i));
  if (prefixed) return { end: i + prefixed[0].length, math: prefixed[0] };
  const bare = /^\|[A-Za-z][A-Za-z0-9+\-]*\|/.exec(text.slice(i));
  if (bare) return { end: i + bare[0].length, math: bare[0] };
  return null;
}

function matchFactRatio(text: string, i: number): { end: number; math: string } | null {
  const m = /^[A-Za-z0-9]+!\s*\/\s*\([^)]*\)!/.exec(text.slice(i));
  if (!m) return null;
  return { end: i + m[0].length, math: m[0] };
}

function matchRatio(text: string, i: number): { end: number; math: string } | null {
  if (i > 0 && /[A-Za-z0-9]/.test(text[i - 1]!)) return null;
  const m = /^(?:\d+\/[A-Za-z0-9π]+|[A-Za-z0-9π]+\/\d+)/.exec(text.slice(i));
  if (!m) return null;
  return { end: i + m[0].length, math: m[0] };
}

function matchScriptToken(text: string, i: number): { end: number; math: string } | null {
  if (!/[A-Za-z0-9\\(]/.test(text[i]!)) return null;
  if (i > 0 && /[A-Za-z0-9]/.test(text[i - 1]!) && /[A-Za-z]/.test(text[i]!)) return null;

  let j = i;
  let depth = 0;
  let brace = 0;
  let sawScript = false;

  while (j < text.length) {
    const c = text[j]!;
    if (c === "\\") {
      const next = consumeTexCommand(text, j);
      if (next === j) {
        j += 1;
        continue;
      }
      j = next;
      continue;
    }
    if (c === "{") {
      brace += 1;
      j += 1;
      continue;
    }
    if (c === "}") {
      if (!brace) break;
      brace -= 1;
      j += 1;
      continue;
    }
    if (c === "(") {
      depth += 1;
      j += 1;
      continue;
    }
    if (c === ")") {
      if (!depth) break;
      depth -= 1;
      j += 1;
      continue;
    }
    if (c === "^" || c === "_") {
      sawScript = true;
      j += 1;
      continue;
    }
    if (brace > 0 || depth > 0) {
      if (c === "\n") break;
      j += 1;
      continue;
    }
    if (c === "." && /[0-9]/.test(text[j - 1] ?? "") && /[0-9]/.test(text[j + 1] ?? "")) {
      j += 1;
      continue;
    }
    if (/[A-Za-z0-9'′+\-*/π]/.test(c)) {
      j += 1;
      continue;
    }
    break;
  }

  if (!sawScript || j === i) return null;
  return { end: j, math: text.slice(i, j) };
}

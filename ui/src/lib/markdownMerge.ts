/*
 * Patch-on-save for the visual editor (the technique Superset PR #6406 and
 * Orca PR #8862 use around lossy serializers).
 *
 *   original = the body bytes read from disk
 *   baseline = the serializer's output for the document right after load
 *   current  = the serializer's output for the document at save time
 *
 * baseline -> current is exactly what the user changed, expressed in the
 * serializer's dialect. A block-level three-way merge applies that change to
 * the original, so every block the user did not touch keeps its bytes.
 *
 * The two-way diff underneath is a patience diff. A plain LCS (node-diff3,
 * jsdiff) is quadratic on the many identical blank and fence lines a markdown
 * page has: 11 s for a 150 KB page, where this takes a few milliseconds.
 */

const BOM = "﻿";

export type LineEndings = { bom: boolean; crlf: boolean };

export function detectLineEndings(text: string): LineEndings {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  return { bom: text.startsWith(BOM), crlf: crlf > 0 && crlf * 2 >= lf };
}

export function normalizeLineEndings(text: string): string {
  return (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n?/g, "\n");
}

export function restoreLineEndings(text: string, endings: LineEndings): string {
  const body = endings.crlf ? text.replace(/\n/g, "\r\n") : text;
  return endings.bom ? BOM + body : body;
}

// Gaps without a unique anchor line fall back to a quadratic LCS only while
// the table stays small; past that, the gap is left unmatched (a conflict,
// which resolves to the user's side).
const MAX_LCS_CELLS = 250_000;

/** For each index in `a`, the index of the line it matches in `b`, or -1. */
export function matchLines(a: ArrayLike<number>, b: ArrayLike<number>): Int32Array {
  const match = new Int32Array(a.length).fill(-1);
  const stack: [number, number, number, number][] = [[0, a.length, 0, b.length]];

  while (stack.length > 0) {
    let [aLo, aHi, bLo, bHi] = stack.pop()!;
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) match[aLo++] = bLo++;
    while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) match[--aHi] = --bHi;
    if (aLo === aHi || bLo === bHi) continue;

    const anchors = uniqueAnchors(a, aLo, aHi, b, bLo, bHi);
    if (anchors.length === 0) {
      if ((aHi - aLo) * (bHi - bLo) <= MAX_LCS_CELLS) lcsMatch(a, aLo, aHi, b, bLo, bHi, match);
      continue;
    }
    let prevA = aLo;
    let prevB = bLo;
    for (const [ai, bi] of anchors) {
      match[ai] = bi;
      stack.push([prevA, ai, prevB, bi]);
      prevA = ai + 1;
      prevB = bi + 1;
    }
    stack.push([prevA, aHi, prevB, bHi]);
  }
  return match;
}

/**
 * Lines that occur exactly once in both ranges, reduced to the longest run
 * that is increasing in both (patience sorting).
 */
function uniqueAnchors(
  a: ArrayLike<number>, aLo: number, aHi: number,
  b: ArrayLike<number>, bLo: number, bHi: number,
): [number, number][] {
  const seen = new Map<number, { inA: number; inB: number; ai: number; bi: number }>();
  for (let i = aLo; i < aHi; i++) {
    const s = seen.get(a[i]);
    if (s) s.inA++;
    else seen.set(a[i], { inA: 1, inB: 0, ai: i, bi: -1 });
  }
  for (let j = bLo; j < bHi; j++) {
    const s = seen.get(b[j]);
    if (s) {
      s.inB++;
      s.bi = j;
    }
  }
  const pairs: [number, number][] = [];
  for (const s of seen.values()) if (s.inA === 1 && s.inB === 1) pairs.push([s.ai, s.bi]);
  if (pairs.length === 0) return pairs;
  pairs.sort((x, y) => x[0] - y[0]);

  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < pairs[k][1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out: [number, number][] = [];
  for (let k = tails[tails.length - 1]; k !== -1; k = prev[k]) out.push(pairs[k]);
  return out.reverse();
}

function lcsMatch(
  a: ArrayLike<number>, aLo: number, aHi: number,
  b: ArrayLike<number>, bLo: number, bHi: number,
  match: Int32Array,
) {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = a[aLo + i] === b[bLo + j]
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[aLo + i] === b[bLo + j]) {
      match[aLo + i] = bLo + j;
      i++;
      j++;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      i++;
    } else {
      j++;
    }
  }
}

function sameIds(x: number[], y: number[]): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Text with markdown punctuation, spacing, ordered-list numbers, inline HTML
 * tags and link targets removed, so `- a` and `* a`, `3. a` and `1. a`, `_x_`
 * and `*x*`, `[a][1]` and `[a](url)`, a table before and after re-padding, a
 * paragraph before and after its soft wraps are joined, or a list item with
 * and without a blank line after it all compare equal. Text with no letters
 * or digits keeps its trimmed form, so a fence never pairs with a blank line.
 */
function looseKey(text: string): string {
  const key = text
    .replace(/^[ \t>]*\d+[.)](?=\s)/gm, "")
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, "")
    .replace(/\]\([^()\s]*(?:\s+"[^"]*")?\)|\]\[[^\]]*\]/g, "]")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return key || text.trim();
}

/** The words of a block in sorted order, for blocks the serializer reorders. */
function bagKey(text: string): string {
  return looseKey(text.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").sort().join(" "));
}

/**
 * `matchLines` on exact ids, then again with each coarser key in turn, each
 * pass only inside the gaps the passes before it left. Finer keys anchor
 * first, so a coarse match can never pull the alignment away from an exact
 * one.
 */
function matchInPasses(x: number[], y: number[], keys: ((id: number) => number)[]): Int32Array {
  const match = matchLines(x, y);
  for (const keyOf of keys) {
    let i = 0;
    let j = 0;
    while (i <= x.length) {
      let gapEnd = i;
      while (gapEnd < x.length && match[gapEnd] === -1) gapEnd++;
      const yEnd = gapEnd < x.length ? match[gapEnd] : y.length;
      if (gapEnd > i && yEnd > j) {
        const inner = matchLines(x.slice(i, gapEnd).map(keyOf), y.slice(j, yEnd).map(keyOf));
        inner.forEach((m, k) => {
          if (m !== -1) match[i + k] = j + m;
        });
      }
      if (gapEnd === x.length) break;
      i = gapEnd + 1;
      j = yEnd + 1;
    }
  }
  return match;
}

const LIST_ITEM_START = /^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]/;
const ATX_HEADING = /^[ \t]{0,3}#{1,6}(?:[ \t]|$)/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Split LF text into blocks: a run of non-blank lines plus the blank lines
 * after it. Each top-level list item and each ATX heading is a block of its
 * own, and a fenced code block is never split, blank lines and all. Blocks
 * partition the lines, so joining them gives back the text exactly.
 */
export function splitBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let trailingBlank = false;
  let fence: string | null = null;
  let prevHeading = false;
  for (const line of text.split("\n")) {
    const blank = line.trim() === "";
    if (fence !== null) {
      current.push(line);
      const close = line.match(FENCE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) fence = null;
      continue;
    }
    if (blank) {
      current.push(line);
      trailingBlank = current.some((l) => l.trim() !== "");
      continue;
    }
    const heading = ATX_HEADING.test(line);
    const startsBlock = trailingBlank || LIST_ITEM_START.test(line) || heading || prevHeading;
    if (startsBlock && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
    trailingBlank = false;
    prevHeading = heading;
    const open = line.match(FENCE);
    if (open) fence = open[1];
  }
  blocks.push(current);
  return blocks;
}

function trailingBlankCount(lines: string[]): number {
  let n = 0;
  while (n < lines.length && lines[lines.length - 1 - n].trim() === "") n++;
  return n;
}

const LINE_PREFIX = /^([ \t]*(?:>[ \t]?)*)(?:([-*+]|\d+[.)])([ \t]+))?(\[[ xX]\][ \t]+)?/;

/**
 * `edited` with the original's spelling of every part of the line prefix
 * (indent and quote markers, bullet or number, task box) the user did not
 * change. Editing the text of `3. item` then keeps the 3, even though the
 * serializer numbers every list from 1 and writes `*` for `-`.
 */
export function keepLinePrefix(base: string, original: string, edited: string): string {
  const o = base.match(LINE_PREFIX)!;
  const a = original.match(LINE_PREFIX)!;
  const b = edited.match(LINE_PREFIX)!;
  const ordered = (bullet: string | undefined) => bullet !== undefined && /\d/.test(bullet);
  const sameKind = (a[2] === undefined) === (o[2] === undefined) && ordered(a[2]) === ordered(o[2]);
  if (!sameKind) return edited;
  const pick = (k: number) => (b[k] === o[k] ? a[k] : b[k]) ?? "";
  return pick(1) + pick(2) + pick(3) + pick(4) + edited.slice(b[0].length);
}

const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/;
const TABLE_RULE_CELL = /^:?-+:?$/;

/**
 * Whether the user left this line as it was. Table rows compare cell by cell
 * with padding ignored, since editing one cell re-pads every row of the
 * table; separator rows compare by alignment only.
 */
function sameContent(edited: string, base: string): boolean {
  if (edited === base) return true;
  if (!TABLE_ROW.test(edited) || !TABLE_ROW.test(base)) return false;
  const cells = (row: string) =>
    row.trim().slice(1, -1).split("|").map((cell) => {
      const c = cell.trim();
      return TABLE_RULE_CELL.test(c) ? `${c.startsWith(":")}${c.endsWith(":")}` : c;
    });
  const e = cells(edited);
  const b = cells(base);
  return e.length === b.length && e.every((c, i) => c === b[i]);
}

/**
 * The user's version of a block, written as close to the original as the
 * edit allows: when the block kept its line count, lines the user did not
 * touch keep their original bytes and edited ones keep their original list
 * prefix; either way the original's blank lines after the block are kept, so
 * editing an item of a loose list does not tighten it.
 */
function rewriteBlock(base: string[], original: string[], edited: string[]): string[] {
  const contentOf = (lines: string[]) => lines.slice(0, lines.length - trailingBlankCount(lines));
  const o = contentOf(base);
  const a = contentOf(original);
  const b = contentOf(edited);
  const content = o.length === a.length && o.length === b.length
    ? b.map((line, k) => (sameContent(line, o[k]) ? a[k] : keepLinePrefix(o[k], a[k], line)))
    : b;
  return [...content, ...original.slice(a.length)];
}

/**
 * Block-level three-way merge of LF-only strings.
 *
 * Base blocks are aligned to the original exactly, then loosely (see
 * `looseKey`), then by their words (see `bagKey`), and to the user's text
 * exactly. A block the user left alone is
 * written as the original block, whatever the serializer did to it. A block
 * the user changed is written as theirs (see `rewriteBlock`). Original blocks
 * with no counterpart (reference definitions, raw HTML, anything the
 * serializer drops) stay where they are, around the user's changes.
 */
export function mergeLines(ours: string, base: string, theirs: string): string {
  const ids = new Map<string, number>();
  const blocks: string[][] = [];
  const intern = (text: string) =>
    splitBlocks(text).map((lines) => {
      const key = lines.join("\n");
      let id = ids.get(key);
      if (id === undefined) {
        id = blocks.length;
        ids.set(key, id);
        blocks.push(lines);
      }
      return id;
    });
  const a = intern(ours);
  const o = intern(base);
  const b = intern(theirs);

  const keyed = (keyOf: (text: string) => string) => {
    const ids = new Map<string, number>();
    return (id: number) => {
      const key = keyOf(blocks[id].join("\n"));
      let k = ids.get(key);
      if (k === undefined) {
        k = ids.size;
        ids.set(key, k);
      }
      return k;
    };
  };
  // Neither is an edit to a block: gaining a blank line after it (blank
  // lines belong to the block before them, so the last block gains one when
  // the user appends), or being renumbered (the serializer restarts an
  // ordered list at 1 after the user splits it).
  const contentKey = (text: string) => text.replace(/\s+$/, "");
  const unnumberedKey = (text: string) => contentKey(text).replace(/^([ \t>]*)\d+([.)])/gm, "$11$2");
  const toA = matchInPasses(o, a, [keyed(contentKey), keyed(looseKey), keyed(bagKey)]);
  const toB = matchInPasses(o, b, [keyed(contentKey), keyed(unnumberedKey)]);

  const out: string[] = [];
  const emitOriginal = (ids: number[]) => ids.forEach((id) => out.push(...blocks[id]));
  // A block the user inserted after an original block that ends without a
  // blank line (an original-only reference definition, or a file with no
  // final newline) gets the separator the user's side has before it. Blocks
  // that replace original ones keep the original's spacing instead.
  const emitTheirs = (lines: string[], insertedAfter: number | null) => {
    if (lines.length === 0) return;
    const prevLine = out[out.length - 1];
    if (insertedAfter !== null && insertedAfter >= 0 && prevLine !== undefined && prevLine.trim() !== "" && lines[0].trim() !== "") {
      const prev = blocks[b[insertedAfter]];
      out.push(...prev.slice(prev.length - trailingBlankCount(prev)));
    }
    out.push(...lines);
  };
  const userBlocks = (from: number, to: number) => b.slice(from, to).flatMap((id) => blocks[id]);
  // Deleting the last item of a list deletes the blank line that separated
  // the list from what follows; the original's separator is kept instead.
  const emitInPlaceOf = (replaced: number[], lines: string[]) => {
    emitTheirs(lines, null);
    if (lines.length > 0 || replaced.length === 0) return;
    if (out.length === 0 || out[out.length - 1].trim() === "") return;
    const last = blocks[replaced[replaced.length - 1]];
    out.push(...last.slice(last.length - trailingBlankCount(last)));
  };

  let io = 0;
  let ia = 0;
  let ib = 0;
  while (io < o.length || ia < a.length || ib < b.length) {
    if (io < o.length && toA[io] === ia && toB[io] === ib) {
      emitOriginal([a[ia]]);
      io++;
      ia++;
      ib++;
      continue;
    }
    const [next, endA, endB] = unstableChunk(toA, toB, io, a.length, b.length);
    const oChunk = o.slice(io, next);
    const aChunk = a.slice(ia, endA);
    const bChunk = b.slice(ib, endB);

    if (sameIds(oChunk, bChunk)) {
      emitOriginal(aChunk);
    } else if (oChunk.length === 0) {
      if (!sameIds(aChunk, bChunk)) emitOriginal(aChunk);
      emitTheirs(userBlocks(ib, endB), ib - 1);
    } else if (sameIds(oChunk, aChunk) || sameIds(aChunk, bChunk)) {
      emitInPlaceOf(aChunk, userBlocks(ib, endB));
    } else if (allMatched(toA, io, next)) {
      const first = toA[io];
      const last = toA[next - 1];
      emitOriginal(a.slice(ia, first));
      if (bChunk.length === oChunk.length) {
        bChunk.forEach((id, k) => emitTheirs(rewriteBlock(blocks[o[io + k]], blocks[a[toA[io + k]]], blocks[id]), null));
      } else {
        emitInPlaceOf(a.slice(first, last + 1), userBlocks(ib, endB));
      }
      emitOriginal(a.slice(last + 1, endA));
    } else if (insertedAround(toB, io, next)) {
      emitTheirs(userBlocks(ib, toB[io]), ib - 1);
      emitOriginal(aChunk);
      emitTheirs(userBlocks(toB[next - 1] + 1, endB), toB[next - 1]);
    } else {
      emitInPlaceOf(aChunk, userBlocks(ib, endB));
    }

    io = next;
    ia = endA;
    ib = endB;
  }
  return out.join("\n");
}

/**
 * Where the unstable chunk starting at base block `io` ends, in base, ours and
 * theirs. It ends at the next base block both sides still have, or earlier,
 * where one side's alignment ends and the other's resumes: a block the user
 * rewrote, followed by blocks they left alone that the serializer mangled
 * beyond recognition, is then two chunks, and the second keeps its bytes.
 */
function unstableChunk(
  toA: Int32Array, toB: Int32Array, io: number, aLength: number, bLength: number,
): [number, number, number] {
  if (io < toA.length && toA[io] !== -1 && toB[io] !== -1) return [io, toA[io], toB[io]];
  for (let k = io + 1; k < toA.length; k++) {
    if (toA[k] !== -1 && toB[k] !== -1) return [k, toA[k], toB[k]];
    if (toA[k - 1] !== -1 && toB[k] !== -1) return [k, toA[k - 1] + 1, toB[k]];
    if (toB[k - 1] !== -1 && toA[k] !== -1) return [k, toA[k], toB[k - 1] + 1];
  }
  return [toA.length, aLength, bLength];
}

function allMatched(match: Int32Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (match[i] === -1) return false;
  return true;
}

/** Whether the user kept base[from..to) intact and only added blocks around it. */
function insertedAround(toB: Int32Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (toB[i] === -1) return false;
    if (i > from && toB[i] !== toB[i - 1] + 1) return false;
  }
  return true;
}

export function mergeVisualSave({
  original,
  baseline,
  current,
}: {
  original: string;
  baseline: string;
  current: string;
}): string {
  if (current === baseline) return original;
  const endings = detectLineEndings(original);
  const merged = mergeLines(
    normalizeLineEndings(original),
    normalizeLineEndings(baseline),
    normalizeLineEndings(current),
  );
  return restoreLineEndings(merged, endings);
}

import { matchLines } from "@kw/lib/markdownMerge";

export type TextChange = { from: number; to: number; insert: string };

/**
 * The edits that turn `before` into `after`, as small as a line diff and a
 * character trim of each changed run make them. Dispatched as one
 * transaction, they let the caret and selection map through an outside
 * change (an agent's write, a title edit) instead of resetting.
 */
export function minimalChanges(before: string, after: string): TextChange[] {
  if (before === after) return [];
  const ids = new Map<string, number>();
  const intern = (text: string) =>
    text.split("\n").map((line) => {
      let id = ids.get(line);
      if (id === undefined) ids.set(line, (id = ids.size));
      return id;
    });
  const a = before.split("\n");
  const b = after.split("\n");
  const match = matchLines(intern(before), intern(after));

  // Offsets are computed on the texts with a line break appended, so every
  // line, the last included, ends in one; see `emit` for mapping back.
  const A = `${before}\n`;
  const B = `${after}\n`;
  const starts = (lines: string[]) => {
    const out = [0];
    for (const line of lines) out.push(out[out.length - 1] + line.length + 1);
    return out;
  };
  const aStart = starts(a);
  const bStart = starts(b);
  const changes: TextChange[] = [];
  const emit = (i0: number, i1: number, j0: number, j1: number) => {
    if (i0 === i1 && j0 === j1) return;
    let from = aStart[i0];
    let to = aStart[i1];
    let insFrom = bStart[j0];
    let insTo = bStart[j1];
    while (from < to && insFrom < insTo && A[from] === B[insFrom]) {
      from++;
      insFrom++;
    }
    while (to > from && insTo > insFrom && A[to - 1] === B[insTo - 1]) {
      to--;
      insTo--;
    }
    if (from === to && insFrom === insTo) return;
    const insert = B.slice(insFrom, insTo);
    if (to <= before.length) {
      changes.push({ from, to, insert });
    } else if (insert === "") {
      // Deleting the last lines and the appended break: delete the break
      // before them instead.
      changes.push({ from: from - 1, to: before.length, insert });
    } else {
      // Appending lines after the appended break: put the break first.
      changes.push({ from: before.length, to: before.length, insert: `\n${insert.slice(0, -1)}` });
    }
  };

  let i = 0;
  let j = 0;
  for (let k = 0; k <= a.length; k++) {
    if (k < a.length && match[k] === -1) continue;
    const jj = k < a.length ? match[k] : b.length;
    emit(i, k, j, jj);
    i = k + 1;
    j = jj + 1;
  }
  return changes;
}

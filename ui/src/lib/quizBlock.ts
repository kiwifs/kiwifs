/**
 * Kiwi Quiz callouts.
 *
 * > [!quiz single ^id] Question
 * > - [ ] Option
 * >   Why this one is wrong.
 * > - [x] Correct option
 * >
 * > Shown after the answer is checked.
 *
 * Kinds: single, multi, boolean, order, match, short.
 * One [x] is single; more than one is multi. Order, match, boolean,
 * and short need the kind named on the tag line.
 */

export type QuizKind = "single" | "multi" | "boolean" | "order" | "match" | "short";

export type QuizOption = {
  id: string;
  text: string;
  correct: boolean;
  feedback?: string;
};

export type QuizItem = {
  id: string;
  text: string;
};

export type QuizPair = {
  id: string;
  left: string;
  right: string;
  feedback?: string;
};

export type QuizSpec = {
  kind: QuizKind;
  id: string;
  prompt: string;
  explanation: string;
  shuffle: boolean;
  options: QuizOption[];
  items: QuizItem[];
  pairs: QuizPair[];
  accept: string[];
  error?: string;
};

export type QuizResponse = {
  picked: string[];
  order: string[];
  pairs: Record<string, string>;
  text: string;
};

const KINDS = new Set<QuizKind>(["single", "multi", "boolean", "order", "match", "short"]);

const KIND_ALIAS: Record<string, QuizKind> = {
  single: "single",
  one: "single",
  choice: "single",
  multi: "multi",
  multiple: "multi",
  boolean: "boolean",
  tf: "boolean",
  truefalse: "boolean",
  order: "order",
  reorder: "order",
  match: "match",
  short: "short",
};

const TAG_RE = /^\[!quiz((?:\s+[^\s\]]+)*)\]\s*([\s\S]*)$/i;
const TASK_RE = /^[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^[-*+]\s+(.*)$/;
const NUMBER_RE = /^\d+[.)]\s+(.*)$/;

type RawItem = {
  text: string;
  correct: boolean;
  feedback: string[];
};

export function quizId(prompt: string, explicit?: string): string {
  const cleaned = (explicit ?? "").replace(/[^\w-]/g, "").slice(0, 64);
  if (cleaned) return cleaned;
  let h = 5381;
  const basis = prompt.trim().toLowerCase();
  for (let i = 0; i < basis.length; i++) h = Math.imul(h, 33) ^ basis.charCodeAt(i);
  return "q" + (h >>> 0).toString(36);
}

export function normalizeQuizText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.?!,;:]+$/g, "");
}

export function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function gradeQuiz(spec: QuizSpec, response: QuizResponse): boolean {
  if (spec.error) return false;
  if (spec.kind === "single" || spec.kind === "boolean" || spec.kind === "multi") {
    const want = spec.options.filter((o) => o.correct).map((o) => o.id).sort();
    const got = [...response.picked].sort();
    if (want.length !== got.length) return false;
    return want.every((id, i) => id === got[i]);
  }
  if (spec.kind === "order") {
    const want = spec.items.map((item) => item.id);
    if (response.order.length !== want.length) return false;
    return want.every((id, i) => id === response.order[i]);
  }
  if (spec.kind === "match") {
    return spec.pairs.every((pair) => response.pairs[pair.id] === pair.right);
  }
  const got = normalizeQuizText(response.text);
  return spec.accept.some((answer) => normalizeQuizText(answer) === got);
}

export function parseQuizCallout(raw: string): QuizSpec | null {
  const text = unwrapBlockquote(raw).replace(/^\n+/, "");
  if (!text.trim()) return null;
  const lines = text.split("\n");
  const tag = lines[0].match(TAG_RE);
  if (!tag) return null;

  const problems: string[] = [];
  let kind: QuizKind | undefined;
  let shuffle = false;
  let explicitId = "";
  for (const token of tag[1].trim().split(/\s+/).filter(Boolean)) {
    if (token.toLowerCase() === "shuffle") {
      shuffle = true;
      continue;
    }
    if (token.startsWith("^")) {
      explicitId = token.slice(1);
      continue;
    }
    const mapped = KIND_ALIAS[token.toLowerCase()];
    if (!mapped) {
      problems.push(`Unknown quiz flag "${token}".`);
      continue;
    }
    if (kind && kind !== mapped) {
      problems.push("A quiz can only have one kind.");
      continue;
    }
    kind = mapped;
  }

  const body = lines.slice(1);
  const freeform = kind === "short" || kind === "boolean" ? parseFreeform(body, tag[2].trim()) : null;
  if (freeform && !freeform.list) {
    const prompt = freeform.prompt;
    const id = quizId(prompt, explicitId);
    const base = emptySpec(kind ?? "single", id, prompt, freeform.explanation, shuffle);
    if (!prompt) problems.push("This quiz needs a question.");
    if (kind === "short") {
      const accept = freeform.answer.split("|").map((part) => part.trim()).filter(Boolean);
      if (accept.length === 0) problems.push("A short-answer quiz needs an accepted answer.");
      return finish({ ...base, kind: "short", accept }, problems);
    }
    const token = freeform.answer.trim().toLowerCase();
    const mapped = token === "yes" ? "true" : token === "no" ? "false" : token;
    if (mapped !== "true" && mapped !== "false") {
      problems.push("A true/false quiz needs an answer of true or false.");
    }
    return finish({
      ...base,
      kind: "boolean",
      accept: mapped === "true" || mapped === "false" ? [mapped] : [],
      options: [
        { id: "true", text: "True", correct: mapped === "true" },
        { id: "false", text: "False", correct: mapped === "false" },
      ],
    }, problems);
  }

  const parsed = parseItems(body, tag[2].trim());
  if (!kind) {
    if (parsed.items.length === 0) {
      problems.push("Name a quiz kind: single, multi, boolean, order, match, or short.");
    } else if (parsed.items.some((item) => item.correct)) {
      kind = parsed.items.filter((item) => item.correct).length > 1 ? "multi" : "single";
    } else if (parsed.items.every((item) => item.text.includes("::"))) {
      kind = "match";
    } else {
      kind = "order";
    }
  }

  const prompt = parsed.prompt;
  const id = quizId(prompt, explicitId);
  const base = emptySpec(kind ?? "single", id, prompt, parsed.explanation, shuffle);
  if (!prompt) problems.push("This quiz needs a question.");
  if (!kind) return finish(base, problems);

  if (kind === "order") {
    if (parsed.items.length < 2) problems.push("An order quiz needs at least two items.");
    return finish({
      ...base,
      kind,
      items: parsed.items.map((item, index) => ({ id: `i${index + 1}`, text: item.text })),
    }, problems);
  }

  if (kind === "match") {
    const pairs: QuizPair[] = [];
    parsed.items.forEach((item, index) => {
      const split = item.text.split("::");
      const right = split.slice(1).join("::").trim();
      if (split.length < 2 || !split[0].trim() || !right) {
        problems.push("Match items need a left :: right pair.");
        return;
      }
      pairs.push({
        id: `p${index + 1}`,
        left: split[0].trim(),
        right,
        feedback: item.feedback.join("\n").trim() || undefined,
      });
    });
    if (pairs.length < 2 && problems.length === 0) problems.push("A match quiz needs at least two pairs.");
    return finish({ ...base, kind, pairs }, problems);
  }

  if (kind === "short") {
    problems.push("A short-answer quiz needs an accepted answer.");
    return finish({ ...base, kind }, problems);
  }

  const marked = parsed.items.filter((item) => item.correct).length;
  if (kind === "single" && marked !== 1) problems.push("A choose-one quiz needs exactly one [x].");
  if (kind === "multi" && marked < 1) problems.push("A select-all quiz needs at least one [x].");
  if (kind === "boolean" && marked !== 1) problems.push("A true/false quiz needs exactly one [x].");
  if (parsed.items.length < 2) problems.push("This quiz needs at least two options.");

  return finish({
    ...base,
    kind,
    options: parsed.items.map((item, index) => ({
      id: `o${index + 1}`,
      text: item.text,
      correct: item.correct,
      feedback: item.feedback.join("\n").trim() || undefined,
    })),
  }, problems);
}

export function quizSpecFromAttr(raw: string | undefined | null): QuizSpec | null {
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{") ? raw : decodeURIComponent(raw);
    const spec = JSON.parse(json) as QuizSpec;
    if (!spec || !KINDS.has(spec.kind)) return null;
    return spec;
  } catch {
    return null;
  }
}

function finish(spec: QuizSpec, problems: string[]): QuizSpec {
  const unique = [...new Set(problems)];
  if (unique.length === 0) return spec;
  return { ...spec, error: unique.join(" ") };
}

function emptySpec(kind: QuizKind, id: string, prompt: string, explanation: string, shuffle: boolean): QuizSpec {
  return {
    kind,
    id,
    prompt,
    explanation,
    shuffle,
    options: [],
    items: [],
    pairs: [],
    accept: [],
  };
}

function unwrapBlockquote(raw: string): string {
  return raw.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/^\s{0,3}>\s?/, "")).join("\n");
}

function parseOptionLine(line: string): RawItem | null {
  const task = line.match(TASK_RE);
  if (task) return { text: task[2].trim(), correct: task[1].toLowerCase() === "x", feedback: [] };
  const bullet = line.match(BULLET_RE);
  if (bullet) return { text: bullet[1].trim(), correct: false, feedback: [] };
  const numbered = line.match(NUMBER_RE);
  if (numbered) return { text: numbered[1].trim(), correct: false, feedback: [] };
  return null;
}

function parseFreeform(body: string[], tagPrompt: string): { list: boolean; prompt: string; answer: string; explanation: string } | null {
  const content = body.map((line, index) => ({ line, index })).filter((row) => row.line.trim() !== "");
  if (content.length === 0) return { list: false, prompt: tagPrompt, answer: "", explanation: "" };
  if (parseOptionLine(content[0].line)) return { list: true, prompt: tagPrompt, answer: "", explanation: "" };
  if (tagPrompt) {
    return {
      list: false,
      prompt: tagPrompt,
      answer: content[0].line.trim(),
      explanation: cleanBlock(body.slice(content[0].index + 1)),
    };
  }
  const answer = content[1];
  return {
    list: false,
    prompt: content[0].line.trim(),
    answer: answer ? answer.line.trim() : "",
    explanation: answer ? cleanBlock(body.slice(answer.index + 1)) : "",
  };
}

function parseItems(body: string[], tagPrompt: string): { prompt: string; items: RawItem[]; explanation: string } {
  const prompt = tagPrompt ? [tagPrompt] : [];
  const items: RawItem[] = [];
  const explanation: string[] = [];
  let phase: "prompt" | "items" | "explain" = "prompt";

  for (const line of body) {
    if (phase === "explain") {
      explanation.push(line);
      continue;
    }
    const option = parseOptionLine(line);
    if (option) {
      phase = "items";
      items.push(option);
      continue;
    }
    if (phase === "items" && line.trim() === "") continue;
    if (phase === "items" && /^\s+\S/.test(line) && items.length > 0) {
      items[items.length - 1].feedback.push(line.trim());
      continue;
    }
    if (phase === "prompt") {
      if (line.trim()) prompt.push(line.trim());
      continue;
    }
    phase = "explain";
    explanation.push(line);
  }

  return { prompt: prompt.join("\n").trim(), items, explanation: cleanBlock(explanation) };
}

function cleanBlock(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end).join("\n").trim();
}

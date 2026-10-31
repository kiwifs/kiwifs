import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const isIOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Hides a span of syntax. */
export const hidden = Decoration.replace({});

export type Span = { from: number; to: number };

const setFocused = StateEffect.define<boolean>();

/**
 * Whether the editor has focus. An unfocused editor still has a selection,
 * at the top of the page when it was never clicked, and revealing syntax
 * there would show a freshly opened page half raw.
 */
const focusedField = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setFocused) ? e.value : v), value),
});

export const trackFocus = [focusedField, EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing))];

export function focusChanged(tr: Transaction): boolean {
  return tr.effects.some((e) => e.is(setFocused));
}

/**
 * Whether any selection range touches [from, to], edges included, so the
 * syntax of the element the caret sits in or next to is shown for editing.
 * Revealing per element rather than per line keeps the decorations in front
 * of an IME composition still while the user types. Without `trackFocus`
 * installed (in tests) the editor counts as focused.
 */
export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  if (state.field(focusedField, false) === false) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

const FRONTMATTER_FENCE = /^---[ \t]*$/;
const FRONTMATTER_CLOSE = /^(---|\.\.\.)[ \t]*$/;

/**
 * The YAML frontmatter block at the top of the page, delimiters included.
 * The markdown grammar has no frontmatter node: it reads the block as a
 * thematic break and a setext heading, so every decoration skips this range.
 */
export function frontmatterRange(state: EditorState): Span | null {
  const doc = state.doc;
  if (doc.lines < 2 || !FRONTMATTER_FENCE.test(doc.line(1).text.replace(/^﻿/, ""))) return null;
  const last = Math.min(doc.lines, 500);
  for (let n = 2; n <= last; n++) {
    const line = doc.line(n);
    if (FRONTMATTER_CLOSE.test(line.text)) return { from: 0, to: line.to };
  }
  return null;
}

/** Calls `enter` for each syntax node overlapping `ranges`, outside the frontmatter. */
export function eachNode(
  state: EditorState,
  ranges: readonly Span[],
  enter: (node: { name: string; from: number; to: number; node: import("@lezer/common").SyntaxNode }) => boolean | void,
) {
  const fm = frontmatterRange(state);
  const tree = syntaxTree(state);
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        if (fm && ref.from < fm.to) return ref.to > fm.to ? undefined : false;
        return enter({ name: ref.name, from: ref.from, to: ref.to, node: ref.node });
      },
    });
  }
}

export type DecorationBuilder = (state: EditorState, ranges: readonly Span[]) => Range<Decoration>[];

/** The whole document, for builders run outside a view (tests, StateFields). */
export function wholeDoc(state: EditorState): Span[] {
  return [{ from: 0, to: state.doc.length }];
}

/**
 * A ViewPlugin running `build` over the visible ranges. On iOS it covers the
 * whole document and skips pure viewport changes, because replacing the
 * decorations mid-scroll stops WebKit's momentum scrolling.
 */
export function decorationPlugin(build: DecorationBuilder) {
  const compute = (view: EditorView) => {
    const ranges = isIOS ? wholeDoc(view.state) : view.visibleRanges;
    return Decoration.set(build(view.state, ranges), true);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = compute(view);
      }
      update(update: ViewUpdate) {
        const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
        const focus = update.transactions.some(focusChanged);
        if (update.docChanged || update.selectionSet || treeChanged || focus || (!isIOS && update.viewportChanged)) {
          this.decorations = compute(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * Decorations from `build` collected in a test or a StateField: sorted, with
 * a replaced span and the marks inside it kept apart.
 */
export function collect(state: EditorState, build: DecorationBuilder): DecorationSet {
  return Decoration.set(build(state, wholeDoc(state)), true);
}

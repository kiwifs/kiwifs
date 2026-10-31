/*
 * iOS editing fixes, ported from SilverBullet's
 * client/codemirror/editing/ios_enter.ts and ios_completion.ts
 * (MIT, Copyright 2022 Zef Hemel). See THIRD_PARTY_NOTICES.md.
 */
import { acceptCompletion, currentCompletions, setSelectedCompletion } from "@codemirror/autocomplete";
import { EditorSelection, type Extension } from "@codemirror/state";
import { getCM } from "@replit/codemirror-vim";
import { type EditorView, runScopeHandlers, ViewPlugin } from "@codemirror/view";
import { isIOS } from "./util";

// CodeMirror lets iOS insert Enter natively and replays it as a synthetic key
// once the DOM change arrives, or after a 50ms timeout. When the native line
// break lands after that timeout, Enter is applied twice. Separately, the tap
// that opens the keyboard can leave CodeMirror's selection out of sync with
// the native caret. So on iOS Enter is taken over at beforeinput, where the
// native caret is authoritative, and the keymap runs exactly once.
const iosEnterPlugin = ViewPlugin.fromClass(
  class {
    pendingKey: KeyboardEvent | null = null;
    fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    suppressLineBreakUntil = 0;

    constructor(readonly view: EditorView) {
      view.dom.addEventListener("keydown", this.onKeyDown, true);
      view.dom.addEventListener("beforeinput", this.onBeforeInput, true);
    }

    destroy() {
      this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
      this.view.dom.removeEventListener("beforeinput", this.onBeforeInput, true);
      clearTimeout(this.fallbackTimer);
    }

    onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        (event as KeyboardEvent & { synthetic?: boolean }).synthetic ||
        !this.handlesInput(event.target) ||
        vimCommandMode(this.view)
      ) {
        return;
      }
      // Keep CodeMirror from scheduling its own delayed Enter, but leave the
      // default action alone so iOS still fires beforeinput and its keyboard
      // state (auto-capitalization) stays correct.
      event.stopPropagation();
      this.pendingKey = event;
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = setTimeout(() => {
        this.runEnter();
        this.suppressLineBreakUntil = Date.now() + 1000;
      }, 500);
    };

    onBeforeInput = (event: InputEvent) => {
      if (
        (event.inputType !== "insertParagraph" && event.inputType !== "insertLineBreak") ||
        event.isComposing ||
        !this.handlesInput(event.target)
      ) {
        return;
      }
      if (vimCommandMode(this.view)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!this.pendingKey && Date.now() < this.suppressLineBreakUntil) return;
      this.runEnter();
    };

    handlesInput(target: EventTarget | null): boolean {
      const view = this.view;
      return (
        target === view.contentDOM &&
        !view.composing &&
        !view.state.readOnly &&
        view.contentDOM.isContentEditable
      );
    }

    runEnter() {
      clearTimeout(this.fallbackTimer);
      const shiftKey = (this.pendingKey?.shiftKey ?? false) && !this.autoShift();
      this.pendingKey = null;
      this.syncSelectionFromDOM();
      const view = this.view;
      const enter = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, shiftKey });
      if (!runScopeHandlers(view, enter, "editor")) {
        view.dispatch(view.state.replaceSelection(view.state.lineBreak), {
          scrollIntoView: true,
          userEvent: "input",
        });
      }
    }

    // With autocapitalize on, the virtual keyboard reports Shift at the start
    // of every sentence; treating that as Shift-Enter would skip the keymap.
    autoShift(): boolean {
      const vv = globalThis.visualViewport;
      return (
        !/^(off|none)$/.test(this.view.contentDOM.autocapitalize) &&
        !!vv &&
        (vv.height * vv.scale) / document.documentElement.clientHeight < 0.85
      );
    }

    syncSelectionFromDOM() {
      const view = this.view;
      const domSel = document.getSelection();
      if (
        view.state.selection.ranges.length > 1 ||
        !domSel?.anchorNode ||
        !domSel.focusNode ||
        !view.contentDOM.contains(domSel.anchorNode) ||
        !view.contentDOM.contains(domSel.focusNode)
      ) {
        return;
      }
      const anchor = view.posAtDOM(domSel.anchorNode, domSel.anchorOffset);
      const head = view.posAtDOM(domSel.focusNode, domSel.focusOffset);
      const main = view.state.selection.main;
      if (anchor !== main.anchor || head !== main.head) {
        view.dispatch({ selection: EditorSelection.single(anchor, head), userEvent: "select" });
      }
    }
  },
);

/**
 * Whether Vim is on and outside insert mode. Vim reads Enter from the
 * editor's own keydown handler, which the capture listener above would
 * otherwise cut off, leaving a native line break where a motion belongs.
 */
export function vimCommandMode(view: EditorView): boolean {
  const vim = getCM(view)?.state.vim as { insertMode?: boolean } | undefined;
  return !!vim && !vim.insertMode;
}

const TAP_SLOP = 10;

// A tap on an autocomplete option on iOS lands as a touch the completion
// list never sees as a click; accept the tapped option directly.
const iosCompletionTapPlugin = ViewPlugin.fromClass(
  class {
    touchStart: { x: number; y: number } | null = null;

    constructor(readonly view: EditorView) {
      view.dom.addEventListener("touchstart", this.onTouchStart, { capture: true, passive: true });
      view.dom.addEventListener("touchend", this.onTouchEnd, true);
    }

    destroy() {
      this.view.dom.removeEventListener("touchstart", this.onTouchStart, true);
      this.view.dom.removeEventListener("touchend", this.onTouchEnd, true);
    }

    onTouchStart = (event: TouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      this.touchStart = touch && { x: touch.clientX, y: touch.clientY };
    };

    onTouchEnd = (event: TouchEvent) => {
      const start = this.touchStart;
      this.touchStart = null;
      const touch = event.changedTouches[0];
      if (!start || !touch || Math.abs(touch.clientX - start.x) > TAP_SLOP || Math.abs(touch.clientY - start.y) > TAP_SLOP) {
        return;
      }
      const index = completionOptionIndex(event.target);
      if (index === null || index >= currentCompletions(this.view.state).length) return;
      event.preventDefault();
      this.view.dispatch({ effects: setSelectedCompletion(index) });
      acceptCompletion(this.view);
    };
  },
);

/** The index of the autocomplete option a tap landed on, from its `…-<n>` id. */
export function completionOptionIndex(target: EventTarget | null): number | null {
  const option = target instanceof Element ? target.closest(".cm-tooltip-autocomplete li[id]") : null;
  const match = option && /-(\d+)$/.exec(option.id);
  return match ? +match[1] : null;
}

/** Enter and autocomplete taps that work on iOS; nothing elsewhere. */
export function iosEditing(): Extension {
  return isIOS ? [iosEnterPlugin, iosCompletionTapPlugin] : [];
}

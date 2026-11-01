import { acceptCompletion, completionStatus, setSelectedCompletion, currentCompletions } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lets the menu open (or re-filter) before the next keystroke. Typing faster
 * than `activateOnTypingDelay` would make the source run once on the whole
 * query and hide stale-range bugs.
 */
async function settle(view: EditorView): Promise<void> {
  const deadline = Date.now() + 300;
  do {
    await sleep(20);
  } while (completionStatus(view.state) !== "active" && Date.now() < deadline);
}

/**
 * Types like a keyboard would: one `input.type` transaction per character,
 * so CodeMirror keeps re-filtering the result it already has (via
 * `validFor`) instead of asking the source again. Don't call `view.focus()`;
 * happy-dom throws "update in progress" when CodeMirror syncs the selection.
 */
export async function typeText(view: EditorView, text: string): Promise<void> {
  for (const ch of text) {
    const head = view.state.selection.main.head;
    view.dispatch({
      changes: { from: head, insert: ch },
      selection: { anchor: head + 1 },
      userEvent: "input.type",
    });
    await settle(view);
  }
}

/** Waits for the menu to be ready, optionally picks `label`, then accepts. */
export async function accept(view: EditorView, label?: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (completionStatus(view.state) === "active") {
      if (label !== undefined) {
        const index = currentCompletions(view.state).findIndex((c) => c.label === label);
        if (index < 0) throw new Error(`No completion labelled ${label}`);
        view.dispatch({ effects: setSelectedCompletion(index) });
      }
      // acceptCompletion refuses until `interactionDelay` has passed since
      // the menu opened, so retry rather than guess the delay.
      if (acceptCompletion(view)) return;
    }
    await sleep(25);
  }
  throw new Error(`Completion never became acceptable for ${JSON.stringify(view.state.doc.toString())}`);
}

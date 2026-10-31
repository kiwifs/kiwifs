// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { describe, expect, it } from "vitest";
import { completionOptionIndex, vimCommandMode } from "./ios";

describe("completionOptionIndex", () => {
  it("reads the option index from a tapped list item", () => {
    const tooltip = document.createElement("div");
    tooltip.className = "cm-tooltip-autocomplete";
    tooltip.innerHTML = '<ul><li id="cm-ac-x-3"><span>label</span></li></ul>';
    expect(completionOptionIndex(tooltip.querySelector("span"))).toBe(3);
    expect(completionOptionIndex(tooltip)).toBeNull();
  });
});

describe("vimCommandMode", () => {
  it("is on only while Vim is outside insert mode", () => {
    const plain = new EditorView({ state: EditorState.create({ doc: "text" }), parent: document.body });
    expect(vimCommandMode(plain)).toBe(false);
    plain.destroy();

    const view = new EditorView({ state: EditorState.create({ doc: "text", extensions: [vim()] }), parent: document.body });
    expect(vimCommandMode(view)).toBe(true);
    Vim.handleKey(getCM(view)!, "i", "user");
    expect(vimCommandMode(view)).toBe(false);
    view.destroy();
  });
});

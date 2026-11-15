// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageFiles, imageMarkdown, imageUpload, pastedImageName, uploadableFile } from "./imageUpload";

const when = new Date(2026, 5, 23, 14, 30, 22);

function png(name: string): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
}

function transfer(files: File[], text = ""): DataTransfer {
  return {
    files,
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    getData: (type: string) => (type === "text/plain" ? text : ""),
  } as unknown as DataTransfer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view?.dom.remove();
  view = null;
});

function editor(doc: string, upload: (file: File) => Promise<string>, extra: { readOnly?: boolean } = {}) {
  const onError = vi.fn<(message: string) => void>();
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [imageUpload({ upload, onError }), EditorState.readOnly.of(extra.readOnly ?? false)],
    }),
    parent: document.body,
  });
  return { view, onError };
}

function paste(target: EditorView, data: DataTransfer): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  target.contentDOM.dispatchEvent(event);
  return event;
}

function drop(target: EditorView, data: DataTransfer): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: data });
  target.contentDOM.dispatchEvent(event);
  return event;
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("pastedImageName", () => {
  it("stamps the local time and the type's extension", () => {
    expect(pastedImageName("image/jpeg", new Date(2026, 0, 2, 3, 4, 5))).toBe("paste-20260102-030405.jpg");
  });

  it("numbers further images pasted in the same second", () => {
    const later = new Date(2026, 5, 23, 14, 31, 0);
    expect(pastedImageName("image/png", later)).toBe("paste-20260623-143100.png");
    expect(pastedImageName("image/png", later)).toBe("paste-20260623-143100-2.png");
    expect(pastedImageName("image/webp", later)).toBe("paste-20260623-143100-3.webp");
    expect(pastedImageName("image/png", new Date(2026, 5, 23, 14, 31, 1))).toBe("paste-20260623-143101.png");
  });
});

describe("uploadableFile", () => {
  it("renames a clipboard image, keeping its type and bytes", async () => {
    const file = uploadableFile(png("image.png"), new Date(2026, 5, 23, 9, 0, 0));
    expect(file.name).toBe("paste-20260623-090000.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
  });

  it("keeps the name of an image that has one", () => {
    const file = png("diagram.png");
    expect(uploadableFile(file, when)).toBe(file);
  });

  it("leaves files that are not uploadable images alone", () => {
    const file = new File(["%PDF"], "image.pdf", { type: "application/pdf" });
    expect(uploadableFile(file, when)).toBe(file);
  });
});

describe("imageFiles", () => {
  it("keeps only the image types the editor uploads", () => {
    const pdf = new File(["%PDF"], "spec.pdf", { type: "application/pdf" });
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const shot = png("shot.png");
    expect(imageFiles(transfer([pdf, shot, svg]))).toEqual([shot]);
  });

  it("falls back to the items list when files is empty", () => {
    const shot = png("image.png");
    const data = { files: [], items: [{ kind: "file", getAsFile: () => shot }, { kind: "string" }] };
    expect(imageFiles(data as unknown as DataTransfer)).toEqual([shot]);
  });

  it("is empty without a transfer", () => {
    expect(imageFiles(null)).toEqual([]);
  });
});

describe("imageMarkdown", () => {
  it("uses the name without its extension as alt text", () => {
    expect(imageMarkdown("paste-20260623-143022.png", "/raw/notes/paste-20260623-143022.png")).toBe(
      "![paste-20260623-143022](/raw/notes/paste-20260623-143022.png)",
    );
  });

  it("escapes brackets in the alt text and encodes spaces and parentheses in the URL", () => {
    expect(imageMarkdown("shot [1] (2).png", "/raw/a b/shot [1] (2).png")).toBe(
      "![shot \\[1\\] (2)](/raw/a%20b/shot%20[1]%20%282%29.png)",
    );
  });
});

describe("imageUpload", () => {
  it("uploads a pasted screenshot and inserts it in place of the selection", async () => {
    const upload = vi.fn(async (file: File) => `/raw/notes/${file.name}`);
    const { view } = editor("Before REPLACE after", upload);
    view.dispatch({ selection: { anchor: 7, head: 14 } });

    const event = paste(view, transfer([png("image.png")]));
    expect(event.defaultPrevented).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    const name = upload.mock.calls[0][0].name;
    expect(name).toMatch(/^paste-\d{8}-\d{6}(-\d+)?\.png$/);

    await settle();
    expect(view.state.doc.toString()).toBe(`Before ![${name.replace(".png", "")}](/raw/notes/${name}) after`);
    expect(view.state.selection.main.head).toBe(7 + `![${name.replace(".png", "")}](/raw/notes/${name})`.length);
  });

  it("shows a marker while uploading and writes no placeholder text", async () => {
    const pending = deferred<string>();
    const { view } = editor("Text", () => pending.promise);
    view.dispatch({ selection: { anchor: 4 } });

    paste(view, transfer([png("diagram.png")]));
    expect(view.state.doc.toString()).toBe("Text");
    expect(view.dom.querySelector(".cm-image-uploading")?.textContent).toBe("Uploading diagram.png…");

    pending.resolve("/raw/diagram.png");
    await settle();
    expect(view.state.doc.toString()).toBe("Text\n![diagram](/raw/diagram.png)");
    expect(view.dom.querySelector(".cm-image-uploading")).toBeNull();
  });

  it("lands where the paste was even when the text before it changes meanwhile", async () => {
    const pending = deferred<string>();
    const { view } = editor("one\ntwo", () => pending.promise);
    view.dispatch({ selection: { anchor: 4 } });
    paste(view, transfer([png("diagram.png")]));

    view.dispatch({ changes: { from: 0, insert: "zero\n" } });
    view.dispatch({ changes: { from: view.state.doc.length, insert: " three" } });
    pending.resolve("/raw/diagram.png");
    await settle();
    expect(view.state.doc.toString()).toBe("zero\none\n![diagram](/raw/diagram.png)\ntwo three");
  });

  it("inserts several images in the order they were pasted", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const uploads = [first, second];
    const { view } = editor("", () => uploads.shift()!.promise);
    drop(view, transfer([png("a.png"), png("b.png")]));
    expect(view.dom.querySelector(".cm-image-uploading")?.textContent).toBe("Uploading 2 images…");

    second.resolve("/raw/b.png");
    first.resolve("/raw/a.png");
    await settle();
    expect(view.state.doc.toString()).toBe("![a](/raw/a.png)\n![b](/raw/b.png)");
  });

  it("takes a drop that the file tree's drag-and-drop already cancelled", async () => {
    const cancel = (event: Event) => event.preventDefault();
    window.addEventListener("drop", cancel, true);
    try {
      const { view } = editor("", async (file) => `/raw/${file.name}`);
      drop(view, transfer([png("a.png")]));
      await settle();
      expect(view.state.doc.toString()).toBe("![a](/raw/a.png)");
    } finally {
      window.removeEventListener("drop", cancel, true);
    }
  });

  it("reports a failed upload and removes its marker", async () => {
    const { view, onError } = editor("Text", async () => {
      throw new Error("File too large (max 100 MB)");
    });
    paste(view, transfer([png("huge.png")]));
    await settle();
    expect(onError).toHaveBeenCalledWith("Could not upload huge.png: File too large (max 100 MB)");
    expect(view.state.doc.toString()).toBe("Text");
    expect(view.dom.querySelector(".cm-image-uploading")).toBeNull();
  });

  it("still inserts the images that made it when one of several fails", async () => {
    const { view, onError } = editor("", async (file) => {
      if (file.name === "bad.png") throw new Error("415 Unsupported Media Type");
      return `/raw/${file.name}`;
    });
    drop(view, transfer([png("bad.png"), png("good.png")]));
    await settle();
    expect(onError).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe("![good](/raw/good.png)");
  });

  it("leaves text pastes, mixed text-and-image pastes and non-image drops to the editor", async () => {
    const upload = vi.fn(async () => "/raw/x.png");
    const { view } = editor("", upload);
    expect(paste(view, transfer([], "plain words")).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("plain words");
    paste(view, transfer([png("image.png")], "A1\tB1"));
    expect(view.state.doc.toString()).toBe("plain wordsA1\tB1");
    drop(view, transfer([new File(["%PDF"], "spec.pdf", { type: "application/pdf" })]));
    // The editor's own drop handler reads the file as text, off a timer.
    await settle();
    expect(upload).not.toHaveBeenCalled();
  });

  it("does nothing in a read-only editor", () => {
    const upload = vi.fn(async () => "/raw/x.png");
    const { view } = editor("", upload, { readOnly: true });
    paste(view, transfer([png("image.png")]));
    drop(view, transfer([png("image.png")]));
    expect(upload).not.toHaveBeenCalled();
  });
});

import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

/** Image types the text editor uploads when they are pasted or dropped. */
export const UPLOADABLE_IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// What browsers call a bitmap on the clipboard (a screenshot, "Copy image").
// Uploaded as is, every paste into a folder would overwrite the last one.
const CLIPBOARD_NAME = /^image\.(png|jpe?g|gif|webp)$/i;

/** Whether the text editor uploads `file` when it is pasted or dropped. */
export function isUploadableImage(file: File): boolean {
  return Object.hasOwn(UPLOADABLE_IMAGE_TYPES, file.type);
}

let lastStamp = "";
let sameStamp = 0;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `paste-20260623-143022.png`: the name a pasted image is stored under. A
 * second image in the same second gets `-2`, then `-3`, so a paste of several
 * images does not write them all to one file.
 */
export function pastedImageName(type: string, now = new Date()): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  sameStamp = stamp === lastStamp ? sameStamp + 1 : 1;
  lastStamp = stamp;
  const ext = Object.hasOwn(UPLOADABLE_IMAGE_TYPES, type) ? UPLOADABLE_IMAGE_TYPES[type] : "png";
  return `paste-${stamp}${sameStamp > 1 ? `-${sameStamp}` : ""}.${ext}`;
}

/**
 * The file to upload for `file`: an image straight off the clipboard, which
 * has no name of its own, is renamed to {@link pastedImageName}; anything
 * else keeps the name it came with.
 */
export function uploadableFile(file: File, now = new Date()): File {
  if (!isUploadableImage(file)) return file;
  if (file.name && !CLIPBOARD_NAME.test(file.name)) return file;
  return new File([file], pastedImageName(file.type, now), {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/** The images in a paste or drop, in order. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  let files = Array.from(data.files ?? []);
  // Some browsers leave `files` empty on paste and only fill `items`.
  if (files.length === 0 && data.items) {
    files = Array.from(data.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }
  return files.filter(isUploadableImage);
}

/** `![alt](url)` for an uploaded file, alt being its name without extension. */
export function imageMarkdown(name: string, url: string): string {
  const alt = name.replace(/\.[^./]+$/, "") || name;
  const href = url.replace(/[ ()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `![${alt.replace(/[[\]\\]/g, "\\$&")}](${href})`;
}

class UploadingWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: UploadingWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-image-uploading";
    span.setAttribute("role", "status");
    span.textContent = this.label;
    return span;
  }
}

const startUpload = StateEffect.define<{ id: number; pos: number; label: string }>({
  map: (value, changes) => ({ ...value, pos: changes.mapPos(value.pos, -1) }),
});
const endUpload = StateEffect.define<number>();

/**
 * Where each upload in flight will land, drawn as an "Uploading…" marker.
 * The marker is a decoration, not text: a save while the upload runs does
 * not write a placeholder into the file. Defined once, so the uploads
 * survive the editor reconfiguring its extensions.
 */
const pendingUploads = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(startUpload)) {
        const { id, pos, label } = effect.value;
        const marker = Decoration.widget({ widget: new UploadingWidget(label), side: -1, uploadId: id });
        set = set.update({ add: [marker.range(pos)] });
      } else if (effect.is(endUpload)) {
        set = set.update({ filter: (_from, _to, value) => value.spec.uploadId !== effect.value });
      }
    }
    return set;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function uploadPos(view: EditorView, id: number): number | null {
  let pos: number | null = null;
  view.state.field(pendingUploads).between(0, view.state.doc.length, (from, _to, value) => {
    if (value.spec.uploadId !== id) return;
    pos = from;
    return false;
  });
  return pos;
}

export type ImageUploadOptions = {
  /** Stores the file and resolves to the URL the markdown should link to. */
  upload: (file: File) => Promise<string>;
  /** Reports an upload that failed. */
  onError?: (message: string) => void;
};

/** "Could not upload shot.png: <why>", for an upload that failed. */
export function uploadErrorMessage(file: File, reason: unknown): string {
  return `Could not upload ${file.name}: ${reason instanceof Error ? reason.message : String(reason)}`;
}

let nextUploadId = 0;

async function uploadImages(view: EditorView, dropped: File[], pos: number, options: ImageUploadOptions) {
  const id = ++nextUploadId;
  const files = dropped.map((file) => uploadableFile(file));
  const label = files.length === 1 ? `Uploading ${files[0].name}…` : `Uploading ${files.length} images…`;
  view.dispatch({ effects: startUpload.of({ id, pos, label }) });

  const results = await Promise.allSettled(files.map((file) => options.upload(file)));
  const markdown: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      markdown.push(imageMarkdown(files[i].name, result.value));
    } else {
      options.onError?.(uploadErrorMessage(files[i], result.reason));
    }
  });

  const at = uploadPos(view, id);
  if (at === null) return;
  const { doc } = view.state;
  // An image that would butt against a word (dropped onto the start of a
  // paragraph, pasted right after a full stop) goes on a line of its own;
  // one placed between spaces was meant to sit inline.
  const butts = (from: number, to: number) => from >= 0 && to <= doc.length && /\S/.test(doc.sliceString(from, to));
  const before = butts(at - 1, at) ? "\n" : "";
  const after = butts(at, at + 1) ? "\n" : "";
  const insert = markdown.length ? before + markdown.join("\n") + after : "";
  const sel = view.state.selection.main;
  view.dispatch({
    changes: insert ? { from: at, insert } : undefined,
    // Typing on from the paste continues after the image, not before it.
    selection: insert && sel.empty && sel.head === at ? { anchor: at + insert.length } : undefined,
    effects: endUpload.of(id),
    userEvent: "input.paste",
  });
}

/**
 * Uploads images pasted or dropped into the editor and inserts a markdown
 * image for each where they went. Text, and files that are not images, are
 * left to the editor's own handling. A paste carrying text as well as an
 * image (a range copied from a spreadsheet) pastes the text.
 */
export function imageUpload(options: ImageUploadOptions): Extension {
  return [
    pendingUploads,
    EditorView.theme({
      ".cm-image-uploading": {
        color: "var(--muted-foreground)",
        fontStyle: "italic",
      },
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        if (view.state.readOnly || event.clipboardData?.getData("text/plain")) return false;
        const files = imageFiles(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        const { from, to } = view.state.selection.main;
        if (from !== to) {
          view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete" });
        }
        void uploadImages(view, files, from, options);
        return true;
      },
    }),
    ViewPlugin.define((view) => {
      // A plain capture listener rather than a CodeMirror handler: react-dnd
      // (the file tree) cancels every OS file drop on window in the capture
      // phase, and CodeMirror ignores events that arrive already cancelled.
      const onDrop = (event: DragEvent) => {
        if (view.state.readOnly) return;
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0) return;
        event.preventDefault();
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        void uploadImages(view, files, pos, options);
      };
      view.dom.addEventListener("drop", onDrop, true);
      return { destroy: () => view.dom.removeEventListener("drop", onDrop, true) };
    }),
  ];
}

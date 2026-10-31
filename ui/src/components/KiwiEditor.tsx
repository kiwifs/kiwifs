import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { BlockNoteEditor, createExtension, filterSuggestionItems } from "@blocknote/core";
import {
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { Check, ChevronDown, ChevronRight, Circle, Code, Eye, Info, Keyboard, Link as LinkIcon, ListTree, Loader2, PenLine, Puzzle, Save, TriangleAlert, User, X, XCircle } from "lucide-react";
import { allFences } from "@kw/fences";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import matter from "gray-matter";
import { api, type TreeEntry } from "@kw/lib/api";
import { resolveRawUrl } from "@kw/lib/rawUrl";
import { Button } from "@kw/components/ui/button";
import { Input } from "@kw/components/ui/input";
import { Textarea } from "@kw/components/ui/textarea";
import { dirOf, stem, titleize } from "@kw/lib/paths";
import { KiwiBreadcrumb } from "./KiwiBreadcrumb";
import { ExcalidrawMarkdownEditor, isExcalidrawMarkdown } from "./ExcalidrawMarkdownPreview";
import { frontmatterToText, joinFrontmatter, splitFrontmatter } from "@kw/lib/frontmatter";
import {
  type EditorMode,
  editorModeFromView,
  joinVisualSource,
  loadEditorModePreference,
  loadVimPreference,
  saveEditorModePreference,
  saveVimPreference,
  splitVisualSource,
  type VisualSource,
  wikiPagesFromTree,
} from "@kw/lib/editorMode";
import { buildResolver } from "@kw/lib/wikiLinks";
import { eventTouchesPath, type SSEEvent, useSSE } from "@kw/lib/useSSE";
import { parseMarkdownToBlocks } from "@kw/lib/blockNoteMarkdown";
import { visualSaveBody } from "@kw/lib/visualSave";
import { formatDistanceToNow } from "date-fns";
import { MarkdownSourceEditor } from "./editor/MarkdownSourceEditor";
import { FencePreview } from "./editor/FencePreview";
import { splitFenceExample } from "./editor/markdownSlashCommands";
import type { FencePreviewTarget } from "./editor/fenceAssist";
import { blockNoteSlashItems, loadSlashCommandTemplate } from "@kw/lib/editorSlashCommands";
import { useEditorSlashCommands } from "../hooks/useEditorSlashCommands";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kw/components/ui/dialog";
import { cn } from "@kw/lib/cn";

const wikiLinkPluginKey = new PluginKey("kiwi-wiki-links");

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function unquoteYamlTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function titleFromFrontmatterText(frontmatterText: string): string | null {
  try {
    const parsed = matter(`---\n${frontmatterText}\n---\n`);
    if (typeof parsed.data?.title === "string") return parsed.data.title;
  } catch {}
  const titleLine = frontmatterText
    .split(/\r?\n/)
    .find((line) => /^\s*title\s*:/.test(line));
  if (!titleLine) return null;
  return unquoteYamlTitle(titleLine.replace(/^\s*title\s*:\s*/, ""));
}

function setTitleInFrontmatterText(frontmatterText: string, title: string): string {
  const titleLine = `title: ${yamlQuote(title)}`;
  const lines = frontmatterText ? frontmatterText.split(/\r?\n/) : [];
  const titleIndex = lines.findIndex((line) => /^\s*title\s*:/.test(line));
  if (titleIndex >= 0) {
    lines[titleIndex] = titleLine;
    return lines.join("\n");
  }
  return [titleLine, ...lines].join("\n").trimEnd();
}

function setTitleInMarkdownSource(markdown: string, title: string): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const nextFrontmatterText = setTitleInFrontmatterText(frontmatterToText(frontmatter), title);
  return joinFrontmatter(nextFrontmatterText, body);
}

function titleFromMarkdownSource(markdown: string): string | null {
  const { frontmatter } = splitFrontmatter(markdown);
  const fromFrontmatter = titleFromFrontmatterText(frontmatterToText(frontmatter));
  if (fromFrontmatter !== null) return fromFrontmatter;
  try {
    const parsed = matter(markdown);
    if (typeof parsed.data?.title === "string") return parsed.data.title;
  } catch {}
  return null;
}

const wikiLinkExtension = createExtension(() => ({
  key: "kiwi-wiki-links",
  prosemirrorPlugins: [wikiLinkDecoPlugin()],
}));

function wikiLinkDecoPlugin() {
  return new Plugin({
    key: wikiLinkPluginKey,
    state: {
      init(_, state) {
        return buildWikiDecos(state.doc);
      },
      apply(tr, old) {
        if (!tr.docChanged) return old;
        return buildWikiDecos(tr.doc);
      },
    },
    props: {
      decorations(state) {
        return wikiLinkPluginKey.getState(state);
      },
    },
  });
}

function buildWikiDecos(doc: any): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = node.text || "";
    const re = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      decos.push(
        Decoration.inline(from, to, { class: "kiwi-editor-wikilink" })
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error";

/**
 * The file on disk no longer matches what the editor loaded or last saved:
 * changed by an agent or another tab ("changed"), found out by a rejected
 * save ("conflict"), or deleted.
 */
type DiskChange =
  | { kind: "changed" | "conflict"; content: string; etag: string | null }
  | { kind: "deleted" };

const bareEtag = (etag: string | null | undefined) => (etag ?? "").replace(/^W\//, "").replace(/"/g, "");

const isConflict = (e: unknown) => (e as { status?: unknown } | null)?.status === 409;

type SaveHandle = {
  save: () => Promise<void>;
  toggleMode?: () => void;
};

type Props = {
  path: string;
  tree?: import("@kw/lib/api").TreeEntry | null;
  onClose: () => void;
  onSaved: (path: string) => void;
  onNavigate?: (path: string) => void;
  saveRef?: React.MutableRefObject<SaveHandle | null>;
  editorModePref?: "editor" | "source" | "live";
  onEditorModeChange?: (mode: EditorMode) => void;
  vimPref?: boolean;
  onVimChange?: (on: boolean) => void;
};

export function KiwiEditor({ path, tree, onClose, onSaved, onNavigate, saveRef, editorModePref, onEditorModeChange, vimPref, onVimChange }: Props) {
  const [initialMd, setInitialMd] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .readFile(path)
      .then((r) => {
        if (cancelled) return;
        etagRef.current = r.etag;
        setInitialMd(r.content || "");
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) {
    return (
      <div className="p-8 text-sm text-destructive font-mono">{error}</div>
    );
  }
  if (initialMd === null) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading editor…</div>
    );
  }

  if (isExcalidrawMarkdown(initialMd)) {
    return (
      <ExcalidrawEditorInner
        path={path}
        initialMd={initialMd}
        etagRef={etagRef}
        saving={saving}
        setSaving={setSaving}
        setError={setError}
        onClose={onClose}
        onSaved={onSaved}
        onNavigate={onNavigate}
        saveRef={saveRef}
      />
    );
  }

  return (
    <EditorInner
      path={path}
      tree={tree}
      initialMd={initialMd}
      etagRef={etagRef}
      isDark={isDark}
      saving={saving}
      setSaving={setSaving}
      setError={setError}
      onClose={onClose}
      onSaved={onSaved}
      onNavigate={onNavigate}
      saveRef={saveRef}
      editorModePref={editorModePref}
      onEditorModeChange={onEditorModeChange}
      vimPref={vimPref}
      onVimChange={onVimChange}
    />
  );
}

function ExcalidrawEditorInner({
  path,
  initialMd,
  etagRef,
  saving,
  setSaving,
  setError,
  onClose,
  onSaved,
  onNavigate,
  saveRef,
}: {
  path: string;
  initialMd: string;
  etagRef: React.MutableRefObject<string | null>;
  saving: boolean;
  setSaving: (v: boolean) => void;
  setError: (v: string | null) => void;
  onClose: () => void;
  onSaved: (p: string) => void;
  onNavigate?: (path: string) => void;
  saveRef?: React.MutableRefObject<SaveHandle | null>;
}) {
  const [currentMd, setCurrentMd] = useState(initialMd);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const savedFlashTimer = useRef<number | null>(null);

  const fmTitle = useMemo(() => {
    try {
      const parsed = matter(initialMd);
      if (typeof parsed.data?.title === "string") return parsed.data.title;
    } catch {}
    return null;
  }, [initialMd]);

  const onSaveRef = useRef<(opts?: { close?: boolean }) => Promise<void>>(async () => {});
  onSaveRef.current = async (opts) => {
    setSaving(true);
    setSaveStatus("saving");
    setError(null);
    try {
      const res = await api.writeFile(path, currentMd, etagRef.current || undefined);
      etagRef.current = res.etag ? `"${res.etag}"` : null;
      setSaveStatus("saved");
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = window.setTimeout(() => setSaveStatus("clean"), 2000);
      if (opts?.close) onSaved(path);
    } catch (e) {
      setSaveStatus("error");
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const markChanged = useCallback((nextMd: string) => {
    setCurrentMd(nextMd);
    setSaveStatus(nextMd === initialMd ? "clean" : "dirty");
  }, [initialMd]);

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = { save: () => onSaveRef.current({ close: true }) };
    return () => { saveRef.current = null; };
  }, [saveRef]);

  useEffect(() => {
    return () => {
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border shrink-0">
        <div className="px-4 sm:px-8 py-2 max-w-6xl mx-auto">
          {onNavigate
            ? <KiwiBreadcrumb path={path} onNavigate={onNavigate} />
            : <div className="text-sm text-muted-foreground font-mono truncate">{path}</div>}
        </div>
      </div>

      <div className="flex-1 overflow-auto kiwi-scroll">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6">
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-tight">
                  {fmTitle || titleize(path)}
                </h1>
                <div className="flex items-center gap-2 mt-2">
                  <SaveIndicator status={saveStatus} />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => onSaveRef.current({ close: true })}
                  disabled={saving || saveStatus === "clean"}
                  size="sm"
                  variant={saveStatus === "dirty" ? "default" : "outline"}
                  aria-label="Save and close editor"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{saving ? "Saving…" : "Save & Close"}</span>
                  <span className="sm:hidden">{saving ? "…" : "Save"}</span>
                </Button>
                <Button variant="outline" size="sm" onClick={onClose}>
                  <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Close</span>
                </Button>
              </div>
            </div>
          </div>

          <ExcalidrawMarkdownEditor markdown={initialMd} onChange={markChanged} />
        </div>
      </div>
    </div>
  );
}

function EditorInner({
  path,
  tree,
  initialMd,
  etagRef,
  isDark,
  saving,
  setSaving,
  setError,
  onClose,
  onSaved,
  onNavigate,
  saveRef,
  editorModePref,
  onEditorModeChange,
  vimPref,
  onVimChange,
}: {
  path: string;
  tree?: import("@kw/lib/api").TreeEntry | null;
  initialMd: string;
  etagRef: React.MutableRefObject<string | null>;
  isDark: boolean;
  saving: boolean;
  setSaving: (v: boolean) => void;
  setError: (v: string | null) => void;
  onClose: () => void;
  onSaved: (p: string) => void;
  onNavigate?: (path: string) => void;
  saveRef?: React.MutableRefObject<SaveHandle | null>;
  editorModePref?: "editor" | "source" | "live";
  onEditorModeChange?: (mode: EditorMode) => void;
  vimPref?: boolean;
  onVimChange?: (on: boolean) => void;
}) {
  const [editorMode, setEditorMode] = useState<EditorMode>(() => loadEditorModePreference());
  const [sourceText, setSourceText] = useState(initialMd);
  const [fenceUnderCursor, setFenceUnderCursor] = useState<FencePreviewTarget | null>(null);
  const syncedMdRef = useRef(initialMd);
  const editRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  // The component can load another document without remounting.
  const saveLifecycleRef = useRef<object | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const editorModeRef = useRef(editorMode);
  editorModeRef.current = editorMode;

  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const autoSaveTimer = useRef<number | null>(null);
  const savedFlashTimer = useRef<number | null>(null);
  const [fmOpen, setFmOpen] = useState(false);
  const [modeSwitchOpen, setModeSwitchOpen] = useState(false);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<EditorMode | null>(null);
  const [visualParseError, setVisualParseError] = useState<string | null>(null);
  const [diskChange, setDiskChangeState] = useState<DiskChange | null>(null);
  // Read by the autosave timer, which can fire before the next render.
  const diskChangeRef = useRef(diskChange);
  const setDiskChange = useCallback((change: DiskChange | null) => {
    diskChangeRef.current = change;
    setDiskChangeState(change);
  }, []);
  const titleHeadingId = useId();
  const frontmatterId = useId();

  const initialVisualSource = useMemo(() => splitVisualSource(initialMd), [initialMd]);
  const [fmText, setFmText] = useState<string>(initialVisualSource.fmText);
  // What Visual mode loaded, as state so a new value reloads the editor.
  const [visualSource, setVisualSource] = useState<VisualSource>(initialVisualSource);
  // The same, advanced past each save without reloading the editor, plus the
  // serializer's text for the document as of that point: the two inputs to
  // the merge that keeps untouched markdown as it was (lib/visualSave.ts).
  const visualSourceRef = useRef<VisualSource>(initialVisualSource);
  const baselineRef = useRef<string | null>(null);
  const [lastEdit, setLastEdit] = useState<{ author: string; date: string } | null>(null);

  const wikiPages = useMemo(() => wikiPagesFromTree(tree), [tree]);
  const wikiResolver = useMemo(() => buildResolver(tree ?? null), [tree]);
  const resolveWikiLink = useCallback((target: string) => wikiResolver(target, path), [wikiResolver, path]);
  const customSlashCommands = useEditorSlashCommands();
  const [slashCommandError, setSlashCommandError] = useState<string | null>(null);
  const slashCommandErrorTimer = useRef<number | null>(null);
  const onSlashTemplateError = useCallback((message: string) => {
    setSlashCommandError(message);
    if (slashCommandErrorTimer.current !== null) {
      window.clearTimeout(slashCommandErrorTimer.current);
    }
    slashCommandErrorTimer.current = window.setTimeout(() => {
      setSlashCommandError(null);
      slashCommandErrorTimer.current = null;
    }, 6000);
  }, []);
  const loadSlashTemplate = useCallback((templatePath: string) => loadSlashCommandTemplate(templatePath), []);

  useEffect(() => {
    return () => {
      if (slashCommandErrorTimer.current !== null) {
        window.clearTimeout(slashCommandErrorTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const lifecycle = {};
    saveLifecycleRef.current = lifecycle;
    syncedMdRef.current = initialMd;
    editRevisionRef.current = 0;
    savedRevisionRef.current = 0;
    setSourceText(initialMd);
    setEditorMode(loadEditorModePreference());
    setFmText(initialVisualSource.fmText);
    setVisualSource(initialVisualSource);
    setSaveStatus("clean");
    setSaving(false);
    setVisualParseError(null);
    setDiskChange(null);
    return () => {
      saveLifecycleRef.current = null;
      saveInFlightRef.current = null;
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
      autoSaveTimer.current = null;
      savedFlashTimer.current = null;
    };
  }, [path, initialMd, initialVisualSource, setSaving]);

  useEffect(() => {
    if (!editorModePref) return;
    setEditorMode(editorModeFromView(editorModePref));
  }, [editorModePref]);

  const [vim, setVim] = useState(() => vimPref ?? loadVimPreference());
  useEffect(() => {
    if (vimPref !== undefined) setVim(vimPref);
  }, [vimPref]);
  const toggleVim = useCallback(() => {
    setVim((on) => {
      saveVimPreference(!on);
      onVimChange?.(!on);
      return !on;
    });
  }, [onVimChange]);

  const persistEditorMode = useCallback(
    (mode: EditorMode) => {
      saveEditorModePreference(mode);
      onEditorModeChange?.(mode);
    },
    [onEditorModeChange],
  );

  useEffect(() => {
    let cancelled = false;
    api.versions(path).then((r) => {
      if (cancelled || !r.versions.length) return;
      const v = r.versions[0];
      setLastEdit({ author: v.author, date: v.date });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [path]);

  const uploadFile = useCallback(
    async (file: File) => {
      const targetDir = dirOf(path);
      return api.uploadAsset(file, targetDir);
    },
    [path],
  );

  const editorOptions = useMemo(
    () => ({
      uploadFile,
      resolveFileUrl: resolveRawUrl,
      extensions: [wikiLinkExtension()],
    }),
    [uploadFile],
  );
  const editor = useCreateBlockNote(editorOptions);

  useEffect(() => {
    if (!editor || !ready) return;
    const dom = editor.domElement;
    dom?.setAttribute("aria-label", "Markdown visual editor");
    dom?.setAttribute("aria-multiline", "true");
  }, [editor, ready]);

  useEffect(() => {
    if (!editor || editorMode !== "visual") return;
    let cancelled = false;
    setReady(false);
    setVisualParseError(null);
    baselineRef.current = null;
    (async () => {
      try {
        const blocks = await parseMarkdownToBlocks(editor, visualSource.body);
        if (cancelled) return;
        // An empty body must still clear what the editor showed before (a
        // reload, a mode switch), or the merge would save it back.
        editor.replaceBlocks(editor.document, blocks.length > 0 ? blocks : [{ type: "paragraph" }]);
        const baseline = await editor.blocksToMarkdownLossy(editor.document);
        if (cancelled) return;
        visualSourceRef.current = visualSource;
        baselineRef.current = baseline;
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setVisualParseError(String(e));
          setReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, editorMode, visualSource]);

  /**
   * The page as Visual mode would save it now: the user's edits merged onto
   * the bytes that were loaded, so untouched markdown keeps its formatting.
   */
  const visualMarkdown = useCallback(async () => {
    const source = visualSourceRef.current;
    const baseline = baselineRef.current;
    let body: string;
    let current: string;
    if (baseline === null) {
      body = current = await editor!.blocksToMarkdownLossy(editor!.document);
    } else {
      ({ body, current } = await visualSaveBody(editor!, { original: source.body, baseline }));
    }
    const next = joinVisualSource(source, fmText, body);
    return { markdown: next.markdown, source: next, baseline: current };
  }, [editor, fmText]);

  const onSaveRef = useRef<(opts?: { close?: boolean }) => Promise<boolean>>(async () => false);
  const scheduleAutoSave = useCallback(() => {
    const lifecycle = saveLifecycleRef.current;
    // Saving now would overwrite a change the user has not seen yet.
    if (!lifecycle || diskChangeRef.current) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      if (saveLifecycleRef.current !== lifecycle) return;
      autoSaveTimer.current = null;
      if (diskChangeRef.current) return;
      void onSaveRef.current();
    }, 2000);
  }, []);
  onSaveRef.current = async (opts) => {
    const lifecycle = saveLifecycleRef.current;
    if (!lifecycle || (editorMode === "visual" && !editor)) return false;
    const isCurrent = () => saveLifecycleRef.current === lifecycle;

    const savePromise = saveInFlightRef.current ?? (async () => {
      const revision = editRevisionRef.current;
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      setSaving(true);
      setSaveStatus("saving");
      setError(null);
      try {
        let md: string;
        let visual: Awaited<ReturnType<typeof visualMarkdown>> | null = null;
        if (editorMode !== "visual") {
          md = sourceText;
        } else {
          visual = await visualMarkdown();
          md = visual.markdown;
        }
        if (!isCurrent()) return false;
        const res = await api.writeFile(path, md, etagRef.current || undefined);
        if (!isCurrent()) return false;
        etagRef.current = res.etag ? `"${res.etag}"` : null;
        if (visual) {
          // The file now holds `md`; later saves merge onto it.
          visualSourceRef.current = visual.source;
          baselineRef.current = visual.baseline;
        }
        // A save acknowledges a snapshot, not a new document to load. Replacing
        // live state here loses transient blocks, selection, and newer edits.
        syncedMdRef.current = md;
        savedRevisionRef.current = revision;
        setLastEdit({ author: "you", date: new Date().toISOString() });
        if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
        if (editRevisionRef.current === revision) {
          setSaveStatus("saved");
          savedFlashTimer.current = window.setTimeout(() => {
            if (isCurrent()) setSaveStatus("clean");
          }, 2000);
        } else {
          setSaveStatus("dirty");
          // A debounce can expire while this request is still in flight.
          if (!autoSaveTimer.current) scheduleAutoSave();
        }
        return true;
      } catch (e) {
        if (isCurrent()) {
          if (isConflict(e)) {
            setSaveStatus("dirty");
            void api.readFile(path).then(
              (file) => {
                if (isCurrent()) setDiskChange({ kind: "conflict", content: file.content, etag: file.etag });
              },
              () => {
                if (isCurrent()) setDiskChange({ kind: "deleted" });
              },
            );
          } else {
            setSaveStatus("error");
            setError(String(e));
          }
        }
        return false;
      } finally {
        if (isCurrent()) {
          setSaving(false);
          saveInFlightRef.current = null;
        }
      }
    })();

    saveInFlightRef.current = savePromise;
    const ok = await savePromise;
    if (!isCurrent()) return false;
    if (ok && opts?.close) {
      if (editRevisionRef.current !== savedRevisionRef.current) {
        return onSaveRef.current(opts);
      }
      onSaved(path);
    }
    return ok;
  };

  const markVisualTitleDirty = useCallback(() => {
    editRevisionRef.current += 1;
    if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
    setSaveStatus("dirty");
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  const markDirty = useCallback(() => {
    if (editorMode === "visual" && !ready) return;
    markVisualTitleDirty();
  }, [ready, editorMode, markVisualTitleDirty]);

  const performModeSwitch = useCallback(
    async (target: EditorMode, opts?: { discard?: boolean }) => {
      setVisualParseError(null);
      if (target !== "visual") {
        if (editorModeRef.current === "visual") {
          if (!opts?.discard && editor) {
            setSourceText((await visualMarkdown()).markdown);
          } else {
            setSourceText(syncedMdRef.current);
          }
        } else if (opts?.discard) {
          setSourceText(syncedMdRef.current);
        }
        setEditorMode(target);
        persistEditorMode(target);
        setReady(true);
      } else {
        const text = opts?.discard ? syncedMdRef.current : sourceText;
        if (opts?.discard) setSourceText(text);
        const next = splitVisualSource(text);
        setFmText(next.fmText);
        setVisualSource(next);
        setEditorMode("visual");
        persistEditorMode("visual");
      }
      setSaveStatus("clean");
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    },
    [editor, visualMarkdown, sourceText, persistEditorMode],
  );

  const requestModeSwitch = useCallback(
    (target: EditorMode) => {
      if (target === editorMode) return;
      // Source and live preview edit the same text: nothing to convert, so
      // nothing to save or lose first.
      if (editorMode !== "visual" && target !== "visual") {
        setEditorMode(target);
        persistEditorMode(target);
        return;
      }
      if (saveStatus === "saving" || saving) return;
      if (saveStatus === "dirty") {
        setPendingSwitchTarget(target);
        setModeSwitchOpen(true);
        return;
      }
      void performModeSwitch(target);
    },
    [editorMode, saveStatus, saving, performModeSwitch, persistEditorMode],
  );

  const handleModeSwitchSave = useCallback(async () => {
    const target = pendingSwitchTarget;
    if (!target) return;
    setModeSwitchOpen(false);
    setPendingSwitchTarget(null);
    const ok = await onSaveRef.current();
    // Stay in the current mode if the save did not include the latest edits.
    if (ok && editRevisionRef.current === savedRevisionRef.current) {
      await performModeSwitch(target);
    }
  }, [pendingSwitchTarget, performModeSwitch]);

  const handleModeSwitchDiscard = useCallback(() => {
    const target = pendingSwitchTarget;
    if (!target) return;
    setModeSwitchOpen(false);
    setPendingSwitchTarget(null);
    void performModeSwitch(target, { discard: true });
  }, [pendingSwitchTarget, performModeSwitch]);

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = {
      save: async () => {
        await onSaveRef.current({ close: true });
      },
      toggleMode: () =>
        requestModeSwitch(editorModeRef.current === "visual" ? "source" : "visual"),
    };
    return () => { saveRef.current = null; };
  }, [saveRef, requestModeSwitch]);

  const fmTitle = useMemo(() => {
    if (editorMode === "visual") return titleFromFrontmatterText(fmText);
    return titleFromMarkdownSource(sourceText);
  }, [editorMode, fmText, sourceText]);

  const displayTitle = fmTitle ?? titleize(path);
  const [titleInputValue, setTitleInputValue] = useState(displayTitle);

  useEffect(() => {
    setTitleInputValue(displayTitle);
  }, [displayTitle]);

  const handleTitleChange = useCallback(
    (nextTitle: string) => {
      setTitleInputValue(nextTitle);
      if (editorMode === "visual") {
        setFmText((current: string) => setTitleInFrontmatterText(current, nextTitle));
        markVisualTitleDirty();
        return;
      }
      setSourceText((current: string) => setTitleInMarkdownSource(current, nextTitle));
      markDirty();
    },
    [editorMode, markDirty, markVisualTitleDirty],
  );

  const handleFrontmatterTextChange = useCallback(
    (nextText: string) => {
      setFmText(nextText);
      const nextTitle = titleFromFrontmatterText(nextText);
      if (nextTitle !== null) setTitleInputValue(nextTitle);
      markDirty();
    },
    [markDirty],
  );

  const handleSourceTextChange = useCallback(
    (nextText: string) => {
      setSourceText(nextText);
      const nextTitle = titleFromMarkdownSource(nextText);
      if (nextTitle !== null) setTitleInputValue(nextTitle);
      markDirty();
    },
    [markDirty],
  );

  const canSave =
    saveStatus !== "clean" &&
    !saving &&
    (editorMode !== "visual" || ready);

  /** Show the file as it is on disk now, dropping unsaved edits. */
  const loadFromDisk = useCallback(
    (content: string, etag: string | null) => {
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      etagRef.current = etag;
      syncedMdRef.current = content;
      savedRevisionRef.current = editRevisionRef.current;
      setSourceText(content);
      const next = splitVisualSource(content);
      setFmText(next.fmText);
      // Reloads the block editor, which also restarts the save merge from the
      // new file. Text modes take the new text as a diff instead.
      if (editorModeRef.current === "visual") setVisualSource(next);
      setSaveStatus("clean");
      setError(null);
      setDiskChange(null);
    },
    [etagRef, setError],
  );

  const onFileEvent = useCallback(
    async (event: SSEEvent) => {
      if (!eventTouchesPath(event, path)) return;
      const lifecycle = saveLifecycleRef.current;
      const isCurrent = () => saveLifecycleRef.current === lifecycle;
      if (event.op === "delete") {
        setDiskChange({ kind: "deleted" });
        return;
      }
      const ours = () => event.etag !== undefined && bareEtag(event.etag) === bareEtag(etagRef.current);
      if (ours()) return;
      // The event for our own save can beat the save's response here.
      if (saveInFlightRef.current) await saveInFlightRef.current;
      if (!isCurrent() || ours()) return;
      let file: { content: string; etag: string | null };
      try {
        file = await api.readFile(path);
      } catch {
        return;
      }
      if (!isCurrent()) return;
      if (file.content === syncedMdRef.current) {
        etagRef.current = file.etag;
        return;
      }
      const clean = editRevisionRef.current === savedRevisionRef.current && !saveInFlightRef.current;
      // Text modes take a clean reload in place, caret and all. BlockNote
      // has no way to patch its document, so Visual mode always asks.
      if (clean && editorModeRef.current !== "visual") loadFromDisk(file.content, file.etag);
      else setDiskChange({ kind: "changed", content: file.content, etag: file.etag });
    },
    [path, etagRef, loadFromDisk],
  );
  useSSE(onFileEvent);

  const keepMine = useCallback(() => {
    const change = diskChangeRef.current;
    // The next save overwrites the disk version on purpose; a deleted file
    // is written fresh, with no If-Match to fail.
    etagRef.current = change && change.kind !== "deleted" ? change.etag : null;
    setDiskChange(null);
    editRevisionRef.current += 1;
    setSaveStatus("dirty");
    scheduleAutoSave();
  }, [etagRef, scheduleAutoSave]);

  // Following a link leaves the editor, which would drop an unsaved edit.
  const navigateFromEditor = useCallback(
    async (target: string) => {
      if (!onNavigate) return;
      if (editRevisionRef.current !== savedRevisionRef.current) {
        const ok = await onSaveRef.current();
        if (!ok) return;
      }
      onNavigate(target);
    },
    [onNavigate],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border shrink-0">
        <div className="px-4 sm:px-8 py-2 max-w-6xl mx-auto">
          {onNavigate
            ? <KiwiBreadcrumb path={path} onNavigate={onNavigate} />
            : <div className="text-sm text-muted-foreground font-mono truncate">{path}</div>}
        </div>
      </div>

      <div className="flex-1 overflow-auto kiwi-scroll">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6">
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div className="min-w-0 flex-1">
                <h1 id={titleHeadingId} className="sr-only">
                  {displayTitle}
                </h1>
                <Input
                  value={titleInputValue}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  aria-label="Page title"
                  className="w-full min-w-0 h-auto border-transparent bg-transparent px-0 py-0 text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-tight shadow-none focus-visible:border-input focus-visible:px-2 focus-visible:py-1"
                />
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <SaveIndicator status={saveStatus} />
                  {editorMode === "visual" && (
                    <span className="text-[10px] text-muted-foreground">
                      Only blocks you edit are reformatted on save
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <EditorModeToggle
                  mode={editorMode}
                  disabled={saving || saveStatus === "saving"}
                  onSelect={requestModeSwitch}
                />
                {editorMode !== "visual" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleVim}
                    aria-pressed={vim}
                    aria-label="Vim keybindings"
                    className={cn(vim && "bg-muted")}
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Vim</span>
                  </Button>
                )}
                <Button
                  onClick={() => onSaveRef.current({ close: true })}
                  disabled={!canSave}
                  size="sm"
                  variant={saveStatus === "dirty" ? "default" : "outline"}
                  aria-label="Save and close editor"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{saving ? "Saving…" : "Save & Close"}</span>
                  <span className="sm:hidden">{saving ? "…" : "Save"}</span>
                </Button>
                <Button variant="outline" size="sm" onClick={onClose}>
                  <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Close</span>
                </Button>
              </div>
            </div>

            {lastEdit && (
              <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Last edited by {lastEdit.author} {relativeTime(lastEdit.date)}
                </span>
              </div>
            )}
          </div>

          {diskChange && (
            <DiskChangeBanner
              change={diskChange}
              onReload={() => diskChange.kind !== "deleted" && loadFromDisk(diskChange.content, diskChange.etag)}
              onKeepMine={keepMine}
            />
          )}

          {editorMode === "visual" && (
            <div className="max-w-3xl mb-4">
              <button
                type="button"
                onClick={() => setFmOpen((v) => !v)}
                aria-expanded={fmOpen}
                aria-controls={frontmatterId}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {fmOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Frontmatter
                {fmText.trim() && <span className="ml-1 text-xs text-muted-foreground">(has data)</span>}
              </button>
              <Textarea
                id={frontmatterId}
                value={fmText}
                onChange={(e) => handleFrontmatterTextChange(e.target.value)}
                aria-label="Frontmatter YAML"
                placeholder={"title: My Page\ntags:\n  - draft"}
                className={cn("mt-2 font-mono text-xs min-h-[80px] resize-y", !fmOpen && "hidden")}
                rows={Math.max(3, fmText.split("\n").length)}
                hidden={!fmOpen}
              />
            </div>
          )}

          <div className="max-w-3xl min-h-[50vh]">
            {editorMode !== "visual" ? (
              <div className="flex flex-col gap-2">
                <MarkdownSourceEditor
                  value={sourceText}
                  onChange={handleSourceTextChange}
                  dark={isDark}
                  onSaveShortcut={() => onSaveRef.current({ close: true })}
                  pages={wikiPages}
                  minHeight="60vh"
                  customSlashCommands={customSlashCommands}
                  loadSlashTemplate={loadSlashTemplate}
                  onSlashTemplateError={onSlashTemplateError}
                  onFenceUnderCursor={editorMode === "source" ? setFenceUnderCursor : undefined}
                  livePreview={editorMode === "live"}
                  vim={vim}
                  pagePath={path}
                  resolveWikiLink={resolveWikiLink}
                  onNavigate={onNavigate ? navigateFromEditor : undefined}
                />
                {/* Only while the caret is in a widget fence, so the pane does
                    not take height from ordinary prose editing. Live preview
                    draws fences in place instead. */}
                {editorMode === "source" && <FencePreview target={fenceUnderCursor} />}
              </div>
            ) : visualParseError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Could not open in Visual mode</p>
                <p className="mt-1 text-xs opacity-90">{visualParseError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => requestModeSwitch("source")}
                >
                  Back to Source
                </Button>
              </div>
            ) : (
              <div className="kiwi-blocknote">
                <ErrorBoundary>
                  {editor && (
                    <BlockNoteView
                      editor={editor as BlockNoteEditor}
                      theme={isDark ? "dark" : "light"}
                      slashMenu={false}
                      formattingToolbar={false}
                      onChange={markDirty}
                    >
                      <FormattingToolbarController />
                      <SuggestionMenuController
                        triggerCharacter="/"
                        getItems={async (query) =>
                          filterSuggestionItems(
                            [
                              ...getDefaultReactSlashMenuItems(editor as BlockNoteEditor),
                              ...kiwiSlashItems(editor as BlockNoteEditor),
                              ...blockNoteSlashItems(
                                editor as BlockNoteEditor,
                                customSlashCommands,
                                onSlashTemplateError,
                              ),
                            ],
                            query,
                          )
                        }
                      />
                      <SuggestionMenuController
                        triggerCharacter="["
                        getItems={async (query) => {
                          const view = editor.prosemirrorView;
                          if (view) {
                            const { state } = view;
                            const pos = state.selection.from;
                            const checkPos = pos - query.length - 2;
                            if (checkPos < 0 || state.doc.textBetween(checkPos, checkPos + 1) !== "[") {
                              return [];
                            }
                          }
                          return filterSuggestionItems(
                            collectPages(tree).map((p) => {
                              const pageName = p.replace(/\.md$/i, "");
                              return {
                                title: titleize(p),
                                subtext: p,
                                aliases: [stem(p), p],
                                group: "Page link",
                                icon: <LinkIcon size={18} />,
                                onItemClick: () => {
                                  queueMicrotask(() => {
                                    const view = editor.prosemirrorView;
                                    if (!view) return;
                                    const { state } = view;
                                    const pos = state.selection.from;
                                    if (pos > 0 && state.doc.textBetween(pos - 1, pos) === "[") {
                                      view.dispatch(
                                        state.tr.delete(pos - 1, pos).insertText(`[[${pageName}]]`, pos - 1),
                                      );
                                    } else {
                                      view.dispatch(state.tr.insertText(`[[${pageName}]]`, pos));
                                    }
                                  });
                                },
                              };
                            }),
                            query,
                          );
                        }}
                      />
                    </BlockNoteView>
                  )}
                </ErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>

      <EditorModeSwitchDialog
        open={modeSwitchOpen}
        onOpenChange={(open) => {
          setModeSwitchOpen(open);
          if (!open) setPendingSwitchTarget(null);
        }}
        onSaveAndSwitch={() => void handleModeSwitchSave()}
        onDiscardAndSwitch={handleModeSwitchDiscard}
        busy={saving}
      />
      {slashCommandError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="flex-1">{slashCommandError}</p>
            <button
              type="button"
              className="text-destructive/80 hover:text-destructive"
              aria-label="Dismiss"
              onClick={() => setSlashCommandError(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const EDITOR_MODES: { mode: EditorMode; label: string; aria: string; Icon: typeof PenLine }[] = [
  { mode: "visual", label: "Visual", aria: "Switch to visual editor mode", Icon: PenLine },
  { mode: "live", label: "Live", aria: "Switch to live preview editor mode", Icon: Eye },
  { mode: "source", label: "Source", aria: "Switch to source editor mode", Icon: Code },
];

function EditorModeToggle({
  mode,
  disabled,
  onSelect,
}: {
  mode: EditorMode;
  disabled?: boolean;
  onSelect: (mode: EditorMode) => void;
}) {
  return (
    <div
      className={cn(
        "inline-flex rounded-md border border-border p-0.5 bg-muted/40",
        disabled && "opacity-50 pointer-events-none",
      )}
      role="group"
      aria-label="Editor mode"
      aria-disabled={disabled || undefined}
    >
      {EDITOR_MODES.map(({ mode: value, label, aria, Icon }) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={mode === value}
          aria-label={aria}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            mode === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onSelect(value)}
        >
          <Icon className="h-3 w-3" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function EditorModeSwitchDialog({
  open,
  onOpenChange,
  onSaveAndSwitch,
  onDiscardAndSwitch,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveAndSwitch: () => void;
  onDiscardAndSwitch: () => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save before switching?</DialogTitle>
          <DialogDescription>
            You have unsaved changes. Save them before switching editor mode, or discard
            changes and switch.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onDiscardAndSwitch} disabled={busy}>
            Switch without saving
          </Button>
          <Button onClick={onSaveAndSwitch} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save & switch"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiskChangeBanner({
  change,
  onReload,
  onKeepMine,
}: {
  change: DiskChange;
  onReload: () => void;
  onKeepMine: () => void;
}) {
  const message =
    change.kind === "deleted"
      ? "This page was deleted on disk."
      : change.kind === "conflict"
        ? "This page changed on disk before your edits were saved."
        : "This page changed on disk.";
  return (
    <div
      role="alert"
      className="max-w-3xl mb-4 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
      <p className="flex-1 min-w-[12rem]">
        {message}{" "}
        <span className="text-muted-foreground">
          {change.kind === "deleted"
            ? "Keep yours to save it again."
            : "Reload to see it, or keep yours to overwrite it."}
        </span>
      </p>
      {change.kind !== "deleted" && (
        <Button size="sm" variant="outline" onClick={onReload}>
          Reload
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onKeepMine}>
        Keep mine
      </Button>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const className = "flex items-center gap-1 text-xs";
  const liveProps = { role: "status", "aria-live": "polite", "aria-atomic": true } as const;

  switch (status) {
    case "dirty":
      return (
        <span {...liveProps} className={cn(className, "text-amber-700 dark:text-amber-400")}>
          <Circle className="h-2.5 w-2.5 fill-current" />
          Unsaved
        </span>
      );
    case "saving":
      return (
        <span {...liveProps} className={cn(className, "text-muted-foreground")}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </span>
      );
    case "saved":
      return (
        <span {...liveProps} className={cn(className, "text-green-700 dark:text-green-400")}>
          <Check className="h-3 w-3" />
          Saved
        </span>
      );
    case "error":
      return (
        <span {...liveProps} className={cn(className, "text-destructive")}>
          <XCircle className="h-3 w-3" />
          Error
        </span>
      );
    default:
      return <span {...liveProps} className="sr-only">No unsaved changes</span>;
  }
}

function relativeTime(d: string): string {
  try {
    const parsed = new Date(d);
    if (isNaN(parsed.getTime())) return d;
    return formatDistanceToNow(parsed, { addSuffix: true });
  } catch {
    return d;
  }
}

// Kiwifs-specific slash commands. Each returns a paragraph block that renders
// as the desired output after we round-trip through markdown on save.
function kiwiSlashItems(editor: BlockNoteEditor) {
  const insertParagraph = (text: string) => {
    const cur = editor.getTextCursorPosition().block;
    editor.insertBlocks(
      [{ type: "paragraph", content: text }],
      cur,
      "after"
    );
  };

  /**
   * One code block tagged with the fence's language: the same block a loaded
   * page's fence parses into, so it saves back as ```` ```lang ```` rather
   * than as escaped paragraphs.
   */
  const insertFenceBlock = (example: string, lang: string) => {
    const cur = editor.getTextCursorPosition().block;
    const { language, body } = splitFenceExample(example, lang);
    editor.insertBlocks([{ type: "codeBlock", props: { language }, content: body }], cur, "after");
  };

  return [
    {
      title: "Wiki link",
      subtext: "Insert a [[page-name]] link",
      aliases: ["link", "wiki", "[[", "ref"],
      group: "KiwiFS",
      icon: <LinkIcon size={18} />,
      onItemClick: () => insertParagraph("[[page-name]]"),
    },
    {
      title: "Info callout",
      subtext: "ℹ️ Highlighted info block",
      aliases: ["callout", "info", "note"],
      group: "KiwiFS",
      icon: <Info size={18} />,
      onItemClick: () => insertParagraph("ℹ️ "),
    },
    {
      title: "Warning callout",
      subtext: "⚠️ Highlighted warning block",
      aliases: ["callout", "warn", "warning"],
      group: "KiwiFS",
      icon: <TriangleAlert size={18} />,
      onItemClick: () => insertParagraph("⚠️ "),
    },
    {
      title: "Error callout",
      subtext: "🛑 Highlighted error block",
      aliases: ["callout", "error", "danger"],
      group: "KiwiFS",
      icon: <XCircle size={18} />,
      onItemClick: () => insertParagraph("🛑 "),
    },
    {
      title: "Table of contents marker",
      subtext: "Insert a <!-- toc --> marker",
      aliases: ["toc", "contents"],
      group: "KiwiFS",
      icon: <ListTree size={18} />,
      onItemClick: () => insertParagraph("<!-- toc -->"),
    },
    // One entry per widget fence, generated from the registry so the visual
    // editor offers exactly what the linter accepts.
    ...allFences()
      .filter((spec) => !spec.legacy)
      .map((spec) => ({
        title: `${spec.lang} widget`,
        subtext: spec.description,
        aliases: ["widget", "fence", spec.lang, ...(spec.aliases ?? [])],
        group: "Widgets",
        icon: <Puzzle size={18} />,
        onItemClick: () => insertFenceBlock(spec.example, spec.lang),
      })),
  ];
}

function collectPages(tree: TreeEntry | null | undefined): string[] {
  if (!tree) return [];
  const pages: string[] = [];
  function walk(node: TreeEntry) {
    if (!node.isDir && node.path.toLowerCase().endsWith(".md")) {
      pages.push(node.path);
    }
    if (node.children) node.children.forEach(walk);
  }
  walk(tree);
  return pages;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { BlockNoteEditor, filterSuggestionItems } from "@blocknote/core";
import {
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { Check, ChevronDown, ChevronRight, Circle, Code, Info, Link as LinkIcon, ListTree, Loader2, PenLine, Save, TriangleAlert, User, X, XCircle } from "lucide-react";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import matter from "gray-matter";
import { api, type TreeEntry } from "@kw/lib/api";
import { Button } from "@kw/components/ui/button";
import { Input } from "@kw/components/ui/input";
import { Textarea } from "@kw/components/ui/textarea";
import { dirOf, stem, titleize } from "@kw/lib/paths";
import { KiwiBreadcrumb } from "./KiwiBreadcrumb";
import { ExcalidrawMarkdownEditor, isExcalidrawMarkdown } from "./ExcalidrawMarkdownPreview";
import { frontmatterToText, joinFrontmatter, splitFrontmatter } from "@kw/lib/frontmatter";
import {
  type EditorMode,
  loadEditorModePreference,
  saveEditorModePreference,
  sourceToVisualParts,
  visualToSource,
  wikiPagesFromTree,
} from "@kw/lib/editorMode";
import { formatDistanceToNow } from "date-fns";
import { MarkdownSourceEditor } from "./editor/MarkdownSourceEditor";
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
};

export function KiwiEditor({ path, tree, onClose, onSaved, onNavigate, saveRef }: Props) {
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
}) {
  const [editorMode, setEditorMode] = useState<EditorMode>(() => loadEditorModePreference());
  const [sourceText, setSourceText] = useState(initialMd);
  const syncedMdRef = useRef(initialMd);
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

  const frontmatterSplit = useMemo(() => splitFrontmatter(initialMd), [initialMd]);
  const [fmText, setFmText] = useState<string>(() => frontmatterToText(frontmatterSplit.frontmatter));
  const initialVisualBody = useMemo(
    () => sourceToVisualParts(initialMd).body,
    [initialMd],
  );
  const [visualParseBody, setVisualParseBody] = useState(initialVisualBody);
  const [lastEdit, setLastEdit] = useState<{ author: string; date: string } | null>(null);

  const wikiPages = useMemo(() => wikiPagesFromTree(tree), [tree]);

  useEffect(() => {
    syncedMdRef.current = initialMd;
    setSourceText(initialMd);
    setEditorMode(loadEditorModePreference());
    setFmText(frontmatterToText(frontmatterSplit.frontmatter));
    setVisualParseBody(initialVisualBody);
    setSaveStatus("clean");
    setVisualParseError(null);
  }, [path, initialMd, frontmatterSplit.frontmatter, initialVisualBody]);

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
      _tiptapOptions: {
        extensions: [] as any[],
      },
    }),
    [uploadFile],
  );
  const editor = useCreateBlockNote(editorOptions);

  useEffect(() => {
    if (!editor) return;
    const pm = (editor as any)._tiptapEditor?.view;
    if (!pm) return;
    const state = pm.state;
    if (state.plugins.some((p: any) => p.key === (wikiLinkPluginKey as any).key)) return;
    const newState = state.reconfigure({
      plugins: [...state.plugins, wikiLinkDecoPlugin()],
    });
    pm.updateState(newState);
  }, [editor]);

  useEffect(() => {
    if (!editor || editorMode !== "visual") return;
    let cancelled = false;
    setReady(false);
    setVisualParseError(null);
    (async () => {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(visualParseBody);
        if (cancelled) return;
        if (blocks && blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
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
  }, [editor, editorMode, visualParseBody]);

  const onSaveRef = useRef<(opts?: { close?: boolean }) => Promise<boolean>>(async () => false);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  onSaveRef.current = async (opts) => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    if (editorMode === "visual" && !editor) return false;

    const savePromise = (async () => {
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      setSaving(true);
      setSaveStatus("saving");
      setError(null);
      try {
        let md: string;
        if (editorMode === "source") {
          md = sourceText;
        } else {
          const body = await editor!.blocksToMarkdownLossy(editor!.document);
          md = joinFrontmatter(fmText, body);
        }
        const res = await api.writeFile(path, md, etagRef.current || undefined);
        etagRef.current = res.etag ? `"${res.etag}"` : null;
        syncedMdRef.current = md;
        setSourceText(md);
        const { fmText: nextFm, body: nextBody } = sourceToVisualParts(md);
        setFmText(nextFm);
        setVisualParseBody(nextBody);
        setSaveStatus("saved");
        setLastEdit({ author: "you", date: new Date().toISOString() });
        if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
        savedFlashTimer.current = window.setTimeout(() => setSaveStatus("clean"), 2000);
        if (opts?.close) onSaved(path);
        return true;
      } catch (e) {
        setSaveStatus("error");
        setError(String(e));
        return false;
      } finally {
        setSaving(false);
        saveInFlightRef.current = null;
      }
    })();

    saveInFlightRef.current = savePromise;
    return savePromise;
  };

  const markDirty = useCallback(() => {
    if (editorMode === "visual" && !ready) return;
    setSaveStatus("dirty");
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      onSaveRef.current();
    }, 2000);
  }, [ready, editorMode]);

  const markVisualTitleDirty = useCallback(() => {
    setSaveStatus("dirty");
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      onSaveRef.current();
    }, 2000);
  }, []);

  const performModeSwitch = useCallback(
    async (target: EditorMode, opts?: { discard?: boolean }) => {
      setVisualParseError(null);
      if (target === "source") {
        if (!opts?.discard && editor) {
          const full = await visualToSource(fmText, async () =>
            editor.blocksToMarkdownLossy(editor.document),
          );
          setSourceText(full);
        } else {
          setSourceText(syncedMdRef.current);
        }
        setEditorMode("source");
        saveEditorModePreference("source");
        setReady(true);
      } else {
        const text = opts?.discard ? syncedMdRef.current : sourceText;
        if (opts?.discard) setSourceText(text);
        const { fmText: nextFm, body } = sourceToVisualParts(text);
        setFmText(nextFm);
        setVisualParseBody(body);
        setEditorMode("visual");
        saveEditorModePreference("visual");
      }
      setSaveStatus("clean");
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    },
    [editor, fmText, sourceText],
  );

  const requestModeSwitch = useCallback(
    (target: EditorMode) => {
      if (target === editorMode) return;
      if (saveStatus === "saving" || saving) return;
      if (saveStatus === "dirty") {
        setPendingSwitchTarget(target);
        setModeSwitchOpen(true);
        return;
      }
      void performModeSwitch(target);
    },
    [editorMode, saveStatus, saving, performModeSwitch],
  );

  const handleModeSwitchSave = useCallback(async () => {
    const target = pendingSwitchTarget;
    if (!target) return;
    setModeSwitchOpen(false);
    setPendingSwitchTarget(null);
    const ok = await onSaveRef.current();
    if (ok) await performModeSwitch(target);
  }, [pendingSwitchTarget, performModeSwitch]);

  const handleModeSwitchDiscard = useCallback(() => {
    const target = pendingSwitchTarget;
    if (!target) return;
    setModeSwitchOpen(false);
    setPendingSwitchTarget(null);
    void performModeSwitch(target, { discard: true });
  }, [pendingSwitchTarget, performModeSwitch]);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
    };
  }, []);

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
    (editorMode === "source" || ready);

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
                <Input
                  value={titleInputValue}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  aria-label="Page title"
                  title="Updates the frontmatter title field"
                  className="w-full min-w-0 h-auto border-transparent bg-transparent px-0 py-0 text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-tight shadow-none focus-visible:border-input focus-visible:px-2 focus-visible:py-1"
                />
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <SaveIndicator status={saveStatus} />
                  {editorMode === "visual" && (
                    <span className="text-[10px] text-muted-foreground">
                      Visual mode may reformat some markdown on save
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
                <Button
                  onClick={() => onSaveRef.current({ close: true })}
                  disabled={!canSave}
                  size="sm"
                  variant={saveStatus === "dirty" ? "default" : "outline"}
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

          {editorMode === "visual" && (
            <div className="max-w-3xl mb-4">
              <button
                type="button"
                onClick={() => setFmOpen((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {fmOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Frontmatter
                {fmText.trim() && <span className="ml-1 text-[10px] opacity-60">(has data)</span>}
              </button>
              {fmOpen && (
                <Textarea
                  value={fmText}
                  onChange={(e) => handleFrontmatterTextChange(e.target.value)}
                  placeholder={"title: My Page\ntags:\n  - draft"}
                  className="mt-2 font-mono text-xs min-h-[80px] resize-y"
                  rows={Math.max(3, fmText.split("\n").length)}
                />
              )}
            </div>
          )}

          <div className="max-w-3xl min-h-[50vh]">
            {editorMode === "source" ? (
              <MarkdownSourceEditor
                value={sourceText}
                onChange={handleSourceTextChange}
                dark={isDark}
                onSaveShortcut={() => onSaveRef.current({ close: true })}
                pages={wikiPages}
                minHeight="60vh"
              />
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
                            ],
                            query,
                          )
                        }
                      />
                      <SuggestionMenuController
                        triggerCharacter="["
                        getItems={async (query) => {
                          const pm = (editor as any)._tiptapEditor;
                          if (pm?.view) {
                            const { state } = pm.view;
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
                                    const ttp = (editor as any)._tiptapEditor;
                                    if (!ttp?.view) return;
                                    const { state } = ttp.view;
                                    const pos = state.selection.from;
                                    if (pos > 0 && state.doc.textBetween(pos - 1, pos) === "[") {
                                      ttp.view.dispatch(
                                        state.tr.delete(pos - 1, pos).insertText(`[[${pageName}]]`, pos - 1),
                                      );
                                    } else {
                                      ttp.view.dispatch(state.tr.insertText(`[[${pageName}]]`, pos));
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
    </div>
  );
}

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
      <button
        type="button"
        disabled={disabled}
        aria-pressed={mode === "visual"}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
          mode === "visual"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => onSelect("visual")}
      >
        <PenLine className="h-3 w-3" />
        <span className="hidden sm:inline">Visual</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={mode === "source"}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
          mode === "source"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => onSelect("source")}
      >
        <Code className="h-3 w-3" />
        <span className="hidden sm:inline">Source</span>
      </button>
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

function SaveIndicator({ status }: { status: SaveStatus }) {
  switch (status) {
    case "dirty":
      return (
        <span className="flex items-center gap-1 text-xs text-amber-500">
          <Circle className="h-2.5 w-2.5 fill-current" />
          Unsaved
        </span>
      );
    case "saving":
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </span>
      );
    case "saved":
      return (
        <span className="flex items-center gap-1 text-xs text-green-500">
          <Check className="h-3 w-3" />
          Saved
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <XCircle className="h-3 w-3" />
          Error
        </span>
      );
    default:
      return null;
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

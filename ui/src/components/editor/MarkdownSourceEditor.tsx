import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import CodeMirror, { ExternalChange } from "@uiw/react-codemirror";
import { vim as vimMode } from "@replit/codemirror-vim";
import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { cn } from "@kw/lib/cn";
import { decodeHref, dirOf, normalizePath } from "@kw/lib/paths";
import { pageAssetUrl, resolveRawUrl } from "@kw/lib/rawUrl";
import { detectLineEndings } from "@kw/lib/markdownMerge";
import { minimalChanges } from "./minimalChanges";
import type { EditorSlashCommandConfig } from "@kw/lib/editorSlashCommands";
import { markdownEditorExtensions } from "./markdownLanguage";
import { livePreviewTheme, markdownEditorTheme } from "./markdownEditorTheme";
import { customSlashCompletionSource, slashCompletionSource } from "./markdownSlashCommands";
import {
  wikiLinkCompletionSource,
  type WikiPage,
} from "./wikiLinkCompletion";
import {
  fenceCompletion,
  fenceLinter,
  fencePreviewAt,
  samePreviewTarget,
  type FencePreviewTarget,
} from "./fenceAssist";
import { livePreview as livePreviewExtension, type LivePreviewOptions, WidgetPortals } from "./livePreview";
import { FenceBlock, resolveFence } from "../FenceBlock";
import { ErrorBoundary } from "../ErrorBoundary";

export type MarkdownSourceEditorProps = {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  dark?: boolean;
  minHeight?: string;
  className?: string;
  onSaveShortcut?: () => void;
  pages?: WikiPage[];
  customSlashCommands?: EditorSlashCommandConfig[];
  loadSlashTemplate?: (templatePath: string) => Promise<string>;
  onSlashTemplateError?: (message: string) => void;
  /**
   * Fires with the widget fence the caret is in, or null. A source-mode pane
   * can render it live, so an author editing YAML can see the picture.
   */
  onFenceUnderCursor?: (fence: FencePreviewTarget | null) => void;
  /**
   * Obsidian-style live preview: markdown syntax hides and widgets render in
   * place, revealed again wherever the selection is. The text is unchanged.
   */
  livePreview?: boolean;
  /** Vim keybindings. */
  vim?: boolean;
  /** The page being edited; relative images and links resolve against it. */
  pagePath?: string;
  /** The page a `[[wiki link]]` target points at, or null. */
  resolveWikiLink?: (target: string) => string | null;
  /** Open another page, from a wiki link or a Cmd/Ctrl-clicked link. */
  onNavigate?: (path: string) => void;
};

/** Fences that draw a widget in live preview; plain code stays text. */
function isWidgetFence(fence: FencePreviewTarget): boolean {
  const { kind } = resolveFence(fence.lang, fence.body, { meta: fence.meta });
  return kind !== "code" && kind !== "inline";
}

// Shared, so leaving the props out does not rebuild every extension each render.
const NO_PAGES: WikiPage[] = [];
const NO_SLASH_COMMANDS: EditorSlashCommandConfig[] = [];

export function MarkdownSourceEditor({
  value,
  onChange,
  readOnly = false,
  dark = false,
  minHeight = "60vh",
  className,
  onSaveShortcut,
  pages = NO_PAGES,
  customSlashCommands = NO_SLASH_COMMANDS,
  loadSlashTemplate,
  onSlashTemplateError,
  onFenceUnderCursor,
  livePreview = false,
  vim = false,
  pagePath = "",
  resolveWikiLink,
  onNavigate,
}: MarkdownSourceEditorProps) {
  // Through a ref, so a parent passing a fresh arrow each render doesn't
  // rebuild every extension.
  const fenceCallback = useRef(onFenceUnderCursor);
  const saveCallback = useRef(onSaveShortcut);
  useEffect(() => {
    fenceCallback.current = onFenceUnderCursor;
    saveCallback.current = onSaveShortcut;
  }, [onFenceUnderCursor, onSaveShortcut]);
  const wantsFence = onFenceUnderCursor !== undefined;
  const navigateRef = useRef(onNavigate);
  const resolveRef = useRef(resolveWikiLink);
  useEffect(() => {
    navigateRef.current = onNavigate;
    resolveRef.current = resolveWikiLink;
  }, [onNavigate, resolveWikiLink]);

  const portals = useMemo(() => new WidgetPortals(), []);
  const widgets = useSyncExternalStore(portals.subscribe, portals.getSnapshot, portals.getSnapshot);

  const preview = useMemo(() => {
    if (!livePreview) return null;
    const options: LivePreviewOptions = {
      wikiLinks: {
        resolve: (target) => (resolveRef.current ? resolveRef.current(target) : target),
        navigate: (path) => navigateRef.current?.(path),
      },
      openLink: (href) => {
        if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || !navigateRef.current) {
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        const page = decodeHref(href.replace(/[#?].*$/, ""));
        const dir = dirOf(pagePath);
        navigateRef.current(normalizePath(dir ? `${dir}/${page}` : page));
      },
      resolveImage: (src) => resolveRawUrl(pageAssetUrl(src, pagePath)),
      fences: {
        portals,
        accepts: isWidgetFence,
        render: (fence) => (
          <ErrorBoundary
            fallback={<p className="px-2 py-3 text-xs text-destructive">This fence threw while rendering.</p>}
          >
            <FenceBlock
              className={`language-${fence.lang}`}
              node={{ data: { meta: fence.meta } }}
              pagePath={pagePath}
              onNavigate={(path) => navigateRef.current?.(path)}
            >
              {`${fence.body}\n`}
            </FenceBlock>
          </ErrorBoundary>
        ),
      },
    };
    return livePreviewExtension(options);
  }, [livePreview, pagePath, portals]);

  const extensions = useMemo(() => {
    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          saveCallback.current?.();
          return true;
        },
      },
    ]);

    // Fence keys come before the slash menu: inside a widget body an author
    // wants `activeIndices`, not `/table`.
    const completionSources: CompletionSource[] = [fenceCompletion, slashCompletionSource];
    if (customSlashCommands.length > 0 && loadSlashTemplate && onSlashTemplateError) {
      completionSources.push(
        customSlashCompletionSource(customSlashCommands, loadSlashTemplate, onSlashTemplateError),
      );
    }
    if (pages.length > 0) {
      completionSources.push(wikiLinkCompletionSource(pages));
    }

    const exts: Extension[] = [
      // First, so its keymap sees keys before the editor's own.
      vim ? vimMode() : [],
      history(),
      ...markdownEditorExtensions(),
      highlightSelectionMatches(),
      autocompletion({
        override: completionSources,
        activateOnTyping: true,
        closeOnBlur: true,
      }),
      EditorView.contentAttributes.of({
        "aria-label": livePreview ? "Markdown live preview editor" : "Markdown source editor",
        "aria-multiline": "true",
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      saveKeymap,
      fenceLinter(),
      preview ?? [],
    ];

    if (wantsFence) {
      // Only report when the fence actually changed: moving the caret through
      // prose, or within the same unchanged fence, would otherwise hand the
      // preview a fresh object (and a re-render) on every keystroke.
      let last: FencePreviewTarget | null = null;
      exts.push(
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet) return;
          const next = fencePreviewAt(update.state, update.state.selection.main.head);
          if (samePreviewTarget(last, next)) return;
          last = next;
          fenceCallback.current?.(next);
        }),
      );
    }
    return exts;
  }, [
    pages,
    customSlashCommands,
    loadSlashTemplate,
    onSlashTemplateError,
    wantsFence,
    vim,
    livePreview,
    preview,
  ]);

  // CodeMirror keeps lines, not line breaks: a CRLF file comes back LF from
  // the editor. The editor gets LF text and changes go back out in the file's
  // own line endings, so editing a Windows file does not rewrite every line.
  // A text with no line break left says nothing; keep what it was.
  const crlfRef = useRef(false);
  const crlf = /\n/.test(value) ? detectLineEndings(value).crlf : crlfRef.current;
  crlfRef.current = crlf;
  const editorValue = useMemo(() => (crlf ? value.replace(/\r\n/g, "\n") : value), [crlf, value]);

  // A new value from outside (an agent's write, a title edit) goes in as the
  // smallest set of edits, so the caret and scroll position stay where they
  // were. The wrapped component would replace the whole document instead;
  // this layout effect runs before its sync, which then finds nothing to do.
  const viewRef = useRef<EditorView | null>(null);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === editorValue) return;
    view.dispatch({ changes: minimalChanges(current, editorValue), annotations: [ExternalChange.of(true)] });
  }, [editorValue]);
  const handleChange = useMemo(
    () => (next: string) => onChange(crlfRef.current ? next.replace(/\r?\n/g, "\r\n") : next),
    [onChange],
  );

  const theme = useMemo(
    () => (livePreview ? [markdownEditorTheme({ dark }), livePreviewTheme({ dark })] : markdownEditorTheme({ dark })),
    [dark, livePreview],
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md bg-background",
        !livePreview && "border shadow-sm",
        className,
      )}
      data-testid="markdown-source-editor"
      data-live-preview={livePreview || undefined}
    >
      <CodeMirror
        value={editorValue}
        height="auto"
        minHeight={minHeight}
        basicSetup={{
          lineNumbers: !livePreview,
          foldGutter: !livePreview,
          highlightActiveLine: !livePreview,
          highlightActiveLineGutter: !livePreview,
          // A drawn selection survives the replaced spans live preview adds,
          // where the native one jumps around them in Safari.
          drawSelection: true,
          highlightSelectionMatches: false,
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          defaultKeymap: false,
          history: false,
          searchKeymap: false,
        }}
        editable={!readOnly}
        readOnly={readOnly}
        theme={theme}
        extensions={extensions}
        onChange={handleChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
      />
      {widgets.map(({ key, dom, node }) => createPortal(node, dom, String(key)))}
    </div>
  );
}

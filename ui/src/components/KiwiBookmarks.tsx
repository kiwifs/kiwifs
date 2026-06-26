import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { api, type CommentAnchor } from "@kw/lib/api";
import {
  anchorFromSelection,
  clearWraps,
  wrapBookmark,
  type HighlightColor,
} from "@kw/lib/highlights";
import { Button } from "@kw/components/ui/button";
import {
  Popover,
  PopoverContent,
} from "@kw/components/ui/popover";
import { Textarea } from "@kw/components/ui/textarea";

export type BookmarkEntry = {
  id: string;
  page: string;
  anchor: CommentAnchor;
  color: HighlightColor;
  note?: string;
  createdAt: string;
};

export type BookmarksState = {
  highlights: BookmarkEntry[];
};

const COLORS: HighlightColor[] = ["yellow", "blue", "pink", "green", "purple"];

const COLOR_SWATCHES: Record<HighlightColor, string> = {
  yellow: "bg-yellow-300",
  blue: "bg-blue-300",
  pink: "bg-pink-300",
  green: "bg-green-300",
  purple: "bg-purple-300",
};

type Props = {
  path: string;
  containerRef: React.RefObject<HTMLElement | null>;
  renderKey: unknown;
};

type PopoverState =
  | { mode: "closed" }
  | { mode: "color-pick"; rect: DOMRect }
  | { mode: "view"; id: string; rect: DOMRect };

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function KiwiBookmarks({ path, containerRef, renderKey }: Props) {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [popover, setPopover] = useState<PopoverState>({ mode: "closed" });
  const [selectionBtn, setSelectionBtn] = useState<{ rect: DOMRect } | null>(null);
  const [noteText, setNoteText] = useState("");
  const pendingAnchorRef = useRef<CommentAnchor | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.getMyState<BookmarksState>("bookmarks").then((state) => {
      if (!cancelled) {
        const pageBookmarks = (state.highlights || []).filter((h) => h.page === path);
        setBookmarks(pageBookmarks);
      }
    });
    return () => { cancelled = true; };
  }, [path]);

  const openView = useCallback((id: string, rect: DOMRect) => {
    const bm = bookmarks.find((b) => b.id === id);
    if (bm) {
      setNoteText(bm.note || "");
      setPopover({ mode: "view", id, rect });
    }
  }, [bookmarks]);

  useLayoutEffect(() => {
    const root = containerRef.current as HTMLElement | null;
    if (!root) return;
    bookmarks.forEach((bm) => wrapBookmark(root, bm.anchor, bm.id, bm.color, openView));
    return () => {
      if (root) clearWraps(root);
    };
  }, [bookmarks, containerRef, renderKey, openView]);

  useEffect(() => {
    const root = containerRef.current as HTMLElement | null;
    if (!root) return;
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelectionBtn(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setSelectionBtn(null);
        return;
      }
      if (!sel.toString().trim()) {
        setSelectionBtn(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelectionBtn({ rect });
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [containerRef]);

  function startColorPick() {
    const root = containerRef.current as HTMLElement | null;
    if (!root) return;
    const anchor = anchorFromSelection(root);
    if (!anchor) return;
    pendingAnchorRef.current = anchor;
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount
      ? sel.getRangeAt(0).getBoundingClientRect()
      : root.getBoundingClientRect();
    setPopover({ mode: "color-pick", rect });
    setSelectionBtn(null);
  }

  async function saveBookmark(color: HighlightColor) {
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;

    const entry: BookmarkEntry = {
      id: genId(),
      page: path,
      anchor,
      color,
      createdAt: new Date().toISOString(),
    };

    const allState = await api.getMyState<BookmarksState>("bookmarks");
    const all = allState.highlights || [];
    const next: BookmarksState = { highlights: [...all, entry] };
    await api.putMyState("bookmarks", next);

    setBookmarks((prev) => [...prev, entry]);
    setPopover({ mode: "closed" });
    pendingAnchorRef.current = null;
    window.getSelection()?.removeAllRanges();
  }

  async function updateNote(id: string) {
    const allState = await api.getMyState<BookmarksState>("bookmarks");
    const all = allState.highlights || [];
    const updated = all.map((h) => h.id === id ? { ...h, note: noteText.trim() || undefined } : h);
    await api.putMyState("bookmarks", { highlights: updated });
    setBookmarks((prev) => prev.map((h) => h.id === id ? { ...h, note: noteText.trim() || undefined } : h));
    setPopover({ mode: "closed" });
  }

  async function removeBookmark(id: string) {
    const allState = await api.getMyState<BookmarksState>("bookmarks");
    const all = allState.highlights || [];
    const next: BookmarksState = { highlights: all.filter((h) => h.id !== id) };
    await api.putMyState("bookmarks", next);
    setBookmarks((prev) => prev.filter((h) => h.id !== id));
    setPopover({ mode: "closed" });
  }

  const activeBookmark = popover.mode === "view"
    ? bookmarks.find((b) => b.id === popover.id)
    : undefined;

  return (
    <>
      {selectionBtn && popover.mode === "closed" ? (
        <div
          className="fixed z-50"
          style={{
            left: Math.max(8, selectionBtn.rect.left + selectionBtn.rect.width / 2 + 50),
            top: Math.max(8, selectionBtn.rect.top - 36),
          }}
        >
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs shadow-md"
            onMouseDown={(e) => e.preventDefault()}
            onClick={startColorPick}
          >
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {popover.mode === "color-pick" ? (
        <Popover
          open
          onOpenChange={(o) => { if (!o) setPopover({ mode: "closed" }); }}
        >
          <div
            style={{
              position: "fixed",
              left: popover.rect.left + popover.rect.width / 2 - 80,
              top: popover.rect.top - 50,
              pointerEvents: "none",
            }}
          />
          <PopoverContent
            className="w-auto p-2"
            style={{
              position: "fixed",
              left: Math.max(8, popover.rect.left + popover.rect.width / 2 - 80),
              top: Math.max(8, popover.rect.top - 50),
            }}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`w-6 h-6 rounded-full ${COLOR_SWATCHES[c]} hover:ring-2 ring-offset-1 ring-foreground/40 transition-all`}
                  onClick={() => saveBookmark(c)}
                  title={c}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      {popover.mode === "view" && activeBookmark ? (
        <Popover
          open
          onOpenChange={(o) => { if (!o) setPopover({ mode: "closed" }); }}
        >
          <PopoverContent
            className="w-72 p-3"
            style={{
              position: "fixed",
              left: Math.max(8, popover.rect.left),
              top: popover.rect.bottom + 8,
            }}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground truncate">
                &ldquo;{activeBookmark.anchor.quote?.slice(0, 60)}...&rdquo;
              </p>
              <Textarea
                ref={noteRef}
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                className="text-sm min-h-[60px]"
              />
              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive h-7 px-2"
                  onClick={() => removeBookmark(activeBookmark.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-3"
                  onClick={() => updateNote(activeBookmark.id)}
                >
                  Save
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}

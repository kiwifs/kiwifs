import { useEffect, useState } from "react";
import { Bookmark, ExternalLink, X } from "lucide-react";
import { api } from "@kw/lib/api";
import type { HighlightColor } from "@kw/lib/highlights";
import type { CommentAnchor } from "@kw/lib/api";
import { Button } from "@kw/components/ui/button";

export type BookmarkEntry = {
  id: string;
  page: string;
  anchor: CommentAnchor;
  color: HighlightColor;
  note?: string;
  createdAt: string;
};

type BookmarksState = {
  highlights: BookmarkEntry[];
};

const COLOR_DOT: Record<HighlightColor, string> = {
  yellow: "bg-yellow-400",
  blue: "bg-blue-400",
  pink: "bg-pink-400",
  green: "bg-green-400",
  purple: "bg-purple-400",
};

type Props = {
  onClose: () => void;
  onNavigate: (path: string) => void;
};

export function KiwiBookmarksPanel({ onClose, onNavigate }: Props) {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterColor, setFilterColor] = useState<HighlightColor | "all">("all");

  useEffect(() => {
    api.getMyState<BookmarksState>("bookmarks").then((state) => {
      setBookmarks(state.highlights || []);
      setLoading(false);
    });
  }, []);

  const filtered = filterColor === "all"
    ? bookmarks
    : bookmarks.filter((b) => b.color === filterColor);

  const grouped = filtered.reduce<Record<string, BookmarkEntry[]>>((acc, b) => {
    (acc[b.page] ||= []).push(b);
    return acc;
  }, {});

  const sortedPages = Object.keys(grouped).sort();

  function pageTitle(path: string): string {
    const base = path.split("/").pop() || path;
    return base.replace(/\.md$/, "").replace(/-/g, " ");
  }

  async function removeBookmark(id: string) {
    const next = bookmarks.filter((b) => b.id !== id);
    setBookmarks(next);
    await api.putMyState("bookmarks", { highlights: next });
  }

  return (
    <div className="absolute inset-0 z-30 bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">My Highlights</h2>
          <span className="text-xs text-muted-foreground">
            {bookmarks.length} highlight{bookmarks.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="px-4 py-2 border-b border-border flex items-center gap-1.5">
        <button
          className={`text-xs px-2 py-0.5 rounded-full transition-colors ${filterColor === "all" ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
          onClick={() => setFilterColor("all")}
        >
          All
        </button>
        {(["yellow", "blue", "pink", "green", "purple"] as HighlightColor[]).map((c) => (
          <button
            key={c}
            className={`w-5 h-5 rounded-full ${COLOR_DOT[c]} transition-all ${filterColor === c ? "ring-2 ring-offset-1 ring-foreground/40 scale-110" : "hover:scale-110"}`}
            onClick={() => setFilterColor(filterColor === c ? "all" : c)}
            title={c}
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : sortedPages.length === 0 ? (
          <div className="text-center py-12">
            <Bookmark className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No highlights yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Select text on any page and click the bookmark icon to highlight it
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedPages.map((page) => (
              <section key={page}>
                <button
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2 group"
                  onClick={() => onNavigate(page)}
                >
                  <span className="capitalize">{pageTitle(page)}</span>
                  <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <div className="space-y-1.5">
                  {grouped[page].map((bm) => (
                    <div
                      key={bm.id}
                      className="group flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => onNavigate(bm.page)}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${COLOR_DOT[bm.color]} mt-1.5 shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-relaxed line-clamp-3">
                          &ldquo;{bm.anchor.quote}&rdquo;
                        </p>
                        {bm.note && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic">
                            {bm.note}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {new Date(bm.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                        onClick={(e) => { e.stopPropagation(); removeBookmark(bm.id); }}
                        title="Remove highlight"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

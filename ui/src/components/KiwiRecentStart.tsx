import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Clock4, Edit3, ExternalLink, Loader2 } from "lucide-react";
import { api, type RecentPageEntry } from "@kw/lib/api";
import { Button } from "@kw/components/ui/button";

const RECENT_LIMIT = 10;

export type RecentEditedPage = RecentPageEntry;

type Props = {
  onOpen: (path: string) => void;
  onEdit: (path: string) => void;
};

export function KiwiRecentStart({ onOpen, onEdit }: Props) {
  const [pages, setPages] = useState<RecentEditedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRecentPages(RECENT_LIMIT)
      .then((result) => {
        if (!cancelled) {
          setPages(result.pages || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPages([]);
          setError("Could not load recent pages.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const subtitle = useMemo(() => {
    if (loading) return "Loading recently edited pages…";
    if (error) return error;
    if (pages.length === 0) return "No recent edits yet.";
    return `Last ${pages.length} edited page${pages.length === 1 ? "" : "s"}`;
  }, [loading, error, pages.length]);

  return (
    <div className="h-full overflow-auto kiwi-scroll">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <Clock4 className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Recent pages</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : pages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Edits will appear here once pages are created or updated.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {pages.map((page) => (
              <li key={page.path} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{page.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{page.path}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {page.actor ? (
                      <>
                        {page.actor}
                        {" · "}
                      </>
                    ) : null}
                    {formatDistanceToNow(parseISO(page.timestamp), { addSuffix: true })}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpen(page.path)}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => onEdit(page.path)}>
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

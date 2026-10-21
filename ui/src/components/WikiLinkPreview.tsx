import { useEffect, useState, type ReactElement } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@kw/components/ui/hover-card";
import { Card, CardContent, CardHeader, CardTitle } from "@kw/components/ui/card";
import { loadPagePreview, type PagePreview } from "@kw/lib/pagePreview";

export type PreviewState =
  | { status: "loading" }
  | { status: "ready"; preview: PagePreview }
  | { status: "missing" }
  | { status: "error" };

type Props = {
  /** Resolved page path, e.g. `notes/foo.md`. */
  path: string;
  /** The link points at a page that does not exist yet; skip the fetch. */
  missing?: boolean;
  children: ReactElement;
};

export function WikiLinkPreview({ path, missing = false, children }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PreviewState>(missing ? { status: "missing" } : { status: "loading" });

  useEffect(() => {
    if (missing) {
      setState({ status: "missing" });
      return;
    }
    if (!open) return;
    setState((s) => (s.status === "error" ? { status: "loading" } : s));
    let cancelled = false;
    loadPagePreview(path).then(
      (preview) => {
        if (!cancelled) setState(preview ? { status: "ready", preview } : { status: "missing" });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, path, missing]);

  return (
    <HoverCard openDelay={300} closeDelay={100} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        asChild
        // Radix also opens on focus; keep tab navigation free of popovers.
        onFocus={(e) => e.preventDefault()}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-80 max-w-[320px] border-0 bg-transparent p-0 shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <PreviewCard path={path} state={state} />
      </HoverCardContent>
    </HoverCard>
  );
}

export function PreviewCard({ path, state }: { path: string; state: PreviewState }) {
  if (state.status === "loading") {
    return (
      <Card className="shadow-md" aria-busy="true" aria-label="Loading preview">
        <CardHeader className="space-y-2 p-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (state.status !== "ready") {
    return (
      <Card className="shadow-md">
        <CardHeader className="space-y-1 p-4">
          <CardTitle className="text-sm">
            {state.status === "missing" ? "Page not found" : "Preview unavailable"}
          </CardTitle>
          <div className="truncate font-mono text-xs text-muted-foreground">{path}</div>
        </CardHeader>
        {state.status === "missing" && (
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">Click the link to create it.</CardContent>
        )}
      </Card>
    );
  }

  const { preview } = state;
  return (
    <Card className="shadow-md">
      <CardHeader className="space-y-1 p-4">
        <CardTitle className="text-sm leading-snug">{preview.title}</CardTitle>
        <div className="truncate font-mono text-xs text-muted-foreground">{preview.path}</div>
      </CardHeader>
      {(preview.snippet || preview.tags.length > 0) && (
        <CardContent className="space-y-2 p-4 pt-0">
          {preview.snippet && <p className="text-xs leading-relaxed text-foreground/80">{preview.snippet}</p>}
          {preview.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {preview.tags.map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

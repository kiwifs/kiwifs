import { useCallback, useEffect, useState } from "react";
import { BookPlus, Check, Copy, ExternalLink, Eye, Loader2 } from "lucide-react";
import { api, type PublishStatusResponse } from "@kw/lib/api";
import { Button } from "@kw/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@kw/components/ui/popover";

type Props = {
  path: string;
  onPublishedChanged?: () => void;
};

export function PublishButton({ path, onPublishedChanged }: Props) {
  const [status, setStatus] = useState<PublishStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api.publishStatus(path);
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    fetchStatus();
  }, [fetchStatus]);

  async function handlePublish() {
    setBusy(true);
    try {
      const res = await api.publish(path);
      setStatus({
        path: res.path,
        published: res.published,
        published_at: res.published_at,
        public_url: res.public_url,
        view_count: status?.view_count ?? 0,
      });
      onPublishedChanged?.();
    } catch (e) {
      console.error("Publish failed:", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpublish() {
    setBusy(true);
    try {
      await api.unpublish(path);
      setStatus((prev) =>
        prev ? { ...prev, published: false, public_url: undefined } : null
      );
      setMenuOpen(false);
      onPublishedChanged?.();
    } catch (e) {
      console.error("Unpublish failed:", e);
    } finally {
      setBusy(false);
    }
  }

  function handleCopyLink() {
    if (!status?.public_url) return;
    const url = window.location.origin + status.public_url;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleViewPublished() {
    if (!status?.public_url) return;
    window.open(status.public_url, "_blank");
  }

  if (loading) {
    return null;
  }

  if (!status?.published) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handlePublish}
        disabled={busy}
        className="gap-1.5"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <BookPlus className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">Publish</span>
      </Button>
    );
  }

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-primary/50 bg-primary/10 text-primary-foreground hover:bg-primary/20 dark:text-primary dark:border-primary/40 dark:bg-primary/10 dark:hover:bg-primary/20"
        >
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="text-xs font-medium">Published</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            <span>
              {status.view_count.toLocaleString()} view
              {status.view_count === 1 ? "" : "s"}
            </span>
          </div>

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors w-full text-left"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied!" : "Copy public link"}
          </button>

          <button
            onClick={handleViewPublished}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors w-full text-left"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View published page
          </button>

          <button
            onClick={handleUnpublish}
            disabled={busy}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors w-full text-left"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BookPlus className="h-3.5 w-3.5" />
            )}
            Unpublish
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

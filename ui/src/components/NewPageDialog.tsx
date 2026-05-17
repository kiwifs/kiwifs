import { useEffect, useState } from "react";
import { Eye, File, FilePenLine } from "lucide-react";
import { api } from "@kw/lib/api";
import { Button } from "@kw/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kw/components/ui/dialog";
import { Input } from "@kw/components/ui/input";
import { Label } from "@kw/components/ui/label";
import { cn } from "@kw/lib/cn";
import { TemplatePreview } from "./TemplatePreview";

type Template = { name: string; path: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (path: string) => void;
  defaultFolder?: string;
};

export function NewPageDialog({ open, onOpenChange, onCreated, defaultFolder }: Props) {
  const [path, setPath] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPath("");
      setSelected("");
      setError(null);
      setShowPreview(false);
      setPreviewContent(null);
      return;
    }
    if (defaultFolder) {
      const prefix = defaultFolder.endsWith("/") ? defaultFolder : defaultFolder + "/";
      setPath(prefix);
    }
    api
      .listTemplates()
      .then((r) => setTemplates(r.templates || []))
      .catch(() => setTemplates([]));
  }, [open]);

  // Load preview when template changes and preview is active
  useEffect(() => {
    if (!showPreview || !selected) {
      setPreviewContent(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    api
      .previewTemplate(selected)
      .then((r) => setPreviewContent(r.content))
      .catch((e) => {
        setPreviewError(String(e));
        setPreviewContent(null);
      })
      .finally(() => setPreviewLoading(false));
  }, [selected, showPreview]);

  async function create() {
    setError(null);
    let p = path.trim();
    if (!p) {
      setError("Path is required.");
      return;
    }
    if (!p.endsWith(".md")) p += ".md";
    setCreating(true);
    try {
      let content = `# ${titleFromPath(p)}\n\n`;
      if (selected) {
        try {
          // Use preview content if available (already resolved), otherwise fetch raw
          if (previewContent) {
            content = previewContent;
          } else {
            const tmpl = await api.readTemplate(selected);
            content = tmpl.content;
          }
        } catch (e) {
          console.warn("template fetch failed", e);
        }
      }
      await api.writeFile(p, content);
      onCreated(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePenLine className="h-4 w-4 text-primary" />
            New page
          </DialogTitle>
          <DialogDescription>
            Create a markdown file at any path under the knowledge root.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="new-page-path">Path</Label>
            <Input
              id="new-page-path"
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="pages/new-topic.md"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Template</Label>
              {selected && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => setShowPreview((v) => !v)}
                >
                  <Eye className="h-3 w-3" />
                  {showPreview ? "Hide preview" : "Preview"}
                </Button>
              )}
            </div>
            <div className="flex flex-col max-h-48 overflow-auto kiwi-scroll border border-border rounded-md">
              <TemplateRow
                label="Blank page"
                active={selected === ""}
                onClick={() => {
                  setSelected("");
                  setShowPreview(false);
                }}
              />
              {templates.map((t) => (
                <TemplateRow
                  key={t.name}
                  label={t.name}
                  active={selected === t.name}
                  onClick={() => setSelected(t.name)}
                />
              ))}
            </div>
          </div>

          {/* Template preview */}
          {showPreview && selected && (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="text-xs font-medium px-3 py-1.5 border-b border-border bg-muted/30">
                Resolved preview
              </div>
              <TemplatePreview
                content={previewContent}
                loading={previewLoading}
                error={previewError}
              />
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive font-mono">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent text-accent-foreground font-medium",
      )}
    >
      <File className="h-3.5 w-3.5 text-muted-foreground" />
      <span>{label}</span>
    </button>
  );
}

function titleFromPath(p: string): string {
  const base = p.split("/").pop() || p;
  const stem = base.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
  return stem
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

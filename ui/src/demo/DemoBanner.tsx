import { ArrowLeft, BookOpen, ExternalLink } from "lucide-react";
import type { DemoTemplateConfig } from "./types";

type DemoBannerProps = {
  template: DemoTemplateConfig;
};

export function DemoBanner({ template }: DemoBannerProps) {
  return (
    <div className="shrink-0 border-b border-border bg-card/95 backdrop-blur px-3 py-2 flex items-center gap-3 text-sm">
      <a
        href="/"
        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">All templates</span>
      </a>
      <div className="h-4 w-px bg-border" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{template.title}</span>
        <span className="hidden md:inline text-muted-foreground"> — {template.description}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href={`https://docs.kiwifs.com`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="h-4 w-4" />
          <span className="hidden sm:inline">Docs</span>
        </a>
        <a
          href="/storybook/"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">Storybook</span>
        </a>
        <code className="hidden lg:inline text-xs bg-muted px-2 py-1 rounded font-mono">
          kiwifs init --template {template.slug === "prompt" ? "prompt" : template.slug === "research" ? "research" : template.slug}
        </code>
      </div>
    </div>
  );
}

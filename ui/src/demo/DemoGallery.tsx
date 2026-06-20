import {
  Moon,
  Sun,
  BookOpen,
  Layers,
  ExternalLink,
  Github,
  ArrowRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@kw/components/ui/button";
import { demoTemplates } from "./templates";
import { demoBasePath } from "./templates/index";

function useThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("kiwifs-theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  return { dark, toggle: () => setDark((v) => !v) };
}

const themeGradients: Record<string, string> = {
  "bg-lime-500": "from-lime-500/20 to-lime-500/5",
  "bg-lime-400": "from-lime-400/20 to-lime-400/5",
  "bg-sky-500": "from-sky-500/20 to-sky-500/5",
  "bg-orange-500": "from-orange-500/20 to-orange-500/5",
  "bg-orange-400": "from-orange-400/20 to-orange-400/5",
  "bg-zinc-500": "from-zinc-500/20 to-zinc-500/5",
  "bg-zinc-400": "from-zinc-400/20 to-zinc-400/5",
  "bg-emerald-600": "from-emerald-600/20 to-emerald-600/5",
  "bg-cyan-500": "from-cyan-500/20 to-cyan-500/5",
  "bg-green-600": "from-green-600/20 to-green-600/5",
  "bg-stone-500": "from-stone-500/20 to-stone-500/5",
};

export function DemoGallery() {
  const { dark, toggle } = useThemeToggle();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <header className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3" />
        <div className="relative max-w-6xl mx-auto px-6 pt-12 pb-10">
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3 mb-4">
                <img src="/kiwi-mascot.png" alt="KiwiFS" className="h-12 w-12" />
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">KiwiFS</h1>
                  <p className="text-sm text-muted-foreground">A file system that thinks in pages</p>
                </div>
              </div>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Explore live template workspaces — knowledge bases, wikis, task boards,
                data dashboards, and more. Each template showcases a different theme preset
                so you can see how customizable KiwiFS really is.
              </p>
            </div>
            <Button variant="outline" size="icon" onClick={toggle} aria-label="Toggle theme" className="shrink-0 mt-1">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>

          {/* Quick links row */}
          <div className="flex flex-wrap gap-3 mt-6">
            <a
              href="/storybook/"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent transition-colors"
            >
              <Layers className="h-4 w-4 text-primary" />
              Storybook
              <span className="text-muted-foreground font-normal">— component library</span>
            </a>
            <a
              href="https://docs.kiwifs.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent transition-colors"
            >
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              Documentation
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
            <a
              href="https://github.com/kiwifs/kiwifs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent transition-colors"
            >
              <Github className="h-4 w-4 text-muted-foreground" />
              GitHub
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          </div>
        </div>
      </header>

      {/* Template grid */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">
          {demoTemplates.length} Templates
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {demoTemplates.map((template) => {
            const grad = themeGradients[template.accentClass] ?? "from-muted/20 to-muted/5";
            return (
              <a
                key={template.slug}
                href={demoBasePath(template.slug)}
                className="group relative rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200"
              >
                {/* Color gradient header */}
                <div className={`h-24 bg-gradient-to-br ${grad} flex items-end px-5 pb-3`}>
                  <div className={`h-2 w-10 rounded-full ${template.accentClass}`} />
                </div>
                {/* Card body */}
                <div className="px-5 pt-3 pb-5">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
                      {template.title}
                    </h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{template.description}</p>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground">
                      {template.useCase}
                    </span>
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground">
                      {template.themePreset} · {template.defaultTheme}
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>KiwiFS — a file system that thinks in pages</span>
          <div className="flex gap-4">
            <a href="/storybook/" className="hover:text-foreground transition-colors">Storybook</a>
            <a href="https://docs.kiwifs.com" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">Docs</a>
            <a href="https://github.com/kiwifs/kiwifs" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { Moon, Sun } from "lucide-react";
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

export function DemoGallery() {
  const { dark, toggle } = useThemeToggle();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <img src="/kiwi-mascot.png" alt="KiwiFS" className="h-10 w-10" />
              <h1 className="text-2xl font-semibold tracking-tight">KiwiFS templates</h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Explore real workspaces — charts, kanban, graphs, queries, and themes.
              Each template uses a different preset so you can see how much KiwiFS can be customized.
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={toggle} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {demoTemplates.map((template) => (
            <a
              key={template.slug}
              href={demoBasePath(template.slug)}
              className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className={`h-1.5 w-12 rounded-full mb-4 ${template.accentClass}`} />
              <h2 className="font-semibold text-lg mb-1 group-hover:text-primary transition-colors">
                {template.title}
              </h2>
              <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-muted px-2 py-0.5">{template.useCase}</span>
                <span className="rounded-full bg-muted px-2 py-0.5">{template.themePreset} · {template.defaultTheme}</span>
              </div>
            </a>
          ))}
        </div>

        <div className="mt-10 pt-8 border-t border-border flex flex-wrap gap-4 text-sm text-muted-foreground">
          <a href="/storybook/" className="hover:text-foreground">Component storybook</a>
          <a href="https://docs.kiwifs.com" target="_blank" rel="noreferrer" className="hover:text-foreground">Documentation</a>
          <a href="https://github.com/kiwifs/kiwifs" target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
        </div>
      </main>
    </div>
  );
}

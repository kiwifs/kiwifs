import { DemoGallery } from "./DemoGallery";
import { DemoShell } from "./DemoShell";
import { demoTemplateBySlug, getDemoSlugFromPath } from "./templates";

export function DemoApp() {
  const slug = getDemoSlugFromPath();
  if (!slug) {
    return <DemoGallery />;
  }

  const template = demoTemplateBySlug[slug];
  if (!template) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-foreground">
        <div className="text-center space-y-3">
          <h1 className="text-xl font-semibold">Template not found</h1>
          <p className="text-muted-foreground">No demo for <code>{slug}</code></p>
          <a href="/" className="text-primary hover:underline">Back to gallery</a>
        </div>
      </div>
    );
  }

  return <DemoShell template={template} />;
}

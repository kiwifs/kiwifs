import type { Meta, StoryObj } from "@storybook/react-vite";

import { ShikiCode } from "@kw/components/ShikiCode";
import { allFences } from "./index";
import { parseFenceMeta } from "./meta";
import { TypedFence } from "./TypedFence";

/**
 * Every fence rendered from its own documented example.
 *
 * The examples here are the same strings the slash menu inserts, that
 * `docs/WIDGETS.md` prints, and that `kiwi_widget_reference` hands to agents.
 * If one of them looks wrong on this page, it is wrong everywhere — which is
 * the point of reviewing them together.
 *
 * Flip the Theme toolbar control: a widget is embedded in author-written
 * markdown and has no per-page styling to fall back on, so each has to stand
 * on its own in light and dark.
 *
 * Every registered spec has a story here; `storiesCoverage.test.ts` fails
 * when one is added without one. Each plays on a loop, with the markdown
 * that produced it beside it.
 */

/** Stepped examples play on their own, so the gallery moves. */
function withPlayback(meta: string): string {
  const parsed = parseFenceMeta(meta);
  return [meta, parsed.autoplay ? "" : "autoplay", parsed.loop ? "" : "loop"].filter(Boolean).join(" ");
}

/** Strip the ```lang line and the closing fence from a documented example. */
function splitExample(example: string): { meta: string; body: string } {
  const newline = example.indexOf("\n");
  const opening = example.slice(0, newline);
  const body = example
    .slice(newline + 1)
    .replace(/```\s*$/, "")
    .replace(/\n$/, "");
  const meta = opening.replace(/^```\S*\s*/, "");
  return { meta, body };
}

function Gallery({ only }: { only?: string }) {
  const specs = allFences().filter((spec) => !only || spec.lang === only);
  return (
    <div
      className="kiwi-page"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        padding: 24,
        background: "var(--background)",
        color: "var(--foreground)",
        minHeight: "100vh",
      }}
    >
      {specs.map((spec) => {
        const { meta, body } = splitExample(spec.example);
        return (
          <section key={spec.lang} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2
              style={{
                margin: 0,
                fontSize: "0.7rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted-foreground)",
              }}
            >
              {spec.lang}
            </h2>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              {spec.description}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
                gap: 16,
                alignItems: "start",
              }}
            >
              <TypedFence spec={spec} source={body} meta={withPlayback(meta)} />
              <ShikiCode code={spec.example.trimEnd()} lang="markdown" title="Markdown" />
            </div>
          </section>
        );
      })}
    </div>
  );
}

const meta: Meta<typeof Gallery> = {
  title: "Fences/Gallery",
  component: Gallery,
  parameters: { layout: "fullscreen" },
};

export default meta;

export const AllFences: StoryObj<typeof Gallery> = {};


type Story = StoryObj<typeof Gallery>;

export const Array_: Story = { args: { only: "array" } };
export const Matrix: Story = { args: { only: "matrix" } };
export const Table: Story = { args: { only: "table" } };
export const Tree: Story = { args: { only: "tree" } };
export const Graph: Story = { args: { only: "graph" } };
export const Plot: Story = { args: { only: "plot" } };
export const Bars: Story = { args: { only: "bars" } };
export const NumberLine: Story = { args: { only: "numberline" } };
export const Plane: Story = { args: { only: "plane" } };
export const Map: Story = { args: { only: "map" } };
export const Timeline: Story = { args: { only: "timeline" } };
export const List: Story = { args: { only: "list" } };
export const Stack: Story = { args: { only: "stack" } };
export const Queue: Story = { args: { only: "queue" } };
export const Bits: Story = { args: { only: "bits" } };
export const Sequence: Story = { args: { only: "sequence" } };
export const Memory: Story = { args: { only: "memory" } };
export const Steps: Story = { args: { only: "steps" } };

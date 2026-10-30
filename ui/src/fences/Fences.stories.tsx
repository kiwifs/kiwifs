import type { Meta, StoryObj } from "@storybook/react-vite";

import { allFences } from "./index";
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
 */

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
            <TypedFence spec={spec} source={body} meta={meta} />
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

export const Array_: StoryObj<typeof Gallery> = { args: { only: "array" } };
export const Matrix: StoryObj<typeof Gallery> = { args: { only: "matrix" } };
export const Table: StoryObj<typeof Gallery> = { args: { only: "table" } };
export const Tree: StoryObj<typeof Gallery> = { args: { only: "tree" } };
export const Graph: StoryObj<typeof Gallery> = { args: { only: "graph" } };
export const NumberLine: StoryObj<typeof Gallery> = { args: { only: "numberline" } };
export const Plane: StoryObj<typeof Gallery> = { args: { only: "plane" } };
export const Map: StoryObj<typeof Gallery> = { args: { only: "map" } };
export const Timeline: StoryObj<typeof Gallery> = { args: { only: "timeline" } };

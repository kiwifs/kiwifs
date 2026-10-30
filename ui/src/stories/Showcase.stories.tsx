import type { ReactElement } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { KiwiPage } from "@kw/components/KiwiPage";
import { MockApiProvider, type MockOverrides } from "@kw/components/__mocks__/apiMock";
import type { TreeEntry } from "@kw/lib/api";
import architectureWalkthrough from "./showcase/architecture-walkthrough.md?raw";
import algorithmLesson from "./showcase/algorithm-lesson.md?raw";
import incidentRunbook from "./showcase/incident-runbook.md?raw";
import adr from "./showcase/adr.md?raw";
import teamDashboard from "./showcase/team-dashboard.md?raw";
import { SHOWCASE_QUERY_ROWS } from "./showcase/queryRows";
import { BROKEN, PENDING } from "./showcase/checks";

/**
 * Whole pages written the way a team would write them, rendered through the
 * real KiwiPage. Each fixture in `./showcase/` is documentation for the blocks
 * it uses and a regression test for how they sit together on one page.
 */
const meta: Meta<typeof KiwiPage> = {
  title: "Showcase",
  component: KiwiPage,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
};

export default meta;
type Story = StoryObj<typeof KiwiPage>;

const FIXTURES = {
  "architecture-walkthrough": architectureWalkthrough,
  "algorithm-lesson": algorithmLesson,
  "incident-runbook": incidentRunbook,
  adr,
  "team-dashboard": teamDashboard,
} as const;

type Fixture = keyof typeof FIXTURES;

const tree: TreeEntry = {
  path: "",
  name: "workspace",
  isDir: true,
  children: [
    {
      path: "showcase",
      name: "showcase",
      isDir: true,
      children: (Object.keys(FIXTURES) as Fixture[]).map((name) => ({
        path: `showcase/${name}.md`,
        name: `${name}.md`,
        isDir: false,
        size: FIXTURES[name].length,
      })),
    },
    {
      path: "tasks",
      name: "tasks",
      isDir: true,
      children: SHOWCASE_QUERY_ROWS.map((row) => {
        const p = String(row._path);
        return { path: p, name: p.slice("tasks/".length), isDir: false, size: 400 };
      }),
    },
  ],
};

function page(name: Fixture, overrides: MockOverrides = {}): Story {
  const path = `showcase/${name}.md`;
  return {
    args: { path, tree },
    decorators: [
      (Story: () => ReactElement) => (
        <MockApiProvider overrides={{ fileContent: FIXTURES[name], tree, ...overrides }}>
          <div className="h-screen bg-background text-foreground">
            <Story />
          </div>
        </MockApiProvider>
      ),
    ],
  };
}

/** Wait for every deferred block, then fail on any block that rendered as an error. */
async function renderedCleanly(
  canvasElement: HTMLElement,
  heading: string,
  selectors: Record<string, number>,
  mermaids = 0,
) {
  await within(canvasElement).findByRole("heading", { level: 1, name: heading }, { timeout: 10_000 });
  await waitFor(() => expect(canvasElement.querySelector(PENDING)).toBeNull(), { timeout: 20_000 });
  const text = canvasElement.textContent ?? "";
  await expect(text).not.toMatch(/fence could not be rendered|Something went wrong|Mermaid render error|Steps error|Could not load app/);
  await expect(canvasElement.querySelector(BROKEN)).toBeNull();
  for (const [selector, n] of Object.entries(selectors)) {
    await waitFor(() => expect(canvasElement.querySelectorAll(selector).length).toBe(n), { timeout: 10_000 });
  }
  // Mermaid draws into a shadow root, so a drawn diagram is only visible from its host.
  await waitFor(
    () => {
      const hosts = Array.from(canvasElement.querySelectorAll(".kiwi-mermaid"));
      expect(hosts.length).toBe(mermaids);
      for (const host of hosts) expect(shadowSvg(host)).toBeTruthy();
    },
    { timeout: 15_000 },
  );
}

function shadowSvg(host: Element): Element | null {
  for (const el of Array.from(host.querySelectorAll("*"))) {
    const svg = el.shadowRoot?.querySelector("svg");
    if (svg) return svg;
  }
  return null;
}

/**
 * A lease and fencing-token app driven by the host's playback, a stepped
 * flowchart, a focused Mermaid diagram, a sequence fence, tabs, a capacity
 * estimate and a wide table.
 */
export const ArchitectureWalkthrough: Story = {
  ...page("architecture-walkthrough"),
  play: async ({ canvasElement }) => {
    await renderedCleanly(canvasElement, "How a job queue survives a crash", {
      "figure.kiwi-app": 1,
      ".kiwi-widget": 2,
      ".kiwi-tabs [role='tab']": 3,
      ".kiwi-calc": 1,
      ".kiwi-figure-media table": 1,
    }, 2);
    const app = await waitFor(
      () => {
        const figure = canvasElement.querySelector<HTMLElement>("figure#lease");
        if (!figure?.querySelector("iframe")) throw new Error("waiting for the lease app");
        return figure;
      },
      { timeout: 10_000 },
    );
    const host = within(app);
    await host.findByText("1/5", {}, { timeout: 10_000 });

    app.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");

    await host.findByText("4/5");
    await expect(host.getByLabelText("Step 4 of 5")).toBeTruthy();
    await waitFor(() => expect(decodeURIComponent(window.location.hash)).toContain("step.lease=3"));
  },
};

/** Array and matrix fences on one clock, a widget:live composition, a runnable cell, a quiz and math. */
export const AlgorithmLesson: Story = {
  ...page("algorithm-lesson"),
  play: async ({ canvasElement }) => {
    await renderedCleanly(canvasElement, "Prefix sums, in one and two dimensions", {
      ".kiwi-widget": 3,
      ".kiwi-code-runner": 1,
      ".kiwi-quiz": 1,
      ".katex-display": 2,
    });
  },
};

/** A stepped response flow, a config diff, a checklist, claims with evidence and an incident timeline. */
export const IncidentRunbook: Story = {
  ...page("incident-runbook"),
  play: async ({ canvasElement }) => {
    await renderedCleanly(canvasElement, "Runbook: job backlog after a config change", {
      ".kiwi-widget": 2,
      ".kiwi-diff": 1,
      ".kiwi-claim-block": 2,
    }, 1);
  },
};

/** Decision-record frontmatter, options in columns, a benchmark chart and claims. */
export const DecisionRecord: Story = {
  ...page("adr"),
  play: async ({ canvasElement }) => {
    await renderedCleanly(canvasElement, "ADR-014: Keep job state in an append-only log", {
      ".kiwi-columns > .kiwi-col": 3,
      ".kiwi-chart .recharts-wrapper": 1,
      ".kiwi-claim-block": 2,
    });
  },
};

/** A live query, goal progress, a chart, a sprint board and a data block. */
export const TeamDashboard: Story = {
  ...page("team-dashboard", { queryRows: SHOWCASE_QUERY_ROWS }),
  play: async ({ canvasElement }) => {
    await renderedCleanly(canvasElement, "Platform team dashboard", {
      ".kiwi-query table tbody tr": SHOWCASE_QUERY_ROWS.length,
      ".kiwi-progress": 1,
      ".kiwi-chart .recharts-wrapper": 1,
      ".kiwi-kanban-block .kiwi-kanban-column": 4,
      ".kiwi-data": 1,
    });
  },
};

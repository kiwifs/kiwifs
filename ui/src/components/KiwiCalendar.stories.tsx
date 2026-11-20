import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, userEvent, within } from "storybook/test";
import { KiwiCalendar } from "./KiwiCalendar";
import { MockApiProvider, type MockOverrides } from "./__mocks__/apiMock";

// Fixed so the grid and its entries look the same on every run.
const JUNE_2026 = new Date(2026, 5, 15);

const datedPages: MockOverrides = {
  queryRows: [
    { _path: "adr/001-sqlite.md", title: "ADR-001: Use SQLite for search", date: "2026-06-03", tags: ["adr", "search"], state: "accepted" },
    { _path: "adr/002-git.md", title: "ADR-002: Git for versioning", date: "2026-06-03", tags: ["adr"], state: "proposed" },
    { _path: "runbooks/high-cpu.md", title: "High CPU runbook drill", date: "2026-06-10", tags: ["runbook", "ops"], status: "active" },
    { _path: "daily/2026-06-15.md", title: "Daily note", date: "2026-06-15", tags: ["daily"] },
    { _path: "releases/v0-20.md", title: "Release v0.20", date: "2026-06-15T16:00:00Z", tags: ["release"], state: "draft" },
    { _path: "releases/v0-20-notes.md", title: "Write v0.20 notes", date: "2026-06-15", tags: ["docs"], state: "draft" },
    { _path: "releases/v0-20-blog.md", title: "Publish v0.20 blog post", date: "2026-06-15", tags: ["docs", "marketing"], state: "review" },
    { _path: "releases/v0-20-retro.md", title: "v0.20 retro", date: "2026-06-15", tags: ["meeting"] },
    { _path: "meetings/planning.md", title: "Q3 planning", date: "2026-06-29", tags: ["meeting"] },
  ],
  metaResults: [
    { path: "adr/001-sqlite.md", frontmatter: { date: "2026-06-03", tags: ["adr"] } },
    { path: "runbooks/high-cpu.md", frontmatter: { date: "2026-06-10", last_executed: "2026-05-30" } },
    { path: "releases/v0-20.md", frontmatter: { date: "2026-06-15", due: "2026-06-20" } },
  ],
};

const noPages: MockOverrides = { queryRows: [], metaResults: [] };

const meta: Meta<typeof KiwiCalendar> = {
  title: "Screens/KiwiCalendar",
  component: KiwiCalendar,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof KiwiCalendar>;

function renderCalendar(overrides: MockOverrides, compact = false) {
  return (
    <MockApiProvider overrides={overrides}>
      <div className="h-screen bg-background text-foreground">
        <KiwiCalendar
          initialDate={JUNE_2026}
          compact={compact}
          onClose={action("close-calendar")}
          onNavigate={action("navigate")}
        />
      </div>
    </MockApiProvider>
  );
}

export const Month: Story = {
  render: () => renderCalendar(datedPages),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("ADR-001: Use SQLite for search")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /June 2026/ })).toBeInTheDocument();
    // Five pages on the 15th: three fit in the cell, the rest sit behind
    // "+2 more". The 16:00 release sorts after the all-day pages.
    await userEvent.click(canvas.getByRole("button", { name: "+2 more" }));
    const popover = within(document.body);
    await expect(await popover.findByText("Release v0.20")).toBeInTheDocument();
  },
};

export const Week: Story = {
  render: () => renderCalendar(datedPages, true),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("v0.20 retro")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Next week" })).toBeInTheDocument();
  },
};

export const Empty: Story = {
  render: () => renderCalendar(noPages),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("0 pages")).toBeInTheDocument();
  },
};

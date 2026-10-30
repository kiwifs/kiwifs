import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { KiwiApp } from "./KiwiApp";
import { MockApiProvider } from "./__mocks__/apiMock";
import { StoryMarkdown } from "./__mocks__/StoryMarkdown";

/**
 * `kiwi-app`: sandboxed HTML with the kit stylesheet and the `kiwi` runtime.
 * Every app here is written the way docs/APPS.md recommends — `k-` classes
 * and tokens, never colours, and `kiwi.steps` instead of a hand-rolled
 * counter — so these stories are also the copy-paste starting points.
 */
const meta: Meta<typeof KiwiApp> = {
  title: "Blocks/KiwiApp",
  component: KiwiApp,
  tags: ["autodocs"],
  parameters: { layout: "padded", a11y: { test: "error" } },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiApp>;

const KIT_REFERENCE = `<div class="k-app">
  <div class="k-eyebrow">Kit reference</div>
  <h2 class="k-title">Every component, every tone</h2>
  <p class="k-lede">Colours come from the page theme. Flip the theme or palette in the toolbar.</p>

  <div class="k-ctl">
    <div class="k-seg">
      <button aria-pressed="true">Happy path</button><button aria-pressed="false">Crash</button><button aria-pressed="false">Pause</button>
    </div>
    <button class="k-btn">Reset</button>
    <button class="k-btn primary">Next</button>
    <button class="k-btn" disabled>Disabled</button>
  </div>

  <div class="k-ctl">
    <span class="k-pill ok">ok</span><span class="k-pill bad">bad</span><span class="k-pill warn">warn</span>
    <span class="k-pill info">info</span><span class="k-pill violet">violet</span><span class="k-pill muted">muted</span>
  </div>

  <div class="k-out on good">Committed with token 42.</div>
  <div class="k-out on bad">Rejected: token 41 is stale.</div>

  <ol class="k-steps"><li class="on">Acquire lease</li><li class="now">Write</li><li>Release</li></ol>

  <div class="k-lanes">
    <div class="k-lane on"><div class="k-eyebrow">Worker A</div>holding</div>
    <div class="k-lane paused"><div class="k-eyebrow">Worker B</div>paused</div>
    <div class="k-lane dead"><div class="k-eyebrow">Worker C</div>gone</div>
  </div>

  <dl class="k-kv"><dt>holder</dt><dd>A</dd><dt>token</dt><dd>42</dd><dt>expires</dt><dd>in 8s</dd></dl>

  <pre class="k-code">UPDATE jobs SET owner = <b>'B'</b> WHERE token = <b>42</b></pre>

  <div class="k-track">
    <div class="k-bar" style="left:4%;width:38%"></div>
    <div class="k-bar" style="--tone:var(--k-warn);left:46%;width:30%"></div>
    <div class="k-now" style="left:58%"></div>
  </div>

  <div class="k-dots"><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i></div>

  <div class="k-grid">
    <div class="k-card k-stat"><b>42 ms</b><span>p99 latency</span></div>
    <div class="k-card k-stat"><b>3</b><span>retries</span></div>
    <div class="k-card k-stat"><b>99.95%</b><span>availability</span></div>
  </div>

  <svg class="k-svg" viewBox="0 0 320 70">
    <rect class="node on" x="8" y="15" width="80" height="40" rx="8"/><text class="label" x="48" y="40" text-anchor="middle">client</text>
    <path class="edge on" d="M88 35 H120"/>
    <rect class="node" x="120" y="15" width="80" height="40" rx="8"/><text class="label" x="160" y="40" text-anchor="middle">api</text>
    <path class="edge dim" d="M200 35 H232"/>
    <rect class="node hot" x="232" y="15" width="80" height="40" rx="8"/><text class="label" x="272" y="40" text-anchor="middle">db</text>
  </svg>
</div>`;

export const KitReference: Story = {
  args: { source: KIT_REFERENCE, meta: 'title="Kit reference"' },
};

const STEPPED = `<div class="k-app">
  <div class="k-eyebrow">Lease and fencing token</div>
  <p class="k-lede" id="note"></p>
  <div class="k-lanes" id="lanes"></div>
  <div class="k-ctl">
    <button class="k-btn" onclick="kiwi.prev()">Back</button>
    <button class="k-btn primary" onclick="kiwi.next()">Next</button>
    <span class="k-pill" id="step"></span>
  </div>
</div>
<script>
  var frames = [
    { note: "A takes the lease with token 41.", a: "on", b: "", tone: "ok" },
    { note: "A stalls in a long GC pause.", a: "paused", b: "", tone: "warn" },
    { note: "The lease expires. B takes it with token 42.", a: "paused", b: "on", tone: "info" },
    { note: "A wakes and writes with token 41.", a: "on", b: "on", tone: "bad" },
    { note: "Storage has seen 42, so 41 is rejected.", a: "dead", b: "on", tone: "ok" }
  ];
  kiwi.steps({
    count: frames.length,
    labels: frames.map(function (f) { return f.note; }),
    onStep: function (i) {
      var f = frames[i];
      document.getElementById("note").textContent = f.note;
      document.getElementById("lanes").innerHTML =
        '<div class="k-lane ' + f.a + '"><div class="k-eyebrow">Worker A</div>token 41</div>' +
        '<div class="k-lane ' + f.b + '"><div class="k-eyebrow">Worker B</div>token 42</div>';
      var pill = document.getElementById("step");
      pill.className = "k-pill " + f.tone;
      pill.textContent = "step " + (i + 1) + " / " + frames.length;
    }
  });
</script>`;

/** Arrow keys, the scrubber and `#?step.demo=N` come from the host; the app wrote none of it. */
export const SteppedApp: Story = {
  args: { source: STEPPED, meta: 'id=demo controls=host caption="The fencing token is what makes the late write harmless."' },
};

/** A kiwi-app and a typed fence on one clock advance together. */
export const SharedClock: Story = {
  render: () => (
    <StoryMarkdown>{[
      "```kiwi-app clock=c controls=host",
      STEPPED,
      "```",
      "",
      "```array clock=c",
      "values: [41, 41, 42, 41, 42]",
      "steps:",
      "  - { activeIndices: [0], note: A holds 41 }",
      "  - { activeIndices: [1], note: A paused }",
      "  - { activeIndices: [2], note: B takes 42 }",
      "  - { activeIndices: [3], note: A writes 41 }",
      "  - { activeIndices: [4], note: 42 wins }",
      "```",
    ].join("\n")}</StoryMarkdown>
  ),
};

/** The regression the srcdoc-once design exists for: a theme toggle must not reload the app. */
export const ThemeSurvivesToggle: Story = {
  args: { source: STEPPED, meta: "id=toggle controls=host" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const forward = await canvas.findByTitle("Step forward (→)", {}, { timeout: 8000 });
    await userEvent.click(forward);
    await userEvent.click(forward);
    await canvas.findByLabelText(/^Step 3 of 5$/);
    const iframe = canvasElement.querySelector("iframe");

    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark");
    try {
      await new Promise((r) => setTimeout(r, 200));
      await expect(canvasElement.querySelector("iframe")).toBe(iframe);
      await expect(canvas.getByLabelText(/^Step 3 of 5$/)).toBeTruthy();
    } finally {
      root.classList.toggle("dark", wasDark);
    }
  },
};

const SMALL = `<div class="k-app k-ctl"><span class="k-pill info">chrome</span> The frame around this app.</div>`;

export const ChromeVariants: Story = {
  render: () => (
    <div className="space-y-6">
      <KiwiApp source={SMALL} meta='chrome=full title="chrome=full shows a bar with the title"' />
      <KiwiApp source={SMALL} meta='caption="chrome=minimal (the default): a frame, and Copy HTML on hover"' />
      <KiwiApp source={SMALL} meta='chrome=none caption="chrome=none: no frame, the app sits on the page"' />
      <KiwiApp source={SMALL} meta='width=wide caption="width=wide, as for every other figure"' />
    </div>
  ),
};

/** `kit=off` and the author's own CSS: the runtime is still there, the look is entirely theirs. */
export const KitOff: Story = {
  args: {
    meta: "kit=off",
    source: `<style>
  body { margin: 0; font: 15px/1.4 Georgia, serif; }
  .own { padding: 20px; border-left: 4px solid currentColor; }
</style>
<div class="own">No kit here. <span class="k-pill ok">k-pill</span> renders as plain text.</div>`,
  },
};

const EXTERNAL = `<div class="k-app">
  <div class="k-eyebrow">Loaded with src=</div>
  <p class="k-lede">This HTML lives in <code>guides/apps/demo.html</code>, next to the page.</p>
</div>`;

export const ExternalSrc: Story = {
  args: { source: "Loading the demo app…", meta: "src=apps/demo.html", pagePath: "guides/queue.md" },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileContents: { "guides/apps/demo.html": EXTERNAL } }}>
        <Story />
      </MockApiProvider>
    ),
  ],
};

export const ExternalSrcMissing: Story = {
  args: { source: "The demo app could not be loaded.", meta: "src=apps/missing.html", pagePath: "guides/queue.md" },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ fileStatus: 404 }}>
        <Story />
      </MockApiProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("guides/apps/missing.html"));
  },
};

export const FixedHeight: Story = {
  args: {
    source: `<div class="k-app">
  <div class="k-eyebrow">height=200</div>
  <p class="k-lede">A fixed-height app does not size itself to its content.</p>
</div>`,
    meta: "height=200",
  },
};

// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";
import { Window as HappyWindow } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KiwiApp } from "./KiwiApp";
import { KIWI_APP_TOKENS, type HostTheme } from "./kiwiApp/hostTheme";
import { parseAppMeta, resolveAppSrc } from "./kiwiApp/meta";
import { buildSrcDoc, kitCss, runtimeJs } from "./kiwiApp/srcdoc";
import { applyKiwiTheme, removeKiwiTheme } from "@kw/lib/kiwiTheme";
import { resetClocks } from "@kw/widgets/playbackClock";
import { PLAYBACK_KEYS } from "@kw/widgets/usePlayback";

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("@kw/lib/api", () => ({ api: { readFile } }));

const LIGHT: HostTheme = { vars: { "--background": "white" }, dark: false };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetClocks();
  window.location.hash = "";
  document.documentElement.classList.remove("dark");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetClocks();
  window.location.hash = "";
  vi.useRealTimers();
  readFile.mockReset();
});

async function render(el: React.ReactElement) {
  await act(async () => root.render(el));
  const iframe = container.querySelector("iframe")!;
  const posted: Record<string, unknown>[] = [];
  const win = iframe.contentWindow!;
  vi.spyOn(win, "postMessage").mockImplementation(((msg: Record<string, unknown>) => {
    posted.push(msg);
  }) as typeof win.postMessage);
  return { iframe, win, posted };
}

async function fromApp(source: unknown, data: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { source: "kiwi-app", v: 1, ...data }, source: source as Window }),
    );
  });
}

async function nextFrame() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
}

describe("KiwiApp theme", () => {
  it("keeps the iframe and its srcdoc when the theme toggles, and posts the new tokens", async () => {
    const { iframe, posted } = await render(<KiwiApp source="<p>hi</p>" />);
    const before = iframe.getAttribute("srcdoc");

    document.documentElement.classList.add("dark");
    await nextFrame();

    expect(container.querySelector("iframe")).toBe(iframe);
    expect(iframe.getAttribute("srcdoc")).toBe(before);
    const theme = posted.find((m) => m.type === "theme");
    expect(theme).toMatchObject({ source: "kiwi-app", v: 1, dark: true });
  });

  it("forwards every --kw-widget-* token declared in kiwi-theme.css", () => {
    const css = readFileSync(path.join(__dirname, "../styles/kiwi-theme.css"), "utf8");
    const declared = new Set([...css.matchAll(/(--kw-widget-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    expect(declared.size).toBeGreaterThan(10);
    for (const name of declared) expect(KIWI_APP_TOKENS).toContain(name);
    for (const name of ["--radius", "--font-sans", "--font-mono", "--destructive", "--ring"]) {
      expect(KIWI_APP_TOKENS).toContain(name);
    }
  });

  it("no longer hard-codes a body background", () => {
    const doc = buildSrcDoc("<p>x</p>", { kit: true, theme: LIGHT });
    expect(doc).toMatch(/body\{[^}]*background:var\(--k-bg\)/);
    expect(doc).not.toContain("#1a1a2e");
  });

  it("posts one theme message a frame after applyKiwiTheme", async () => {
    const { posted } = await render(<KiwiApp source="<p>hi</p>" />);
    await nextFrame();
    posted.length = 0;
    try {
      applyKiwiTheme({ light: { background: "hsl(10 50% 50%)" } });
      expect(posted.filter((m) => m.type === "theme")).toHaveLength(0);
      await nextFrame();
      const themes = posted.filter((m) => m.type === "theme");
      expect(themes).toHaveLength(1);
      expect((themes[0]!.vars as Record<string, string>)["--background"]).toBe("hsl(10 50% 50%)");
    } finally {
      removeKiwiTheme();
    }
  });

  it("coalesces several .dark toggles within a frame into one message", async () => {
    const { posted } = await render(<KiwiApp source="<p>hi</p>" />);
    await nextFrame();
    posted.length = 0;
    const cls = document.documentElement.classList;
    cls.add("dark");
    cls.remove("dark");
    cls.add("dark");
    await nextFrame();
    const themes = posted.filter((m) => m.type === "theme");
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ dark: true });
  });
});

describe("buildSrcDoc", () => {
  const author = "<html><head><style>.mine{color:red}</style></head><body><p class=mine>x</p></body></html>";

  it("puts the runtime, theme and kit ahead of the author's head", () => {
    const doc = buildSrcDoc(author, { kit: true, theme: LIGHT });
    const runtime = doc.indexOf("data-kiwi-runtime");
    const theme = doc.indexOf("data-kiwi-theme");
    const kit = doc.indexOf("data-kiwi-kit");
    const mine = doc.indexOf(".mine{color:red}");
    expect(runtime).toBeGreaterThan(-1);
    expect(runtime).toBeLessThan(theme);
    expect(theme).toBeLessThan(kit);
    expect(kit).toBeLessThan(mine);
    expect(doc).toContain("@layer kiwi-kit");
  });

  it("omits the kit with kit=off but keeps the runtime", () => {
    const doc = buildSrcDoc(author, { kit: false, theme: LIGHT });
    expect(doc).not.toContain("data-kiwi-kit");
    expect(doc).not.toContain("@layer kiwi-kit");
    expect(doc).toContain("data-kiwi-runtime");
  });

  it("wraps a fragment and adds a head to an <html> with none", () => {
    expect(buildSrcDoc("<p>x</p>", { kit: true, theme: LIGHT })).toMatch(/^<!DOCTYPE html>/);
    const doc = buildSrcDoc("<html><body>x</body></html>", { kit: true, theme: LIGHT });
    expect(doc.indexOf("<head>")).toBeLessThan(doc.indexOf("<body>"));
  });

  it("keeps `$&` in author HTML literal", () => {
    expect(buildSrcDoc("<head></head><p>$&$1</p>", { kit: false, theme: LIGHT })).toContain("<p>$&$1</p>");
  });

  it("keeps the kit small and every class k- prefixed", () => {
    expect(kitCss.length).toBeLessThan(6 * 1024);
    const rules = kitCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const classes = [...rules.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!);
    const tops = classes.filter((c) => !["ok", "bad", "warn", "info", "muted", "violet", "primary", "on", "now", "good", "dead", "paused", "node", "edge", "label", "dim", "hot"].includes(c));
    for (const c of tops) expect(c.startsWith("k-"), c).toBe(true);
  });
});

describe("runtime.js", () => {
  it("parses as plain script", () => {
    expect(() => new Function(runtimeJs)).not.toThrow();
  });

  it("uses no ES2015+ syntax", () => {
    expect(() => parse(runtimeJs, { ecmaVersion: 5 })).not.toThrow();
  });
});

/** Run the runtime in a window of its own, under a stub parent unless standalone. */
function bootRuntime({ standalone = false } = {}) {
  const win = new HappyWindow();
  const toParent: Record<string, unknown>[] = [];
  const parent = { postMessage: (msg: Record<string, unknown>) => toParent.push(msg) };
  if (!standalone) Object.defineProperty(win, "parent", { value: parent, configurable: true });
  new Function("window", "document", "ResizeObserver", runtimeJs)(win, win.document, undefined);
  const kiwi = (win as unknown as { kiwi: Record<string, (...a: unknown[]) => unknown> & { step: number } }).kiwi;
  const send = (data: Record<string, unknown>, source: unknown = parent) =>
    win.dispatchEvent(
      new win.MessageEvent("message", { data: { source: "kiwi-app", v: 1, ...data }, source: source as never }),
    );
  const key = (k: string, target: EventTarget = win.document.body as unknown as EventTarget) =>
    target.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }) as unknown as Event);
  const sent = (type: string) => toParent.filter((m) => m.type === type);
  return { win, kiwi, send, key, sent };
}

describe("runtime.js in its own window", () => {
  it("applies a theme from the parent", () => {
    const { win, kiwi, send } = bootRuntime();
    send({ type: "theme", vars: { "--background": "red" }, dark: true });
    expect(win.document.querySelector("style[data-kiwi-theme]")?.textContent).toContain("--background: red;");
    expect(win.document.documentElement.classList.contains("dark")).toBe(true);
    expect(kiwi.theme).toEqual({ vars: { "--background": "red" }, dark: true });
  });

  it("ignores messages whose source is not the parent", () => {
    const { win, kiwi, send } = bootRuntime();
    send({ type: "theme", vars: { "--background": "red" }, dark: true }, win);
    send({ type: "theme", vars: { "--background": "red" }, dark: true }, { postMessage() {} });
    expect(win.document.querySelector("style[data-kiwi-theme]")).toBeNull();
    expect(win.document.documentElement.classList.contains("dark")).toBe(false);
    expect(kiwi.theme).toEqual({ vars: {}, dark: false });
  });

  it("forwards the playback keys once steps exist, but not while an input has focus", () => {
    const { win, kiwi, key, sent } = bootRuntime();
    key("ArrowRight");
    expect(sent("key")).toHaveLength(0);

    kiwi.steps({ count: 3 });
    for (const k of PLAYBACK_KEYS) key(k);
    expect(sent("key").map((m) => m.key)).toEqual([...PLAYBACK_KEYS]);

    const input = win.document.createElement("input");
    win.document.body.appendChild(input);
    input.focus();
    key("ArrowRight", input as unknown as EventTarget);
    key(" ", input as unknown as EventTarget);
    expect(sent("key")).toHaveLength(PLAYBACK_KEYS.length);
  });

  it("waits for the host's steps:set before rendering a step", () => {
    const { kiwi, send, sent } = bootRuntime();
    const onStep = vi.fn();
    kiwi.steps({ count: 5, labels: "not an array", durations: { 0: 1 }, onStep });
    expect(sent("steps:register")[0]).toMatchObject({ count: 5, labels: null, durations: null });
    expect(onStep).not.toHaveBeenCalled();

    send({ type: "steps:set", index: Number.NaN });
    send({ type: "steps:set", index: Infinity });
    expect(onStep).not.toHaveBeenCalled();

    send({ type: "steps:set", index: 3 });
    expect(onStep).toHaveBeenCalledExactlyOnceWith(3);
    expect(kiwi.step).toBe(3);
  });

  it("measures a body that overflows a root pinned to the frame", () => {
    const { win, kiwi, sent } = bootRuntime();
    const body = win.document.body;
    body.style.margin = "8px 0 12px";
    win.document.documentElement.getBoundingClientRect = () => ({ height: 300 }) as never;
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 900 });
    kiwi.resize();
    expect(sent("resize").at(-1)).toMatchObject({ height: 920 });

    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 100 });
    kiwi.resize();
    expect(sent("resize").at(-1)).toMatchObject({ height: 300 });
  });

  it("steps locally when opened on its own", () => {
    const { kiwi } = bootRuntime({ standalone: true });
    const onStep = vi.fn();
    kiwi.steps({ count: 3, onStep });
    expect(onStep).toHaveBeenLastCalledWith(0);
    kiwi.next();
    expect(onStep).toHaveBeenLastCalledWith(1);
  });
});

describe("parseAppMeta", () => {
  it("reads height=", () => {
    expect(parseAppMeta("height=400").height).toBe(400);
    expect(parseAppMeta("").height).toBeUndefined();
  });

  it('still reads the legacy meta="height=…" form', () => {
    expect(parseAppMeta('meta="height=300"').height).toBe(300);
  });

  it("reads chrome, kit, controls and src", () => {
    const m = parseAppMeta("chrome=none kit=off controls=host src=apps/a.html");
    expect(m).toMatchObject({ chrome: "none", kit: false, hostControls: true, src: "apps/a.html" });
    expect(parseAppMeta("").chrome).toBe("minimal");
    expect(parseAppMeta("chrome=bogus").chrome).toBe("minimal");
    expect(parseAppMeta("").kit).toBe(true);
  });

  it("shares the typed fence options", () => {
    const m = parseAppMeta('id=lease width=wide title="Lease" caption="A lease, outlived" autoplay loop');
    expect(m).toMatchObject({ id: "lease", clock: "lease", width: "wide", title: "Lease", caption: "A lease, outlived", autoplay: true, loop: true });
    expect(parseAppMeta("id=a clock=b").clock).toBe("b");
  });

  it("resolves src= against the page folder", () => {
    expect(resolveAppSrc("guides/queue.md", "apps/lease.html")).toBe("guides/apps/lease.html");
    expect(resolveAppSrc("guides/queue.md", "../shared/a.html")).toBe("shared/a.html");
    expect(resolveAppSrc("guides/queue.md", "/apps/a.html")).toBe("apps/a.html");
    expect(resolveAppSrc(undefined, "a.html")).toBe("a.html");
  });

  it("refuses a src= that climbs above the workspace root", () => {
    expect(resolveAppSrc("guides/queue.md", "../../a.html")).toBeNull();
    expect(resolveAppSrc("queue.md", "../a.html")).toBeNull();
    expect(resolveAppSrc("guides/queue.md", "/../a.html")).toBeNull();
    expect(resolveAppSrc("guides/queue.md", "apps/../../../a.html")).toBeNull();
    expect(resolveAppSrc("guides/queue.md", "..")).toBeNull();
  });
});

describe("KiwiApp src=", () => {
  const meta = "src=apps/a.html";
  const page = "guides/queue.md";

  it("shows the fence body while the file loads", async () => {
    readFile.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<KiwiApp source="Loading fallback" meta={meta} pagePath={page} />));
    expect(readFile).toHaveBeenCalledWith("guides/apps/a.html");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[aria-busy]")?.textContent).toContain("Loading fallback");
  });

  it("renders the file in the iframe once it loads", async () => {
    readFile.mockResolvedValue({ content: "<p>from the file</p>" });
    await act(async () => root.render(<KiwiApp source="Loading fallback" meta={meta} pagePath={page} />));
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("srcdoc")).toContain("<p>from the file</p>");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows an error card with the resolved path when the file is missing", async () => {
    readFile.mockRejectedValue(new Error("not found"));
    await act(async () => root.render(<KiwiApp source="Loading fallback" meta={meta} pagePath={page} />));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("guides/apps/a.html");
    expect(alert?.textContent).toContain("not found");
    expect(alert?.textContent).toContain("Loading fallback");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("shows the error card, without reading anything, for a path above the root", async () => {
    await act(async () => root.render(<KiwiApp source="<p>body</p>" meta="src=../../x.html" pagePath={page} />));
    expect(readFile).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("../../x.html");
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("KiwiApp rendering", () => {
  it("renders figure chrome from meta", async () => {
    await render(<KiwiApp source="<p>x</p>" meta='chrome=none width=wide caption="Cap" id=x' />);
    const fig = container.querySelector("figure.kiwi-app")!;
    expect(fig.className).toContain("kiwi-figure-wide");
    expect(fig.id).toBe("x");
    expect(fig.querySelector("figcaption")?.textContent).toBe("Cap");
    expect(fig.querySelector(".border")).toBeNull();
  });

  it("shows the title in the full chrome bar", async () => {
    await render(<KiwiApp source="<p>x</p>" meta='chrome=full title="Lease timeline"' />);
    expect(container.textContent).toContain("Lease timeline");
  });

  it("ignores messages from any window but its own iframe", async () => {
    const { iframe, win } = await render(<KiwiApp source="<p>x</p>" />);
    const start = iframe.style.height;
    await fromApp(window, { type: "resize", height: 900 });
    expect(iframe.style.height).toBe(start);
    await fromApp(win, { type: "resize", height: 900 });
    expect(iframe.style.height).toBe("900px");
  });

  it("ignores messages without the protocol envelope", async () => {
    const { iframe, win } = await render(<KiwiApp source="<p>x</p>" />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "resize", height: 777 }, source: win }));
    });
    expect(iframe.style.height).not.toBe("777px");
  });

  it("drives registered steps from the host", async () => {
    const { win, posted } = await render(<KiwiApp source="<p>x</p>" meta="id=demo controls=host" />);
    await fromApp(win, { type: "steps:register", count: 5, labels: ["a", "b", "c", "d", "e"] });
    expect(posted.filter((m) => m.type === "steps:set").at(-1)).toMatchObject({ index: 0 });

    await fromApp(win, { type: "steps:next" });
    expect(posted.filter((m) => m.type === "steps:set").at(-1)).toMatchObject({ index: 1 });

    await fromApp(win, { type: "key", key: "End" });
    expect(posted.filter((m) => m.type === "steps:set").at(-1)).toMatchObject({ index: 4 });

    await fromApp(win, { type: "key", key: "ArrowLeft" });
    expect(posted.filter((m) => m.type === "steps:set").at(-1)).toMatchObject({ index: 3 });

    // controls=host puts the transport under the app.
    expect(container.querySelector("figure.kiwi-app button[aria-label]")).not.toBeNull();
  });

  it("shows no host transport without controls=host", async () => {
    const { win } = await render(<KiwiApp source="<p>x</p>" meta="id=bare" />);
    await fromApp(win, { type: "steps:register", count: 5 });
    expect(container.querySelector("figure.kiwi-app button[aria-label]")).toBeNull();
  });

  it("ignores non-finite numbers from the app", async () => {
    const { iframe, win, posted } = await render(<KiwiApp source="<p>x</p>" meta="id=finite" />);
    await fromApp(win, { type: "steps:register", count: 5, durations: [Infinity, Number.NaN, 200] });
    await fromApp(win, { type: "steps:seek", index: 2 });
    await fromApp(win, { type: "steps:seek", index: Number.NaN });
    await fromApp(win, { type: "steps:seek", index: Infinity });
    await fromApp(win, { type: "steps:seek", index: "3" });
    expect(posted.filter((m) => m.type === "steps:set").at(-1)).toMatchObject({ index: 2 });

    const start = iframe.style.height;
    await fromApp(win, { type: "resize", height: Infinity });
    await fromApp(win, { type: "resize", height: Number.NaN });
    expect(iframe.style.height).toBe(start);
  });

  it("answers the same playback keys usePlayback does", async () => {
    const { win, posted } = await render(<KiwiApp source="<p>x</p>" meta="id=keys" />);
    await fromApp(win, { type: "steps:register", count: 5 });
    const last = () => posted.filter((m) => m.type === "steps:set").at(-1);
    await fromApp(win, { type: "key", key: "End" });
    expect(last()).toMatchObject({ index: 4 });
    await fromApp(win, { type: "key", key: "Home" });
    expect(last()).toMatchObject({ index: 0 });
    await fromApp(win, { type: "key", key: "ArrowRight" });
    await fromApp(win, { type: "key", key: "ArrowRight" });
    expect(last()).toMatchObject({ index: 2 });
    await fromApp(win, { type: "key", key: "r" });
    expect(last()).toMatchObject({ index: 0 });
  });

  it("starts at the deep-linked step", async () => {
    window.location.hash = "#?step.deep=3";
    const { win, posted } = await render(<KiwiApp source="<p>x</p>" meta="id=deep" />);
    await fromApp(win, { type: "steps:register", count: 6 });
    expect(posted.filter((m) => m.type === "steps:set").at(-1)).toMatchObject({ index: 3 });
  });
});

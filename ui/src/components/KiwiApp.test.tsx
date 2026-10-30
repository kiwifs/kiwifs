// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KiwiApp } from "./KiwiApp";
import { KIWI_APP_TOKENS, type HostTheme } from "./kiwiApp/hostTheme";
import { parseAppMeta, resolveAppSrc } from "./kiwiApp/meta";
import { buildSrcDoc, kitCss, runtimeJs } from "./kiwiApp/srcdoc";
import { resetClocks } from "@kw/widgets/playbackClock";

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
    const doc = buildSrcDoc("<p>x</p>", { kit: false, theme: LIGHT });
    expect(doc).not.toContain("#1a1a2e");
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
    const code = runtimeJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(?:let|const|class)\s/);
    expect(code).not.toMatch(/=>/);
    expect(code).not.toMatch(/`/);
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

  it("starts at the deep-linked step", async () => {
    window.location.hash = "#?step.deep=3";
    const { win, posted } = await render(<KiwiApp source="<p>x</p>" meta="id=deep" />);
    await fromApp(win, { type: "steps:register", count: 6 });
    expect(posted.filter((m) => m.type === "steps:set").at(-1)).toMatchObject({ index: 3 });
  });
});

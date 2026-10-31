import { afterEach, describe, expect, it, vi } from "vitest";
import { eventTouchesPath, subscribeFileEvents } from "./useSSE";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((msg: { type: string; data: string }) => void)[]>();
  closed = false;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (msg: { type: string; data: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  emit(name: string, data: object) {
    this.listeners.get(name)?.forEach((fn) => fn({ type: name, data: JSON.stringify(data) }));
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});

describe("subscribeFileEvents", () => {
  it("shares one connection and closes it after the last subscriber leaves", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeFileEvents(a);
    const offB = subscribeFileEvents(b);
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].emit("write", { op: "write", path: "a.md", etag: "e1" });
    expect(a).toHaveBeenCalledWith({ op: "write", path: "a.md", etag: "e1" });
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    expect(FakeEventSource.instances[0].closed).toBe(false);
    offB();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("listens for the named events the server sends", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const seen = vi.fn();
    const off = subscribeFileEvents(seen);
    FakeEventSource.instances[0].emit("delete", { path: "gone.md" });
    expect(seen).toHaveBeenCalledWith({ op: "delete", path: "gone.md" });
    off();
  });
});

describe("eventTouchesPath", () => {
  it("matches single-file and bulk events, ignoring a leading slash", () => {
    expect(eventTouchesPath({ op: "write", path: "/notes/a.md" }, "notes/a.md")).toBe(true);
    expect(eventTouchesPath({ op: "bulk", paths: ["x.md", "notes/a.md"] }, "notes/a.md")).toBe(true);
    expect(eventTouchesPath({ op: "write", path: "notes/b.md" }, "notes/a.md")).toBe(false);
  });
});

import { useEffect, useRef } from "react";
import { sseUrl } from "./api";

/** A server event, as `internal/events.Event` serializes it. */
export type SSEEvent = {
  op: string;
  path?: string;
  paths?: string[];
  actor?: string;
  etag?: string;
};

/** The file-change events, sent as named SSE events (`event: write`). */
export const FILE_EVENTS = ["write", "delete", "bulk"] as const;

type Connection = { source: EventSource; listeners: Set<(e: SSEEvent) => void> };
const connections = new Map<string, Connection>();

/**
 * Listen for file-change events. Subscribers share one EventSource per
 * space, since browsers cap connections per origin and the server caps
 * subscribers; it closes when the last one leaves.
 */
export function subscribeFileEvents(onEvent: (e: SSEEvent) => void): () => void {
  const url = sseUrl();
  let conn = connections.get(url);
  if (!conn) {
    const source = new EventSource(url);
    const listeners = new Set<(e: SSEEvent) => void>();
    const dispatch = (msg: MessageEvent) => {
      let data: SSEEvent;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (!data.op) data.op = msg.type;
      listeners.forEach((l) => l(data));
    };
    FILE_EVENTS.forEach((name) => source.addEventListener(name, dispatch as EventListener));
    // EventSource reconnects on its own; nothing to do on a dropped stream.
    source.onerror = () => {};
    conn = { source, listeners };
    connections.set(url, conn);
  }
  conn.listeners.add(onEvent);
  const current = conn;
  return () => {
    current.listeners.delete(onEvent);
    if (current.listeners.size === 0) {
      current.source.close();
      connections.delete(url);
    }
  };
}

/** Whether a file event concerns `path`. */
export function eventTouchesPath(event: SSEEvent, path: string): boolean {
  const norm = (p: string) => p.replace(/^\/+/, "");
  const target = norm(path);
  if (event.path !== undefined && norm(event.path) === target) return true;
  return event.paths?.some((p) => norm(p) === target) ?? false;
}

/** `subscribeFileEvents` for a component; the latest callback always runs. */
export function useSSE(onEvent: (e: SSEEvent) => void, enabled = true) {
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribeFileEvents((e) => latest.current(e));
  }, [enabled]);
}

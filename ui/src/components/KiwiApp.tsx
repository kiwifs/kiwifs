/**
 * KiwiApp — sandboxed HTML/CSS/JS from ```kiwi-app fences.
 *
 * The iframe runs with `sandbox="allow-scripts"` only: no same-origin, so the
 * app cannot reach the page, its cookies or the API. Everything it gets from
 * the host arrives as a message, and every message it sends is checked against
 * the iframe's own window.
 *
 * Into every app goes the `kiwi` runtime (resize, theme, steps, key
 * forwarding) and, unless `kit=off`, the kit stylesheet. The srcdoc is built
 * once per source: a theme change is posted to the running app, never baked
 * into a new srcdoc, so a reader on step 7 stays on step 7.
 *
 * ````markdown
 * ```kiwi-app id=lease width=wide caption="A lease outliving its holder"
 * <div class="k-app">…</div>
 * <script>kiwi.steps({ count: 5, onStep: render })</script>
 * ```
 * ````
 *
 * See docs/APPS.md for the meta options, the kit classes and the runtime API.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@kw/lib/api";
import { figureClassName } from "@kw/lib/figureLayout";
import { playbackKeyAction, usePlayback, type Step } from "@kw/widgets/usePlayback";
import { PlaybackControls } from "@kw/widgets/PlaybackControls";
import { currentHostTheme, readHostTheme, subscribeHostTheme, type HostTheme } from "./kiwiApp/hostTheme";
import { buildSrcDoc } from "./kiwiApp/srcdoc";
import { parseAppMeta, resolveAppSrc } from "./kiwiApp/meta";

interface KiwiAppProps {
  source: string;
  meta?: string;
  /** The page this fence sits on; `src=` resolves against its folder. */
  pagePath?: string;
  onNavigate?: (path: string) => void;
}

const PROTOCOL = 1;
const STATIC_STEPS: Step<number>[] = [{ state: 0, label: "" }];
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 6000;

interface StepsRegistration {
  count: number;
  labels: string[] | null;
  durations: (number | null)[] | null;
}

type RemoteFile =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; content: string }
  | { status: "error"; message: string };

function useAppFile(path: string | null): RemoteFile {
  const [state, setState] = useState<RemoteFile & { path?: string | null }>({ status: "idle" });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({ status: "loading", path });
    api.readFile(path).then(
      ({ content }) => live && setState({ status: "ok", content, path }),
      (err: unknown) =>
        live && setState({ status: "error", message: err instanceof Error ? err.message : String(err), path }),
    );
    return () => {
      live = false;
    };
  }, [path]);
  if (!path) return { status: "idle" };
  return state.path === path ? state : { status: "loading" };
}

function readRegistration(d: Record<string, unknown>): StepsRegistration | null {
  const count = Math.floor(Number(d.count));
  if (!Number.isFinite(count) || count < 1) return null;
  const capped = Math.min(count, 10_000);
  return {
    count: capped,
    labels: Array.isArray(d.labels) ? d.labels.slice(0, capped).map((l) => String(l ?? "")) : null,
    durations: Array.isArray(d.durations)
      ? d.durations.slice(0, capped).map((n) => (Number.isFinite(n) && (n as number) > 0 ? (n as number) : null))
      : null,
  };
}

export function KiwiApp({ source, meta, pagePath }: KiwiAppProps) {
  const opts = useMemo(() => parseAppMeta(meta), [meta]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [registration, setRegistration] = useState<StepsRegistration | null>(null);

  const srcPath = opts.src ? resolveAppSrc(pagePath, opts.src) : null;
  const remote = useAppFile(srcPath);
  const html = opts.src ? (remote.status === "ok" ? remote.content : null) : source;
  const srcError =
    opts.src && !srcPath ? "the path leads outside the workspace" : remote.status === "error" ? remote.message : null;

  // Deliberately keyed on the HTML and the kit flag alone. The theme is read
  // for first paint and then travels by message.
  const srcDoc = useMemo(
    () => (html == null ? null : buildSrcDoc(html, { kit: opts.kit, theme: currentHostTheme() })),
    [html, opts.kit],
  );

  useEffect(() => {
    setLoaded(false);
    setRegistration(null);
  }, [srcDoc]);

  const steps = useMemo<Step<number>[]>(() => {
    if (!registration) return STATIC_STEPS;
    return Array.from({ length: registration.count }, (_, i) => ({
      state: i,
      label: registration.labels?.[i] || `Step ${i + 1}`,
      duration: registration.durations?.[i] ?? undefined,
    }));
  }, [registration]);

  const pb = usePlayback(steps, {
    containerRef: figureRef,
    // Until the app registers steps there is nothing to own a `#?step=` key.
    clock: registration ? opts.clock : null,
    autoPlay: opts.autoplay && registration != null,
    loop: opts.loop,
  });
  const pbRef = useRef(pb);
  pbRef.current = pb;

  const post = useCallback((type: string, data: Record<string, unknown> = {}) => {
    iframeRef.current?.contentWindow?.postMessage({ source: "kiwi-app", v: PROTOCOL, type, ...data }, "*");
  }, []);

  const postTheme = useCallback((theme: HostTheme) => post("theme", { vars: theme.vars, dark: theme.dark }), [post]);
  // The page-wide reading says something changed; each app re-reads where it sits.
  const postOwnTheme = useCallback(() => postTheme(readHostTheme(figureRef.current)), [postTheme]);

  useEffect(() => subscribeHostTheme(postOwnTheme), [postOwnTheme]);

  useEffect(() => {
    if (registration) post("steps:set", { index: pb.currentStep });
  }, [registration, pb.currentStep, post]);

  const fixedHeight = opts.height;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const d = event.data as Record<string, unknown> | null;
      if (!d || typeof d !== "object" || d.source !== "kiwi-app" || d.v !== PROTOCOL) return;
      const p = pbRef.current;
      switch (d.type) {
        case "resize":
          if (!fixedHeight && Number.isFinite(d.height)) {
            setMeasured(Math.max(MIN_HEIGHT, Math.min(Math.ceil(d.height as number), MAX_HEIGHT)));
          }
          break;
        case "ready":
          setLoaded(true);
          break;
        case "steps:register": {
          const reg = readRegistration(d);
          if (reg) setRegistration(reg);
          break;
        }
        case "steps:next":
          p.stepForward();
          break;
        case "steps:prev":
          p.stepBack();
          break;
        case "steps:seek":
          if (Number.isFinite(d.index)) p.setCurrentStep(Math.floor(d.index as number));
          break;
        case "steps:reset":
          p.reset();
          break;
        case "steps:play":
          p.play();
          break;
        case "steps:pause":
          p.stop();
          break;
        case "key":
          playbackKeyAction(String(d.key), p.clockId);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fixedHeight]);

  const onLoad = useCallback(() => {
    setLoaded(true);
    // The theme may have changed between building the srcdoc and the load,
    // and the srcdoc was built before the figure existed to read it from.
    postOwnTheme();
  }, [postOwnTheme]);

  const copySource = useCallback(async () => {
    const text = html ?? source;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [html, source]);

  const label = opts.title || "Interactive app";
  const framed = opts.chrome !== "none";
  const height = fixedHeight ?? measured ?? 160;
  const fallbackText = source.trim();

  let body: ReactNode;
  if (srcError != null) {
    body = (
      <div className="kiwi-app-error px-4 py-3 text-sm" role="alert">
        <div className="font-medium text-destructive">Could not load app</div>
        <div className="mt-1 text-xs text-muted-foreground">
          <code className="font-mono">{srcPath ?? opts.src}</code> — {srcError}
        </div>
        {fallbackText && <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{fallbackText}</p>}
      </div>
    );
  } else if (srcDoc == null) {
    body = (
      <div className="px-4 py-3 text-sm text-muted-foreground" aria-busy="true">
        {fallbackText || <div className="h-24 animate-pulse rounded bg-muted" />}
      </div>
    );
  } else {
    body = (
      <div className="relative">
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          onLoad={onLoad}
          style={{ width: "100%", height, border: "none", display: "block" }}
          title={label}
        />
        {!loaded && <div className="absolute inset-0 animate-pulse bg-muted/60" aria-hidden />}
      </div>
    );
  }

  const copyButton = (
    <button
      type="button"
      onClick={copySource}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
      title="Copy source HTML"
    >
      {copied ? "Copied!" : "Copy HTML"}
    </button>
  );

  return (
    <figure
      ref={figureRef}
      className={`kiwi-app not-prose group relative ${figureClassName({ width: opts.width, pin: false })}`}
      id={opts.id}
      data-chrome={opts.chrome}
      data-width={opts.width}
      aria-label={opts.title || undefined}
      tabIndex={-1}
    >
      <div className={framed ? "rounded-md border border-border overflow-hidden bg-background" : undefined}>
        {opts.chrome === "full" && (
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            {copyButton}
          </div>
        )}
        {body}
        {opts.chrome === "minimal" && (
          <div className="absolute right-1.5 top-1.5 rounded bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {copyButton}
          </div>
        )}
        {opts.hostControls && registration && (
          <div className={framed ? "border-t border-border px-3 py-2" : "mt-2"}>
            <PlaybackControls pb={pb} />
          </div>
        )}
      </div>
      {opts.caption && <figcaption className="kiwi-figcaption">{opts.caption}</figcaption>}
    </figure>
  );
}

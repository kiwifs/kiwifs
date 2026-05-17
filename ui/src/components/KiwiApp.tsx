/**
 * KiwiApp — Sandboxed JavaScript execution in markdown.
 *
 * Renders HTML+CSS+JS from ```kiwi-app code blocks inside a sandboxed iframe.
 * The iframe uses `srcdoc` with `sandbox="allow-scripts"` which enables JS
 * but blocks access to the parent DOM, cookies, navigation, forms, and popups.
 *
 * Features:
 * - Auto-height via ResizeObserver + postMessage
 * - Dark mode forwarding via CSS custom properties
 * - Configurable height via code fence meta: ```kiwi-app height=400
 * - Copy source button
 * - Error boundary integration
 *
 * Markdown syntax:
 * ````markdown
 * ```kiwi-app height=500
 * <!DOCTYPE html>
 * <html>
 * <body>
 *   <h1>Hello from sandbox!</h1>
 *   <script>
 *     document.querySelector('h1').addEventListener('click', () => {
 *       alert('Clicked!');
 *     });
 *   </script>
 * </body>
 * </html>
 * ```
 * ````
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface KiwiAppProps {
  source: string;
  meta?: string;
}

/**
 * Parse optional height from code fence meta string.
 * e.g. "height=400" → 400
 */
function parseMetaHeight(meta?: string): number | null {
  if (!meta) return null;
  const match = meta.match(/height=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Read CSS custom properties from the host document for dark mode forwarding.
 */
function getThemeVars(): string {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const isDark = root.classList.contains("dark");

  // Extract common theme variables used by kiwifs
  const vars = [
    "--background",
    "--foreground",
    "--muted",
    "--muted-foreground",
    "--border",
    "--primary",
    "--primary-foreground",
    "--card",
    "--card-foreground",
    "--accent",
    "--accent-foreground",
  ];

  const cssLines: string[] = [];
  for (const v of vars) {
    const val = computed.getPropertyValue(v).trim();
    if (val) cssLines.push(`  ${v}: ${val};`);
  }

  return `
:root {
${cssLines.join("\n")}
  color-scheme: ${isDark ? "dark" : "light"};
}
body {
  background: ${isDark ? "#1a1a2e" : "#ffffff"};
  color: ${isDark ? "#e5e5e5" : "#1a1a1a"};
}
`;
}

/**
 * Build the complete srcdoc with auto-resize script and theme injection.
 */
function buildSrcDoc(source: string): string {
  const themeCSS = getThemeVars();

  // Auto-resize script: observes body size and posts height to parent
  const resizeScript = `
<script>
(function() {
  var _kiwi_ro;
  function postHeight() {
    var h = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.scrollHeight
    );
    window.parent.postMessage({ type: "kiwi-app-resize", height: h }, "*");
  }
  if (typeof ResizeObserver !== "undefined") {
    _kiwi_ro = new ResizeObserver(postHeight);
    _kiwi_ro.observe(document.body);
  }
  window.addEventListener("load", postHeight);
  // Also fire after a short delay for dynamic content
  setTimeout(postHeight, 100);
  setTimeout(postHeight, 500);
})();
</script>`;

  const themeStyle = `<style data-kiwi-theme>${themeCSS}</style>`;

  // If source already has a <head>, inject theme into it.
  // Otherwise prepend theme + resize script.
  if (/<head[\s>]/i.test(source)) {
    // Inject after <head>
    const injected = source.replace(
      /(<head[^>]*>)/i,
      `$1\n${themeStyle}`
    );
    // Append resize script before </body> or at end
    if (/<\/body>/i.test(injected)) {
      return injected.replace(/<\/body>/i, `${resizeScript}\n</body>`);
    }
    return injected + resizeScript;
  }

  // No <head> tag — wrap everything
  return `<!DOCTYPE html>
<html>
<head>${themeStyle}</head>
<body>
${source}
${resizeScript}
</body>
</html>`;
}

export function KiwiApp({ source, meta }: KiwiAppProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(parseMetaHeight(meta) || 300);
  const [copied, setCopied] = useState(false);
  const fixedHeight = parseMetaHeight(meta);

  // Listen for resize messages from the iframe
  useEffect(() => {
    if (fixedHeight) return; // Don't auto-resize if height is explicitly set

    function handleMessage(event: MessageEvent) {
      if (
        event.data &&
        event.data.type === "kiwi-app-resize" &&
        typeof event.data.height === "number"
      ) {
        // Only accept messages from our iframe
        if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
          const newHeight = Math.max(50, Math.min(event.data.height + 16, 2000));
          setHeight(newHeight);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fixedHeight]);

  const srcDoc = buildSrcDoc(source);

  const handleCopySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = source;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [source]);

  return (
    <figure className="kiwi-app not-prose my-4 relative group">
      <div className="rounded-md border border-border overflow-hidden bg-background">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">Interactive App</span>
          <button
            onClick={handleCopySource}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
            title="Copy source HTML"
          >
            {copied ? "Copied!" : "Copy HTML"}
          </button>
        </div>

        {/* Sandboxed iframe */}
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          style={{
            width: "100%",
            height: fixedHeight || height,
            border: "none",
            display: "block",
          }}
          title="Embedded kiwi-app"
        />
      </div>
    </figure>
  );
}

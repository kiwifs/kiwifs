import { markdown2typst } from "markdown2typst";
import { version as compilerVersion } from "@myriaddreamin/typst-ts-web-compiler/package.json";
import { version as rendererVersion } from "@myriaddreamin/typst-ts-renderer/package.json";

// The wasm must match the installed JS bindings exactly; an unpinned URL
// resolves to the latest release and breaks with mismatched bindgen symbols.
const CDN = "https://cdn.jsdelivr.net/npm/@myriaddreamin";

const PREAMBLE = `
#set page(paper: "us-letter", margin: (top: 1in, bottom: 1in, left: 1.25in, right: 1.25in))
#set text(size: 12pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: none)
`;

let $typst: any = null;
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if ($typst) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = await import("@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs");
    $typst = mod.$typst;
    $typst.setCompilerInitOptions({
      getModule: () =>
        `${CDN}/typst-ts-web-compiler@${compilerVersion}/pkg/typst_ts_web_compiler_bg.wasm`,
    });
    $typst.setRendererInitOptions({
      getModule: () =>
        `${CDN}/typst-ts-renderer@${rendererVersion}/pkg/typst_ts_renderer_bg.wasm`,
    });
  })();
  return initPromise;
}

const CODE_OR_WIKI_LINK =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|(!?)\[\[([^\]|\\]+)(?:\\?\|([^\]]+))?\]\]/g;

/**
 * Replace `[[target|label]]` with its label (or target) so the PDF shows link
 * text instead of raw wiki syntax. `![[embeds]]` are dropped. Code is left
 * untouched; the optional `\` handles the escaped pipe used inside tables.
 */
export function wikiLinksToText(markdown: string): string {
  return markdown.replace(CODE_OR_WIKI_LINK, (match, code, bang, target, label) => {
    if (code) return match;
    if (bang) return "";
    return (label ?? target).trim();
  });
}

export async function exportPdf(markdown: string): Promise<Uint8Array> {
  await ensureInit();
  const typstSource = PREAMBLE + markdown2typst(wikiLinksToText(markdown));
  return $typst.pdf({ mainContent: typstSource });
}

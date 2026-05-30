import { markdown2typst } from "markdown2typst";

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
        `${CDN}/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm`,
    });
    $typst.setRendererInitOptions({
      getModule: () =>
        `${CDN}/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm`,
    });
  })();
  return initPromise;
}

export async function exportPdf(markdown: string): Promise<Uint8Array> {
  await ensureInit();
  const typstSource = PREAMBLE + markdown2typst(markdown);
  return $typst.pdf({ mainContent: typstSource });
}

declare module "markdown2typst" {
  export function markdown2typst(markdown: string): string;
}

declare module "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs" {
  export const $typst: {
    setCompilerInitOptions(opts: { getModule: () => string }): void;
    setRendererInitOptions(opts: { getModule: () => string }): void;
    svg(opts: { mainContent: string }): Promise<string>;
    pdf(opts: { mainContent: string }): Promise<Uint8Array>;
  };
}

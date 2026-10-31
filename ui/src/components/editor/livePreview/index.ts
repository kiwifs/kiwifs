import type { Extension } from "@codemirror/state";
import { blocks } from "./blocks";
import { fenceRendererFacet, fenceWidgets, type FenceRenderer } from "./fenceWidgets";
import { frontmatter } from "./frontmatter";
import { headings } from "./headings";
import { hideMarks } from "./hideMarks";
import { imageResolverFacet, images } from "./images";
import { iosEditing } from "./ios";
import { links, openLinkFacet } from "./links";
import { lists } from "./lists";
import { tasks } from "./tasks";
import { trackFocus } from "./util";
import { wikiLinkFacet, wikiLinks, type WikiLinkHandlers } from "./wikiLinks";

export { WidgetPortals } from "./portals";
export type { FenceRenderer } from "./fenceWidgets";
export type { WikiLinkHandlers } from "./wikiLinks";

export type LivePreviewOptions = {
  wikiLinks?: WikiLinkHandlers;
  /** Opens a Cmd/Ctrl-clicked markdown link; defaults to a new tab. */
  openLink?: (href: string) => void;
  /** Turns an image `src` as written into a loadable URL. */
  resolveImage?: (src: string) => string | Promise<string>;
  /** Draws widget fences; without it every fence stays code. */
  fences?: FenceRenderer;
};

/**
 * Obsidian-style live preview for the markdown source editor: syntax hides
 * and content renders in place, and whatever the selection touches shows
 * its markdown again. Only decorations: the document is the file's text, so
 * saving writes back exactly what was loaded plus the user's typing.
 */
export function livePreview(options: LivePreviewOptions = {}): Extension {
  return [
    wikiLinkFacet.of(options.wikiLinks ?? {}),
    options.openLink ? openLinkFacet.of(options.openLink) : [],
    options.resolveImage ? imageResolverFacet.of(options.resolveImage) : [],
    options.fences ? fenceRendererFacet.of(options.fences) : [],
    trackFocus,
    frontmatter(),
    headings(),
    hideMarks(),
    lists(),
    tasks(),
    links(),
    wikiLinks(),
    images(),
    fenceWidgets(),
    blocks(),
    iosEditing(),
  ];
}

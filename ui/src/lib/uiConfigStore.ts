import { create } from "zustand";
import { api } from "./api";
import { DEFAULT_BRANDING, resolveBranding, type BrandingConfig } from "./branding";
import { DEFAULT_UI_TAGS, resolveUITags, type UITagsConfig } from "./frontmatterTags";
import { normalizeColorMap } from "./tagStyle";
import { DEFAULT_UI_FEATURES, resolveUIFeatures, type UIFeatureKey } from "./uiFeatures";

export const THEME_LOCKED_TOOLTIP = "Theme locked by admin";

type UIConfigState = {
  themeLocked: boolean;
  branding: BrandingConfig;
  features: Record<UIFeatureKey, boolean>;
  toolbarViews: string[] | null | undefined;
  tags: UITagsConfig;
  loaded: boolean;
  load: () => Promise<void>;
};

export const useUIConfigStore = create<UIConfigState>((set) => ({
  themeLocked: false,
  branding: DEFAULT_BRANDING,
  features: DEFAULT_UI_FEATURES,
  toolbarViews: undefined,
  tags: DEFAULT_UI_TAGS,
  loaded: false,
  load: async () => {
    try {
      const config = await api.getUIConfig();
      const tags = resolveUITags(config.tags);
      tags.colors = normalizeColorMap(tags.colors);
      set({
        themeLocked: config.themeLocked === true,
        branding: resolveBranding(config.branding ?? {}),
        features: resolveUIFeatures(config.features),
        toolbarViews: config.toolbarViews ?? null,
        tags,
        loaded: true,
      });
    } catch {
      set({
        themeLocked: false,
        branding: DEFAULT_BRANDING,
        features: DEFAULT_UI_FEATURES,
        toolbarViews: null,
        tags: DEFAULT_UI_TAGS,
        loaded: true,
      });
    }
  },
}));

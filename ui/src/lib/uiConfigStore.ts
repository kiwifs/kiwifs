import { create } from "zustand";
import { api } from "./api";
import { DEFAULT_BRANDING, resolveBranding, type BrandingConfig } from "./branding";
import { DEFAULT_UI_FEATURES, resolveUIFeatures, type UIFeatureKey } from "./uiFeatures";

export const THEME_LOCKED_TOOLTIP = "Theme locked by admin";

type UIConfigState = {
  themeLocked: boolean;
  branding: BrandingConfig;
  features: Record<UIFeatureKey, boolean>;
  loaded: boolean;
  load: () => Promise<void>;
};

export const useUIConfigStore = create<UIConfigState>((set) => ({
  themeLocked: false,
  branding: DEFAULT_BRANDING,
  features: DEFAULT_UI_FEATURES,
  loaded: false,
  load: async () => {
    try {
      const config = await api.getUIConfig();
      set({
        themeLocked: config.themeLocked === true,
        branding: resolveBranding(config.branding ?? {}),
        features: resolveUIFeatures(config.features),
        loaded: true,
      });
    } catch {
      set({
        themeLocked: false,
        branding: DEFAULT_BRANDING,
        features: DEFAULT_UI_FEATURES,
        loaded: true,
      });
    }
  },
}));

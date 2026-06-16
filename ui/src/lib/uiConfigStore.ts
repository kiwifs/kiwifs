import { create } from "zustand";
import { api } from "./api";

export const THEME_LOCKED_TOOLTIP = "Theme locked by admin";

type UIConfigState = {
  themeLocked: boolean;
  loaded: boolean;
  load: () => Promise<void>;
};

export const useUIConfigStore = create<UIConfigState>((set) => ({
  themeLocked: false,
  loaded: false,
  load: async () => {
    try {
      const config = await api.getUIConfig();
      set({ themeLocked: config.themeLocked === true, loaded: true });
    } catch {
      set({ themeLocked: false, loaded: true });
    }
  },
}));

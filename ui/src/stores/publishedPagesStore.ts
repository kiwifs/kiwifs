import { create } from "zustand";
import { api, type PublishedPage } from "../lib/api";

type PublishedPagesState = {
  pages: PublishedPage[];
  showList: boolean;
  refresh: () => Promise<void>;
  toggleShowList: () => void;
};

const readInitialShowList = () => {
  try {
    return localStorage.getItem("kiwifs-show-published-list") !== "0";
  } catch {
    return true;
  }
};

export const usePublishedPagesStore = create<PublishedPagesState>((set) => ({
  pages: [],
  showList: readInitialShowList(),
  refresh: async () => {
    try {
      const resp = await api.publishedPages();
      set({ pages: resp.pages || [] });
    } catch {
      set({ pages: [] });
    }
  },
  toggleShowList: () => {
    set((state) => {
      const showList = !state.showList;
      try {
        localStorage.setItem("kiwifs-show-published-list", showList ? "1" : "0");
      } catch {}
      return { showList };
    });
  },
}));

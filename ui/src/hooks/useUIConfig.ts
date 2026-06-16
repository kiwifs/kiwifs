import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { DEFAULT_SIDEBAR_CONFIG, type SidebarConfig } from "../lib/sidebarStructure";

export type UIConfigState = {
  themeLocked: boolean;
  startPage: string;
  sidebar: SidebarConfig;
};

const DEFAULT_UI_CONFIG: UIConfigState = {
  themeLocked: false,
  startPage: "welcome",
  sidebar: DEFAULT_SIDEBAR_CONFIG,
};

export function useUIConfig() {
  const [config, setConfig] = useState<UIConfigState>(DEFAULT_UI_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .getUIConfig()
      .then((res) => {
        setConfig({
          themeLocked: res.themeLocked,
          startPage: res.startPage || "welcome",
          sidebar: {
            pinned: res.sidebar?.pinned ?? [],
            hidden: res.sidebar?.hidden ?? [],
            sections: res.sidebar?.sections ?? [],
          },
        });
      })
      .catch(() => setConfig(DEFAULT_UI_CONFIG))
      .finally(() => setLoaded(true));
  }, []);

  return { config, loaded };
}

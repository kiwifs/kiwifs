import { useEffect, useState } from "react";
import { api } from "../lib/api";

export type UIConfigState = {
  themeLocked: boolean;
  startPage: string;
};

const DEFAULT_UI_CONFIG: UIConfigState = {
  themeLocked: false,
  startPage: "welcome",
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
        });
      })
      .catch(() => setConfig(DEFAULT_UI_CONFIG))
      .finally(() => setLoaded(true));
  }, []);

  return { config, loaded };
}

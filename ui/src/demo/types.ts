import type { MockOverrides } from "@kw/components/__mocks__/apiMock";
import type { KiwiDemoViewId } from "@kw/lib/hostConfig";
import type { TreeEntry } from "@kw/lib/api";
import type { Theme } from "@kw/hooks/useTheme";

export type DemoTemplateConfig = {
  slug: string;
  title: string;
  description: string;
  useCase: string;
  themePreset: string;
  defaultTheme: Theme;
  accentClass: string;
  initialPath: string;
  initialView?: KiwiDemoViewId;
  startPage?: string;
  branding: {
    name: string;
    welcomeTitle?: string;
    welcomeMessage?: string;
  };
  tree: TreeEntry;
  fileContents: Record<string, string>;
  mock: Omit<MockOverrides, "fileContents" | "tree" | "uiConfig">;
  uiConfig?: MockOverrides["uiConfig"];
};

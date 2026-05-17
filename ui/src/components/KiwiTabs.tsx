/**
 * KiwiTabs — Tabbed content component rendered from :::tabs directives.
 *
 * Receives a div[data-kiwi-directive="tabs"] containing child
 * div[data-kiwi-directive="tab"] panels. Renders tab headers and
 * manages active panel state.
 *
 * Markdown syntax:
 * ```
 * :::tabs
 * ::tab[Overview]
 * Overview content here.
 *
 * ::tab[API]
 * API content here.
 * :::
 * ```
 */

import React, { useState, useCallback, Children, isValidElement } from "react";

interface KiwiTabsProps {
  children: React.ReactNode;
}

interface TabInfo {
  label: string;
  content: React.ReactNode;
}

/**
 * Extract tab panels from children rendered by the directive transform.
 * Each tab panel is a div with data-kiwi-directive="tab" and data-label.
 */
function extractTabs(children: React.ReactNode): TabInfo[] {
  const tabs: TabInfo[] = [];
  const childArray = Children.toArray(children);

  for (const child of childArray) {
    if (isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      if (props["data-kiwi-directive"] === "tab") {
        const label = (props["data-label"] as string) || `Tab ${tabs.length + 1}`;
        tabs.push({ label, content: props.children as React.ReactNode });
      } else {
        // Non-tab children: check if they contain nested tabs
        // This handles cases where react-markdown wraps content in extra elements
        const nested = extractTabs(props.children as React.ReactNode);
        if (nested.length > 0) {
          tabs.push(...nested);
        }
      }
    }
  }

  return tabs;
}

export function KiwiTabs({ children }: KiwiTabsProps) {
  const tabs = extractTabs(children);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleTabClick = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  if (tabs.length === 0) {
    return <div className="kiwi-tabs-empty">{children}</div>;
  }

  return (
    <div className="kiwi-tabs not-prose my-4 rounded-md border border-border overflow-hidden">
      {/* Tab header bar */}
      <div className="kiwi-tabs-header flex border-b border-border bg-muted/30" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={index}
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls={`kiwi-tabpanel-${index}`}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
              ${index === activeIndex
                ? "border-primary text-primary bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            onClick={() => handleTabClick(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tabs.map((tab, index) => (
        <div
          key={index}
          id={`kiwi-tabpanel-${index}`}
          role="tabpanel"
          aria-hidden={index !== activeIndex}
          className={`kiwi-tabs-panel p-4 ${index === activeIndex ? "" : "hidden"}`}
        >
          <div className="kiwi-prose">{tab.content}</div>
        </div>
      ))}
    </div>
  );
}

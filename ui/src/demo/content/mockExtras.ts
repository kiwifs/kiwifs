import type { MockOverrides } from "@kw/components/__mocks__/apiMock";
import type { BacklinkEntry, Comment, SearchResult, Version } from "@kw/lib/api";

export function demoComments(path: string, items: Omit<Comment, "path">[]): Comment[] {
  return items.map((c) => ({ ...c, path }));
}

export function demoBacklinks(entries: { path: string; count: number }[]): BacklinkEntry[] {
  return entries;
}

export function demoSearch(items: SearchResult[]): SearchResult[] {
  return items;
}

export function demoVersions(items: Version[]): Version[] {
  return items;
}

export type MockExtras = Pick<
  MockOverrides,
  | "graphNodes"
  | "graphEdges"
  | "searchResults"
  | "backlinks"
  | "comments"
  | "versions"
  | "queryRows"
  | "calendarRows"
  | "timelineEvents"
  | "metaResults"
  | "workflows"
  | "workflowBoards"
  | "views"
  | "viewResults"
>;

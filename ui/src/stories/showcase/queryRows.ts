/** What the dashboard's `kiwi-query` gets back from the mocked API. */
export const SHOWCASE_QUERY_ROWS: Record<string, unknown>[] = [
  { _path: "tasks/append-path-fencing.md", title: "Fencing check on the append path", status: "in-progress", priority: 1, owner: "storage" },
  { _path: "tasks/compaction-lag-alert.md", title: "Alert on compaction lag", status: "todo", priority: 2, owner: "platform" },
  { _path: "tasks/second-drill.md", title: "Run the second incident drill", status: "todo", priority: 3, owner: "on-call" },
  { _path: "tasks/renewal-dashboard.md", title: "Renewal latency panel", status: "review", priority: 3, owner: "platform" },
];

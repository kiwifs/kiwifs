import { useEffect, useState, useCallback } from "react";
import { api, type QueryResponse } from "@/lib/api";

// KiwiQuery renders a live table from a DQL (Dataview Query Language) query.
//
// Accepts both the legacy YAML-like format and raw DQL:
//
// ```kiwi-query
// TABLE name, status FROM "students/" WHERE status = "active" SORT name ASC
// ```
//
// Legacy format (still supported):
// ```kiwi-query
// from: runs/
// where: $.status = published
// sort: $.priority
// order: desc
// limit: 20
// columns: path, status, priority
// ```

type Props = {
  source: string;
  isComputedView?: boolean;
  onNavigate?: (path: string) => void;
};

const LEGACY_KEYS = new Set(["from", "where", "sort", "order", "limit", "columns"]);

function isLegacyFormat(source: string): boolean {
  const lines = source.trim().split("\n");
  return lines.every((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    const colon = trimmed.indexOf(":");
    if (colon < 0) return false;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    return LEGACY_KEYS.has(key);
  });
}

function legacyToDQL(source: string): string {
  let from = "";
  const wheres: string[] = [];
  let sort = "";
  let order = "";
  let limit = "";
  let columns: string[] = [];

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();

    switch (key) {
      case "from":
        from = val;
        break;
      case "where":
        wheres.push(val.replace(/^\$\./, ""));
        break;
      case "sort":
        sort = val.replace(/^\$\./, "");
        break;
      case "order":
        order = val;
        break;
      case "limit":
        limit = val;
        break;
      case "columns":
        columns = val
          .split(",")
          .map((c) => c.trim().replace(/^\$\./, ""))
          .filter(Boolean);
        break;
    }
  }

  const parts = ["TABLE"];
  if (columns.length > 0) {
    parts.push(columns.join(", "));
  }
  if (from) {
    parts.push(`FROM "${from}"`);
  }
  if (wheres.length > 0) {
    parts.push("WHERE " + wheres.join(" AND "));
  }
  if (sort) {
    parts.push(`SORT ${sort}${order ? " " + order.toUpperCase() : ""}`);
  }
  if (limit) {
    parts.push(`LIMIT ${limit}`);
  }
  return parts.join(" ");
}

function formatHeader(col: string): string {
  let s = col.replace(/^_/, "").replace(/\./g, " ").replace(/_/g, " ");
  return s
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (v === Math.floor(v)) return String(v);
    return v.toFixed(2);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function KiwiQuery({ source, isComputedView, onNavigate }: Props) {
  const [data, setData] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const dql = isLegacyFormat(source) ? legacyToDQL(source) : source.trim();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    api
      .query(dql)
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [dql]);

  const copyDQL = useCallback(() => {
    navigator.clipboard.writeText(dql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [dql]);

  if (error) {
    return (
      <div className="kiwi-query-error rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
        <div className="font-semibold">kiwi-query error</div>
        <div className="font-mono">{error}</div>
      </div>
    );
  }
  if (data == null) {
    return (
      <div className="kiwi-query-loading text-muted-foreground text-sm">
        Loading query…
      </div>
    );
  }

  if (isComputedView) {
    return (
      <div className="kiwi-query">
        <div className="mb-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 border border-blue-200">
          This page is auto-generated from a query. Edit the query in the frontmatter.
        </div>
        {renderResult(data, dql, onNavigate, copyDQL, copied)}
      </div>
    );
  }

  return (
    <div className="kiwi-query">
      {renderResult(data, dql, onNavigate, copyDQL, copied)}
    </div>
  );
}

function renderResult(
  data: QueryResponse,
  dql: string,
  onNavigate?: (path: string) => void,
  onCopy?: () => void,
  copied?: boolean,
) {
  if (data.groups && data.groups.length > 0) {
    return renderGroups(data, onCopy, copied);
  }

  if (data.rows.length === 0) {
    return (
      <div className="kiwi-query-empty text-muted-foreground text-sm">
        No results.
      </div>
    );
  }

  const cols = data.columns ?? [];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            {cols.map((c) => (
              <th key={c} className="px-2 py-1 font-medium">
                {formatHeader(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {cols.map((c) => {
                const v = formatCell(row[c]);
                if ((c === "_path" || c === "path") && onNavigate) {
                  return (
                    <td key={c} className="px-2 py-1">
                      <a
                        href={`#${row[c]}`}
                        className="wiki-link"
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigate(String(row[c]));
                        }}
                      >
                        {v}
                      </a>
                    </td>
                  );
                }
                return (
                  <td key={c} className="px-2 py-1">
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data.has_more && (
        <div className="text-muted-foreground mt-1 text-xs">
          Showing {data.rows.length}+ results
        </div>
      )}
      {onCopy && (
        <button
          onClick={onCopy}
          className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
        >
          {copied ? "Copied!" : "Copy as DQL"}
        </button>
      )}
    </div>
  );
}

function renderGroups(
  data: QueryResponse,
  onCopy?: () => void,
  copied?: boolean,
) {
  return (
    <div>
      {data.groups!.map((g) => (
        <div key={g.key} className="mb-3">
          <div className="text-sm font-semibold">
            {g.key || "(empty)"}{" "}
            <span className="text-muted-foreground font-normal">
              ({g.count})
            </span>
          </div>
          <div className="ml-2 mt-1">
            <div
              className="bg-primary/20 rounded"
              style={{
                height: "16px",
                width: `${Math.min(100, (g.count / Math.max(...data.groups!.map((x) => x.count))) * 100)}%`,
                minWidth: "4px",
              }}
            />
          </div>
        </div>
      ))}
      {onCopy && (
        <button
          onClick={onCopy}
          className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
        >
          {copied ? "Copied!" : "Copy as DQL"}
        </button>
      )}
    </div>
  );
}

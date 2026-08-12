/**
 * KiwiDataBlock — renders ```kiwi-data fences as a readable table.
 *
 * These blocks are structured data, not code: the server indexes them into
 * page_records so `FROM RECORDS "<kind>"` can query them. Showing them as
 * syntax-highlighted YAML would hide that they are queryable rows, so they
 * get a table and a kind badge instead.
 *
 * A block that fails to parse falls back to the raw source with the parser's
 * complaint attached — the same authoring mistake the indexer logs.
 *
 * (Named ...Block because KiwiData is the import-connections manager.)
 */

import { useMemo } from "react";
import { formatRecordValue, kindFromMeta, parseDataBlock } from "@kw/lib/dataBlock";

export function KiwiDataBlock({ source, meta }: { source: string; meta?: string }) {
  const parsed = useMemo(() => parseDataBlock(source, kindFromMeta(meta)), [source, meta]);

  if (!parsed.ok) {
    return (
      <div className="kiwi-data-error border-destructive/40 my-3 rounded-md border">
        <div className="text-destructive border-destructive/40 border-b px-3 py-1.5 text-xs">
          kiwi-data: {parsed.error}
        </div>
        <pre className="overflow-x-auto px-3 py-2 text-xs">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  const { kind, records, columns } = parsed.block;

  return (
    <div className="kiwi-data my-3 rounded-md border">
      <div className="text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 text-xs">
        <span className="font-mono">{kind}</span>
        <span>
          {records.length} {records.length === 1 ? "record" : "records"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              {columns.map((c) => (
                <th key={c} className="px-2 py-1 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((rec, i) => (
              <tr key={i} className="border-b last:border-b-0">
                {columns.map((c) => {
                  const isNull = c in rec && rec[c] === null;
                  return (
                    <td
                      key={c}
                      className={`px-2 py-1 ${isNull ? "text-muted-foreground" : ""}`}
                      title={isNull ? "explicitly null" : undefined}
                    >
                      {formatRecordValue(rec, c)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default KiwiDataBlock;

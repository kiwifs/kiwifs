import { useSyncExternalStore } from "react";
import { alpha } from "./colors";
import { getPageData, pageDataVersion, subscribePageData } from "@kw/lib/pageData";
import { toSet, type Many } from "./sets";
import { WidgetText } from "./WidgetText";
import { objectsOf, shortText, summarizeTable } from "./widgetA11y";
import { partHandlers, useInspect, whyFor, type InspectRef } from "./inspect";
import type { CellValue } from "./cellOverlay";

/**
 * A named-column table: relations, schemas, lock tables, Bayes 2×2, runbook
 * matrices, MVCC row versions.
 *
 * Not `MatrixView` — cells are addressed by row key and column name, not by
 * `[r, c]`, which is what lets a primary key stay the identity of a row while
 * it is inserted, updated and deleted across steps. Not `kiwi-data` either:
 * that is a queryable dataset with no animation surface.
 */

export interface TableColumn {
  key: string;
  label?: string;
  /** Marks the primary key. Rendered with a key glyph and used as `rowKey`. */
  pk?: boolean;
  /** Foreign key target, shown in the header: `{table, column}` or `"users.id"`. */
  fk?: { table: string; column: string } | string;
  align?: "left" | "right" | "center";
  /** Column width in px. */
  width?: number;
  /** Shown under the label — `int`, `text not null`. */
  type?: string;
}

/** A cell as `"rowKey.colKey"` or `[rowKey, colKey]`. */
export type TableCellRef = string | readonly [string | number, string | number];

export interface TableArrow {
  /** Source cell. */
  from: TableCellRef;
  to: TableCellRef;
  label?: string;
  color?: string;
}

export interface TableViewProps {
  /**
   * Columns, as `{key, …}` or bare key strings. Omit them to infer one per
   * key seen in `rows`, in first-seen order — which is what you want when the
   * rows came from a dataset rather than from an author.
   */
  columns?: (TableColumn | string)[];
  /** Records, one per row, keyed by column. */
  rows?: Record<string, CellValue>[];
  /** Column whose value identifies a row. Defaults to the `pk` column, else the index. */
  rowKey?: string;
  /** Cells being written this step, as `"rowKey.colKey"` or `[rowKey, colKey]`. */
  activeCells?: Many<TableCellRef>;
  /** Secondary-highlighted cells. */
  highlightCells?: Many<TableCellRef>;
  /** Dimmed cells. */
  dimCells?: Many<TableCellRef>;
  /** Row keys being written this step. */
  activeRows?: Many<string | number>;
  /** Secondary-highlighted row keys. */
  highlightRows?: Many<string | number>;
  /** Dimmed row keys. */
  dimRows?: Many<string | number>;
  /** Column keys to highlight top to bottom. */
  highlightCols?: Many<string>;
  /** Rows added this step — green, with a `+` gutter. */
  insertedRows?: Many<string | number>;
  /** Rows removed this step — struck through. MVCC and diffs. */
  deletedRows?: Many<string | number>;
  /** References between cells, drawn as a ↳ glyph in the source cell. */
  arrows?: TableArrow[];
  /** Sort indicator only; the rows are rendered in the order given. */
  sort?: { key: string; dir?: "asc" | "desc" } | string;
  /** Caption above the table. */
  caption?: string;
  /** Render at most this many rows, then a "…n more" line. */
  maxRows?: number;
  /** Scroll past this height rather than growing the page. Default 420. */
  maxHeight?: number;
  /** Widget id for the inspect bus. Defaults to "table". */
  widgetId?: string;
  /**
   * Render the records of a `kiwi-data` block on the same page, by kind.
   * `rows` wins when both are given, so a fence can override a dataset.
   */
  fromData?: string;
  /** Reported when the reader selects a cell. */
  onSelect?: (ref: InspectRef) => void;
  /** Key → explanation, revealed when the reader selects that cell or row. */
  why?: Record<string, string>;
  /** Controlled selection, as cell refs. */
  selected?: Many<TableCellRef | number>;
  /** Primary highlight color. */
  activeColor?: string;
  /** Secondary highlight color. */
  highlightColor?: string;
  /** Accessible name. Defaults to a summary of the rows and columns. */
  ariaLabel?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  inserted: "var(--kw-widget-highlight, #22c55e)",
  deleted: "var(--kw-widget-accent-rose, #f43f5e)",
};

type Row = Record<string, CellValue>;

let warnedDuplicateKeys = false;

/** Duplicate keys still render; the warning is for the author, in dev only. */
function warnDuplicateKeys(what: string) {
  if (warnedDuplicateKeys || !(import.meta as { env?: { DEV?: boolean } }).env?.DEV) return;
  warnedDuplicateKeys = true;
  console.warn(`TableView: ${what}. Highlights addressed by that key will match every copy.`);
}

/** One column per key seen across the rows, in the order they first appear. */
export function inferColumns(rows: readonly Row[]): TableColumn[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  }
  return seen.map((key) => ({
    key,
    label: key,
    align: rows.every((r) => r[key] == null || typeof r[key] === "number") ? "right" : "left",
  }));
}

/** Columns as written — objects, bare strings, or objects missing a key. */
export function normalizeColumns(columns: unknown): TableColumn[] {
  if (!Array.isArray(columns)) return [];
  const out: TableColumn[] = [];
  columns.forEach((c, i) => {
    if (typeof c === "string" || typeof c === "number") {
      out.push({ key: String(c) });
      return;
    }
    if (typeof c !== "object" || c === null || Array.isArray(c)) return;
    const col = c as Partial<TableColumn> & { key?: unknown; label?: unknown };
    const key = col.key ?? col.label ?? `col${i}`;
    out.push({ ...col, key: String(key), label: col.label != null ? String(col.label) : undefined });
  });
  return out;
}

/** `"row.col"` for a string, `[row, col]` tuple, or `{row, col}` object. */
export function cellRefKey(ref: unknown): string {
  if (Array.isArray(ref)) return `${ref[0]}.${ref[1]}`;
  if (typeof ref === "object" && ref !== null) {
    const rc = ref as { row?: unknown; col?: unknown };
    return `${rc.row}.${rc.col}`;
  }
  return String(ref);
}

function isScalar(v: unknown): v is string | number {
  return typeof v === "string" || typeof v === "number";
}

function cellSet(value: Many<TableCellRef | number>): Set<string> {
  if (Array.isArray(value) && value.length === 2) {
    // A cell key always has a dot, so a lone pair of dotless scalars can only
    // mean one `[row, col]` cell, never two cells.
    const [a, b] = value as unknown[];
    if (isScalar(a) && isScalar(b) && !String(a).includes(".") && !String(b).includes(".")) {
      return new Set([`${a}.${b}`]);
    }
  }
  return new Set([...toSet(value as Many<unknown>)].map(cellRefKey));
}

function own(row: Row, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
}

function keySet(value: Many<string | number>): Set<string> {
  return new Set([...toSet(value)].map(String));
}

function format(v: unknown): string {
  if (v == null) return "∅";
  if (v === Infinity) return "∞";
  if (v === -Infinity) return "−∞";
  if (typeof v === "boolean") return v ? "T" : "F";
  return shortText(v);
}

function fkText(fk: unknown): string {
  if (typeof fk === "string") return `→ ${fk}`;
  if (typeof fk === "object" && fk !== null && !Array.isArray(fk)) {
    const { table, column } = fk as { table?: unknown; column?: unknown };
    if (table != null && column != null) return `→ ${table}.${column}`;
    if (table != null) return `→ ${table}`;
  }
  return `→ ${shortText(fk)}`;
}

export function TableView({
  columns: columnsIn,
  rows: rowsIn,
  fromData,
  rowKey,
  activeCells,
  highlightCells,
  dimCells,
  activeRows,
  highlightRows,
  dimRows,
  highlightCols,
  insertedRows,
  deletedRows,
  arrows,
  sort: sortIn,
  caption,
  maxRows,
  maxHeight = 420,
  widgetId = "table",
  onSelect,
  why,
  selected,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  ariaLabel,
}: TableViewProps) {
  const bus = useInspect();
  // Re-read on every registration so a data block that mounts after this
  // fence still fills it.
  useSyncExternalStore(subscribePageData, pageDataVersion, pageDataVersion);
  const linked_ = fromData ? getPageData(fromData) : undefined;
  const rows = objectsOf<Row>(rowsIn ?? linked_?.records ?? []);
  // Inferred columns keep first-seen key order, so a dataset reads in the
  // order it was written rather than alphabetically.
  const columns = columnsIn != null ? normalizeColumns(columnsIn) : inferColumns(rows);
  const sort = typeof sortIn === "string" ? { key: sortIn } : sortIn != null && typeof sortIn === "object" ? sortIn : null;
  const pkColumn = columns.find((c) => c.pk)?.key;
  const idOf = (row: Row, i: number) => {
    const key = rowKey ?? pkColumn;
    const v = key ? own(row, key) : undefined;
    return v == null ? String(i) : shortText(v);
  };
  const ids = rows.map(idOf);

  const activeCellSet = cellSet(activeCells);
  const highlightCellSet = cellSet(highlightCells);
  const dimCellSet = cellSet(dimCells);
  const selectedSet = cellSet(selected);
  const activeRowSet = keySet(activeRows);
  const highlightRowSet = keySet(highlightRows);
  const dimRowSet = keySet(dimRows);
  const highlightColSet = keySet(highlightCols);
  const insertedSet = keySet(insertedRows);
  const deletedSet = keySet(deletedRows);
  const linked = bus.linkedKeys(widgetId);
  const mergedWhy = { ...bus.why, ...(why ?? {}) };

  const isSelected = (cellId: string) =>
    selectedSet.has(cellId) ||
    (bus.selected?.widget === widgetId && bus.selected.kind === "cell" && bus.selected.key === cellId);
  const selectableCell = (cellId: string) =>
    onSelect !== undefined || whyFor(mergedWhy, { widget: widgetId, kind: "cell", key: cellId }) !== undefined;
  const firstSelectable = (() => {
    for (let i = 0; i < rows.length; i++) {
      for (const col of columns) {
        const id = `${ids[i]}.${col.key}`;
        if (selectableCell(id)) return id;
      }
    }
    return undefined;
  })();

  const limit = typeof maxRows === "number" && Number.isFinite(maxRows) && maxRows >= 0 ? Math.trunc(maxRows) : undefined;
  const shown = limit != null ? rows.slice(0, limit) : rows;
  const hidden = rows.length - shown.length;

  const rowKeys = uniqueKeys(ids.slice(0, shown.length));
  const colKeys = uniqueKeys(columns.map((c) => c.key));
  if (rowKeys.duplicated) warnDuplicateKeys("two rows share a key");
  if (colKeys.duplicated) warnDuplicateKeys("two columns share a key");

  // Arrows between <td>s would need measured geometry; a glyph in the source
  // cell plus the target's key says the same thing and survives a reflow.
  const arrowFrom = new Map<string, TableArrow>();
  for (const a of objectsOf<TableArrow>(arrows)) arrowFrom.set(cellRefKey(a.from), a);

  const label = ariaLabel ?? summarizeTable({ columns, rows, caption });

  return (
    <div style={{ overflow: "auto", maxHeight, padding: "0.25rem 0" }}>
      <table
        role="table"
        aria-label={label}
        style={{
          borderCollapse: "separate",
          borderSpacing: 0,
          fontSize: "0.8rem",
          fontVariantNumeric: "tabular-nums",
          width: "max-content",
          minWidth: "100%",
          color: DEFAULTS.text,
        }}
      >
        {caption && (
          <caption
            style={{
              captionSide: "bottom",
              paddingTop: 8,
              fontSize: "0.72rem",
              color: DEFAULTS.dimColor,
              textAlign: "left",
            }}
          >
            <WidgetText text={shortText(caption)} />
          </caption>
        )}
        <thead>
          <tr>
            {columns.map((col, ci) => {
              const lit = highlightColSet.has(col.key);
              return (
                <th
                  key={colKeys.keys[ci]}
                  scope="col"
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    textAlign: col.align ?? "left",
                    padding: "6px 10px",
                    width: col.width,
                    whiteSpace: "nowrap",
                    background: lit ? alpha(highlightColor, 18) : DEFAULTS.surface,
                    borderBottom: `2px solid ${lit ? highlightColor : DEFAULTS.border}`,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {col.pk && (
                      <span title="primary key" style={{ color: activeColor, fontSize: "0.7rem" }}>
                        ⚿
                      </span>
                    )}
                    <WidgetText text={col.label ?? col.key} />
                    {sort != null && sort.key === col.key && (
                      <span style={{ color: DEFAULTS.dimColor }}>
                        {sort.dir === "desc" ? "▼" : "▲"}
                      </span>
                    )}
                  </span>
                  {(col.type || col.fk) && (
                    <div
                      style={{
                        fontWeight: 400,
                        fontSize: "0.65rem",
                        color: DEFAULTS.dimColor,
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      }}
                    >
                      {col.fk ? fkText(col.fk) : shortText(col.type)}
                    </div>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => {
            const id = ids[i]!;
            const inserted = insertedSet.has(id);
            const deleted = deletedSet.has(id);
            const rowActive = activeRowSet.has(id);
            const rowLit = highlightRowSet.has(id) || linked.has(id);
            const rowDim = dimRowSet.has(id);
            return (
              <tr
                key={rowKeys.keys[i]}
                style={{
                  opacity: rowDim || deleted ? 0.5 : 1,
                  background: rowActive
                    ? alpha(activeColor, 14)
                    : rowLit
                      ? alpha(highlightColor, 12)
                      : inserted
                        ? alpha(DEFAULTS.inserted, 10)
                        : "transparent",
                  transition: "background 0.25s ease, opacity 0.25s ease",
                }}
              >
                {columns.map((col, ci) => {
                  const cellId = `${id}.${col.key}`;
                  const picked = isSelected(cellId);
                  const active = activeCellSet.has(cellId);
                  const lit = highlightCellSet.has(cellId) || picked;
                  const dim = dimCellSet.has(cellId);
                  const arrow = arrowFrom.get(cellId);
                  const canSelect = selectableCell(cellId);
                  const handlers = canSelect
                    ? {
                        ...partHandlers(widgetId, "cell", cellId, bus, {
                          onSelect,
                          why: mergedWhy,
                          tabbable: cellId === firstSelectable,
                        }),
                        "aria-selected": picked || undefined,
                      }
                    : {};
                  return (
                    <td
                      key={colKeys.keys[ci]}
                      {...handlers}
                      style={{
                        textAlign: col.align ?? "left",
                        padding: "5px 10px",
                        whiteSpace: "nowrap",
                        borderBottom: `1px solid ${DEFAULTS.border}`,
                        background: active
                          ? activeColor
                          : lit
                            ? alpha(highlightColor, 22)
                            : highlightColSet.has(col.key)
                              ? alpha(highlightColor, 8)
                              : "transparent",
                        color: active ? "var(--kw-widget-active-foreground, #111827)" : undefined,
                        opacity: dim ? 0.45 : 1,
                        fontWeight: col.pk ? 700 : 400,
                        textDecoration: deleted ? "line-through" : undefined,
                        cursor: canSelect ? "pointer" : undefined,
                        outline: picked ? `2px solid ${activeColor}` : "none",
                        outlineOffset: -2,
                        transition: "background 0.25s ease",
                      }}
                    >
                      {ci === 0 && (inserted || deleted) && (
                        <span
                          aria-hidden
                          style={{
                            color: inserted ? DEFAULTS.inserted : DEFAULTS.deleted,
                            marginRight: 6,
                            fontWeight: 700,
                          }}
                        >
                          {inserted ? "+" : "−"}
                        </span>
                      )}
                      <WidgetText text={format(own(row, col.key))} />
                      {arrow && (
                        <span
                          title={arrow.label != null ? shortText(arrow.label) : `→ ${cellRefKey(arrow.to)}`}
                          style={{ color: arrow.color ?? activeColor, marginLeft: 6 }}
                        >
                          ↳
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {hidden > 0 && (
            <tr>
              <td
                colSpan={Math.max(1, columns.length)}
                style={{ padding: "5px 10px", color: DEFAULTS.dimColor, fontStyle: "italic" }}
              >
                …{hidden} more {hidden === 1 ? "row" : "rows"}
              </td>
            </tr>
          )}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={Math.max(1, columns.length)}
                style={{ padding: "10px", color: DEFAULTS.dimColor, textAlign: "center" }}
              >
                (no rows)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** React keys for a list that may repeat: the second `7` becomes `7#3`. */
function uniqueKeys(keys: readonly string[]): { keys: string[]; duplicated: boolean } {
  const seen = new Set<string>();
  let duplicated = false;
  const out = keys.map((k, i) => {
    if (!seen.has(k)) {
      seen.add(k);
      return k;
    }
    duplicated = true;
    return `${k}#${i}`;
  });
  return { keys: out, duplicated };
}

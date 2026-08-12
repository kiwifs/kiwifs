/**
 * dataBlock — parses ```kiwi-data fences into records for display.
 *
 * Mirrors internal/markdown/datablocks.go. The server indexes these blocks
 * into the page_records table so DQL can query them with
 * `FROM RECORDS "<kind>"`; the UI's job is only to show the same records as
 * a readable table instead of a wall of YAML.
 *
 * Three body shapes are accepted, matching the server:
 *
 *   kind: dataset-schema     |  kind: stats          |  - name: target
 *   records:                 |  rows: 750000         |    dtype: float
 *     - name: target         |  ordered: false       |
 *       dtype: float         |                       |
 *
 * The third form takes its kind from the fence info string
 * (```kiwi-data dataset-schema or ```kiwi-data kind=dataset-schema).
 */

import yaml from "js-yaml";

export type DataRecord = Record<string, unknown>;

export type DataBlock = {
  kind: string;
  records: DataRecord[];
  /** Union of every record's keys, in first-seen order. */
  columns: string[];
};

export type DataBlockParseResult =
  | { ok: true; block: DataBlock }
  | { ok: false; error: string };

/** Reads the kind hint out of a fence info/meta string. */
export function kindFromMeta(meta: string | undefined): string {
  if (!meta) return "";
  const first = meta.trim().split(/\s+/)[0] ?? "";
  return first.startsWith("kind=") ? first.slice("kind=".length) : first;
}

function isRecord(v: unknown): v is DataRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseDataBlock(source: string, infoKind = ""): DataBlockParseResult {
  if (!source.trim()) {
    return { ok: false, error: "empty block" };
  }

  let doc: unknown;
  try {
    doc = yaml.load(source);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let kind = infoKind.trim();
  let raw: unknown[];

  if (Array.isArray(doc)) {
    raw = doc;
  } else if (isRecord(doc)) {
    const bodyKind = doc.kind;
    if (typeof bodyKind === "string" && bodyKind.trim()) {
      kind = bodyKind.trim();
    }
    if ("records" in doc) {
      if (!Array.isArray(doc.records)) {
        return { ok: false, error: "records must be a list" };
      }
      raw = doc.records;
    } else {
      // Single-record form: the mapping itself, minus the discriminator.
      const { kind: _discarded, ...rest } = doc;
      raw = Object.keys(rest).length > 0 ? [rest] : [];
    }
  } else {
    return { ok: false, error: "block must be a mapping or a list" };
  }

  const records = raw.filter(isRecord).filter((r) => Object.keys(r).length > 0);
  if (!kind) {
    return { ok: false, error: "missing kind" };
  }
  if (records.length === 0) {
    return { ok: false, error: "no records" };
  }

  const columns: string[] = [];
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  return { ok: true, block: { kind, records, columns } };
}

/**
 * formatRecordValue renders one cell. A missing key and an explicit null are
 * deliberately shown differently: null is an asserted "we looked and there is
 * no value", which the Phase 0 evaluation showed is not the same claim as an
 * absent field.
 */
export function formatRecordValue(rec: DataRecord, key: string): string {
  if (!(key in rec)) return "";
  const v = rec[key];
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  return JSON.stringify(v);
}

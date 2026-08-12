import { describe, expect, it } from "vitest";
import { formatRecordValue, kindFromMeta, parseDataBlock } from "./dataBlock";

describe("parseDataBlock", () => {
  it("parses the record-list form", () => {
    const res = parseDataBlock(
      ["kind: dataset-schema", "records:", "  - name: target", "    dtype: float", "  - name: id", "    dtype: int"].join("\n"),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.block.kind).toBe("dataset-schema");
    expect(res.block.records).toHaveLength(2);
    expect(res.block.columns).toEqual(["name", "dtype"]);
  });

  it("parses the single-record mapping form without re-emitting kind", () => {
    const res = parseDataBlock(["kind: stats", "rows: 750000", "ordered: false"].join("\n"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.block.records).toEqual([{ rows: 750000, ordered: false }]);
    expect(res.block.columns).toEqual(["rows", "ordered"]);
  });

  it("takes the kind from the info string for a bare list", () => {
    const res = parseDataBlock("- name: target\n  dtype: float", "dataset-schema");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.block.kind).toBe("dataset-schema");
  });

  it("prefers a kind in the body over the info string", () => {
    const res = parseDataBlock("kind: from-body\nrecords:\n  - a: 1", "from-info");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.block.kind).toBe("from-body");
  });

  it("unions columns across records in first-seen order", () => {
    const res = parseDataBlock(
      ["kind: k", "records:", "  - b: 1", "    a: 2", "  - c: 3", "    a: 4"].join("\n"),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.block.columns).toEqual(["b", "a", "c"]);
  });

  it("reports malformed yaml instead of throwing", () => {
    const res = parseDataBlock("kind: broken\nrecords:\n  - name: [unterminated");
    expect(res.ok).toBe(false);
  });

  it.each([
    ["", "empty block"],
    ["records:\n  - name: x", "missing kind"],
    ["kind: k", "no records"],
    ["kind: k\nrecords: []", "no records"],
    ["just a string", "mapping or a list"],
  ])("rejects %j", (source, want) => {
    const res = parseDataBlock(source);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain(want);
  });
});

describe("kindFromMeta", () => {
  it.each([
    [undefined, ""],
    ["", ""],
    ["dataset-schema", "dataset-schema"],
    ["kind=dataset-schema", "dataset-schema"],
    ["  dataset-schema  extra", "dataset-schema"],
  ])("reads %j", (meta, want) => {
    expect(kindFromMeta(meta)).toBe(want);
  });
});

describe("formatRecordValue", () => {
  it("distinguishes an absent key from an explicit null", () => {
    expect(formatRecordValue({ a: 1 }, "missing")).toBe("");
    expect(formatRecordValue({ a: null }, "a")).toBe("—");
  });

  it("formats scalars, booleans and collections", () => {
    expect(formatRecordValue({ a: 0.116 }, "a")).toBe("0.116");
    expect(formatRecordValue({ a: false }, "a")).toBe("false");
    expect(formatRecordValue({ a: ["x", "y"] }, "a")).toBe("x, y");
    expect(formatRecordValue({ a: { b: 1 } }, "a")).toBe('{"b":1}');
  });
});

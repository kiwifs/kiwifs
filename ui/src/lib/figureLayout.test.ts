import { describe, expect, it } from "vitest";
import { figureClassName, parseEmbedLabel, parseFigureAttrs } from "./figureLayout";

describe("parseEmbedLabel", () => {
  it("treats a matching target as no modifiers", () => {
    expect(parseEmbedLabel("diagram.excalidraw.md", "diagram.excalidraw.md")).toEqual({
      width: "inline",
      pin: false,
    });
  });

  it("reads width and pin tokens", () => {
    expect(parseEmbedLabel("wide sticky")).toEqual({
      width: "wide",
      pin: true,
    });
    expect(parseEmbedLabel("full")).toEqual({ width: "full", pin: false });
  });

  it("reads pixel size and leftover caption", () => {
    expect(parseEmbedLabel("600x400 The write path")).toEqual({
      width: "inline",
      pin: false,
      pixelWidth: 600,
      pixelHeight: 400,
      caption: "The write path",
    });
  });

  it("keeps a caption that is only words", () => {
    expect(parseEmbedLabel("Write path")).toEqual({
      width: "inline",
      pin: false,
      caption: "Write path",
    });
  });
});

describe("parseFigureAttrs", () => {
  it("reads width and a boolean pin flag", () => {
    expect(parseFigureAttrs({ width: "wide", pin: "" })).toEqual({
      width: "wide",
      pin: true,
      caption: undefined,
    });
  });

  it("treats pin=false as off", () => {
    expect(parseFigureAttrs({ pin: "false" }).pin).toBe(false);
  });
});

describe("figureClassName", () => {
  it("uses width only — pin does not change layout", () => {
    expect(figureClassName({ width: "wide", pin: true })).toBe("kiwi-figure kiwi-figure-wide");
  });
});

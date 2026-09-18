import { describe, it, expect } from "vitest";
import { widthThresholds } from "./content-width.js";

describe("widthThresholds", () => {
  it("reads min- and max-width in px, em and rem", () => {
    expect(widthThresholds("(min-width: 600px)")).toEqual([600]);
    expect(widthThresholds("screen and (max-width: 40em)")).toEqual([640]);
    expect(widthThresholds("(min-width: 30rem) and (max-width: 1200px)")).toEqual([480, 1200]);
    expect(widthThresholds("(max-inline-size: 500px)")).toEqual([500]);
  });

  it("reads the range syntax, both bounds", () => {
    expect(widthThresholds("(width >= 768px)")).toEqual([768]);
    expect(widthThresholds("(600px <= width)")).toEqual([600]);
    expect(widthThresholds("(400px < width < 800px)").sort((a, b) => a - b)).toEqual([400, 800]);
  });

  it("reads every query of a list, and skips print-only ones", () => {
    expect(widthThresholds("print and (max-width: 500px), (min-width: 900px)")).toEqual([900]);
    expect(widthThresholds("only print")).toEqual([]);
  });

  it("ignores conditions that are not about width", () => {
    expect(widthThresholds("(prefers-color-scheme: dark)")).toEqual([]);
    expect(widthThresholds("(min-height: 600px)")).toEqual([]);
    expect(widthThresholds("(min-resolution: 2dppx)")).toEqual([]);
    expect(widthThresholds("(orientation: landscape)")).toEqual([]);
  });
});

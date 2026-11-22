// Data files are JSON, and JSON.parse makes "__proto__" an own key. A merge that reads target["__proto__"] gets
// Object.prototype and, descending into it, changes every object in the process. The merges skip the three keys
// that reach a prototype: `__proto__`, `constructor` and `prototype`.
import { afterEach, describe, expect, it } from "vitest";
import { deepMerge } from "../src/index";
import { mergeData } from "../src/source-store";

const proto = Object.prototype as Record<string, unknown>;
afterEach(() => { for (const key of Object.keys(proto)) delete proto[key]; });

describe("merging parsed data", () => {
  it("deepMerge leaves Object.prototype alone", () => {
    deepMerge({}, JSON.parse(`{"__proto__":{"pdPolluted":"yes"}}`));
    expect(({} as Record<string, unknown>).pdPolluted).toBeUndefined();
  });

  it("deepMerge takes none of the three keys, and everything else", () => {
    const target: Record<string, unknown> = { kept: { a: 1 } };
    const source = JSON.parse(`{"__proto__":{"x":1},"constructor":{"prototype":{"y":1}},"prototype":{"z":1},"kept":{"b":2}}`);
    const out = deepMerge(target, source);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(["kept"]);
    expect(out.kept).toEqual({ a: 1, b: 2 });
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  it("mergeData gives a plain object, with none of the three keys and nothing inherited", () => {
    const out = mergeData({ kept: { a: 1 } }, JSON.parse(`{"__proto__":{"x":1},"constructor":{"y":1},"prototype":{"z":1},"kept":{"b":2}}`));
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(["kept"]);
    expect((out as Record<string, unknown>).x).toBeUndefined();
    expect(out.kept).toEqual({ a: 1, b: 2 });
  });
});

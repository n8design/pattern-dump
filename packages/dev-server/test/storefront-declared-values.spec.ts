// checkDeclared in "json" mode: a typed config value checked against what a schema property declares,
// with nothing coerced. ("frontmatter" mode is pinned through checkPageFrontmatter, in
// storefront-frontmatter.spec.ts.)
import { describe, expect, it } from "vitest";
import { checkDeclared } from "../src/storefront/declared-values.js";

const ok = (value: unknown) => ({ ok: true, value });
const no = (message: string) => ({ ok: false, message });

describe("checkDeclared — json mode takes typed values as they are", () => {
  it("accepts a value of the declared type", () => {
    expect(checkDeclared({ type: "string" }, "Docs", "json")).toEqual(ok("Docs"));
    expect(checkDeclared({ type: "number" }, 2.5, "json")).toEqual(ok(2.5));
    expect(checkDeclared({ type: "integer" }, -4, "json")).toEqual(ok(-4));
    expect(checkDeclared({ type: "boolean" }, false, "json")).toEqual(ok(false));
    expect(checkDeclared({ type: "array", items: { type: "number" } }, [1, 2], "json")).toEqual(ok([1, 2]));
    expect(checkDeclared({ type: "object" }, { a: 1 }, "json")).toEqual(ok({ a: 1 }));
    expect(checkDeclared({ type: "null" }, null, "json")).toEqual(ok(null));
    expect(checkDeclared({}, { anything: true }, "json")).toEqual(ok({ anything: true }));
  });

  it("coerces nothing", () => {
    expect(checkDeclared({ type: "number" }, "2", "json")).toEqual(no(`must be a number (got "2")`));
    expect(checkDeclared({ type: "boolean" }, "true", "json")).toEqual(no(`must be true or false (got "true")`));
    expect(checkDeclared({ type: "integer" }, 2.5, "json")).toEqual(no(`must be a whole number (got 2.5)`));
    expect(checkDeclared({ type: "string" }, ["a"], "json")).toEqual(no(`must be text (got ["a"])`));
    expect(checkDeclared({ type: "object" }, [], "json")).toEqual(no(`must be an object (got [])`));
    expect(checkDeclared({ type: "null" }, 0, "json")).toEqual(no(`must be null (got 0)`));
    expect(checkDeclared({ type: "array" }, "a", "json")).toEqual(no(`must be a list (got "a")`));
    expect(checkDeclared({ type: "number" }, Number.NaN, "json")).toEqual(no(`must be a number (got null)`));
  });

  it("checks array items by their declared type", () => {
    expect(checkDeclared({ type: "array", items: { type: "string" } }, ["a", 1], "json")).toEqual(no(`has an item that must be text (got 1)`));
  });

  it("tries a union's types in order, and checks an enum after the type", () => {
    expect(checkDeclared({ type: ["number", "string"] }, "x", "json")).toEqual(ok("x"));
    expect(checkDeclared({ type: ["number", "string"] }, true, "json")).toEqual(no(`must be a number (got true)`));
    expect(checkDeclared({ type: "string", enum: ["a", "b"] }, "b", "json")).toEqual(ok("b"));
    expect(checkDeclared({ type: "string", enum: ["a", "b"] }, "c", "json")).toEqual(no(`must be one of "a", "b" (got "c")`));
  });
});

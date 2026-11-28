import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { describe, expect, it } from "vitest";
import { NARROW_QUERY } from "./breakpoints.js";

describe("NARROW_QUERY", () => {
  it("is the query the compiled stylesheet uses for the narrow layout", () => {
    const { css } = compile(fileURLToPath(new URL("../styles/shell.scss", import.meta.url)));
    const queries = [...css.matchAll(/@media ([^{]*?)\s*\{/g)].map((m) => m[1]);
    expect(queries).toContain(NARROW_QUERY);
  });
});

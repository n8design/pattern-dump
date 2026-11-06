// readFrontmatter's lenient behaviour, as it is: component docs and the component tree read through it,
// and they keep this behaviour. What it accepts, and what it drops without a word, is pinned here so a
// stricter reading can be added beside it without changing it.
import { describe, expect, it } from "vitest";
import { readFrontmatter } from "../src/frontmatter.js";

const BOM = "﻿";

describe("readFrontmatter (lenient)", () => {
  it("keeps an unknown key, as a string", () => {
    expect(readFrontmatter("---\ntitle: Setup\nbogus: 1\n---\nbody")).toEqual({ title: "Setup", bogus: "1" });
  });

  it("reads every scalar as a string", () => {
    expect(readFrontmatter("---\norder: 2\n---\n")).toEqual({ order: "2" });
  });

  it("drops a line it cannot read, and turns a nested map into an empty list", () => {
    expect(readFrontmatter("---\ntitle: Setup\n  : : broken [\nnested:\n  child: x\n---\n"))
      .toEqual({ title: "Setup", nested: [] });
  });

  it("ignores a block that is never closed", () => {
    expect(readFrontmatter("---\ntitle: Setup\nbody without close")).toEqual({});
  });

  it("keeps a colon inside a value", () => {
    expect(readFrontmatter("---\ndescription: a: b\n---\n")).toEqual({ description: "a: b" });
  });

  it("reads both list spellings", () => {
    expect(readFrontmatter("---\ntags: [a, \"b\"]\nmore:\n  - c\n  - 'd'\n---\n")).toEqual({ tags: ["a", "b"], more: ["c", "d"] });
  });

  describe("byte-order mark and line endings", () => {
    const clean = "---\ntitle: Setup\norder: 2\ntags:\n  - a\n  - b\n---\nbody";
    const expected = { title: "Setup", order: "2", tags: ["a", "b"] };

    it("reads clean input", () => {
      expect(readFrontmatter(clean)).toEqual(expected);
    });

    it("reads a file that starts with a UTF-8 byte-order mark like clean input", () => {
      // trim() removes U+FEFF, so the opening line still reads as `---`.
      expect(readFrontmatter(BOM + clean)).toEqual(expected);
    });

    it("reads CRLF line endings like clean input", () => {
      expect(readFrontmatter(clean.replace(/\n/g, "\r\n"))).toEqual(expected);
    });

    it("reads a byte-order mark with CRLF like clean input", () => {
      expect(readFrontmatter(BOM + clean.replace(/\n/g, "\r\n"))).toEqual(expected);
    });

    it("trims a byte-order mark inside a value away", () => {
      expect(readFrontmatter(`---\ntitle: ${BOM}Setup\n---\n`)).toEqual({ title: "Setup" });
    });

    it("drops a line it cannot read under CRLF too", () => {
      expect(readFrontmatter("---\r\ntitle: Setup\r\n  : : broken [\r\n---\r\n")).toEqual({ title: "Setup" });
    });

    it("ignores a block whose lines end in a bare CR: it is one line, with no closing ---", () => {
      expect(readFrontmatter("---\rtitle: Setup\r---\r")).toEqual({});
    });
  });
});

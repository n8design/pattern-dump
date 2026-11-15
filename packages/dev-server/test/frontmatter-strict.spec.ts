// readFrontmatterStrict: the same values as the lenient reading, plus an error — with its line — for
// everything the lenient reading passes over. A file that starts with a UTF-8 byte-order mark, and CRLF
// line endings, read exactly like clean input: the same values, no errors, the same line numbers.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFrontmatter, readFrontmatterStrict } from "../src/frontmatter.js";

const BOM = "﻿";
const crlf = (s: string): string => s.replace(/\n/g, "\r\n");
/** The three spellings of one file that must read alike. */
const spellings = (md: string): Array<[string, string]> => [["clean", md], ["BOM", BOM + md], ["CRLF", crlf(md)], ["BOM + CRLF", BOM + crlf(md)]];

describe("readFrontmatterStrict — valid input", () => {
  const md = "---\ntitle: Setup\ndescription: \"How to: start\"\norder: 2\n\ntags:\n  - a\n  - 'b'\nmore: [c, \"d\"]\n---\n# Body\nbody: not frontmatter\n";
  const values = { title: "Setup", description: "How to: start", order: "2", tags: ["a", "b"], more: ["c", "d"] };
  const lines = { title: 2, description: 3, order: 4, tags: 6, more: 9 };

  for (const [name, text] of spellings(md)) {
    it(`reads ${name} with no errors, to the same values as the lenient reading`, () => {
      expect(readFrontmatterStrict(text)).toEqual({ values, maps: {}, errors: [], lines });
      expect(readFrontmatter(text)).toEqual(values);
    });
  }

  it("takes a file with no block as valid: no values, no errors", () => {
    for (const text of ["# Just a body\n", "", "\n---\ntitle: x\n---\n", BOM + "# Body"]) {
      expect(readFrontmatterStrict(text), JSON.stringify(text)).toEqual({ values: {}, maps: {}, errors: [], lines: {} });
    }
  });

  it("allows blank lines inside the block", () => {
    expect(readFrontmatterStrict("---\n\ntitle: A\n\n---\n")).toEqual({ values: { title: "A" }, maps: {}, errors: [], lines: { title: 3 } });
  });
});

describe("readFrontmatterStrict — the line of each key", () => {
  const md = "---\n\ntitle: First\nlayout: article\ntags:\n  - a\ntitle: Second\n---\n";
  for (const [name, text] of spellings(md)) {
    it(`gives the line each key is set on, the last one for a duplicate key (${name})`, () => {
      const r = readFrontmatterStrict(text);
      expect(r.lines).toEqual({ title: 7, layout: 4, tags: 5 });
      expect(r.values["title"]).toBe("Second");
    });
  }
});

describe("readFrontmatterStrict — one level of keys under a key", () => {
  const md = "---\ntitle: A\nrelated:\n  pages: [a.md, \"b.md\"]\n  limit: 5\n  tags:\n    - css\n    - 'grid'\nafter: x\n---\n";
  for (const [name, text] of spellings(md)) {
    it(`reads a map of values and lists, kept apart from the plain values, each line named with its parent (${name})`, () => {
      const r = readFrontmatterStrict(text);
      expect(r.errors).toEqual([]);
      expect(r.values).toEqual({ title: "A", after: "x" });
      expect(r.maps).toEqual({ related: { pages: ["a.md", "b.md"], limit: "5", tags: ["css", "grid"] } });
      expect(r.lines).toEqual({ title: 2, related: 3, "related.pages": 4, "related.limit": 5, "related.tags": 6, after: 9 });
      // The lenient reading gives the plain values only.
      expect(readFrontmatter(text)).toEqual({ title: "A", after: "x" });
    });
  }

  it("keeps a key with a list under it a list, and an empty key an empty list", () => {
    expect(readFrontmatterStrict("---\ntags:\n  - a\nnone:\n---\n")).toMatchObject({ values: { tags: ["a"], none: [] }, maps: {}, errors: [] });
  });
});

describe("readFrontmatterStrict — every problem, with its line", () => {
  const cases: Array<[label: string, md: string, errors: Array<{ line: number; message: string }>]> = [
    ["an unclosed block", "---\ntitle: Setup\n# Body\n",
      [{ line: 1, message: "the frontmatter block opened here is never closed: end it with a line holding only ---" }]],
    ["a line it cannot read", "---\ntitle: Setup\n  : : broken [\n---\n",
      [{ line: 3, message: "cannot read this line: : : broken [" }]],
    ["a nested value with no key above it", "---\ntitle: A\n  child: x\n---\n",
      [{ line: 3, message: "nested value with no key above it: nested keys follow a line `key:`, indented under it" }]],
    ["a second level of nesting", "---\nrelated:\n  limit: 3\n    deeper: x\n---\n",
      [{ line: 4, message: "nested value: one level of keys under \"related\", each indented the same as the first" }]],
    ["a list item in a map with no key above it", "---\nrelated:\n  limit: 3\n  - stray\n---\n",
      [{ line: 4, message: "list item with no key above it in \"related\": a list follows a line `  key:`" }]],
    ["a duplicate key in a map", "---\nrelated:\n  limit: 3\n  limit: 4\n---\n",
      [{ line: 4, message: "duplicate key \"related.limit\"" }]],
    ["an inline list never closed in a map", "---\nrelated:\n  tags: [a, b\n---\n",
      [{ line: 3, message: "\"related.tags\": the list opened with [ is never closed with ]" }]],
    ["a list item with no key above it", "---\ntitle: A\n\n- stray\n---\n",
      [{ line: 4, message: "list item with no key above it: a list follows a line `key:`" }]],
    ["a duplicate key", "---\ntitle: A\norder: 1\ntitle: B\n---\n",
      [{ line: 4, message: "duplicate key \"title\"" }]],
    ["an unterminated quote in a value", "---\ntitle: \"Setup\n---\n",
      [{ line: 2, message: "\"title\": the value has an opening quote with no closing one" }]],
    ["an unterminated quote in a list item", "---\ntags:\n  - 'a\n  - b\n---\n",
      [{ line: 3, message: "list item 'a has an opening quote with no closing one" }]],
    ["an unterminated quote in an inline list", "---\ntags: [a, \"b]\n---\n",
      [{ line: 2, message: "list item \"b has an opening quote with no closing one" }]],
    ["an inline list never closed", "---\ntags: [a, b\n---\n",
      [{ line: 2, message: "\"tags\": the list opened with [ is never closed with ]" }]],
    ["several problems, in line order", "---\ntitle: A\n  child: x\nwhat is this\ntitle: B\n---\n", [
      { line: 3, message: "nested value with no key above it: nested keys follow a line `key:`, indented under it" },
      { line: 4, message: "cannot read this line: what is this" },
      { line: 5, message: "duplicate key \"title\"" },
    ]],
  ];

  for (const [label, md, errors] of cases) {
    for (const [name, text] of spellings(md)) {
      it(`reports ${label} (${name}), on the same line`, () => {
        expect(readFrontmatterStrict(text).errors).toEqual(errors);
      });
    }
  }

  it("reports bare-CR line endings, which the lenient reading takes for no block at all", () => {
    expect(readFrontmatter("---\rtitle: Setup\r---\r")).toEqual({});
    expect(readFrontmatterStrict("---\rtitle: Setup\r---\r")).toEqual({
      values: {}, maps: {}, errors: [{ line: 1, message: "lines end in a bare CR: use LF or CRLF line endings" }], lines: {},
    });
    // The same with a byte-order mark in front.
    expect(readFrontmatterStrict(BOM + "---\rtitle: Setup\r---\r").errors).toEqual([
      { line: 1, message: "lines end in a bare CR: use LF or CRLF line endings" },
    ]);
    // A stray CR inside an otherwise LF block: reported once, for its line, whatever else the CR does to
    // the line — which is read exactly as the lenient reading reads it.
    expect(readFrontmatterStrict("---\ntitle: A\rB\n---\n")).toEqual({
      values: readFrontmatter("---\ntitle: A\rB\n---\n"),
      maps: {},
      errors: [{ line: 2, message: "line ends in a bare CR: use LF or CRLF line endings" }],
      lines: {},
    });
    expect(readFrontmatter("---\ntitle:\rB\n---\n")).toEqual({ title: "B" });
    expect(readFrontmatterStrict("---\ntitle:\rB\n---\n")).toEqual({
      values: { title: "B" },
      maps: {},
      errors: [{ line: 2, message: "line ends in a bare CR: use LF or CRLF line endings" }],
      lines: { title: 2 },
    });
  });
});

// Strict reading only adds errors: on every frontmatter in the repo's fixture corpus, both readings give
// the same values — so moving a reader from one to the other can change what is reported, never what is read.
describe("readFrontmatterStrict reads the same values as the lenient reading", () => {
  it("on every .md file in test-bench, in every spelling", async () => {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const files = execFileSync("git", ["ls-files", "test-bench/**/*.md", "test-bench/*.md"], { cwd: repo, encoding: "utf8" })
      .split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const md = await readFile(join(repo, file), "utf8");
      for (const [name, text] of spellings(md)) {
        expect(readFrontmatterStrict(text).values, `${file} (${name})`).toEqual(readFrontmatter(text));
      }
    }
  });
});

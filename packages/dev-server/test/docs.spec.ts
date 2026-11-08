// CHARACTERISATION TESTS for the docs/Markdown rendering path.
//
// Written to pin CURRENT behaviour before `renderDoc` and the `_md` singleton are extracted into
// their own module, so the extraction can be proven behaviour-preserving. Until this spec existed
// the entire path was unguarded — no assertion anywhere in the repo touched rendered doc output.
//
// WHY THESE ASSERT OVER HTTP. `renderDoc`, `_resolveFence`, `_resolvePatternLinks` and `_md` are all
// module-private. Exporting them to make them testable would change the subject in order to test it,
// and would couple the tests to the current file layout. Asserting on `/api/component/:id` -> `.doc`
// is extraction-agnostic: these tests do not care where the renderer lives, so they must pass
// UNCHANGED across the move. If they need editing, the move was not behaviour-preserving.
//
// THREE LOAD-BEARING PROPERTIES pinned here, none previously tested:
//   1. `validateLink` is a positive allowlist — the only thing stopping `javascript:` in a doc.
//   2. `html: false` — author raw HTML is escaped, never injected into the SHELL (not the iframe).
//   3. The `pattern` fence is the ONE deliberately-unescaped path (the self-trust boundary). Its
//      asymmetry with `src-html` is intentional; "consistently" escaping it would kill live embeds.
//
// A NOTE ON SELECTORS: Shiki emits randomised per-render class names (`__shiki_1qoj64`). Never
// assert on those — assert on the stable wrappers (`shiki-container`, `copy-btn`, `data-raw`).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";
import { save } from "../../../test-support/save.js";

const here      = dirname(fileURLToPath(import.meta.url));
const testBench = join(here, "../../../test-bench");

const config = defineConfig({
  sourceDir:   "./src",
  patternsDir: "./src/patterns",
  outDir:      "./dist",
  styles:      { strategy: "parallel", dir: "./src/styles" },
  themes:      { dir: "./themes", default: "light", switch: "attribute" },
  assets:      { strategy: "central", dir: "./assets" },
  scriptsDir:  "./src/scripts",
});

interface Detail {
  doc?: string;
  title?: string;
  status?: string;
  source?: { md?: string };
}

describe("docs rendering — characterisation", () => {
  let server: { port: number; close: () => Promise<void> };
  let specimen = "";

  const detail = async (id: string): Promise<Detail> => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${id}`);
    return res.json() as Promise<Detail>;
  };

  beforeAll(async () => {
    server = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
    specimen = (await detail("atoms/md-specimen")).doc ?? "";
    expect(specimen.length).toBeGreaterThan(0); // guard: the fixture must actually render
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  // ---- Markdown baseline -----------------------------------------------------------------

  describe("markdown baseline (md-specimen)", () => {
    it("renders all six heading levels", () => {
      for (const h of [1, 2, 3, 4, 5, 6]) {
        expect(specimen).toContain(`<h${h}>`);
      }
    });

    it("renders nested lists, blockquote, table and inline formatting", () => {
      expect(specimen).toContain("<ul>");
      expect(specimen).toContain("<ol>");
      expect(specimen).toContain("<blockquote>");
      expect(specimen).toContain("<table>");
      expect(specimen).toContain("<s>");          // ~~strikethrough~~
      expect(specimen).toContain("<code>");
    });

    it("strips leading front matter from the rendered body", () => {
      expect(specimen).not.toContain("title: Markdown Specimen");
      expect(specimen).not.toContain("status: stable");
    });
  });

  // ---- Security --------------------------------------------------------------------------

  describe("security", () => {
    it("allows the safe link schemes through", () => {
      expect(specimen).toContain('<a href="https://example.com">');
      expect(specimen).toContain('<a href="#heading-2">');
    });

    it("escapes fence content rather than emitting it live (src-template)", () => {
      // The handlebars source must arrive as escaped text, not as parseable markup.
      expect(specimen).toContain("&#x3C;");
      expect(specimen).not.toContain('<button type="{{type}}"');
    });

    it("carries raw source in data-raw with quotes escaped", () => {
      expect(specimen).toContain('<div class="shiki-container" data-raw="');
      expect(specimen).toContain("&quot;");
    });
  });

  // ---- Pattern cross-links ---------------------------------------------------------------

  describe("pattern: cross-links", () => {
    it("resolves a plain target to a navigable pattern-link", () => {
      expect(specimen).toContain(
        '<a href="/atoms/button" class="pattern-link" data-pattern-id="atoms/button">',
      );
    });

    it("carries the variant on a ~variant target", () => {
      expect(specimen).toContain(
        '<a href="/atoms/button#secondary" class="pattern-link" data-pattern-id="atoms/button" data-variant="secondary">',
      );
    });

    // The anti-rot feature: a typo'd cross-link must read as broken, not as a working link.
    it("marks an unresolved target broken and NOT a live jump", () => {
      expect(specimen).toContain(
        '<a href="#" class="pattern-link--unresolved" aria-disabled="true">Missing component</a>',
      );
      expect(specimen).not.toContain('data-pattern-id="atoms/no-such-component"');
    });
  });

  // ---- Fences ----------------------------------------------------------------------------

  describe("fences", () => {
    // THE trust boundary. `pattern` injects live component HTML into the shell, by design.
    it("pattern fence injects LIVE unescaped component markup", () => {
      expect(specimen).toContain(
        '<div class="doc-example"><button type="button" class="df-button df-button--primary">',
      );
    });

    it("src-html shows the same render ESCAPED — the safe twin of the pattern fence", () => {
      // Same component, two fences: one live, one escaped. That asymmetry is deliberate.
      expect(specimen).toContain("df-button df-button--primary");     // live embed
      expect(specimen).toContain("&#x3C;");                            // escaped twin
    });

    it("highlights ordinary fences through the shared Shiki pipeline", () => {
      expect(specimen).toContain('class="shiki shiki-themes');
      expect(specimen).toContain('<button class="copy-btn"');
    });

    it("emits the documented error strings for unresolvable specs", () => {
      expect(specimen).toContain(
        '<p class="doc-error">[src-template: atoms/no-such-component — no template file]</p>',
      );
      expect(specimen).toContain(
        '<p class="doc-error">[src-data: atoms/button~no-such-variant — unknown variant]</p>',
      );
      expect(specimen).toContain(
        '<p class="doc-error">[src-html: atoms/no-such-component — render error]</p>',
      );
    });
  });

  // ---- Variant doc fallback --------------------------------------------------------------

  describe("variant doc fallback (one-edge)", () => {
    // NOTE on fixture choice: atoms/badge~warning is the obvious candidate (no own .md) but it is a
    // FALSE NEGATIVE — badge.md is front-matter-only, so the fallback fires and inherits an empty
    // body. It cannot distinguish "fallback worked" from "fallback never ran". atoms/button~secondary
    // is the real test: button.md has a body, so inheritance is observable.
    it("a variant with no own .md inherits the base component's doc body", async () => {
      const base    = await detail("atoms/button");
      const variant = await detail("atoms/button~secondary");

      expect(base.doc).toBeTruthy();
      expect(variant.doc).toBe(base.doc);
    });

    it("inherits the BODY only — metadata stays the variant's", async () => {
      const base    = await detail("atoms/button");
      const variant = await detail("atoms/button~secondary");

      expect(variant.doc).toBe(base.doc);
      expect(variant.title).not.toBe(base.title);
      expect(base.title).toBe("Button");
      expect(variant.title).toBe("button~secondary");
    });

    it("a variant WITH its own .md keeps it", async () => {
      const base    = await detail("atoms/badge");
      const variant = await detail("atoms/badge~info");

      expect(variant.doc).toBeTruthy();
      expect(variant.doc).not.toBe(base.doc);
      expect(variant.title).toBe("Badge — Info variant");
    });

    it("an empty base doc yields no inherited doc (fallback fires, finds nothing)", async () => {
      // badge.md is front-matter only. Pinned because it is indistinguishable from a broken
      // fallback unless you know the fixture — see the note above.
      const variant = await detail("atoms/badge~warning");
      expect(variant.doc ?? "").toBe("");
    });
  });
});

// ---- The URL allowlist -------------------------------------------------------------------
//
// Needs dangerous hrefs, which no committed fixture contains — and must not be added to the real
// test-bench, which the Playwright suite and the HMR specs render against. So this boots a server
// over a temp COPY, following the diagnostics-graph.spec precedent.

describe("docs security — validateLink allowlist", () => {
  let dir = "";
  let server: { port: number; close: () => Promise<void> };
  let doc = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pd-docs-sec-"));
    await cp(testBench, dir, { recursive: true });
    await save(
      join(dir, "src/patterns/atoms/chip/chip.md"),
      [
        "---", "title: Chip", "status: draft", "---", "",
        "[js](javascript:alert(1))",
        "[data](data:text/html,<script>alert(1)</script>)",
        "[vb](vbscript:msgbox(1))",
        "[ok-https](https://example.com/x)",
        "[ok-mailto](mailto:a@b.c)",
        "[ok-rel](./sibling.md)",
        "",
        "<img src=x onerror=alert(1)>",
        "",
      ].join("\n"),
    );
    server = await startDevServer(config, dir, { port: 0, wsPort: 0 });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/chip`);
    doc = ((await res.json()) as Detail).doc ?? "";
    expect(doc.length).toBeGreaterThan(0);
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // Observed behaviour, which is stronger than "the href is sanitised": markdown-it does not emit
  // an anchor AT ALL for a rejected URL. The source stays literal `[js](javascript:...)` text in a
  // <p>. So the scheme string is still present in the document — as inert text, never as an href.
  // Asserting `not.toContain("javascript:")` would therefore fail against correct, safe behaviour.
  it("never emits a rejected scheme as an href", () => {
    expect(doc).not.toContain('href="javascript:');
    expect(doc).not.toContain('href="data:');
    expect(doc).not.toContain('href="vbscript:');
    expect(doc).not.toContain("<a href=\"javascript");
  });

  it("leaves a rejected link as literal inert text rather than dropping content", () => {
    expect(doc).toContain("[js](javascript:alert(1))");
    expect(doc).toContain("[vb](vbscript:msgbox(1))");
  });

  it("escapes markup smuggled inside a rejected data: URL", () => {
    expect(doc).not.toContain("<script>alert(1)</script>");
    expect(doc).toContain("&lt;script&gt;");
  });

  it("allows https, mailto and relative hrefs", () => {
    expect(doc).toContain('href="https://example.com/x"');
    expect(doc).toContain('href="mailto:a@b.c"');
    expect(doc).toContain('href="./sibling.md"');
  });

  it("escapes author raw HTML instead of injecting it into the shell (html: false)", () => {
    expect(doc).not.toContain("<img src=x onerror=");
    expect(doc).toContain("&lt;img");
  });
});

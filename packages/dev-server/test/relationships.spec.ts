import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";

const here       = dirname(fileURLToPath(import.meta.url));
const testBench  = join(here, "../../../test-bench");
const fixtureDir = join(here, "scss-fixtures");

const config = defineConfig({
  sourceDir:   "./src",
  patternsDir: "./src/patterns",
  outDir:      "./dist",
  styles:      { strategy: "parallel", dir: "./src/styles" },
  themes:      { dir: "./themes", default: "light", switch: "attribute" },
  assets:      { strategy: "central", dir: "./assets" },
  scriptsDir:  "./src/scripts",
});

const fixtureConfig = defineConfig({
  sourceDir:   ".",
  patternsDir: "./patterns",
  outDir:      "./dist",
  styles:      { strategy: "parallel", dir: "./styles" },
  themes:      { dir: "./themes", default: "light", switch: "attribute" },
  assets:      { strategy: "central", dir: "./assets" },
  scriptsDir:  "./scripts",
});

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
  try { await fn(server.port); } finally { await server.close(); }
}

async function withFixtureServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server = await startDevServer(fixtureConfig, fixtureDir, { port: 0, wsPort: 0 });
  try { await fn(server.port); } finally { await server.close(); }
}

async function fetchDetail(port: number, id: string) {
  const res = await fetch(`http://127.0.0.1:${port}/api/component/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${id}`);
  return res.json() as Promise<{
    relationships: {
      available: boolean;
      uses: string[];
      usedBy: string[];
      styleUses: string[];
      styleUsesModules: string[];
      styleModules: string[];
      inlineStyles: boolean;
      utilityClasses: boolean;
      unattributedClasses: string[];
    }
  }>;
}

async function fetchRaw(port: number, id: string) {
  const res = await fetch(`http://127.0.0.1:${port}/api/component/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${id}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ---- Composition edges (test-bench) ----

describe("relationships derivation — composition edges", () => {
  it("molecules/field.uses contains atoms/input", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "molecules/field");
      expect(d.relationships.uses).toContain("atoms/input");
    });
  }, 15000);

  it("atoms/input.usedBy contains molecules/field", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/input");
      expect(d.relationships.usedBy).toContain("molecules/field");
    });
  }, 15000);

  it("organisms/buttonbar.uses contains atoms/button", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/buttonbar");
      expect(d.relationships.uses).toContain("atoms/button");
    });
  }, 15000);

  it("atoms/button.usedBy contains organisms/buttonbar", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      expect(d.relationships.usedBy).toContain("organisms/buttonbar");
    });
  }, 15000);

  it("organisms/card.uses contains molecules/media", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(d.relationships.uses).toContain("molecules/media");
    });
  }, 15000);

  it("molecules/media.uses contains atoms/icon", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "molecules/media");
      expect(d.relationships.uses).toContain("atoms/icon");
    });
  }, 15000);

  it("atoms/button.uses is empty (no partials in button.hbs)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      expect(d.relationships.uses).toHaveLength(0);
    });
  }, 15000);

  it("organisms/toolbar.uses is empty (no partials — writes classes directly)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/toolbar");
      expect(d.relationships.uses).toHaveLength(0);
    });
  }, 15000);

  it("derivation is deterministic — same output on repeated calls", async () => {
    await withServer(async (port) => {
      const a = await fetchDetail(port, "molecules/field");
      const b = await fetchDetail(port, "molecules/field");
      expect(a.relationships.uses).toEqual(b.relationships.uses);
      expect(a.relationships.styleUses).toEqual(b.relationships.styleUses);
    });
  }, 15000);
});

// ---- Class-borrowing styleUses — the headline, FAILS under regex ----

describe("relationships derivation — class-borrowing styleUses (test-bench)", () => {
  it("organisms/toolbar.styleUses == [atoms/button] (df-button/--primary/--ghost borrowed in .hbs)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/toolbar");
      expect(d.relationships.available).toBe(true);
      // toolbar.hbs writes class="df-button df-button--primary" and class="df-button df-button--ghost"
      // directly — no {{> atoms-button}} partial. The class-borrowing scan detects them.
      // FAILS if class-borrowing or source-map BEM attribution is broken.
      expect(d.relationships.styleUses).toEqual(["atoms/button"]);
    });
  }, 15000);

  it("molecules/field.styleUses == [] (field.hbs uses only own classes)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "molecules/field");
      // field.hbs uses df-field, df-field__label, df-field__hint — all owned by field.scss.
      // The field.scss @use of button.scss is a convention violation → styleUsesModules, not styleUses.
      expect(d.relationships.styleUses).toHaveLength(0);
    });
  }, 15000);

  it("atoms/button.styleUses == [] (button.hbs uses only own classes)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      expect(d.relationships.styleUses).toHaveLength(0);
    });
  }, 15000);
});

// ---- Source-map BEM regression guards — each FAILS under regex on SCSS source ----

describe("relationships derivation — source-map BEM attribution guards", () => {
  it("df-field__hint is NOT in field.unattributedClasses (attributed to field via &__hint)", async () => {
    // field.scss has .df-field { &__hint { ... } }
    // The literal '.df-field__hint' does NOT appear in field.scss source.
    // A regex on source would miss it and classify it as unattributed.
    // Source-map traces compiled .df-field__hint back to field.scss → correctly attributed.
    await withServer(async (port) => {
      const d = await fetchDetail(port, "molecules/field");
      expect(d.relationships.unattributedClasses).not.toContain("df-field__hint");
    });
  }, 15000);

  it("organisms/toolbar.unattributedClasses == [] (df-button--primary/--ghost attributed via &--)", async () => {
    // button.scss has .df-button { &--primary { ... } &--ghost { ... } }
    // Literals '.df-button--primary' and '.df-button--ghost' do NOT appear in source.
    // A regex on source would leave them unattributed. Source-map resolves them to atoms/button.
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/toolbar");
      expect(d.relationships.unattributedClasses).toEqual([]);
    });
  }, 15000);

  it("df-media__figure is NOT in media.unattributedClasses (attributed to media via &__figure)", async () => {
    // media.scss has .df-media { &__figure { ... } &__body { ... } }
    // Same pattern: BEM variants only exist in compiled CSS, not as literals in source.
    await withServer(async (port) => {
      const d = await fetchDetail(port, "molecules/media");
      expect(d.relationships.unattributedClasses).not.toContain("df-media__figure");
      expect(d.relationships.unattributedClasses).not.toContain("df-media__body");
    });
  }, 15000);
});

// ---- __base__ sentinel — styleUses must not leak base classes ----

describe("relationships derivation — __base__ filter", () => {
  it("organisms/card.styleUses == [] (df-reset is __base__, must not appear in styleUses)", async () => {
    // card.hbs uses df-reset (defined in _reset.scss → __base__).
    // The __base__ filter must exclude it from styleUses.
    // If the filter is broken, card.styleUses would contain "__base__".
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(d.relationships.styleUses).toHaveLength(0);
      expect(d.relationships.styleUses).not.toContain("__base__");
    });
  }, 15000);
});

// ---- styleUsesModules: @use closure + convention-violation degradation ----

describe("relationships derivation — styleUsesModules (test-bench)", () => {
  it("atoms/button.styleUsesModules contains 00-base/tokens (via barrel @use)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      // button.scss @uses ../00-base (barrel). _tokens.scss is forwarded → appears here.
      // Use .toContain because the barrel also forwards _reset.scss → 00-base/reset may be present.
      expect(d.relationships.styleUsesModules).toContain("00-base/tokens");
    });
  }, 15000);

  it("molecules/field.styleUsesModules contains BOTH 00-base/tokens AND 01-atoms/button (degraded)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "molecules/field");
      // 00-base/tokens: real @use (via barrel)
      // 01-atoms/button: convention violation → degrades to plain non-navigable path here
      expect(d.relationships.styleUsesModules).toContain("00-base/tokens");
      expect(d.relationships.styleUsesModules).toContain("01-atoms/button");
    });
  }, 15000);

  it("molecules/field.styleUsesModules does NOT contain the barrel path itself", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "molecules/field");
      // _index.scss barrel must be filtered out (only its forwarded leaves appear).
      expect(d.relationships.styleUsesModules).not.toContain("00-base");
      expect(d.relationships.styleUsesModules).not.toContain("00-base/_index");
      expect(d.relationships.styleUsesModules).not.toContain("00-base/index");
    });
  }, 15000);

  it("@forward barrel proof: any component styleUsesModules contains 00-base/tokens, not the barrel", async () => {
    // Every component @uses ../00-base (barrel) which @forwards tokens and reset.
    // The barrel itself (_index.scss) must not appear — only the concrete modules surface.
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/toolbar");
      expect(d.relationships.styleUsesModules).toContain("00-base/tokens");
      expect(d.relationships.styleUsesModules).not.toContain("00-base");
      expect(d.relationships.styleUsesModules).not.toContain("00-base/_index");
    });
  }, 15000);
});

// ---- styleModules: base-layer class-borrowing provenance ----
// styleModules = shared/family modules that AUTHOR a class worn by the markup but belong to no
// component (the module-level analog of styleUses). Distinct from styleUsesModules (@use dep).

describe("relationships derivation — styleModules (base-layer provenance, test-bench)", () => {
  it("atoms/dual.styleModules names the shared partial that styles it (base-only component)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/dual");
      // dual's markup wears only base-authored classes (tb-shared-only, tb-dual — both resolve to
      // 00-base/shared-family). It owns no component class and @uses no module.
      expect(d.relationships.styleModules).toEqual(["00-base/shared-family"]);
      expect(d.relationships.styleUses).toHaveLength(0);
      expect(d.relationships.styleUsesModules).toHaveLength(0);
    });
  }, 15000);

  it("atoms/style-mix separates the two relationships: styleUses=[atoms/button] AND styleModules=[shared-family]", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/style-mix");
      // Wears .df-button (authored by atoms/button → component borrow) and .tb-shared-only
      // (authored by 00-base/shared-family → module borrow). They must land in different fields.
      expect(d.relationships.styleUses).toContain("atoms/button");
      expect(d.relationships.styleModules).toContain("00-base/shared-family");
      // Cross-contamination guard: neither relationship leaks into the other.
      expect(d.relationships.styleUses).not.toContain("00-base/shared-family");
      expect(d.relationships.styleModules).not.toContain("atoms/button");
    });
  }, 15000);

  it("atoms/button.styleModules is empty (genuinely no shared-module class — 'none' now means none)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      // button wears only its own classes; its @use of tokens is a dependency, not a worn class.
      expect(d.relationships.styleModules).toHaveLength(0);
      // styleUsesModules (@use) is untouched by this feature.
      expect(d.relationships.styleUsesModules).toContain("00-base/tokens");
    });
  }, 15000);

  it("atoms/ql-nested.styleModules resolves a nested _index barrel (keepBarrel resolver path)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/ql-nested");
      // .tb-ql-nested is authored in 01-atoms/quicklinks/_index.scss — a directory barrel that maps
      // to no component. The @use-graph resolver drops barrels (returns null), so this provenance is
      // ONLY recoverable via keepBarrel=true. A flat fixture cannot exercise this path — the
      // ql-icon twin. Without keepBarrel this array would be empty.
      expect(d.relationships.styleModules).toEqual(["01-atoms/quicklinks/index"]);
      expect(d.relationships.styleUses).toHaveLength(0);
    });
  }, 15000);

  it("53-guard (generalized): no styleModules/base-module id appears in ANY component's styleUses", async () => {
    // The Option (a) regression: styleUses stays component→component only. A base-module id leaking
    // into styleUses means the __base__ sentinel was repurposed and the graph was polluted.
    await withServer(async (port) => {
      type Node = { path: string; kind: "group" | "component"; children?: Node[] };
      const tree = await (await fetch(`http://127.0.0.1:${port}/api/tree`)).json() as { roots: Node[] };
      const ids: string[] = [];
      const walk = (n: Node) => {
        if (n.kind === "component") ids.push(n.path);
        for (const c of n.children ?? []) walk(c);
      };
      for (const root of tree.roots ?? []) walk(root);

      const allModuleIds = new Set<string>();
      const perCompStyleUses: Record<string, string[]> = {};
      for (const id of ids) {
        const d = await fetchDetail(port, id).catch(() => null);
        if (!d?.relationships?.available) continue;
        for (const m of d.relationships.styleModules ?? []) allModuleIds.add(m);
        perCompStyleUses[id] = d.relationships.styleUses ?? [];
      }
      expect(allModuleIds.size, "no styleModules ids surfaced — fixtures not discovered?").toBeGreaterThan(0);
      for (const [id, uses] of Object.entries(perCompStyleUses)) {
        for (const m of allModuleIds) {
          expect(uses, `base-module '${m}' leaked into ${id}.styleUses`).not.toContain(m);
        }
      }
    });
  }, 30000);
});

// ---- New fields: inlineStyles, unattributedClasses ----

describe("relationships derivation — new fields (test-bench)", () => {
  it("organisms/card.inlineStyles == true (has style='padding: 8px')", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(d.relationships.inlineStyles).toBe(true);
    });
  }, 15000);

  it("organisms/toolbar.inlineStyles == false (no inline styles)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/toolbar");
      expect(d.relationships.inlineStyles).toBe(false);
    });
  }, 15000);

  it("organisms/card.unattributedClasses == [df-crad] (typo class owned by nothing)", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(d.relationships.unattributedClasses).toEqual(["df-crad"]);
    });
  }, 15000);

  it("df-card and df-reset are NOT in card.unattributedClasses", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      // df-card is self-owned (excluded), df-reset is __base__ (excluded)
      expect(d.relationships.unattributedClasses).not.toContain("df-card");
      expect(d.relationships.unattributedClasses).not.toContain("df-reset");
    });
  }, 15000);

  it("atoms/button.unattributedClasses == []", async () => {
    await withServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      expect(d.relationships.unattributedClasses).toHaveLength(0);
    });
  }, 15000);

  it("styleUsedBy is absent from every payload", async () => {
    await withServer(async (port) => {
      const raw = await fetchRaw(port, "atoms/button");
      expect((raw.relationships as Record<string, unknown>)["styleUsedBy"]).toBeUndefined();
    });
  }, 15000);
});

// ---- scss-fixture: SCSS partial resolution forms (as-alias, index-file, @forward) ----

describe("relationships derivation — scss partial resolution (fixture)", () => {
  // card.scss @uses button (as alias, extension omitted) and badge (index-file form).
  // These are convention violations → degrade to styleUsesModules (non-navigable paths).
  // card.hbs uses .button and .badge/.badge__label → class-borrowing styleUses edges.
  // badge/_index.scss defines .badge { &__label { } } — BEM expansion guards source-map.

  it("organisms/card.styleUses contains atoms/button (class-borrowing: .button class in card.hbs)", async () => {
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(d.relationships.styleUses).toContain("atoms/button");
    });
  }, 15000);

  it("organisms/card.styleUses contains atoms/badge (class-borrowing: .badge class in card.hbs)", async () => {
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(d.relationships.styleUses).toContain("atoms/badge");
    });
  }, 15000);

  it("badge__label NOT in card.unattributedClasses (BEM source-map guard: &__label in badge/_index.scss)", async () => {
    // card.hbs uses class="badge__label" — a BEM modifier from badge/_index.scss &__label.
    // Source-map must trace it back to badge/_index.scss → atoms/badge.
    // Regex on SCSS source would miss &__label and leave badge__label as unattributed.
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(d.relationships.unattributedClasses).not.toContain("badge__label");
    });
  }, 15000);

  it("organisms/card.styleUsesModules contains 01-atoms/button (degraded @use with as alias)", async () => {
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      // card.scss @uses '../01-atoms/button' as btn → convention violation, degrades to module path.
      // FAILS if SCSS partial resolution is broken (as-alias, extension-omitted form).
      expect(d.relationships.styleUsesModules).toContain("01-atoms/button");
    });
  }, 15000);

  it("organisms/card.styleUsesModules contains 01-atoms/badge (degraded @use index-file form)", async () => {
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      // card.scss @uses '../01-atoms/badge' (dir with _index.scss) → convention violation.
      // FAILS if /index suffix is not stripped from normalized path.
      expect(d.relationships.styleUsesModules).toContain("01-atoms/badge");
    });
  }, 15000);

  it("atoms/button.styleUsesModules contains 00-base/tokens via @forward barrel", async () => {
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      // button.scss @uses ../00-base/base; _base.scss @forward "tokens".
      // loadedUrls follows @forward transitively → 00-base/tokens must appear.
      // FAILS if @forward traversal is not followed (missed-token regression).
      expect(d.relationships.styleUsesModules).toContain("00-base/tokens");
    });
  }, 15000);

  it("atoms/button.styleUses is empty in fixture (only shared module deps)", async () => {
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "atoms/button");
      // button.hbs uses only .button class — self-owned; no other component's classes.
      expect(d.relationships.styleUses).toHaveLength(0);
    });
  }, 15000);
});

// ---- Attribution regression guard: empty pipeline must FAIL, never silent [] ----
//
// If the source-map attribution pipeline (classOwnerIndex) is broken — e.g. CSS
// did not compile, the source-map is missing, or extraction returned nothing — then
// styleUses silently returns [] for every component and no other test catches it.
// These guards make that failure visible instead of letting it degrade to a
// false-green "no style borrowing detected" result.

describe("relationships derivation — attribution regression guard", () => {
  it("toolbar.styleUses is non-empty (proves classOwnerIndex was populated from test-bench CSS)", async () => {
    // toolbar.hbs writes df-button/df-button--primary/df-button--ghost — classes owned by
    // atoms/button. If classOwnerIndex is empty or attribution is broken, this returns []
    // and the test fails loudly. Never treat [] as a valid result here.
    await withServer(async (port) => {
      const d = await fetchDetail(port, "organisms/toolbar");
      expect(
        d.relationships.styleUses,
        "styleUses is [] — classOwnerIndex appears empty; source-map attribution pipeline is broken"
      ).not.toHaveLength(0);
    });
  }, 15000);

  it("fixture card.styleUses is non-empty (proves classOwnerIndex was populated from fixture CSS)", async () => {
    // organisms/card borrows .button and .badge from the fixture corpus. Same guard applied
    // to the fixture server: if the fixture CSS was not compiled or the index not built,
    // styleUses is silently [] and no fixture test catches it.
    await withFixtureServer(async (port) => {
      const d = await fetchDetail(port, "organisms/card");
      expect(
        d.relationships.styleUses,
        "fixture styleUses is [] — classOwnerIndex empty; check that fixture CSS compiled correctly"
      ).not.toHaveLength(0);
    });
  }, 15000);
});

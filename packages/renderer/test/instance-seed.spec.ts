import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index";

// Base-seeded id scope — M3 follow-up.
//
// Every id scope has a BASE; {{id 'name'}} = base-name. The base is either minted
// (from component slug + composition position, auto-distinct per instance) or
// supplied by a composing parent via a partial hash arg (base="<value>"), making
// the whole cluster externally predictable.

const here = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(here, "fixtures");
const render = createRenderer({ patternsDir });

const attr = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map(m => m[1]);

// ── Per-instance distinctness (composed, within one render) ─────────────────
// These are the cases that were previously broken: two invocations of the same
// partial within one render got the same id because there was no base disambiguation.

describe("per-instance distinctness — composed in one render tree", () => {
  it("organisms/buttonbar: two atoms-button get distinct btn ids", async () => {
    const out = await render({ component: "organisms/buttonbar" });
    const ids = attr(out.html, "id");
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("organisms/form: two molecules-field yield two coherent, distinct clusters", async () => {
    const out = await render({ component: "organisms/form" });

    const forVals   = attr(out.html, "for");
    const ids       = attr(out.html, "id");
    const ariaRefs  = attr(out.html, "aria-describedby");

    // Two label-for values, two input-ids, two aria-describedby, two hint-ids → 4 unique ids total
    expect(forVals).toHaveLength(2);
    expect(ids).toHaveLength(4);           // 2 inputs + 2 hints
    expect(ariaRefs).toHaveLength(2);

    const [for0, for1]       = forVals;
    const [aria0, aria1]     = ariaRefs;

    // Within each field: for == input id  and  aria-describedby == hint id
    expect(ids).toContain(for0);
    expect(ids).toContain(for1);
    expect(ids).toContain(aria0);
    expect(ids).toContain(aria1);

    // label-for pairs are distinct across fields (no collision)
    expect(for0).not.toBe(for1);
    expect(aria0).not.toBe(aria1);

    // Within each cluster: input-id ≠ hint-id (different names → different ids)
    expect(for0).not.toBe(aria0);
    expect(for1).not.toBe(aria1);

    // No id appears twice (no duplicates anywhere in the rendered page)
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("re-rendering the form yields byte-identical output (deterministic)", async () => {
    const a = await render({ component: "organisms/form" });
    const b = await render({ component: "organisms/form" });
    expect(a.html).toBe(b.html);
  });
});

// ── Supplied base ────────────────────────────────────────────────────────────
// A composing parent passes base="<value>" as a partial hash arg; the child's
// entire id cluster derives from that base, making it externally predictable.

describe("supplied base — parent seeds the child's id cluster", () => {
  it("base='email' produces email-input and email-hint", async () => {
    const out = await render({ component: "organisms/formbase" });
    expect(out.html).toContain("email-input");
    expect(out.html).toContain("email-hint");
  });

  it("label for='email-input' matches input id='email-input'", async () => {
    const out = await render({ component: "organisms/formbase" });
    const forVal = attr(out.html, "for")[0];
    const ids    = attr(out.html, "id");
    expect(forVal).toBe("email-input");
    expect(ids).toContain("email-input");
  });

  it("aria-describedby='email-hint' matches hint id='email-hint'", async () => {
    const out = await render({ component: "organisms/formbase" });
    const aria = attr(out.html, "aria-describedby")[0];
    const ids  = attr(out.html, "id");
    expect(aria).toBe("email-hint");
    expect(ids).toContain("email-hint");
  });

  it("a parent outside the field can reference email-hint by construction", async () => {
    // The key property: because the parent supplied the base, it KNOWS the cluster
    // members without inspecting rendered HTML. This test encodes that guarantee.
    const out = await render({ component: "organisms/formbase" });
    // Both cluster members are in the document and predictable from the supplied base.
    expect(attr(out.html, "id")).toEqual(expect.arrayContaining(["email-input", "email-hint"]));
  });

  it("supplied base is deterministic", async () => {
    const a = await render({ component: "organisms/formbase" });
    const b = await render({ component: "organisms/formbase" });
    expect(a.html).toBe(b.html);
  });
});

// ── Open decision: all-states-in-one-document ────────────────────────────────
// When the dev environment renders ALL states/instances of a component into one
// document (snapshot mode, multi-instance preview), two independent top-level
// render() calls produce the same base (pd-<slug>) and therefore the same ids.
// The per-INSTANCE seed for top-level renders is an open decision:
//   A. Caller supplies a seed on RenderInput (keeps render() pure, dev-env manages seeds) — leaning
//   B. Renderer manages a global counter (breaks render() purity)
// This note is the record. RenderInput used to carry an unused `seed?` placeholder for option A; it
// was removed as dead surface, and is added back — as a contract change — when this is decided.

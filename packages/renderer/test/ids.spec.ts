import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index";

// Milestone 3 — Named accessibility ids.
// The primitive: {{id 'name'}} returns a stable id for `name` within the render scope.
// Same name -> same id (so <label for> matches <input id>); different names -> different ids;
// the scope spans composition (a parent and a composed child resolve the same name to the same
// id, ACROSS the partial boundary); two renders of the same component on a page get DISTINCT ids;
// and the whole thing is deterministic (same input -> same output) — no Math.random, no globals.

const here = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(here, "fixtures");
const render = createRenderer({ patternsDir });

// helper: pull an attribute value out of rendered html
const attr = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);

describe("named ids — same name resolves to the same id within a render", () => {
  it("label `for` equals the input `id` ACROSS the partial boundary", async () => {
    const out = await render({ component: "molecules/field" });
    const forVals = attr(out.html, "for");
    const idVals = attr(out.html, "id");
    expect(forVals.length).toBe(1);
    // the label's `for` must equal SOME element's `id` (the input's), produced by {{id 'input'}}
    expect(idVals).toContain(forVals[0]);
  });

  it("aria-describedby points at the hint's id (a second, distinct name)", async () => {
    const out = await render({ component: "molecules/field" });
    const describedby = attr(out.html, "aria-describedby")[0];
    const idVals = attr(out.html, "id");
    expect(describedby).toBeTruthy();
    expect(idVals).toContain(describedby);
    // 'input' and 'hint' are different names -> different ids
    const forVal = attr(out.html, "for")[0];
    expect(describedby).not.toBe(forVal);
  });
});

describe("named ids — determinism and uniqueness", () => {
  it("is deterministic: same render yields identical ids (snapshots depend on this)", async () => {
    const a = await render({ component: "molecules/field" });
    const b = await render({ component: "molecules/field" });
    expect(a.html).toBe(b.html);
    expect(attr(a.html, "for")[0]).toBe(attr(b.html, "for")[0]);
  });

  it("never emits a Math.random-style id (ids are stable tokens, not random)", async () => {
    const out = await render({ component: "molecules/field" });
    const id = attr(out.html, "for")[0];
    // a deterministic named id is a readable token, not a long random number
    expect(id).toMatch(/[a-zA-Z]/);
  });

  it("two instances COMPOSED in one render tree get distinct ids for the same name", async () => {
    // The buttonbar composes atoms-button twice (saveBtn / cancelBtn). With the base-seeded
    // scope, each invocation gets its own base → distinct ids for {{id 'btn'}}.
    // This is the compositional case. See instance-seed.spec.ts for headline coverage.
    const out = await render({ component: "organisms/buttonbar" });
    const ids = attr(out.html, "id");
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    // OPEN DECISION: two independent top-level render() calls for the same component
    // produce the same base and therefore the same ids — this is the all-states-in-one-
    // document seeding problem. See RenderInput.seed in @pattern-dump/contracts.
  });
});

// Legacy shim: hTWOo's templates use getId / getLastId / getLastNumericId (69 usages, 20 files).
// The shim preserves that API but resolves deterministically + scoped (no module globals).
describe.skip("legacy shim — getId/getLastId map to the deterministic scope", () => {
  it("getLastId returns the id minted by the preceding getId, deterministically", async () => {
    const a = await render({ component: "molecules/field-legacy" }); // uses getId/getLastId
    const b = await render({ component: "molecules/field-legacy" });
    expect(a.html).toBe(b.html); // deterministic, unlike the Math.random original
    const forVal = attr(a.html, "for")[0];
    const idVals = attr(a.html, "id");
    expect(idVals).toContain(forVal); // for/id still match through the shim
  });
});
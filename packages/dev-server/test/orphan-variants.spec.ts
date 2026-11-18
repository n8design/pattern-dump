// A data-overlay variant (`chip~danger.json`) overlays data on its base's template. Without one (no `chip.hbs`
// beside it, or a base made of own-markup variants alone) it has no markup and stays out of discovery, as before,
// but no longer silently: discovery lists it (orphanVariants), and pd dev reports it like a handle collision, in
// the terminal and on the Console, the Console line replayed to a browser that connects later. Fixtures are
// throwaway, as in layout-mode.spec.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HmrMessage } from "@pattern-dump/contracts";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { surfaceCollisions } from "../src/surfacing.js";
import { save } from "../../../test-support/save.js";

let root = "";
afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function patterns(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pd-orphan-variants-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}

const FILES = {
  "atoms/chip/chip.hbs": "<span>{{label}}</span>",
  "atoms/chip/chip~danger.json": `{ "label": "Danger" }`,
  // No base template at all.
  "atoms/pill/pill~loud.json": `{ "tone": "loud" }`,
  // A base made of own-markup variants alone: a data variant has no markup to overlay there either.
  "atoms/badge/badge~info.hbs": "<b>i</b>",
  "atoms/badge/badge~warn.json": `{ "tone": "warn" }`,
};

describe("a data-overlay variant with no base template", () => {
  it("is left out of discovery and listed as an orphan variant", async () => {
    const dir = await patterns(FILES);
    const dr = await buildDiscoveryMap(dir);
    expect(dr.discoveryMap.has("atoms/chip~danger")).toBe(true);
    expect(dr.discoveryMap.has("atoms/pill~loud")).toBe(false);
    expect(dr.discoveryMap.has("atoms/badge~warn")).toBe(false);
    expect(dr.orphanVariants).toEqual([
      { variantPath: join(dir, "atoms/badge/badge~warn.json"), basePath: join(dir, "atoms/badge/badge.hbs") },
      { variantPath: join(dir, "atoms/pill/pill~loud.json"), basePath: join(dir, "atoms/pill/pill.hbs") },
    ]);
  });

  it("is reported in the terminal and on the Console, and replayed to a browser that connects later", async () => {
    const dir = await patterns(FILES);
    const dr = await buildDiscoveryMap(dir);
    const pushed: HmrMessage[] = [];
    let retained: HmrMessage[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await surfaceCollisions(dr.collisions, join(dir, ".."), { push: m => { pushed.push(m); }, retain: m => { retained = m; } }, dr.orphanVariants);
    const message = { type: "orphan-variant", variantPath: join(dir, "atoms/pill/pill~loud.json"), basePath: join(dir, "atoms/pill/pill.hbs") };
    expect(pushed).toContainEqual(message);
    expect(retained).toContainEqual(message);
    expect(retained.filter(m => m.type === "orphan-variant")).toHaveLength(2);
    expect(warn.mock.calls.map(c => String(c[0]))).toContainEqual(
      `[dev-server] ${join(dir, "atoms/pill/pill~loud.json")}: a data variant needs ${join(dir, "atoms/pill/pill.hbs")} to overlay, and there is none, so it is left out`,
    );
  });
});

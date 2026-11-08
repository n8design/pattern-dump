// Handles drop numeric ordering prefixes, as PatternLab's partial names do: `00-atoms/badge` is
// included as `atoms-badge`. Ids and routes keep the prefix; only the handle loses it.
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap, deriveHandle } from "./index.js";
import { save } from "../../../test-support/save.js";

describe("deriveHandle", () => {
  it("is the first folder plus the component name", () => {
    expect(deriveHandle("atoms/button")).toBe("atoms-button");
    expect(deriveHandle("molecules/quick-links/ql-list-button")).toBe("molecules-ql-list-button");
  });

  it("drops numeric ordering prefixes from both parts", () => {
    expect(deriveHandle("00-atoms/badge")).toBe("atoms-badge");
    expect(deriveHandle("01_molecules/card")).toBe("molecules-card");
    expect(deriveHandle("00-atoms/01-global/00-colors")).toBe("atoms-colors");
    expect(deriveHandle("00-atoms/badge~info")).toBe("atoms-badge~info");
  });

  it("keeps digits that are part of a name", () => {
    expect(deriveHandle("atoms/h1")).toBe("atoms-h1");
    expect(deriveHandle("atoms/2col-grid")).toBe("atoms-2col-grid");
    expect(deriveHandle("404/page")).toBe("404-page");
  });
});

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function files(base: string, paths: Record<string, string>): Promise<void> {
  for (const [p, text] of Object.entries(paths)) {
    await mkdir(dirname(join(base, p)), { recursive: true });
    await save(join(base, p), text);
  }
}

describe("buildDiscoveryMap — numbered folders", () => {
  it("keeps the prefix in the id and drops it from the handle, variants included", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-handles-"));
    await files(root, {
      "00-atoms/badge/badge.hbs": "<span>b</span>",
      "00-atoms/badge/badge~info.json": "{}",
      "01-molecules/card.hbs": "<article>{{> atoms-badge }}</article>",
    });
    const r = await buildDiscoveryMap(root);
    expect([...r.discoveryMap.keys()].sort()).toEqual(["00-atoms/badge", "00-atoms/badge~info", "01-molecules/card"]);
    expect(r.handleMap.get("atoms-badge")).toBe("00-atoms/badge");
    expect(r.handleMap.get("atoms-badge~info")).toBe("00-atoms/badge~info");
    expect(r.handleMap.get("molecules-card")).toBe("01-molecules/card");
    expect(r.handleMap.has("00-atoms-badge")).toBe(false);
  });

  it("two components that differ only by prefix collide", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-handles-"));
    await files(root, { "00-atoms/badge.hbs": "<b></b>", "atoms/badge.hbs": "<i></i>" });
    const r = await buildDiscoveryMap(root);
    expect(r.collisions.map(c => c.handle)).toEqual(["atoms-badge"]);
    expect(r.handleMap.get("atoms-badge")).toBe("00-atoms/badge");
  });
});

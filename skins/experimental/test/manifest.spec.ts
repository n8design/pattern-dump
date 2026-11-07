// The skin ships compiled helpers: its manifest names the `.js` its build writes from the TypeScript
// source, and that file loads where an installed copy would sit, under node_modules, where Node does not
// strip types. It exports what the source does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as source from "../helpers/skin.js";

const skin = fileURLToPath(new URL("../", import.meta.url));
let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-skin-manifest-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("the skin's manifest", () => {
  it("names compiled helpers, which the build has written", async () => {
    const { patternDump } = JSON.parse(await readFile(join(skin, "package.json"), "utf8")) as { patternDump: { helpers: string } };
    expect(patternDump.helpers).toBe("dist/helpers/skin.js");
    expect(existsSync(join(skin, patternDump.helpers))).toBe(true);
  });

  it("loads its helpers from a copy installed under node_modules, with the source's exports", async () => {
    const installed = join(tmp, "node_modules", "@pattern-dump", "skin-experimental", "dist", "helpers");
    await mkdir(installed, { recursive: true });
    await cp(join(skin, "dist", "helpers", "skin.js"), join(installed, "skin.js"));
    const built = await import(pathToFileURL(join(installed, "skin.js")).href) as Record<string, unknown>;
    expect(Object.keys(built).sort()).toEqual(Object.keys(source).sort());
    expect((built["skinTitleEm"] as (t: string) => number)("Storefront bench")).toBe(source.skinTitleEm("Storefront bench"));
  });
});

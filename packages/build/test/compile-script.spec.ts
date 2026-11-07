// A compiled behaviour script names its modules by their paths from the entry's folder, so the same
// source compiles to the same bytes wherever it sits, and the output names no folder of the machine.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScriptFile } from "../src/index.js";

let tmp = "";
const SOURCES = {
  "toggle.ts": `import { label } from "./lib/label.ts";\ndocument.body.dataset.toggle = label("on");\n`,
  "lib/label.ts": `export const label = (s: string): string => s.toUpperCase();\n`,
};

/** The scripts folder written at `dir`. */
async function scriptsAt(dir: string): Promise<string> {
  for (const [rel, text] of Object.entries(SOURCES)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return join(dir, "toggle.ts");
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-compile-script-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("compileScriptFile", () => {
  it("names each module by its path from the entry's folder", async () => {
    const js = await compileScriptFile(await scriptsAt(join(tmp, "a", "src", "scripts")));
    expect(js.match(/^\/\/ .*$/gm)).toEqual(["// lib/label.ts", "// toggle.ts"]);
  });

  it("gives the same bytes for the same source in two different folders", async () => {
    const one = await compileScriptFile(await scriptsAt(join(tmp, "one", "deep", "scripts")));
    const two = await compileScriptFile(await scriptsAt(join(tmp, "two")));
    expect(one).toBe(two);
    expect(one).not.toContain(tmp);
  });
});

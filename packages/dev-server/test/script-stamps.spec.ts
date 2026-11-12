// A behaviour script's URL in a preview carries the content hash of the script as served (`?v=<hash>`), not
// its file's mtime: the same on every machine and checkout, and changed exactly when the served bytes are.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

let root = "";
let server: DevServer;
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, scriptsDir: "./src/scripts",
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-script-stamps-"));
  for (const [rel, text] of Object.entries({
    "src/patterns/atoms/clicker/clicker.hbs": `<button data-clicker>Click</button>\n`,
    "src/patterns/atoms/clicker/clicker.md": `---\ntitle: Clicker\nrequireScript: [clicker]\n---\n`,
    "src/scripts/clicker.ts": `import { label } from "./label.js";\ndocument.querySelector("[data-clicker]")!.textContent = label;\n`,
    "src/scripts/label.ts": `export const label = "Clicked";\n`,
  })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

const origin = () => `http://127.0.0.1:${server.port}`;
const sha10 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);

/** The preview's script URL, and the bytes that URL serves. */
async function stampAndScript(): Promise<{ stamp: string; js: string }> {
  const doc = await (await fetch(`${origin()}/preview/atoms/clicker`)).text();
  const src = /<script type="module" src="([^"]+)">/.exec(doc)?.[1];
  expect(src).toMatch(/^\/_pd\/scripts\/clicker\.js\?v=/);
  const js = await (await fetch(origin() + src!)).text();
  return { stamp: new URL(src!, origin()).searchParams.get("v")!, js };
}

describe("a behaviour script's stamp", () => {
  it("is the content hash of the script as served", async () => {
    const { stamp, js } = await stampAndScript();
    expect(js).toContain("Clicked");
    expect(stamp).toBe(sha10(js));
  });

  it("doesn't follow the file's mtime", async () => {
    const before = (await stampAndScript()).stamp;
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, "src/scripts/clicker.ts"), later, later);
    expect((await stampAndScript()).stamp).toBe(before);
  });
});

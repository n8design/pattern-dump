// Asset references in markup and in compiled CSS are rewritten to the served /assets/<root>/… path,
// whether written relative (`../images/x`) or root-absolute (`/images/x`, the PatternLab form).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";
import { normalizeAssetRefs } from "../src/preview-document.js";

describe("normalizeAssetRefs", () => {
  const roots = ["images", "css"];

  it("rewrites relative references to an asset root, at any depth", () => {
    expect(normalizeAssetRefs(`<img src="../images/a.svg">`, roots)).toBe(`<img src="/assets/images/a.svg">`);
    expect(normalizeAssetRefs(`<use href="../../images/i.svg#x">`, roots)).toBe(`<use href="/assets/images/i.svg#x">`);
    expect(normalizeAssetRefs(`url(./images/a.png)`, roots)).toBe(`url(/assets/images/a.png)`);
  });

  it("rewrites root-absolute references at the start of a URL", () => {
    expect(normalizeAssetRefs(`<img src="/images/a.svg">`, roots)).toBe(`<img src="/assets/images/a.svg">`);
    expect(normalizeAssetRefs(`url(/images/a.png)`, roots)).toBe(`url(/assets/images/a.png)`);
    expect(normalizeAssetRefs(`url('/images/a.png')`, roots)).toBe(`url('/assets/images/a.png')`);
    expect(normalizeAssetRefs(`srcset="/images/a.png 1x, /images/b.png 2x"`, roots))
      .toBe(`srcset="/assets/images/a.png 1x, /assets/images/b.png 2x"`);
  });

  it("leaves served paths, other hosts and other folders alone", () => {
    for (const text of [
      `<img src="/assets/images/a.svg">`,
      `<img src="https://cdn.example/images/a.svg">`,
      `<img src="//cdn.example/images/a.svg">`,
      `<a href="/atoms/images/">`,
      `<img src="/media/a.svg">`,
    ]) expect(normalizeAssetRefs(text, roots), text).toBe(text);
  });

  it("does not rewrite root-absolute /assets/… for a root named assets", () => {
    expect(normalizeAssetRefs(`<img src="/assets/a.svg">`, ["assets"])).toBe(`<img src="/assets/a.svg">`);
  });
});

describe("asset references over HTTP (PatternLab-style project)", () => {
  const config = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    assets: { strategy: "central", dir: ["./assets/images", "./assets/css"] },
    documentBase: ["base"],
  });
  let dir = "";
  let server: { port: number; close: () => Promise<void> };
  const get = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pd-asset-refs-"));
    for (const d of ["src/patterns/atoms", "src/styles/atoms", "assets/images", "assets/css"]) {
      await mkdir(join(dir, d), { recursive: true });
    }
    await writeFile(join(dir, "src/patterns/atoms/logo.hbs"), `<img class="logo" src="/images/logo.svg" alt="">\n`);
    await writeFile(join(dir, "src/styles/atoms/logo.scss"), `.logo { background: url(/images/bg.svg); }\n`);
    await writeFile(join(dir, "src/styles/base.scss"), `body { background: url("../images/bg.svg"); }\n`);
    await writeFile(join(dir, "assets/images/logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`);
    await writeFile(join(dir, "assets/images/bg.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`);
    server = await startDevServer(config, dir, { port: 0, wsPort: 0 });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("root-absolute markup references are served", async () => {
    const doc = await (await get("/preview/atoms/logo")).text();
    expect(doc).toContain(`src="/assets/images/logo.svg"`);
    expect((await get("/assets/images/logo.svg")).status).toBe(200);
  });

  it("url() in component and base CSS points at the served path", async () => {
    expect(await (await get("/_pd/components/atoms/logo.css")).text()).toContain("url(/assets/images/bg.svg)");
    expect(await (await get("/_pd/base.css")).text()).toContain(`url("/assets/images/bg.svg")`);
    expect((await get("/assets/images/bg.svg")).status).toBe(200);
  });
});

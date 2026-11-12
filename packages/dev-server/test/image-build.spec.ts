// pd build writes the image variants a page references, and leaves the project's image cache holding exactly what
// the build used: a variant another build made, or one no page references any more, is removed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageVariantKey } from "@pattern-dump/build";
import { defineConfig } from "@pattern-dump/config";
import { imageUrl } from "@pattern-dump/contracts";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
let root = "";
let key = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-image-build-"));
  await mkdir(join(root, "src", "assets", "images"), { recursive: true });
  await save(join(root, "src", "patterns", "atoms", "a", "a.hbs"), "<p>a</p>\n");
  await save(join(root, "src", "patterns", "layouts", "page", "page.hbs"), "<main><h1>{{title}}</h1>{{{body}}}</main>\n");
  await save(join(root, "src", "patterns", "layouts", "page", "page.schema.json"),
    JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }));
  await copyFile(join(fixtures, "photo.jpg"), join(root, "src", "assets", "images", "harbour.jpg"));
  key = imageVariantKey(await readFile(join(fixtures, "photo.jpg")), 240, { quality: 75, effort: 4 });
  await save(join(root, "pages", "index.md"), `---\ntitle: Home\n---\n\n[The harbour](${imageUrl("images/harbour", key, 240)})\n`);
  // A variant cached by an earlier build that no page references now.
  await mkdir(join(root, "node_modules", ".cache", "pattern-dump", "images"), { recursive: true });
  await save(join(root, "node_modules", ".cache", "pattern-dump", "images", "ffffffffff.webp"), "stale");
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("pd build and image variants", () => {
  it("writes the variants pages reference, and the cache keeps exactly those", async () => {
    await buildStaticSite(defineConfig({
      sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
      styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
      storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://workbench.example.test/" },
    }), root, { outDir: join(root, "workbench"), pdVersion: "0.0.0-test" });
    expect(await readdir(join(root, "site", "_pd", "images", "images"))).toEqual([`harbour.${key}.240.webp`]);
    expect(await readdir(join(root, "node_modules", ".cache", "pattern-dump", "images"))).toEqual([`${key}.webp`]);
  });
});

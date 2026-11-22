// A style guide's pd build writes the image variants its workbench uses, as the site build does for its pages: every
// src and srcset candidate of a {{pd-image}} in a preview, and of one in a component's docs (an embedded example), is a file in the
// output. A project with no site, so only the workbench build could write them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@pattern-dump/config";
import { componentUrl, previewUrl, staticPathFor } from "@pattern-dump/contracts";
import { buildStaticSite, type StaticBuildReport } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
let root = "";
let out = "";
let report: StaticBuildReport;

/** Every image URL an HTML document writes under /_pd/images/: each src and each srcset candidate. */
const imageUrls = (html: string): string[] => [...new Set([
  ...[...html.matchAll(/\bsrc="([^"]+)"/g)].map(m => m[1]!),
  ...[...html.matchAll(/\bsrcset="([^"]+)"/g)].flatMap(m => m[1]!.split(",").map(c => c.trim().split(/\s+/)[0]!)),
].filter(u => u.startsWith("/_pd/images/")))];
const exists = (path: string) => stat(path).then(s => s.isFile(), () => false);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-build-images-"));
  out = join(root, "workbench");
  await mkdir(join(root, "src", "assets", "images"), { recursive: true });
  await copyFile(join(fixtures, "photo.jpg"), join(root, "src", "assets", "images", "harbour.jpg"));
  for (const [rel, body] of Object.entries({
    "src/patterns/atoms/pic/pic.hbs": `<figure class="pic">{{pd-image image alt=alt}}</figure>\n`,
    "src/patterns/atoms/pic/pic.schema.json": JSON.stringify({ required: ["image", "alt"], properties: {
      image: { type: "string", "x-pd-image": { widths: [160, 320], sizes: "(max-width: 40rem) 100vw, 20rem" } }, alt: { type: "string" } } }),
    "src/patterns/atoms/pic/pic.json": JSON.stringify({ image: "/assets/images/harbour.jpg", alt: "A harbour" }),
    "src/patterns/atoms/pic/pic.md": "# Pic\n\n```pattern atoms/pic\n```\n",
  })) await save(join(root, rel), body);
  report = await buildStaticSite(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  }), root, { outDir: out, pdVersion: "0.0.0-test", audit: false });
}, 120_000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("pd build of a style guide and its image variants", () => {
  it("writes every variant a preview's {{pd-image}} references", async () => {
    const preview = await readFile(join(out, staticPathFor(previewUrl("atoms/pic"))), "utf8");
    const urls = imageUrls(preview);
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(await exists(join(out, ...url.split("/").filter(Boolean))), url).toBe(true);
    expect(report.warnings.filter(w => w.startsWith("404"))).toEqual([]);
  });

  it("writes every variant an example in the component's docs references", async () => {
    const detail = JSON.parse(await readFile(join(out, staticPathFor(componentUrl("atoms/pic"))), "utf8")) as { doc?: string };
    const urls = imageUrls(detail.doc ?? "");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(await exists(join(out, ...url.split("/").filter(Boolean))), url).toBe(true);
  });
});

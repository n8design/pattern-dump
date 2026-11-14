// An image from a pattern package's assets (its manifest's `assets`), used in a site page's markdown at the URL the
// site serves it at: it gets its variants in the layout's slot like one of the site's own images. The demo's case: a
// content-only site with its own assets folder and a style guide package that ships placeholder images.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
const config = validateConfig(defineConfig({
  outDir: "./dist", packages: ["@acme/ds"], assets: { strategy: "central", dir: ["./media/content"] },
  storefront: { pagesDir: "./pages", outDir: "./site" },
}), "site");
const SITE = PD_HOSTS.storefront;
const SLOT = { widths: [160, 320], sizes: "100vw" };
let root = "";
let server: DevServer;

function get(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${SITE}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-prose-package-"));
  const pkg = join(root, "vendor", "ds");
  for (const [rel, body] of Object.entries({
    "vendor/ds/package.json": JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: { patterns: "patterns", assets: ["media/images"] } }),
    "vendor/ds/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "vendor/ds/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"],
      properties: { title: { type: "string" } }, "x-pd-prose-images": SLOT }),
    "pages/index.md": `---\ntitle: Home\n---\n\nThe site's own:\n\n![A launch](/assets/content/launch.jpg)\n\nThe package's:\n\n![A placeholder](/assets/images/placeholder.jpg)\n`,
  })) await save(join(root, rel), body);
  await mkdir(join(root, "media", "content"), { recursive: true });
  await mkdir(join(pkg, "media", "images"), { recursive: true });
  await copyFile(join(fixtures, "photo.jpg"), join(root, "media", "content", "launch.jpg"));
  await copyFile(join(fixtures, "photo.jpg"), join(pkg, "media", "images", "placeholder.jpg"));
  await mkdir(join(root, "node_modules", "@acme"), { recursive: true });
  await symlink(join("..", "..", "vendor", "ds"), join(root, "node_modules", "@acme", "ds"));
  server = await startDevServer(config, root, { port: 0, live: false });
}, 60_000);
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("a package's image in a site page's markdown", () => {
  it("is served where the page names it", async () => {
    expect((await get("/assets/images/placeholder.jpg")).status).toBe(200);
  });

  it("gets its variants like the site's own image", async () => {
    const page = await get("/");
    expect(page.body).not.toContain("is not an image in the assets");
    expect(page.status).toBe(200);
    const imgs = [...page.body.matchAll(/<img [^>]*>/g)].map(m => m[0]);
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toMatch(/src="\/_pd\/images\/content\/launch\.[0-9a-f]{10}\.320\.webp"/);
    expect(imgs[1]).toMatch(/src="\/_pd\/images\/images\/placeholder\.[0-9a-f]{10}\.320\.webp"/);
    for (const img of imgs) {
      for (const url of / srcset="([^"]+)"/.exec(img)![1]!.split(",").map(c => c.trim().split(/\s+/)[0]!)) {
        expect((await get(url)).status, url).toBe(200);
      }
    }
  });
});

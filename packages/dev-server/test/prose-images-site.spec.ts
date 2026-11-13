// A storefront page's prose images end to end, through the server pd build crawls: a raster from the assets in the
// page's markdown is written with its variants in the layout's slot (x-pd-prose-images), and every URL it writes is
// served on the storefront's host; a page whose layout declares no slot, and an image with no alt, fail the page
// with the file and line.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: "./src/assets" },
  storefront: { pagesDir: "./pages", outDir: "./site" },
});
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
const SLOT = { widths: [160, 320], sizes: "(min-width: 50rem) 40rem, 100vw" };
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
  root = await mkdtemp(join(tmpdir(), "pd-prose-images-"));
  await mkdir(join(root, "src", "assets", "images"), { recursive: true });
  await copyFile(join(fixtures, "photo.jpg"), join(root, "src", "assets", "images", "launch.jpg"));
  const layout = (slot: boolean) => JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } },
    ...(slot ? { "x-pd-prose-images": SLOT } : {}) });
  for (const [rel, body] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": layout(true),
    "src/patterns/layouts/plain/plain.hbs": `<main>{{{body}}}</main>\n`,
    "src/patterns/layouts/plain/plain.schema.json": layout(false),
    "pages/index.md": `---\ntitle: Home\n---\n\nThe launch:\n\n![The shuttle on its pad](/assets/images/launch.jpg)\n`,
    "pages/no-slot.md": `---\ntitle: No slot\nlayout: plain\n---\n\n![The shuttle on its pad](/assets/images/launch.jpg)\n`,
    "pages/no-alt.md": `---\ntitle: No alt\n---\n\nText first.\n\n![](/assets/images/launch.jpg)\n`,
  })) await save(join(root, rel), body);
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("prose images on the storefront", () => {
  it("a raster in a page's markdown has its variants in the layout's slot, each served on the storefront's host", async () => {
    const page = await get("/");
    expect(page.status).toBe(200);
    const img = /<img [^>]*>/.exec(page.body)?.[0] ?? "";
    expect(img).toMatch(/^<img src="\/_pd\/images\/images\/launch\.[0-9a-f]{10}\.320\.webp" /);
    expect(img).toContain(`sizes="auto, (min-width: 50rem) 40rem, 100vw"`);
    expect(img).toContain(`alt="The shuttle on its pad" loading="lazy" decoding="async"`);
    expect(img).toMatch(/ width="320" height="\d+" /);
    const urls = [/ src="([^"]+)"/.exec(img)![1]!, ...(/ srcset="([^"]+)"/.exec(img)![1]!.split(",").map(c => c.trim().split(/\s+/)[0]!))];
    expect(urls).toHaveLength(3); // src, and the srcset's two widths
    for (const url of urls) expect((await get(url)).status, url).toBe(200);
  });

  it("a page whose layout declares no slot fails, naming the file, line, layout and key", async () => {
    const page = await get("/no-slot/");
    expect(page.status).toBe(500);
    expect(page.body).toContain(`no-slot.md:6: the image /assets/images/launch.jpg needs its layout's slot for prose images: `
      + `layouts/plain declares no x-pd-prose-images`);
  });

  it("an image with no alt fails the page at its line", async () => {
    const page = await get("/no-alt/");
    expect(page.status).toBe(500);
    expect(page.body).toContain(`no-alt.md:7: the image /assets/images/launch.jpg has no alt text`);
  });
});

// pd dev follows the images beside a site's pages: an image added, changed or removed reloads the open page
// (page-changed), and what the page shows after it is the new state: its variants for the new bytes, or the
// page's problem once the image is gone. Asserted on the page as served after each handled step, never on the
// events alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

const fixtures = fileURLToPath(new URL("../../build/test/fixtures/images/", import.meta.url));
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: { pagesDir: "./pages", outDir: "./site" },
}), "page-images-watch");
const SITE = PD_HOSTS.storefront;

let tmp = "";
let bench: Bench;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-page-images-watch-"));
  const root = join(tmp, "project");
  for (const [rel, body] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<main><h1>{{title}}</h1>{{{body}}}</main>\n`,
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } },
      "x-pd-prose-images": { widths: [160, 320], sizes: "100vw" } }),
    "pages/index.md": `---\ntitle: Home\n---\n\n![A chart](./chart.png)\n`,
    "pages/guide/index.md": `---\ntitle: Guide\n---\n\n![A shot](./shot.png)\n`,
  })) await save(join(root, rel), body);
  await mkdir(join(root, "pages"), { recursive: true });
  await copyFile(join(fixtures, "flat.png"), join(root, "pages", "chart.png"));
  bench = new Bench(root, null);
  await bench.start(config);
}, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

function page(route: string): Promise<{ status: number; body: string }> {
  const port = Number(new URL(bench.origin).port);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: route, headers: { host: `${SITE}:${port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}
const variant = (html: string): string | undefined => /<img src="(\/_pd\/images\/[^"]+)"/.exec(html)?.[1];
/** Whether the step told the open page at `route` to reload. */
const reloads = (messages: string[], route: string) => messages.some(m => {
  const msg = JSON.parse(m) as { type: string; route?: string | null };
  return msg.type === "page-changed" && (msg.route === null || msg.route === route);
});

describe("pd dev and the images beside the pages", () => {
  it("a changed image: the open page reloads and shows the new bytes' variants", async () => {
    const before = variant((await page("/")).body);
    expect(before).toMatch(/^\/_pd\/images\/chart\.[0-9a-f]{10}\.\d+\.webp$/);
    const { messages } = await bench.step(async () => save(bench.at("pages/chart.png"), await readFile(join(fixtures, "alpha.png"))));
    expect(reloads(messages, "/"), messages.join("\n")).toBe(true);
    const after = await page("/");
    expect(after.status).toBe(200);
    expect(variant(after.body)).toMatch(/^\/_pd\/images\/chart\.[0-9a-f]{10}\.\d+\.webp$/);
    expect(variant(after.body)).not.toBe(before);
  });

  it("an added image: the open page that wanted it reloads and shows it", async () => {
    const missing = await page("/guide/");
    expect(missing.status).toBe(500);
    expect(missing.body).toContain(`the image ./shot.png is not beside the page: there is no guide/shot.png in the pages folder`);
    const { messages } = await bench.step(async () => save(bench.at("pages/guide/shot.png"), await readFile(join(fixtures, "flat.png"))));
    expect(reloads(messages, "/guide/"), messages.join("\n")).toBe(true);
    const shown = await page("/guide/");
    expect(shown.status).toBe(200);
    expect(variant(shown.body)).toMatch(/^\/_pd\/images\/guide\/shot\.[0-9a-f]{10}\.\d+\.webp$/);
  });

  it("a removed image: the open page reloads and names it as missing", async () => {
    const { messages } = await bench.step(() => bench.remove("pages/chart.png"));
    expect(reloads(messages, "/"), messages.join("\n")).toBe(true);
    const gone = await page("/");
    expect(gone.status).toBe(500);
    expect(gone.body).toContain(`the image ./chart.png is not beside the page: there is no chart.png in the pages folder`);
  });
});

// A social image that can't be made (D1): a card that is missing or stale, with no Playwright to render it, or a
// Chromium that won't start. The build doesn't stop: each such page takes the site's image (or none, and then a
// summary card), and the report names every page, with why and what to do. Playwright is faked here; the build is the
// source's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "../src/static-build.js";
import { BrowserUnavailableError, type PlaywrightModule } from "../src/storefront/browser-checks.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-social-d1-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** A real PNG, one grey, made here: the site's image. */
function greyPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w, 128)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const fm = (lines: string[]) => `---\n${lines.join("\n")}\n---\n\nText.\n`;
let n = 0;
async function project(): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({
    "src/patterns/layouts/page/page.hbs": "<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>",
    "src/patterns/layouts/page/page.schema.json": JSON.stringify({ properties: { title: { type: "string" } } }),
    "src/patterns/components/social-image/social-image.hbs": `<div class="card"><h1>{{title}}</h1></div>`,
    "src/patterns/components/social-image/social-image.schema.json": JSON.stringify({ properties: { title: { type: "string" } } }),
    "assets/share.png": greyPng(240, 126),
    "pages/index.md": fm(["title: Home"]),
    "pages/guide/index.md": fm(["title: Guide"]),
    "pages/about.md": fm(["title: About", "image: /assets/share.png"]),
  })) await save(join(root, rel), text);
  return root;
}
const configFor = (image: boolean) => validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./.out/wb", build: { workbench: false }, assets: { dir: "./assets" },
  site: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/", url: "https://example.test/",
    ...(image ? { image: "/assets/share.png" } : {}), socialImages: { component: "components/social-image" } },
} as never), "test");

const noPlaywright = async (): Promise<PlaywrightModule> => {
  throw new BrowserUnavailableError("pd build --browser needs Playwright in this project: npm install --save-dev playwright, then npx playwright install chromium");
};
const noChromium = async (): Promise<PlaywrightModule> =>
  ({ chromium: { launch: () => Promise.reject(new Error("Executable doesn't exist at /x/chrome\nmore")) } });
const build = (root: string, image: boolean, loadPlaywright: () => Promise<PlaywrightModule>) =>
  buildStaticSite(configFor(image), root, { outDir: join(root, ".out", "wb"), pdVersion: "0.0.0-test", loadPlaywright });
const headOf = (root: string, route: string) => readFile(join(root, ".out", "site", ...route.split("/").filter(Boolean), "index.html"), "utf8");
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];
const W1 = (page: string) => `${page}: no social image: its card is missing or stale and Playwright isn't installed: run pd social, or install Playwright`;

describe("a card that can't be made: the build goes on, and says so for every page", () => {
  it("without Playwright: each page takes the site's image, and is named", async () => {
    const root = await project();
    const report = await build(root, true, noPlaywright);
    const { missing, ...counts } = report.socialImages!;
    expect(counts).toEqual({ pages: 2, rendered: 0, cached: 0, committed: 0, siteImage: true });
    expect([...missing].sort()).toEqual([W1("guide/index.md"), W1("index.md")]);
    const head = await headOf(root, "/guide/");
    expect(meta(head, "og:image")).toMatch(/^https:\/\/example\.test\/assets\/share\.png\?v=[0-9a-f]{10}$/);
    expect(meta(head, "twitter:image")).toBe(meta(head, "og:image"));
    expect(meta(head, "twitter:card")).toBe("summary_large_image");
  });

  it("without the site's image either: no image at all, and a summary card", async () => {
    const root = await project();
    const report = await build(root, false, noPlaywright);
    expect(report.socialImages?.siteImage).toBe(false);
    expect(report.socialImages?.missing).toHaveLength(2);
    const head = await headOf(root, "/");
    expect(meta(head, "og:image")).toBeUndefined();
    expect(meta(head, "twitter:image")).toBeUndefined();
    expect(meta(head, "twitter:card")).toBe("summary");
  });

  it("with a Chromium that won't start: why, in each page's line", async () => {
    const root = await project();
    const report = await build(root, true, noChromium);
    expect(report.socialImages?.missing).toContain(
      "index.md: no social image: its card is missing or stale and Chromium didn't start (Executable doesn't exist at /x/chrome): run pd social, or npx playwright install chromium");
  });
});

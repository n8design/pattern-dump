// The demo's pages as pd dev serves them on the storefront's host, dressed by the skin from its pattern
// package: what the skin derives from a page and the nav (the hero's measure, the numbered sections,
// rows and chapters), and that its templates leave nothing an author writes unescaped. Requests set Host
// explicitly through node:http — fetch() silently ignores an overridden Host header.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { validateConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import demoConfig from "../demo/pattern-dump.config.js";

const skin = fileURLToPath(new URL("../", import.meta.url));
const patterns = join(skin, "patterns");

let server: DevServer;

beforeAll(async () => {
  server = await startDevServer(validateConfig(demoConfig, "skin-experimental demo"), join(skin, "demo"), { port: 0, live: false });
}, 120_000);
afterAll(async () => { await server?.close(); });

/** A storefront page's HTML, from the storefront's host. */
const page = (path: string): Promise<{ status: number; html: string }> => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `live.localhost:${server.port}` } }, res => {
    let html = "";
    res.setEncoding("utf8");
    res.on("data", c => { html += c; });
    res.on("end", () => resolve({ status: res.statusCode ?? 0, html }));
  });
  req.on("error", reject);
  req.end();
});

describe("the demo's pages, in the skin", () => {
  it("dresses the home page: the poster title's measure, the numbered sections, the footer line", async () => {
    const { status, html } = await page("/");
    expect(status).toBe(200);
    expect(html).toContain(`<h1 class="hero-title home-title" style="--sk-title-em: 5.026">Storefront bench</h1>`);
    // The demo's site sets a year, which the title carries.
    expect(html).toContain(`<a class="site-title" href="/" aria-current="page">Storefront bench <span class="site-year">©2026</span></a>`);
    expect(html).toContain(`<a href="/guides/">(01) Guides</a>`);
    expect(html).toContain(`<p class="site-footer-line">Built with Pattern Dump from the storefront bench.</p>`);
    // A row for every other part of the site, none for the home page itself, each with its description;
    // a folder's row lists its pages.
    const rows = parse(html).querySelectorAll(`nav.site-rows[aria-label="Sections"] .row`);
    expect(rows.map(r => [r.querySelector(".row-title")?.getAttribute("href"), r.querySelector(".row-title")?.text, r.querySelector(".row-description")?.text]))
      .toEqual([["/guides/", "(01) Guides", "Longer texts about the bench."], ["/about/", "(02) About", "What the bench is for."]]);
    expect(rows[0].querySelectorAll(".row-pages a").map(a => [a.getAttribute("href"), a.text])).toEqual([["/guides/setup/", "Setup"]]);
  });

  it("shows a folder's pages as rows on the folder's own page, with their descriptions, and none on a page without pages", async () => {
    const guides = parse((await page("/guides/")).html);
    expect(guides.querySelectorAll(`nav.site-rows[aria-label="In this section"] .row`).map(r => [r.querySelector(".row-title")?.getAttribute("href"), r.querySelector(".row-title")?.text, r.querySelector(".row-description")?.text]))
      .toEqual([["/guides/setup/", "(01) Setup", "How the bench is put together."]]);
    for (const route of ["/about/", "/guides/setup/"]) {
      expect(parse((await page(route)).html).querySelectorAll(".site-rows"), route).toHaveLength(0);
    }
  });

  it("turns an article's sections into chapters: one <details> per h2, the first open, its heading in the summary", async () => {
    const html = parse((await page("/guides/setup/")).html);
    const chapters = html.querySelectorAll("details.chapter");
    expect(chapters.map(d => [d.hasAttribute("open"), d.querySelector("summary > h2.chapter-title")?.text])).toEqual([
      [true, "(01) Pages"], [false, "(02) Layouts"],
    ]);
    expect(chapters[1].querySelector(".chapter-body figure.doc-example iframe")?.getAttribute("src")).toBe("/preview/components/callout~warning");
    // Every h2 of the body is a chapter's heading: none is left in the running text.
    expect(html.querySelectorAll(".article-body h2:not(.chapter-title)")).toHaveLength(0);
  });

  it("marks an article's section current in the header: the page itself has no entry there", async () => {
    const { html } = await page("/guides/setup/");
    expect(html).toContain(`<a href="/guides/" aria-current="true">(01) Guides</a>`);
    expect(html).not.toContain(`<a href="/" aria-current="page">`);
  });
});

describe("the skin's templates", () => {
  it("use the page's body, or the slices of it the chapters helper cuts, as their only unescaped values", async () => {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".hbs")) for (const m of (await readFile(p, "utf8")).matchAll(/\{\{\{[^}]*\}\}\}/g)) found.push(`${p.slice(patterns.length + 1)}: ${m[0]}`);
      }
    };
    await walk(join(patterns, "layouts"));
    await walk(join(patterns, "partials"));
    // A page's body, or the two slices of it the chapters helper cuts (its intro, a chapter's HTML):
    // the markdown renderer's output, which escapes everything an author writes.
    expect(found).toEqual([
      "layouts/article/article.hbs: {{{intro}}}", "layouts/article/article.hbs: {{{html}}}",
      "layouts/home/home.hbs: {{{body}}}",
      "layouts/page/page.hbs: {{{intro}}}", "layouts/page/page.hbs: {{{html}}}",
    ]);
  });
});

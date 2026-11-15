// Scheduled pages: a page whose own `date` is after today stays out of pd build as a draft does (no page, no listing,
// no sitemap entry, its old routes unwritten, a link to it a broken link) and appears with the first build on or after
// its date. A folder whose index.md is scheduled holds its pages back with it, until the later of the dates. pd dev
// shows it, listed with scheduled: true and a note. "Today" is the UTC date of the build's clock; the report says how
// many pages were held back, and until when.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import { readPages, todayOf } from "../src/storefront/pages.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-scheduled-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const md = (title: string, extra = "", body = `Text of ${title}.`) => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;
const schema = JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" }, page: { type: "object", properties: { children: {} } } } });

async function project(pages: Record<string, string>): Promise<string> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, body] of Object.entries({
    "src/patterns/layouts/page/page.hbs": `<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}<ul>{{#each page.children}}<li><a href="{{route}}">{{title}}</a></li>{{/each}}</ul></main><footer><p>F</p></footer>\n`,
    "src/patterns/layouts/page/page.schema.json": schema,
    ...Object.fromEntries(Object.entries(pages).map(([k, v]) => [`pages/${k}`, v])),
  })) await save(join(root, rel), body);
  return root;
}
const config = () => validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "https://wb.test/", url: "https://site.test/" },
}), "test");

const TODAY = "2026-11-15";
const site = {
  "index.md": md("Home"),
  "articles/index.md": md("Articles"),
  "articles/past.md": md("Past", "date: 2026-11-14\n"),
  "articles/today.md": md("Today", "date: 2026-11-15\n"),
  "articles/soon.md": md("Soon", "date: 2026-12-01\nredirectFrom: [/soon/]\n"),
  "articles/wip.md": md("Wip", "date: 2026-12-24\ndraft: true\n"),
  "events/index.md": md("Events", "date: 2026-11-20\n"),
  "events/early.md": md("Early", "date: 2026-11-01\n"),
  "events/late.md": md("Late", "date: 2027-01-10\n"),
};

describe("today", () => {
  it("is the UTC date of the clock, whatever the machine's time zone", () => {
    expect(todayOf(new Date("2026-11-30T23:30:00-05:00"))).toBe("2026-12-01");
    expect(todayOf(new Date("2026-12-01T00:30:00+02:00"))).toBe("2026-11-30");
  });
});

describe("readPages and scheduled pages", () => {
  it("shows a page dated after today, listed with scheduled: true; today's and earlier pages are published", async () => {
    const model = await readPages(join(await project(site), "pages"), { today: TODAY });
    expect(model.pages.map(p => p.route)).toContain("/articles/soon/");
    expect(model.entries.get("/articles/soon/")?.scheduled).toBe(true);
    for (const r of ["/articles/past/", "/articles/today/", "/events/early/"]) expect(model.entries.get(r)?.scheduled, r).toBe(false);
    // A draft is a draft, whatever its date.
    expect(model.entries.get("/articles/wip/")?.scheduled).toBe(false);
    expect(model.scheduled).toEqual([
      { path: "articles/soon.md", until: "2026-12-01" }, { path: "events/index.md", until: "2026-11-20" }, { path: "events/late.md", until: "2027-01-10" }]);
  });

  it("leaves them out, with every page under a scheduled folder, each until the later of the dates", async () => {
    const model = await readPages(join(await project(site), "pages"), { drafts: "leave-out", scheduled: "leave-out", today: TODAY });
    expect(model.problems).toEqual([]);
    expect(model.pages.map(p => p.route).sort()).toEqual(["/", "/articles/", "/articles/past/", "/articles/today/"]);
    expect(JSON.stringify(model.nav)).not.toMatch(/soon|events/);
    expect(model.folders.get("/articles/")?.children).toEqual(["/articles/past/", "/articles/today/"]);
    expect(model.scheduled).toEqual([
      { path: "articles/soon.md", until: "2026-12-01" }, { path: "events/early.md", until: "2026-11-20" },
      { path: "events/index.md", until: "2026-11-20" }, { path: "events/late.md", until: "2027-01-10" }]);
    expect(model.drafts).toEqual(["articles/wip.md"]);
  });

  it("publishes each with the first day on or after its date", async () => {
    const root = await project(site);
    const at = async (today: string) => (await readPages(join(root, "pages"), { scheduled: "leave-out", drafts: "leave-out", today })).pages.map(p => p.route);
    expect(await at("2026-11-30")).not.toContain("/articles/soon/");
    expect(await at("2026-12-01")).toContain("/articles/soon/");
    expect(await at("2026-12-01")).toEqual(expect.arrayContaining(["/events/", "/events/early/"]));
    expect(await at("2026-12-01")).not.toContain("/events/late/");
  });
});

describe("pd build and scheduled pages", () => {
  const CLOCK = new Date(`${TODAY}T12:00:00Z`);

  it("writes none of them, lists none, writes none of their old routes, and says until when in the report", async () => {
    const root = await project(site);
    const report = await buildStaticSite(config(), root, { outDir: join(root, "dist"), pdVersion: "0.0.0-test", now: CLOCK });
    expect(report.scheduled).toEqual([
      { path: "articles/soon.md", until: "2026-12-01" }, { path: "events/early.md", until: "2026-11-20" },
      { path: "events/index.md", until: "2026-11-20" }, { path: "events/late.md", until: "2027-01-10" }]);
    expect(existsSync(join(root, "site", "articles", "today", "index.html"))).toBe(true);
    for (const gone of ["articles/soon", "soon", "events"]) expect(existsSync(join(root, "site", gone)), gone).toBe(false);
    expect(await readFile(join(root, "site", "articles", "index.html"), "utf8")).not.toContain("/articles/soon/");
    expect(await readFile(join(root, "site", "sitemap.xml"), "utf8")).not.toMatch(/soon|events/);
  }, 60_000);

  it("builds a page once its day has come", async () => {
    const root = await project(site);
    const report = await buildStaticSite(config(), root, { outDir: join(root, "dist"), pdVersion: "0.0.0-test", now: new Date("2026-12-01T00:00:00Z") });
    expect(existsSync(join(root, "site", "articles", "soon", "index.html"))).toBe(true);
    expect(report.scheduled).toEqual([{ path: "events/late.md", until: "2027-01-10" }]);
  }, 60_000);

  it("a link to a scheduled page from a published page is a broken link", async () => {
    const root = await project({ ...site, "index.md": md("Home", "", "[Soon](/articles/soon/)") });
    await expect(buildStaticSite(config(), root, { outDir: join(root, "dist"), pdVersion: "0.0.0-test", now: CLOCK }))
      .rejects.toThrow(`  - /: <a href="/articles/soon/">: no page or file is built at /articles/soon/`);
  }, 60_000);

  it("a site with nothing scheduled has no scheduled pages in its report", async () => {
    const root = await project({ "index.md": md("Home", "date: 2026-11-01\n") });
    const report = await buildStaticSite(config(), root, { outDir: join(root, "dist"), pdVersion: "0.0.0-test", now: CLOCK });
    expect(Object.hasOwn(report, "scheduled")).toBe(false);
  }, 60_000);
});

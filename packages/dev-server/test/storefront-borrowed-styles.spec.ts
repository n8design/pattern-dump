// A template that uses a class another component owns, without including it, borrows that component's stylesheet:
// it is linked into the preview and into a site page. Kept (a design system borrows on purpose: 40 of hTWOo's 261
// components do), and said: STYLE_BORROWED (info) on the component, one per owner; a warning on a site page that
// renders the borrower, naming the page; the count in pd build's report. On a copy of the storefront bench with
// the case that was hard to find by hand: a search organism whose input reuses a search-field molecule's class.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { PD_HOSTS, type ComponentDetailResponse } from "@pattern-dump/contracts";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
const ADDED: Record<string, string> = {
  "src/patterns/molecules/search-field/search-field.hbs": `<form class="search-field" role="search"><label>Search <input type="search"></label></form>\n`,
  "src/styles/molecules/search-field.scss": ".search-field {\n  display: flex;\n}\n",
  // Borrows: its input wears the molecule's class, and it does not include the molecule.
  "src/patterns/organisms/search/search.hbs": `<div class="site-search"><input class="search-field" type="search" aria-label="Search"></div>\n`,
  "src/patterns/organisms/search/search.schema.json": JSON.stringify({ properties: {} }),
  "src/styles/organisms/search.scss": ".site-search {\n  margin: 0;\n}\n",
  // Does not borrow: it includes the molecule whose class it uses.
  "src/patterns/organisms/finder/finder.hbs": `<div class="search-field-wrap search-field">{{> molecules-search-field}}</div>\n`,
  "src/patterns/organisms/finder/finder.schema.json": JSON.stringify({ properties: {} }),
  "pages/find.md": "---\ntitle: Find\n---\n\n<pd-organisms-search></pd-organisms-search>\n",
  "pages/finder.md": "---\ntitle: Finder\n---\n\n<pd-organisms-finder></pd-organisms-finder>\n",
};
const MESSAGE = `organisms/search uses class "search-field" from molecules/search-field, so molecules/search-field's stylesheet `
  + `is linked too: include molecules/search-field if it belongs here, or rename the class`;

let tmp = "";
let root = "";
let server: DevServer;

async function benchCopy(extra: Record<string, string>): Promise<string> {
  const to = join(tmp, "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const dest = join(to, file.slice("storefront-bench/".length));
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(repo, file), dest);
  }
  for (const [rel, text] of Object.entries(extra)) {
    await mkdir(dirname(join(to, rel)), { recursive: true });
    await save(join(to, rel), text);
  }
  return to;
}
function get(path: string, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${host}:${server.port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.end();
  });
}
const borrowed = async (id: string) => (JSON.parse(await get(`/api/component/${id}`, PD_HOSTS.workbench)) as ComponentDetailResponse)
  .diagnostics.filter(d => d.kind === "STYLE_BORROWED");

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-borrowed-styles-"));
  root = await benchCopy(ADDED);
  server = await startDevServer(config, root, { port: 0, live: false });
}, 60_000);
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a stylesheet linked by a borrowed class", () => {
  it("is still linked, into the borrower's preview and the page that places it", async () => {
    const detail = JSON.parse(await get("/api/component/organisms/search", PD_HOSTS.workbench)) as ComponentDetailResponse;
    expect(detail.document).toContain(`data-pd-comp="molecules/search-field"`);
    expect(await get("/find/", "live.localhost")).toContain(`data-pd-comp="molecules/search-field"`);
  });

  it("is an info on the borrower, one per owner; not on a component that includes the owner", async () => {
    expect(await borrowed("organisms/search")).toEqual([{ kind: "STYLE_BORROWED", severity: "info", source: "render", message: MESSAGE }]);
    expect(await borrowed("organisms/finder")).toEqual([]);
    expect(await borrowed("molecules/search-field")).toEqual([]);
  });

  it("is a warning on the site page that renders the borrower, naming the page, and counted by pd build", async () => {
    const out = join(tmp, "out");
    const report = await buildStaticSite(config, root, { outDir: out, basePath: "/", log: () => {} });
    expect(report.notes).toContain(`warning: find.md: ${MESSAGE}`);
    expect(report.notes.filter(n => n.startsWith("warning: finder.md:") && n.includes("search-field"))).toEqual([]);
    expect(report.borrowedStyles).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

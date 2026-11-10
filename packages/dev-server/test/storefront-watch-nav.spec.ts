// An edited page reloads every page when the edit changes what other pages show of it: its title,
// description or order, which are in every page's nav. Any other edit reloads only the page itself. On a
// copy of the storefront bench, so the repo is never written to (watch-harness.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let tmp = "";
let b: Bench;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-sf-watch-nav-"));
  const root = join(tmp, "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  // A page deeper than the nav reaches (it is one level deep): only its breadcrumbs show its folders.
  for (const [rel, text] of Object.entries({
    "pages/guides/deep/index.md": "---\ntitle: Deep\n---\nDeep.\n",
    "pages/guides/deep/more/index.md": "---\ntitle: More\n---\nMore.\n",
    "pages/guides/deep/more/leaf.md": "---\nlayout: doc\ntitle: Leaf\n---\nLeaf.\n",
  })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  b = new Bench(root, null);
  await b.start(validateConfig(benchConfig, "storefront-bench"));
}, 120_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** The page-changed messages a save of `rel`, with `edit` applied, sends. */
async function pageChanges(rel: string, edit: (text: string) => string): Promise<string[]> {
  const text = await readFile(b.at(rel), "utf8");
  const next = edit(text);
  expect(next).not.toBe(text); // the edit applies, so the case tests what it says
  const r = await b.step(() => save(b.at(rel), next));
  return r.messages.filter(m => m.startsWith(`{"type":"page-changed"`));
}

/** A storefront page, as the storefront host serves it. */
function page(route: string): Promise<string> {
  const url = new URL(b.origin);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: url.port, path: route, headers: { host: `${PD_HOSTS.storefront}:${url.port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => { body += c; });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.end();
  });
}
const breadcrumbs = (html: string) =>
  [.../<nav class="doc-breadcrumbs"[\s\S]*?<\/nav>/.exec(html)?.[0].matchAll(/<a href="[^"]*">([^<]*)<\/a>/g) ?? []].map(m => m[1]);

const own = (route: string) => [`{"type":"page-changed","route":"${route}"}`];
const every = [`{"type":"page-changed","route":null}`];

describe("an edited page", () => {
  it("reloads only itself when its body changes", async () => {
    expect(await pageChanges("pages/about.md", t => `${t}\nMore text.\n`)).toEqual(own("/about/"));
  }, 60_000);

  it("reloads only itself when frontmatter no other page shows changes", async () => {
    expect(await pageChanges("pages/guides/setup.md", t => t.replace("lede: Three folders", "lede: Three plain folders"))).toEqual(own("/guides/setup/"));
  }, 60_000);

  it("reloads every page when its title changes", async () => {
    expect(await pageChanges("pages/about.md", t => t.replace("title: About", "title: About us"))).toEqual(every);
  }, 60_000);

  it("reloads every page when its description changes", async () => {
    expect(await pageChanges("pages/about.md", t => t.replace("description: What the bench is for.", "description: Why the bench exists."))).toEqual(every);
  }, 60_000);

  it("reloads every page when its order changes", async () => {
    expect(await pageChanges("pages/about.md", t => t.replace("order: 2", "order: 0.5"))).toEqual(every);
  }, 60_000);

  it("reloads every page when the home page's order moves it in the nav", async () => {
    expect(await pageChanges("pages/index.md", t => t.replace("order: 0", "order: 5"))).toEqual(every);
  }, 60_000);

  it("reloads every page when a folder's title changes that only a deeper page's breadcrumbs show", async () => {
    expect(breadcrumbs(await page("/guides/deep/more/leaf/"))).toEqual(["Storefront bench", "Guides", "Deep", "More"]);
    expect(await pageChanges("pages/guides/deep/more/index.md", t => t.replace("title: More", "title: More still"))).toEqual(every);
    expect(breadcrumbs(await page("/guides/deep/more/leaf/"))).toEqual(["Storefront bench", "Guides", "Deep", "More still"]);
  }, 60_000);

  it("compares against the last edit, not the start: the next body edit reloads only itself again", async () => {
    expect(await pageChanges("pages/about.md", t => `${t}\nEven more text.\n`)).toEqual(own("/about/"));
  }, 60_000);
});

// pd dev watches its config file. A change to storefront.site alone is taken live: the next page request
// renders with the new values, and every page reloads. Any other change asks for a restart and is not
// taken; a config that does not load is an error, and the running values stay. On a copy of the storefront
// bench with its config as JSON, loaded again by the test itself (core owns loading: watch-harness.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = "pattern-dump.config.json";
let tmp = "";
let b: Bench;
let original: PatternDumpConfig;

/** The config file as JSON, written with save(). */
const writeConfig = (config: unknown, rel = CONFIG) => save(b.at(rel), `${JSON.stringify(config, null, 2)}\n`);

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
const footer = async (route = "/about/") => /<footer[\s\S]*?<p>([^<]*)<\/p>/.exec(await page(route))?.[1];

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-sf-watch-config-"));
  const root = join(tmp, "bench");
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  original = validateConfig(benchConfig, "storefront-bench");
  b = new Bench(root, null);
  await save(b.at(CONFIG), `${JSON.stringify(original, null, 2)}\n`);
  const reload = async () => validateConfig(JSON.parse(await readFile(b.at(CONFIG), "utf8")), CONFIG);
  await b.start(original, { configPath: b.at(CONFIG), reloadConfig: reload });
}, 120_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const withSite = (site: Record<string, unknown>): PatternDumpConfig =>
  ({ ...original, storefront: { ...original.storefront!, site: { ...original.storefront!.site, ...site } } });
const reloads = (messages: string[]) => messages.filter(m => m.startsWith(`{"type":"page-changed"`));
const errors = (messages: string[]) => messages.filter(m => m.startsWith(`{"type":"error"`)).map(m => (JSON.parse(m) as { message: string }).message);

describe("the config file in pd dev", () => {
  it("takes a storefront.site change live: every page reloads, and renders the new value", async () => {
    expect(await footer()).toBe("Built with Pattern Dump from the storefront bench.");
    const r = await b.step(() => writeConfig(withSite({ footer: "A new footer." })));
    expect(reloads(r.messages)).toEqual([`{"type":"page-changed","route":null}`]);
    expect(errors(r.messages)).toEqual([]);
    expect(await footer()).toBe("A new footer.");
    expect(await footer("/guides/setup/")).toBe("A new footer.");
  }, 60_000);

  it("sends nothing when nothing it reads changed", async () => {
    const r = await b.step(() => save(b.at(CONFIG), `${JSON.stringify(withSite({ footer: "A new footer." }))}\n`));
    expect(r.messages).toEqual([]);
  }, 60_000);

  it("asks for a restart for any other change, and takes none of it", async () => {
    const r = await b.step(() => writeConfig({ ...withSite({ footer: "Not taken." }), outDir: "./.out/elsewhere" }));
    expect(reloads(r.messages)).toEqual([]);
    expect(errors(r.messages)).toEqual([`${CONFIG} changed: restart pd dev to load it (only storefront.site is taken without a restart)`]);
    expect(await footer()).toBe("A new footer.");
  }, 60_000);

  it("reports a config that does not load, and keeps the running values", async () => {
    const r = await b.step(() => writeConfig({ ...withSite({ footer: "Not taken either." }), bogus: 1 }));
    expect(reloads(r.messages)).toEqual([]);
    expect(errors(r.messages)).toHaveLength(1);
    expect(errors(r.messages)[0]).toMatch(new RegExp(`^${CONFIG.replace(/\./g, "\\.")} cannot be loaded, so pd dev keeps running with the config it has: [\\s\\S]*bogus`));
    expect(await footer()).toBe("A new footer.");
  }, 60_000);

  it("compares with the config it runs with: back to a site-only change, it is taken again", async () => {
    const r = await b.step(() => writeConfig(withSite({ footer: "Taken after all." })));
    expect(reloads(r.messages)).toEqual([`{"type":"page-changed","route":null}`]);
    expect(await footer()).toBe("Taken after all.");
  }, 60_000);

  it("takes a change to a declared navigation live, on every page", async () => {
    const navLabels = async (route: string) =>
      [.../<nav class="site-footer-nav"[\s\S]*?<\/nav>/.exec(await page(route))?.[0].matchAll(/<a [^>]*>([^<]*)<\/a>/g) ?? []].map(m => m[1]);
    expect(await navLabels("/about/")).toEqual(["About", "Source", "Setup", "All guides"]);
    const footerNav = [{ page: "about.md" }, { href: "https://example.test/code", label: "Code" }];
    const r = await b.step(() => writeConfig(withSite({ footer: "Taken after all.", navigations: { footer: footerNav } })));
    expect(reloads(r.messages)).toEqual([`{"type":"page-changed","route":null}`]);
    expect(errors(r.messages)).toEqual([]);
    expect(await navLabels("/about/")).toEqual(["About", "Code"]);
    expect(await navLabels("/guides/setup/")).toEqual(["About", "Code"]);
  }, 60_000);
});

// The theme picker's order (themes.ts, themes.order) and where the theme switch comes from (server-config.ts): the
// order never depends on how a file system lists a folder, the project's switch wins over a package's, and a theme
// added or removed in pd dev takes its place in the one ordered list /api/themes serves.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import type { ThemeSummary } from "@pattern-dump/contracts";
import { orderThemeNames, reorderThemes, unknownThemeNames } from "../src/themes.js";
import { resolveServerConfig } from "../src/server-config.js";
import type { ResolvedPackage } from "../src/packages.js";
import { surfaceThemeNotes } from "../src/surfacing.js";
import { save } from "../../../test-support/save.js";

// readdir, shuffled where a test asks: ext4 lists a folder in hash order, APFS sorted.
const shuffle = { on: false };
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const readdir = (async (...args: Parameters<typeof real.readdir>) => {
    const entries = await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(...args);
    // Reversed: the one order sure to differ from a sorted listing.
    return shuffle.on ? [...entries].reverse() : entries;
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});
const { discoverThemeFiles } = await import("../src/themes.js");

// CTS's order, a real one: teams.* and the others, by name, wherever the files are.
const CTS = ["teal", "red", "purple", "orange", "green", "gray", "darkyellow", "darkblue", "blue", "teams.light", "teams.hc", "teams.dark"];

describe("orderThemeNames", () => {
  it("without an order: every name sorted, numbers by value", () => {
    expect(orderThemeNames(["teal10", "Blue", "teal2", "amber", "teal"])).toEqual(["amber", "Blue", "teal", "teal2", "teal10"]);
  });

  it("the listed names first, in the order's order, then the rest sorted", () => {
    expect(orderThemeNames(["blue", "zinc", "teams.dark", "red", "teal", "amber"], ["teal", "red", "blue", "teams.dark"]))
      .toEqual(["teal", "red", "blue", "teams.dark", "amber", "zinc"]);
    expect(orderThemeNames([...CTS].reverse(), CTS)).toEqual(CTS);
  });

  it("leaves out a listed name no theme has, and names it", () => {
    expect(orderThemeNames(["red", "blue"], ["teal", "red", "red"])).toEqual(["red", "blue"]);
    expect(unknownThemeNames(["teal", "red", "teal"], ["red", "blue"])).toEqual(["teal"]);
  });

  it("reorders a map in place", () => {
    const m = new Map([["zinc", 1], ["amber", 2], ["teal", 3]]);
    reorderThemes(m, ["teal"]);
    expect([...m.keys()]).toEqual(["teal", "amber", "zinc"]);
  });

  it("an unknown name is a warning at start, not an error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    surfaceThemeNotes(["teams.hc"], []);
    expect(warn.mock.calls.map(c => c[0])).toEqual([`[dev-server] themes.order names "teams.hc", and no theme has that name: it is left out of the order`]);
    warn.mockRestore();
  });
});

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-theme-order-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
async function write(files: Record<string, string>, root: string): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
}

describe("discoverThemeFiles", () => {
  it("project and package folders: one order, whatever readdir returns; the project's file hides a package's", async () => {
    const root = join(tmp, "dirs");
    await write({
      "themes/teal.theme.scss": "", "themes/red.theme.scss": "", "themes/blue.theme.scss": "",
      "pkg/themes/blue.theme.scss": "", "pkg/themes/teams.light.theme.scss": "", "pkg/themes/gray.theme.scss": "",
    }, root);
    const dirs = [join(root, "themes"), join(root, "pkg", "themes")];
    const plain = await discoverThemeFiles(dirs);
    shuffle.on = true;
    try {
      const shuffled = await discoverThemeFiles(dirs);
      expect(shuffled).toEqual(plain);
      expect(shuffled.map(t => t.name)).toEqual(["blue", "gray", "red", "teal", "teams.light"]);
      expect(shuffled.find(t => t.name === "blue")!.dir).toBe(join(root, "themes"));
      expect((await discoverThemeFiles(dirs, CTS)).map(t => t.name)).toEqual(["teal", "red", "gray", "blue", "teams.light"]);
    } finally { shuffle.on = false; }
  });
});

describe("the theme switch", () => {
  const config = defineConfig({ sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" } });
  const pkg = (name: string, value?: "attribute" | "stylesheet"): ResolvedPackage => ({
    name, version: "1.0.0", dir: `/nm/${name}`, exclude: [], direct: true, styles: true,
    manifest: { themes: { dir: "themes", ...(value ? { switch: value } : {}) } },
  });

  it("the project's setting wins over a package's, with a note naming both", () => {
    const cfg = resolveServerConfig({ ...config, themes: { default: "teal", switch: "attribute" } }, "/project", {}, [pkg("@acme/ds", "stylesheet"), pkg("@acme/b")]);
    expect(cfg.themeSwitch).toBe("attribute");
    expect(cfg.themeSwitchNotes).toEqual([`themes.switch is "attribute", and the pattern package @acme/ds asks for "stylesheet": the project's setting is used`]);
  });

  it("without the project's: stylesheet as soon as a package asks for it, else attribute; no note", () => {
    const sheet = resolveServerConfig({ ...config, themes: { default: "teal" } }, "/project", {}, [pkg("@acme/a", "attribute"), pkg("@acme/ds", "stylesheet")]);
    expect([sheet.themeSwitch, sheet.themeSwitchNotes]).toEqual(["stylesheet", []]);
    const attr = resolveServerConfig({ ...config, themes: { default: "teal" } }, "/project", {}, [pkg("@acme/a")]);
    expect([attr.themeSwitch, attr.themeSwitchNotes]).toEqual(["attribute", []]);
    const same = resolveServerConfig({ ...config, themes: { default: "teal", switch: "stylesheet" } }, "/project", {}, [pkg("@acme/ds", "stylesheet")]);
    expect(same.themeSwitchNotes).toEqual([]);
  });
});

describe("pd dev: /api/themes", { timeout: 60_000 }, () => {
  const get = (port: number, path: string) => new Promise<string>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path }, res => {
      let body = "";
      res.setEncoding("utf8").on("data", (c: string) => { body += c; });
      res.on("end", () => resolve(body));
    }).on("error", reject).end();
  });
  const names = async (port: number) => (JSON.parse(await get(port, "/api/themes")) as ThemeSummary[]).map(t => t.name);

  it("serves the themes in the order; one added in pd dev takes its place, one removed leaves it", async () => {
    const root = join(tmp, "live");
    await write({
      "src/patterns/atoms/x/x.hbs": "<p>x</p>\n", "src/styles/x.scss": "",
      "themes/red.theme.scss": "[data-theme=red] { --c: red; }\n", "themes/zinc.theme.scss": "[data-theme=zinc] { --c: gray; }\n",
      "themes/amber.theme.scss": "[data-theme=amber] { --c: orange; }\n",
    }, root);
    const { startDevServer } = await import("../src/index.js");
    const cfg = validateConfig(defineConfig({
      sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
      themes: { dir: "./themes", default: "red", order: ["zinc", "teal"] },
    }), "test");
    const server = await startDevServer(cfg, root, { port: 0, wsPort: 0, live: true });
    try {
      expect(await names(server.port)).toEqual(["zinc", "amber", "red"]);
      await save(join(root, "themes", "teal.theme.scss"), "[data-theme=teal] { --c: teal; }\n");
      await expect.poll(() => names(server.port), { timeout: 15_000 }).toEqual(["zinc", "teal", "amber", "red"]);
      await save(join(root, "themes", "blue.theme.scss"), "[data-theme=blue] { --c: blue; }\n");
      await expect.poll(() => names(server.port), { timeout: 15_000 }).toEqual(["zinc", "teal", "amber", "blue", "red"]);
      await rm(join(root, "themes", "amber.theme.scss"));
      await expect.poll(() => names(server.port), { timeout: 15_000 }).toEqual(["zinc", "teal", "blue", "red"]);
    } finally { await server.close(); }
  });
});

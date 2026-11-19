// Which style guide `pd init --site` names: a folder (read for its package name) or an npm name, with a range or not.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@pattern-dump/core";
import { resolveSitePackage } from "./site.js";
import { save } from "../../../../test-support/save.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

describe("resolveSitePackage", () => {
  it("a folder: its package's name, as a file: dependency relative to the site", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-site-"));
    await save(join(root, "styleguide", "package.json"), JSON.stringify({ name: "@acme/styleguide", patternDump: { patterns: "src/patterns" } }));
    expect(await resolveSitePackage("./styleguide", root, join(root, "site"))).toEqual({
      ok: true, site: { name: "@acme/styleguide", spec: "file:../styleguide", dir: join(root, "styleguide") }, warnings: [] });
    // A bare name that is a folder with a package.json is that folder.
    expect(await resolveSitePackage("styleguide", root, join(root, "web", "site"))).toMatchObject({ ok: true, site: { spec: "file:../../styleguide" } });
  });

  it("a folder without the patternDump field: a warning, not a stop", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-site-"));
    await save(join(root, "ui", "package.json"), JSON.stringify({ name: "acme-ui" }));
    const r = await resolveSitePackage("./ui", root, join(root, "site"));
    expect(r).toMatchObject({ ok: true, site: { name: "acme-ui", spec: "file:../ui" } });
    expect(r.ok && r.warnings).toEqual([expect.stringContaining(`acme-ui has no "patternDump" field in its package.json yet`)]);
  });

  // The block is built from the style guide's own config, so pasting it makes the package readable and agrees with the
  // config (a folder named in both must be the same in both, or loading the config fails).
  it("a style guide with a config but without the field: the exact block to add, from the config's folders", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-site-"));
    const ui = join(root, "ui");
    await save(join(ui, "package.json"), JSON.stringify({ name: "acme-ui", version: "1.0.0" }, null, 2));
    await save(join(ui, "pattern-dump.config.json"), JSON.stringify({
      sourceDir: "./lib", patternsDir: "./lib/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./lib/styles/" },
      documentBase: ["reset"], themes: { dir: "./tokens", default: "dark", switch: "stylesheet" },
      scriptsDir: "./lib/js", assets: { strategy: "central", dir: "./static" },
    }));
    const r = await resolveSitePackage("./ui", root, join(root, "site"));
    const block = [
      `"patternDump": {`,
      `  "patterns": "lib/patterns",`,
      `  "styles": {`,
      `    "dir": "lib/styles",`,
      `    "documentBase": [`,
      `      "reset"`,
      `    ]`,
      `  },`,
      `  "themes": {`,
      `    "dir": "tokens",`,
      `    "default": "dark",`,
      `    "switch": "stylesheet"`,
      `  },`,
      `  "scripts": "lib/js",`,
      `  "assets": [`,
      `    "static"`,
      `  ]`,
      `}`,
    ].join("\n");
    expect(r.ok && r.warnings).toEqual([`acme-ui has no "patternDump" field in its package.json yet, so Pattern Dump can't `
      + `read its patterns, styles and themes. Add this to ${join("./ui", "package.json")} (the folders of its config):\n${block}`]);

    const pkg = await readFile(join(ui, "package.json"), "utf8");
    await save(join(ui, "package.json"), pkg.replace(/\n}\s*$/, `,\n  ${block.split("\n").join("\n  ")}\n}\n`));
    expect(await resolveSitePackage("./ui", root, join(root, "site"))).toMatchObject({ ok: true, warnings: [] });
    await expect(loadConfig(ui)).resolves.toMatchObject({ patternsDir: "./lib/patterns" });
  });

  it("refuses a folder without a package.json or a name, and the site's own folder", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-site-"));
    await save(join(root, "noname", "package.json"), "{}");
    expect(await resolveSitePackage("./missing", root, join(root, "site"))).toEqual({ ok: false,
      reason: "./missing has no package.json: --site takes a style guide's npm name, or the folder of one" });
    expect(await resolveSitePackage("./noname", root, join(root, "site"))).toMatchObject({ ok: false, reason: expect.stringContaining(`has no package name`) });
    expect(await resolveSitePackage("./noname", root, join(root, "noname"))).toMatchObject({ ok: false, reason: expect.stringContaining("is the folder the site would be written to") });
  });

  it("an npm name: latest without a range, the range after the last @, a bad name refused", async () => {
    root = await mkdtemp(join(tmpdir(), "pd-site-"));
    expect(await resolveSitePackage("@acme/styleguide", root, join(root, "site"))).toEqual({ ok: true, site: { name: "@acme/styleguide", spec: "latest" }, warnings: [] });
    expect(await resolveSitePackage("@acme/styleguide@1.2.0", root, join(root, "site"))).toMatchObject({ ok: true, site: { name: "@acme/styleguide", spec: "1.2.0" } });
    expect(await resolveSitePackage("acme-ui@^2", root, join(root, "site"))).toMatchObject({ ok: true, site: { name: "acme-ui", spec: "^2" } });
    expect(await resolveSitePackage("Acme UI", root, join(root, "site"))).toMatchObject({ ok: false, reason: expect.stringContaining("is neither a folder nor an npm package name") });
  });
});

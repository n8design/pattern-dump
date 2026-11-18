// Symbol sets (`requireAssets: [id]` in a component's .md) are looked up in every asset folder, in order, the first
// that has the file winning: the project's folders come before a package's. A preview inlines what it finds, hidden
// with display:none as before; a set no folder has is left out of the preview, and reported to the caller.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { findSvgSets } from "../src/requires.js";
import { save } from "../../../test-support/save.js";

const set = (id: string) => `<svg xmlns="http://www.w3.org/2000/svg"><symbol id="${id}" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></symbol></svg>`;
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-svg-sets-"));
  for (const [rel, body] of Object.entries({
    "src/assets/images/shared.svg": set("project-shared"),
    "pkg/assets/images/shared.svg": set("package-shared"),
    "pkg/assets/icons.svg": set("package-icon"),
    "src/patterns/atoms/icon/icon.hbs": `<svg><use href="#package-icon"/></svg>\n`,
    "src/patterns/atoms/icon/icon.md": `---\nrequireAssets: [icons, shared]\n---\n`,
  })) await save(join(root, rel), body);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("findSvgSets", () => {
  it("looks in every folder in order: a set only in a later one is found, the first one's wins, a missing one is named", async () => {
    const r = await findSvgSets(["icons", "shared", "nowhere"], [join(root, "src/assets"), join(root, "pkg/assets")]);
    expect(r.sets.map(s => [s.id, s.file])).toEqual([
      ["icons", join(root, "pkg/assets/icons.svg")],
      ["shared", join(root, "src/assets/images/shared.svg")],
    ]);
    expect(r.missing).toEqual(["nowhere"]);
  });
});

describe("a preview's symbol sets", () => {
  it("come from any asset folder, the project's first, hidden as before", async () => {
    const server: DevServer = await startDevServer(defineConfig({
      sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
      styles: { strategy: "parallel", dir: "./src/styles" }, assets: { dir: ["./src/assets", "./pkg/assets"] },
    }), root, { port: 0, live: false });
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path: "/preview/atoms/icon" }, res => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        });
        req.on("error", reject);
        req.end();
      });
      expect(body).toContain(`<svg style="display:none;position:absolute" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><symbol id="package-icon"`);
      expect(body).toContain(`<symbol id="project-shared"`);
      expect(body).not.toContain(`package-shared`);
    } finally { await server.close(); }
  });
});

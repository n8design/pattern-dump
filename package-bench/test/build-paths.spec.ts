// A build of the bench, both roots, names no folder of the machine it ran on: no absolute path of the
// bench (in either form, a link-resolved one included), no home folder, and no vendor/ path of the
// packages' real folders, in any file, text or binary.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realpathSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../pattern-dump.config.js";

const bench = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
let tmp = "";
const roots: Record<string, string> = {};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-package-bench-build-"));
  roots.workbench = join(tmp, "workbench");
  roots.storefront = join(tmp, "storefront");
  const config = validateConfig({ ...benchConfig, storefront: { ...benchConfig.storefront!, outDir: roots.storefront } }, "package-bench");
  await buildStaticSite(config, bench, { outDir: roots.workbench, pdVersion: "0.0.0-test" });
}, 120_000);
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** Every file under `dir`, as text (binary bytes read one to one, so a path in them is found too). */
async function files(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) out.set(relative(dir, join(e.parentPath, e.name)), (await readFile(join(e.parentPath, e.name))).toString("latin1"));
  }
  return out;
}

describe("a build of the package bench", () => {
  it("writes both roots, with the packages' compiled script in each", async () => {
    for (const root of Object.values(roots)) expect((await files(root)).has(join("_pd", "scripts", "chip.js"))).toBe(true);
  });

  it("names no folder of the machine in any file of either root", async () => {
    const needles = [...new Set([bench, realpathSync(bench)])].concat(homedir(), "vendor/");
    const hits: string[] = [];
    for (const [name, root] of Object.entries(roots)) {
      for (const [file, text] of await files(root)) for (const n of needles) if (text.includes(n)) hits.push(`${name}/${file}: ${n}`);
    }
    expect(hits).toEqual([]);
  });
});

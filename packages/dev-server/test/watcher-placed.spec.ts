// A component a page places (pd- tags) reloads what shows it when any file it is checked or rendered from
// changes: its template and its data, as any component's do, and its schema, which a placement is checked
// against (a schema edit was resolved to no component, so nothing reloaded). A content-swap is what every
// storefront page reloads on, and what refreshes the component's diagnostics in the workbench. On a copy
// of the storefront bench, whose guides page places its slider and slides (watch-harness.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll } from "./watch-harness.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const SLIDE = "src/patterns/components/slide";
let tmp = "";
let n = 0;

async function bench(): Promise<Bench> {
  const root = join(tmp, `bench-${n++}`);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  // The slide gets data, so a data edit can be made too.
  await writeFile(join(root, SLIDE, "slide.json"), `{ "image": "x.svg" }\n`);
  const b = new Bench(root, "components/slider", join(tmp, "staging"));
  await b.start(validateConfig(benchConfig, "storefront-bench"));
  return b;
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-watcher-placed-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const SWAP = `{"type":"content-swap","componentId":"components/slide"}`;

describe("a placed component's files", () => {
  for (const [what, file, edit] of [
    ["its schema", `${SLIDE}/slide.schema.json`, (s: string) => s.replace(`"alt": {`, `"credit": { "type": "string" },\n    "alt": {`)],
    ["its template", `${SLIDE}/slide.hbs`, (s: string) => `${s}<!-- edited -->\n`],
    ["its data", `${SLIDE}/slide.json`, (s: string) => s.replace("x.svg", "y.svg")],
  ] as const) {
    it(`reload what shows it when ${what} changes`, async () => {
      const b = await bench();
      try {
        const text = await readFile(b.at(file), "utf8");
        const r = await b.step(() => writeFile(b.at(file), edit(text)), [["change", file]]);
        expect(r.messages).toContain(SWAP);
      } finally {
        await b.close();
      }
    }, 60_000);
  }
});

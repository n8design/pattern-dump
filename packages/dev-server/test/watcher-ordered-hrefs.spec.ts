// A stylesheet save right after a template save, with no request in between, still sends the preview's
// whole link list (`orderedHrefs`). The template save drops the discovery; the list is worked out from the
// current one, built for it, not from a cache that may be empty. Without the list the workbench can only
// update links it already has, and a component whose stylesheet link is missing never gains it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const HBS = "src/patterns/atoms/btn/btn.hbs";
const SCSS = "src/styles/atoms/btn.scss";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-ordered-hrefs-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a stylesheet saved right after its template", () => {
  it("sends the whole link list, though the template save dropped the discovery", async () => {
    const root = join(tmp, "site");
    for (const [rel, text] of [[HBS, `<button class="btn">One</button>\n`], [SCSS, `.btn { color: red; }\n`]]) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
    const b = new Bench(root, "atoms/btn");
    await b.start(config);

    const r = await b.step(async () => {
      // The template first, handled, with no request after it; then the stylesheet.
      const from = handled.length;
      await save(b.at(HBS), `<button class="btn">Two</button>\n`);
      await whenHandled(() => handled.slice(from).some(h => b.owns(h.path) && b.rel(h.path) === HBS));
      await save(b.at(SCSS), `.btn { color: blue; }\n`);
    }, [["change", HBS], ["change", SCSS]]);

    const swaps = r.messages.filter(m => m.includes(`"css-link-swap"`)).map(m => JSON.parse(m) as { orderedHrefs?: string[] });
    expect(swaps).toHaveLength(1);
    expect(swaps[0].orderedHrefs).toEqual(["/_pd/components/atoms/btn.css?v=<t>"]);
  }, 60_000);
});

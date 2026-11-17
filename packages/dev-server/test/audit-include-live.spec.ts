// pd dev's audit, after an edit to a partial: the partial is audited again, and so is every component that includes
// it, at any depth, so the workbench's Audit tab shows the defect on each of them, not only on the partial (it used to
// re-audit the edited component alone, and its includers kept their clean verdict).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { pdScratchDir } from "../src/scratch.js";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
type Audit = { occurrences: Array<{ component: string; ruleId: string }> };

let tmp = "";
const roots: string[] = [];
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-audit-include-live-")); });
afterAll(async () => {
  await closeAll();
  for (const r of roots) await rm(pdScratchDir(r), { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("pd dev's audit, after an edit to a partial", () => {
  it("shows the partial's defect on every component that includes it", async () => {
    const root = join(tmp, "site");
    roots.push(root);
    for (const [rel, text] of Object.entries({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{> molecules-nav}}</div>\n`,
      "src/patterns/organisms/shell/shell.hbs": `<div class="shell">{{> organisms-page}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav><a href="/">Home</a></nav>\n`,
      "src/patterns/atoms/other/other.hbs": `<p>other</p>\n`,
      "src/styles/.keep": "",
    })) await save(join(root, rel), text);
    const b = new Bench(root, null);
    await b.start(config);
    const audit = async (): Promise<Audit> => (await (await fetch(`${b.origin}/api/audit`)).json()) as Audit;
    const with_ = (a: Audit, rule: string) => [...new Set(a.occurrences.filter(o => o.ruleId === rule).map(o => o.component))].sort();
    // A warm graph: from here the watcher keeps it current.
    expect(with_(await audit(), "element-permitted-content")).toEqual([]);
    await b.step(() => b.create("src/patterns/molecules/nav/nav.hbs", `<nav><a href="/">Home</a><span><div>defect</div></span></nav>\n`));
    expect(with_(await audit(), "element-permitted-content")).toEqual(["molecules/nav", "organisms/page", "organisms/shell"]);
    await b.close();
  }, 60_000);
});

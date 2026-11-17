// pd audit never reports a component clean from its cache when something it includes has changed: the cache key
// covers the component's own files and those of everything its render can include (a partial at any depth, and,
// when a template can include one it doesn't name, every file of the design system), the global data and the
// project helpers' source. Found on a style guide whose navigation partial got a defect back: the pages including it
// stayed clean. Each case audits once (filling the cache), changes one file, and audits again.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { runDiagnosticsAudit } from "../src/audit.js";
import { pdScratchDir } from "../src/scratch.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
const roots: string[] = [];
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-audit-include-")); });
afterAll(async () => {
  for (const r of roots) await rm(pdScratchDir(r), { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" }, helpers: "./src/helpers",
}), "audit");

const HELPERS = `module.exports = function (Handlebars) {
  Handlebars.registerHelper("pick", function (name, context) {
    return new Handlebars.SafeString(Handlebars.partials[name](context));
  });
};
`;
/** Markup html-validate refuses (a <div> in a <span>): an HTML_INVALID finding wherever it is rendered. */
const DEFECT = `<span><div>defect</div></span>`;

async function project(files: Record<string, string>): Promise<string> {
  const root = join(tmp, `p-${n++}`);
  roots.push(root);
  for (const [rel, text] of Object.entries({ "src/helpers/helpers.cjs": HELPERS, ...files })) await save(join(root, rel), text);
  return root;
}
const findings = async (root: string, id: string): Promise<string[]> =>
  (await runDiagnosticsAudit(config, root)).graph.occurrences.filter(o => o.component === id).map(o => o.ruleId);

describe("pd audit's cache, after a change to what a component includes", () => {
  it("a partial it includes: the defect shows on the component that includes it", async () => {
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{> molecules-nav}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav><a href="/">Home</a></nav>\n`,
    });
    expect(await findings(root, "organisms/page")).toEqual([]);
    await save(join(root, "src/patterns/molecules/nav/nav.hbs"), `<nav><a href="/">Home</a>${DEFECT}</nav>\n`);
    expect(await findings(root, "molecules/nav")).toContain("element-permitted-content");
    expect(await findings(root, "organisms/page")).toContain("element-permitted-content");
  }, 60_000);

  it("a partial two levels down", async () => {
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{> molecules-nav}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav>{{> atoms-link}}</nav>\n`,
      "src/patterns/atoms/link/link.hbs": `<a href="/">Home</a>\n`,
    });
    expect(await findings(root, "organisms/page")).toEqual([]);
    await save(join(root, "src/patterns/atoms/link/link.hbs"), `<a href="/">Home</a>${DEFECT}\n`);
    expect(await findings(root, "organisms/page")).toContain("element-permitted-content");
  }, 60_000);

  it("a partial's sample data, which the include renders with beneath the page's", async () => {
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{> molecules-nav}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav>{{{markup}}}</nav>\n`,
      "src/patterns/molecules/nav/nav.json": `{ "markup": "<a href=\\"/\\">Home</a>" }\n`,
    });
    expect(await findings(root, "organisms/page")).toEqual([]);
    await save(join(root, "src/patterns/molecules/nav/nav.json"), JSON.stringify({ markup: DEFECT }));
    expect(await findings(root, "organisms/page")).toContain("element-permitted-content");
  }, 60_000);

  it("a partial included by a project helper, by a name in the data", async () => {
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{pick "molecules-nav" this}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav><a href="/">Home</a></nav>\n`,
    });
    expect(await findings(root, "organisms/page")).toEqual([]);
    await save(join(root, "src/patterns/molecules/nav/nav.hbs"), `<nav><a href="/">Home</a>${DEFECT}</nav>\n`);
    expect(await findings(root, "organisms/page")).toContain("element-permitted-content");
  }, 60_000);

  it("a dynamic partial ({{> (expr)}})", async () => {
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{> (lookup . "which")}}</div>\n`,
      "src/patterns/organisms/page/page.json": `{ "which": "molecules-nav" }\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav><a href="/">Home</a></nav>\n`,
    });
    expect(await findings(root, "organisms/page")).toEqual([]);
    await save(join(root, "src/patterns/molecules/nav/nav.hbs"), `<nav><a href="/">Home</a>${DEFECT}</nav>\n`);
    expect(await findings(root, "organisms/page")).toContain("element-permitted-content");
  }, 60_000);

  it("a project helper's source: what calls a helper is audited again", async () => {
    // pd audit runs once per process; here Node keeps the first helper module, so the case checks the cache was
    // not used for the component, not what the new helper renders.
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{pick "molecules-nav" this}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav><a href="/">Home</a></nav>\n`,
    });
    await runDiagnosticsAudit(config, root);
    await save(join(root, "src/helpers/helpers.cjs"), `${HELPERS}// changed\n`);
    expect((await runDiagnosticsAudit(config, root)).reaudited).toContain("organisms/page");
  }, 60_000);

  it("still reuses a verdict when nothing it depends on changed (the cache works)", async () => {
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{> molecules-nav}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav><a href="/">Home</a></nav>\n`,
      "src/patterns/atoms/other/other.hbs": `<p>other</p>\n`,
    });
    await runDiagnosticsAudit(config, root);
    await save(join(root, "src/patterns/atoms/other/other.hbs"), `<p>other, changed</p>\n`);
    expect((await runDiagnosticsAudit(config, root)).reaudited).toEqual(["atoms/other"]);
  }, 60_000);

  it("a component that includes by helper is not audited again for a change it doesn't include", async () => {
    const root = await project({
      "src/patterns/organisms/page/page.hbs": `<div class="page">{{pick "molecules-nav" this}}</div>\n`,
      "src/patterns/molecules/nav/nav.hbs": `<nav><a href="/">Home</a></nav>\n`,
      "src/patterns/atoms/other/other.hbs": `<p>other</p>\n`,
    });
    await runDiagnosticsAudit(config, root);
    await save(join(root, "src/patterns/atoms/other/other.hbs"), `<p>other, changed</p>\n`);
    expect((await runDiagnosticsAudit(config, root)).reaudited).toEqual(["atoms/other"]);
  }, 60_000);
});

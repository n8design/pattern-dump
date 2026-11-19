// pd build's two style checks on a storefront, on copies of the bench: a class on a page that nothing in the style
// guide defines (a warning, or an error with storefront.checks.classes), and a var() in the skin's own styles with no
// definition anywhere (an error), each naming file and line.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import { buildStaticSite } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const NOW = new Date("2027-01-02T03:04:05.000Z");
let tmp = "";

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-sf-checks-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
async function benchCopy(): Promise<string> {
  const root = join(tmp, `bench-${n++}`);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}
const config = (checks?: Record<string, unknown>): PatternDumpConfig =>
  validateConfig({ ...benchConfig, site: { ...benchConfig.site!, ...(checks ? { checks } : {}) } }, "test");
const build = (root: string, cfg: PatternDumpConfig = config()) =>
  buildStaticSite(cfg, root, { outDir: join(root, "..", `wb-${n++}`), pdVersion: "0.0.0-test", now: NOW });
const append = async (path: string, text: string) => save(path, `${await readFile(path, "utf8")}${text}`);
const exists = (p: string) => stat(p).then(() => true, () => false);
/** The line `text` is on in `file` (1-based). */
const lineIn = async (file: string, text: string) => (await readFile(file, "utf8")).split("\n").findIndex(l => l.includes(text)) + 1;

/** A component that writes what a page gives it into its class and style attributes: the one way a page's value
 *  becomes a class (a page's markdown can't write HTML). Placed on about.md with `look` and `size`. */
async function placeBadge(root: string, look: string, size = "2rem"): Promise<string> {
  const dir = join(root, "src", "patterns", "components", "badge");
  await mkdir(dir, { recursive: true });
  await save(join(dir, "badge.hbs"), `<span class="badge {{look}}" style="--badge-size: {{size}}">{{label}}</span>\n`);
  await save(join(dir, "badge.json"), JSON.stringify({ look: "", size: "1rem", label: "New" }));
  await save(join(dir, "badge.schema.json"), JSON.stringify({ type: "object", properties: {
    look: { type: "string" }, size: { type: "string" }, label: { type: "string" } } }));
  const about = join(root, "pages", "about.md");
  await append(about, `\n<pd-components-badge look="${look}" size="${size}" label="Big"></pd-components-badge>\n`);
  return about;
}

describe("pd build — classes outside the design system", () => {
  it("finds none on the bench: every class its pages carry is a component's, a style's or Pattern Dump's own", async () => {
    const report = await build(await benchCopy());
    expect(report.classes).toEqual({ severity: "warning", warnings: [] });
  }, 60_000);

  it("warns about a class a page gives a component that nothing defines, naming the page and line, and still builds", async () => {
    const root = await benchCopy();
    const about = await placeBadge(root, "lede hero-big-title");
    const report = await build(root);
    const line = await lineIn(about, "hero-big-title");
    expect(report.classes?.warnings).toEqual([
      `about.md:${line}: class "lede" isn't defined by any component or style`,
      `about.md:${line}: class "hero-big-title" isn't defined by any component or style`,
    ]);
    expect(await exists(join(root, ".out", "site", "about", "index.html"))).toBe(true);
  }, 60_000);

  it("stops the build with checks.classes: \"error\", and writes nothing", async () => {
    const root = await benchCopy();
    await placeBadge(root, "hero-big-title");
    await expect(build(root, config({ classes: "error" }))).rejects.toThrow(/classes outside the design system[\s\S]*about\.md:\d+: class "hero-big-title"/);
    expect(await exists(join(root, ".out", "site"))).toBe(false);
  }, 60_000);

  it("takes allowClasses, by name and by prefix, and skips the check with checks.classes: \"off\"", async () => {
    const root = await benchCopy();
    await placeBadge(root, "lede hero-big-title");
    expect((await build(root)).classes?.warnings).toHaveLength(2);
    expect((await build(root, config({ allowClasses: ["lede", "hero-*"] }))).classes?.warnings).toEqual([]);
    expect((await build(root, config({ classes: "off" }))).classes).toBeUndefined();
  }, 120_000);

  it("counts a state class (is-, has-, js-) and a class a stylesheet of the style guide names as defined", async () => {
    const root = await benchCopy();
    // .card-title is the card's (in its stylesheet), worn here by another component.
    await placeBadge(root, "is-open has-icon js-toggle card-title");
    expect((await build(root)).classes?.warnings).toEqual([]);
  }, 60_000);
});

describe("pd build — custom properties nothing defines", () => {
  it("stops the build on a var() in the skin with no definition, naming file and line, and writes nothing", async () => {
    const root = await benchCopy();
    const card = join(root, "src", "styles", "components", "card.scss");
    await append(card, `\n.card-title {\n  color: var(--wf-ink-missing);\n}\n`);
    const line = await lineIn(card, "--wf-ink-missing");
    await expect(build(root)).rejects.toThrow(
      `src/styles/components/card.scss:${line}: var(--wf-ink-missing) reads a custom property nothing defines`);
    expect(await exists(join(root, ".out", "site"))).toBe(false);
  }, 60_000);

  it("builds with a fallback, with allowProperties, and with the property set in a component's style attribute", async () => {
    const root = await benchCopy();
    const card = join(root, "src", "styles", "components", "card.scss");
    await append(card, `\n.card-title {\n  color: var(--wf-ink-missing, currentColor);\n  gap: var(--js-gap);\n  margin: var(--badge-size);\n}\n`);
    // The badge's template sets --badge-size in a style attribute, on a page the build writes.
    await placeBadge(root, "");
    await build(root, config({ allowProperties: ["--js-*"] }));
    await expect(build(root)).rejects.toThrow(/var\(--js-gap\)/);
  }, 90_000);

  it("skips a var() in a comment, and one whose name Sass builds", async () => {
    const root = await benchCopy();
    await append(join(root, "src", "styles", "components", "card.scss"),
      `\n// color: var(--in-a-comment);\n/* var(--in-a-block) */\n$k: x;\n.card-title { color: var(--wf-#{$k}); }\n`);
    await build(root);
  }, 60_000);
});

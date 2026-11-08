// documentBase is authoritative and additive: a listed path always forms the base layer, even a file
// that belongs to a component; rules no component owns still join it when unlisted, and are reported.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAllStyleData, documentBaseMatcher, missingDocumentBase } from "../src/style-index.js";
import { recomputeComponentCss } from "../src/css-closure.js";
import { save } from "../../../test-support/save.js";

let styles = "";
const ids = new Set(["atoms/button", "organisms/hero"]);

beforeAll(async () => {
  styles = await mkdtemp(join(tmpdir(), "pd-document-base-"));
  const files: Record<string, string> = {
    "styles.scss": `@use '00-base/reset';\n@use 'shared/flyout';\n@use '01-atoms/button';\n@use '03-organisms/hero';\n`,
    "00-base/_reset.scss": `html { margin: 0; }\n`,
    "shared/_flyout.scss": `.flyout { color: gray; }\n`,
    "01-atoms/_button.scss": `.btn { color: blue; }\n`,
    "03-organisms/_hero.scss": `body { background: black; }\n.hero { color: white; }\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(styles, rel)), { recursive: true });
    await save(join(styles, rel), text);
  }
});
afterAll(async () => { if (styles) await rm(styles, { recursive: true, force: true }); });

const build = (base?: string[]) =>
  buildAllStyleData([{ dir: styles, entries: [join(styles, "styles.scss")], ...(base ? { base } : {}) }], ids);

describe("documentBaseMatcher", () => {
  it("matches a listed file, a listed folder, or the whole tree", () => {
    const at = (rel: string) => join(styles, rel);
    const m = documentBaseMatcher(styles, ["00-base", "03-organisms/hero"]);
    expect(m(at("00-base/_reset.scss"))).toBe(true);
    expect(m(at("03-organisms/_hero.scss"))).toBe(true);
    expect(m(at("03-organisms/_hero-extra.scss"))).toBe(false);
    expect(m(at("01-atoms/_button.scss"))).toBe(false);
    const all = documentBaseMatcher(styles, ["."]);
    expect(all(at("01-atoms/_button.scss"))).toBe(true);
    expect(all("/elsewhere/x.scss")).toBe(false);
    expect(documentBaseMatcher(styles, undefined)(at("00-base/_reset.scss"))).toBe(false);
  });

  it("accepts entries written as files: ./, _ and .scss", () => {
    const m = documentBaseMatcher(styles, ["./03-organisms/_hero.scss"]);
    expect(m(join(styles, "03-organisms/_hero.scss"))).toBe(true);
  });
});

describe("buildAllStyleData with documentBase", () => {
  it("without documentBase, unowned rules form the base layer as before and nothing is reported", async () => {
    const d = await build();
    expect(d.baseCss).toContain("html");
    expect(d.baseCss).toContain(".flyout");
    expect(d.componentCssMap.get("organisms/hero")).toContain(".hero");
    expect(d.baseOutsideList.size).toBe(0);
  });

  it("a listed component file goes into the base layer; unlisted unowned rules stay and are reported", async () => {
    const d = await build(["00-base", "03-organisms/hero"]);
    expect(d.baseCss).toContain("background: black");
    expect(d.baseCss).toContain(".hero");
    expect(d.componentCssMap.get("organisms/hero") ?? "").toBe("");
    expect(d.componentCssMap.get("atoms/button")).toContain(".btn");
    expect(d.baseCss).toContain(".flyout");
    expect([...d.baseOutsideList]).toEqual([[join(styles, "shared/_flyout.scss"), 1]]);
    // Ownership is unchanged: the class still belongs to the component that authored it.
    expect(d.classOwnerIndex.get("hero")).toBe("organisms/hero");
  });

  it('"." makes the whole styles tree the base layer', async () => {
    const d = await build(["."]);
    expect(d.baseCss).toContain(".btn");
    expect(d.baseCss).toContain(".hero");
    expect([...d.componentCssMap.values()].every(css => css === "")).toBe(true);
    expect(d.baseOutsideList.size).toBe(0);
  });

  it("the per-save recompute leaves a listed file's rules out of the component", async () => {
    const css = await recomputeComponentCss(join(styles, "styles.scss"), "organisms/hero", styles, ids,
      documentBaseMatcher(styles, ["03-organisms/hero"]));
    expect(css).toBe("");
  });
});

describe("missingDocumentBase", () => {
  it("names the entries that match nothing on disk", () => {
    expect(missingDocumentBase(styles, ["00-base", "03-organisms/hero", "03-organisms/_hero.scss", ".", "does-not-exist", "00-base/typo"]))
      .toEqual(["does-not-exist", "00-base/typo"]);
  });
});

// Every stylesheet's classes, defined and mentioned, are kept, not only the claim that wins a class. A card's
// stylesheet that reaches into Button's class (`.card-body > .button`) mentions `button`; before, that claim lost
// to Button's own definition and was dropped, so nothing showed that renaming `.button` breaks the card.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAllStyleData } from "../src/style-index.js";
import { save } from "../../../test-support/save.js";

let styles = "";
const ids = new Set(["atoms/button", "molecules/card"]);

beforeAll(async () => {
  styles = await mkdtemp(join(tmpdir(), "pd-mentions-"));
  const files: Record<string, string> = {
    "atoms/button.scss": `.button { padding: 0; }\n.button .button-label { font-weight: bold; }\n`,
    "molecules/card.scss": `@use "../base/tokens";\n.card { display: grid; }\n.card-body { gap: 0; > .button { margin: 0; } }\n.card:hover .card-title { color: red; }\n`,
    "base/_tokens.scss": `.tokens-note .button { outline: 0; }\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(styles, rel)), { recursive: true });
    await save(join(styles, rel), text);
  }
});
afterAll(async () => { if (styles) await rm(styles, { recursive: true, force: true }); });

describe("each stylesheet's classes", () => {
  it("keeps a mention of another component's class, with the compiled selector", async () => {
    const d = await buildAllStyleData(styles, ids);
    const card = d.stylesheets.get(join(styles, "molecules/card.scss"))!;
    expect(card.component).toBe("molecules/card");
    expect(card.root).toBe(styles);
    expect([...card.defines.keys()]).toEqual(["card", "card-body"]);
    expect(card.mentions.get("button")).toBe(".card-body > .button");
    // The class index still gives `button` to the component that defines it.
    expect(d.classOwnerIndex.get("button")).toBe("atoms/button");
  });

  it("leaves out a stylesheet's mentions of its own classes", async () => {
    const d = await buildAllStyleData(styles, ids);
    const card = d.stylesheets.get(join(styles, "molecules/card.scss"))!;
    expect(card.mentions.has("card")).toBe(false);
    expect([...card.mentions.keys()]).toEqual(["button", "card-title"]);
    const button = d.stylesheets.get(join(styles, "atoms/button.scss"))!;
    expect([...button.mentions.keys()]).toEqual(["button-label"]);
  });

  it("names the authoring partial, a shared module with no component, as its own stylesheet", async () => {
    const d = await buildAllStyleData(styles, ids);
    const tokens = d.stylesheets.get(join(styles, "base/_tokens.scss"))!;
    expect(tokens.component).toBeNull();
    expect([...tokens.mentions]).toEqual([["button", ".tokens-note .button"], ["tokens-note", ".tokens-note .button"]]);
  });

  it("is the same data whatever order the entries are compiled in", async () => {
    const a = await buildAllStyleData(styles, ids);
    const b = await buildAllStyleData(styles, ids, [join(styles, "molecules/card.scss"), join(styles, "atoms/button.scss")]);
    expect([...b.stylesheets.keys()]).toEqual([...a.stylesheets.keys()]);
    for (const [path, sheet] of a.stylesheets) {
      expect([...b.stylesheets.get(path)!.defines]).toEqual([...sheet.defines]);
      expect([...b.stylesheets.get(path)!.mentions]).toEqual([...sheet.mentions]);
    }
  });
});

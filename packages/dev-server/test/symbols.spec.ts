// Symbol sources (symbols.ts): one SVG per symbol in an asset root's symbols/ folder, checked and prepared before a
// page inlines it. The two sources are drawn for this test.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseTokens } from "../src/css-tokens.js";
import { createSymbolIndexer, prepareSymbol, spriteMarkup, standaloneSvg, type SymbolEntry, type SymbolSource } from "../src/symbols.js";
import { save } from "../../../test-support/save.js";
import { FLOW, LAYERS } from "./symbol-fixtures.js";

const ok = (e: SymbolEntry): SymbolSource => { if (!e.ok) throw new Error(e.problem.problems.join("; ")); return e.source; };
const problems = (e: SymbolEntry): string[] => e.ok ? [] : e.problem.problems;
const svg = (body: string, root = `viewBox="0 0 10 10"`) => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`;

describe("prepareSymbol", () => {
  it("prefixes ids and their references, drops <title>, keeps SVG's mixed-case names, reads size and tokens", () => {
    const s = ok(prepareSymbol("flow", "/a/symbols/flow.svg", FLOW));
    expect(s.inner).toBe(`<defs><marker id="img-flow--arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto">`
      + `<path d="M0 0L10 5L0 10Z" fill="var(--color-primary)"></path></marker></defs>\n`
      + `  <rect x="20" y="60" width="120" height="80" fill="var(--color-primary)"></rect>\n`
      + `  <line x1="140" y1="100" x2="255" y2="100" stroke="var(--color-text)" stroke-width="4" marker-end="url(#img-flow--arrow)"></line>\n`
      + `  <rect x="300" y="90" width="40" height="20" fill="currentColor"></rect>`);
    expect(s).toMatchObject({ viewBox: "0 0 400 200", width: 400, height: 200, ids: ["img-flow--arrow"],
      tokens: ["--color-primary", "--color-text"], usesCurrentColor: true });
    expect(s.warning).toBeUndefined();
  });

  it("turns a <style>'s simple class rule into attributes and removes the class; size from the viewBox", () => {
    const s = ok(prepareSymbol("layers", "/a/symbols/layers.svg", LAYERS));
    expect(s.inner).not.toMatch(/<style|class=/);
    expect(s.inner).toContain(`<rect x="20" y="20" width="360" height="70" fill="var(--color-surface-subtle)" stroke="var(--color-border)" stroke-width="4"></rect>`);
    expect(s.inner).toContain(`fill="url(#img-layers--fade)"`);
    expect(s).toMatchObject({ width: 400, height: 200, tokens: ["--color-border", "--color-surface-subtle"] });
  });

  it("a colour that isn't a token is an error, in an attribute, a style attribute or a <style> rule", () => {
    expect(problems(prepareSymbol("a", "f", svg(`<rect fill="#ff0000"/>`)))).toEqual([expect.stringMatching(/fill="#ff0000" is not a colour token/)]);
    expect(problems(prepareSymbol("a", "f", svg(`<rect style="stroke: rgb(0 0 0)"/>`)))).toEqual([expect.stringMatching(/stroke="rgb\(0 0 0\)"/)]);
    expect(problems(prepareSymbol("a", "f", svg(`<style>.x { fill: red; }</style><rect class="x"/>`)))).toEqual([expect.stringMatching(/fill="red"/)]);
    expect(problems(prepareSymbol("a", "f", svg(`<rect fill="var(--color-a, #fff)"/>`)))).toHaveLength(1);
    expect(problems(prepareSymbol("a", "f", svg(`<rect fill="none" stroke="transparent"/><circle fill="currentColor"/>`)))).toEqual([]);
  });

  it("a <style> with anything but simple class rules of presentation properties is an error", () => {
    expect(problems(prepareSymbol("a", "f", svg(`<style>rect { fill: var(--color-a); }</style>`)))).toEqual([expect.stringMatching(/only simple class rules.*not rect/)]);
    expect(problems(prepareSymbol("a", "f", svg(`<style>.x { transform: scale(2); }</style>`)))).toEqual([expect.stringMatching(/sets transform/)]);
    expect(problems(prepareSymbol("a", "f", svg(`<style>@media (prefers-color-scheme: dark) { .x { fill: none; } }</style>`)))).toHaveLength(1);
  });

  it("removes scripts, event attributes, foreignObject, images and hrefs that leave the file, in one warning", () => {
    const s = ok(prepareSymbol("a", "f", svg(`<script>alert(1)</script><rect onclick="x()" fill="none"/>`
      + `<foreignObject><div>x</div></foreignObject><image href="https://example.com/x.png"/><a href="https://example.com/"><use href="#own"/></a><g id="own"/>`)));
    expect(s.inner).not.toMatch(/script|onclick|foreignObject|<image|example\.com/i);
    expect(s.inner).toContain(`<use href="#img-a--own">`);
    expect(s.warning).toBe("removed <script>, <foreignObject>, <image>, onclick attributes, an href that leaves the file (https://example.com/)");
  });

  it("keeps the root's presentation attributes on a group; a name that can't be an id, and no size, are errors", () => {
    expect(ok(prepareSymbol("a", "f", svg(`<rect/>`, `viewBox="0 0 10 10" fill="var(--color-a)"`))).inner).toBe(`<g fill="var(--color-a)"><rect></rect></g>`);
    expect(problems(prepareSymbol("my diagram", "f", svg("")))).toEqual([expect.stringMatching(/name can't be a symbol's/)]);
    expect(problems(prepareSymbol("a", "f", `<svg xmlns="http://www.w3.org/2000/svg" width="50%"><rect/></svg>`))).toEqual([expect.stringMatching(/size can't be known/)]);
  });
});

describe("the sprite and the standalone file", () => {
  it("the sprite is hidden by size, never display:none", () => {
    const flow = ok(prepareSymbol("flow", "f", FLOW));
    const sprite = spriteMarkup([flow]);
    expect(sprite.startsWith(`<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n<symbol id="img-flow" viewBox="0 0 400 200">`)).toBe(true);
    expect(sprite).not.toContain("display:none");
    expect(spriteMarkup([])).toBe("");
  });

  it("declares the tokens it uses, light then dark, with currentColor as the configured token", () => {
    const tokens = baseTokens(`:root { --color-primary: light-dark(#111, #eee); --color-text: light-dark(#222, #ddd); --color-heading: #333; }`);
    const r = standaloneSvg(ok(prepareSymbol("flow", "f", FLOW)), tokens, "--color-heading");
    if (!("svg" in r)) throw new Error(r.problems.join("; "));
    expect(r.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><style>`
      + `:root { --color-primary: #111; --color-text: #222; --color-heading: #333; } `
      + `@media (prefers-color-scheme: dark) { :root { --color-primary: #eee; --color-text: #ddd; --color-heading: #333; } }</style>`)).toBe(true);
    expect(r.svg).not.toMatch(/currentColor/i);
    expect(r.svg).toContain(`fill="var(--color-heading)"`);
  });

  it("a token the base layer lacks is a problem, naming it", () => {
    const r = standaloneSvg(ok(prepareSymbol("flow", "f", FLOW)), baseTokens(`:root { --color-primary: #111; }`), "--color-text");
    expect(r).toEqual({ problems: ["--color-text is not in the base layer"] });
  });
});

describe("the symbol index", () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });

  it("reads symbols/ of every asset root; the first root's stem wins; nothing outside symbols/ is read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-symbols-"));
    dirs.push(dir);
    const project = join(dir, "assets"), pkg = join(dir, "node_modules/pkg/assets");
    await save(join(project, "symbols/flow.svg"), FLOW);
    await save(join(project, "images/hex.svg"), svg(`<rect fill="#f00"/>`));
    await save(join(pkg, "symbols/flow.svg"), svg(`<rect fill="#f00"/>`));
    await save(join(pkg, "symbols/layers.svg"), LAYERS);
    const index = await createSymbolIndexer().index([project, pkg]);
    expect([...index.entries.keys()].sort()).toEqual(["flow", "layers"]);
    expect(index.entries.get("flow")!.ok).toBe(true);
    expect(index.shadowed).toEqual([{ stem: "flow", file: join(pkg, "symbols/flow.svg"), by: join(project, "symbols/flow.svg") }]);
  });

  it("a changed file is read again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pd-symbols-"));
    dirs.push(dir);
    const indexer = createSymbolIndexer();
    await save(join(dir, "symbols/a.svg"), svg(`<rect fill="none"/>`));
    expect((await indexer.index([dir])).entries.get("a")!.ok).toBe(true);
    await save(join(dir, "symbols/a.svg"), svg(`<rect fill="#000"/>`));
    expect((await indexer.index([dir])).entries.get("a")!.ok).toBe(false);
  });
});

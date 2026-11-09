// What pd dev's watcher sends for every kind of change, pinned as it is: on a copy of test-bench (with its
// pattern package linked as npm links a `file:` dependency) and of the storefront bench, one live server
// each, the workbench showing one component.
//
// Every case starts from its own clean baseline: a fresh copy and a fresh server, so no case sees what
// another left behind, in any order. A case whose step needs files to exist first (a component's docs,
// say) creates them in an unmeasured setup.
//
// Deterministic, with no waiting for quiet (watch-harness.ts). Each case declares the watcher events its
// act causes; the step waits until those are handled, then for its barrier, asserts the events handled
// were exactly the declared ones, and compares its messages, sorted (handlers for one change may finish
// in either order), with cache-busting stamps (?v=…) and the copy's folder normalised. New files are
// renamed into place, so each is one event: written in place, the OS can report the creation and the
// write apart (pinned on its own below).
//
// A characterization: it records the behaviour before the watcher is reworked, and must pass unedited
// after a change that is not meant to alter it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import storefrontConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { saveInTwoSteps } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let tmp = "";

/** The tracked files of a repo folder, copied to `<tmp>/<name>`. */
async function copyOf(folder: string, name: string): Promise<string> {
  const root = join(tmp, name);
  for (const file of execFileSync("git", ["ls-files", folder], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice(folder.length + 1));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-watch-char-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

type Act = (b: Bench) => Promise<void>;
type Case = [name: string, act: Act, events: string[][], messages: string[]];

let copies = 0;
/** A fresh copy of test-bench, its pattern package linked as npm links a `file:` dependency, served. */
async function testBench(setup?: Act): Promise<Bench> {
  const b = new Bench(await copyOf("test-bench", `test-bench-${copies++}`), "atoms/button");
  await mkdir(b.at("node_modules"), { recursive: true });
  await symlink(join("..", "packages", "pd-fixture-ui"), b.at("node_modules/pd-fixture-ui"));
  await b.start(validateConfig(testBenchConfig, "test-bench"));
  if (setup) { await setup(b); await b.barrier(); }
  return b;
}
/** A fresh copy of the storefront bench, served. */
async function storefrontBench(setup?: Act): Promise<Bench> {
  const b = new Bench(await copyOf("storefront-bench", `storefront-bench-${copies++}`), "components/callout");
  await b.start(validateConfig(storefrontConfig, "storefront-bench"));
  if (setup) { await setup(b); await b.barrier(); }
  return b;
}

describe("the watcher on test-bench", () => {
  // The files a step needs before it: the state the component's life reaches by then. Created unmeasured,
  // but each waits for its own events like a step, so none is still being handled when the step begins.
  const component = (b: Bench) => b.step(() => b.create("src/patterns/atoms/zz-char/zz-char.hbs", "<p>char</p>\n"),
    [["addDir", "src/patterns/atoms/zz-char"], ["add", "src/patterns/atoms/zz-char/zz-char.hbs"]]);
  const docs = (b: Bench) => b.step(() => b.create("src/patterns/atoms/zz-char/zz-char.md", "---\ntitle: Char\n---\n"),
    [["add", "src/patterns/atoms/zz-char/zz-char.md"]]);
  const stylesheet = (b: Bench) => b.step(() => b.create("src/styles/01-atoms/zz-char.scss", ".zz-char { color: red; }\n"),
    [["add", "src/styles/01-atoms/zz-char.scss"]]);
  const SETUP: Record<string, Act> = {
    "its new docs": async b => { await component(b); },
    "its new stylesheet": async b => { await component(b); await docs(b); },
    "removing its docs": async b => { await component(b); await docs(b); await stylesheet(b); },
    "removing its template": async b => { await component(b); await stylesheet(b); },
    // The folder emptied, its stylesheet still there.
    "removing its folder": async b => {
      await stylesheet(b);
      await b.step(() => mkdir(b.at("src/patterns/atoms/zz-char"), { recursive: true }).then(() => undefined), [["addDir", "src/patterns/atoms/zz-char"]]);
    },
  };
  const CASES: Case[] = [
    // Pins a known bug, see follow-up; change this case when the bug is fixed. (A template shared by
    // data-overlay variants sends content-swap only for the last variant using it.)
    ["a template", b => b.edit("src/patterns/atoms/button/button.hbs", "\n"), [["change", "src/patterns/atoms/button/button.hbs"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button~secondary\"}",
    ]],
    ["its data", b => b.edit("src/patterns/atoms/button/button.json", "\n"), [["change", "src/patterns/atoms/button/button.json"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["its docs", b => b.edit("src/patterns/atoms/button/button.md", "\nMore.\n"), [["change", "src/patterns/atoms/button/button.md"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["its stylesheet", b => b.edit("src/styles/01-atoms/button.scss", "\n.tb-char { color: red; }\n"), [["change", "src/styles/01-atoms/button.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/button\",\"href\":\"/_pd/components/atoms/button.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"molecules/field\",\"href\":\"/_pd/components/molecules/field.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
    ]],
    ["a base partial", b => b.edit("src/styles/00-base/_tokens.scss", "\n$tb-char: 1;\n"), [["change", "src/styles/00-base/_tokens.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/button\",\"href\":\"/_pd/components/atoms/button.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/icon\",\"href\":\"/_pd/components/atoms/icon.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/input\",\"href\":\"/_pd/components/atoms/input.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/responsive-demo\",\"href\":\"/_pd/components/atoms/responsive-demo.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"molecules/field\",\"href\":\"/_pd/components/molecules/field.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"molecules/media\",\"href\":\"/_pd/components/molecules/media.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"organisms/buttonbar\",\"href\":\"/_pd/components/organisms/buttonbar.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"organisms/card\",\"href\":\"/_pd/components/organisms/card.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"organisms/toolbar\",\"href\":\"/_pd/components/organisms/toolbar.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"pages/homepage\",\"href\":\"/_pd/components/pages/homepage.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
    ]],
    ["a base stylesheet", b => b.edit("src/styles/00-base/shared-family.scss", "\n.tb-char-base { color: red; }\n"), [["change", "src/styles/00-base/shared-family.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["a theme", b => b.edit("themes/light.theme.scss", "\n:root { --tb-char: 1; }\n"), [["change", "themes/light.theme.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["a script", b => b.edit("src/scripts/toggle.ts", "\n"), [["change", "src/scripts/toggle.ts"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    ["a new component", b => b.create("src/patterns/atoms/zz-char/zz-char.hbs", "<p>char</p>\n"), [["addDir", "src/patterns/atoms/zz-char"], ["add", "src/patterns/atoms/zz-char/zz-char.hbs"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["its new docs", b => b.create("src/patterns/atoms/zz-char/zz-char.md", "---\ntitle: Char\n---\n"), [["add", "src/patterns/atoms/zz-char/zz-char.md"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/zz-char\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    // The component had no CSS before: the swap says so (cssBecameNonEmpty), as no document can have its link.
    ["its new stylesheet", b => b.create("src/styles/01-atoms/zz-char.scss", ".zz-char { color: red; }\n"), [["add", "src/styles/01-atoms/zz-char.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/zz-char\",\"href\":\"/_pd/components/atoms/zz-char.css?v=<t>\",\"cssBecameNonEmpty\":true,\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
    ]],
    ["removing its docs", b => b.remove("src/patterns/atoms/zz-char/zz-char.md"), [["unlink", "src/patterns/atoms/zz-char/zz-char.md"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/zz-char\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    // The restyle after the removal carries the open component's link list, like any other css-link-swap
    // (before, it went without: the rebuild had just emptied the composition registry it is worked out from).
    ["removing its template", b => b.remove("src/patterns/atoms/zz-char/zz-char.hbs"), [["unlink", "src/patterns/atoms/zz-char/zz-char.hbs"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/zz-char\",\"href\":\"/_pd/components/atoms/zz-char.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
      "{\"type\":\"tree-changed\"}",
    ]],
    ["removing its folder", b => b.remove("src/patterns/atoms/zz-char"), [["unlinkDir", "src/patterns/atoms/zz-char"]], [
      "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
      "{\"type\":\"tree-changed\"}",
    ]],
    // Changed with data, helpers and assets reloading: global data is read again and the open component
    // reloads (before, nothing was sent).
    ["global data", b => b.edit("src/_data/tb.json", "\n"), [["change", "src/_data/tb.json"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    // Changed likewise: a helper module reloads in place, and the open component with it.
    ["a helper", b => b.edit("src/helpers/hbs.cjs", "\n"), [["change", "src/helpers/hbs.cjs"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    // Changed likewise: an asset reloads the open component.
    ["an asset", b => b.create("assets/images/zz-char.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n"), [["add", "assets/images/zz-char.svg"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/button\"}",
    ]],
    // Changed with linked packages being watched: pd-fixture-ui is a `file:` link, so its files reload
    // like the project's (before, nothing was sent).
    ["a package template", b => b.edit("packages/pd-fixture-ui/patterns/atoms/fixture-chip/fixture-chip.hbs", "\n"), [["change", "packages/pd-fixture-ui/patterns/atoms/fixture-chip/fixture-chip.hbs"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"atoms/fixture-chip\"}",
    ]],
    // Changed with linked packages being watched, as above: the package's stylesheet reloads its component.
    ["a package stylesheet", b => b.edit("packages/pd-fixture-ui/sass/01-atoms/_fixture-chip.scss", "\n.fx-char { color: red; }\n"), [["change", "packages/pd-fixture-ui/sass/01-atoms/_fixture-chip.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"atoms/fixture-chip\",\"href\":\"/_pd/components/atoms/fixture-chip.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/atoms/button.css?v=<t>\"]}",
    ]],
  ];
  for (const [name, act, events, messages] of CASES) {
    it(`sends what it sends for ${name}`, async () => {
      const b = await testBench(SETUP[name]);
      try {
        expect(await b.step(() => act(b), events)).toEqual({ messages, events });
      } finally {
        await b.close();
      }
    }, 60_000);
  }

  it("handles a file created empty and then written as two events, add then change, dropping neither", async () => {
    // What the OS sometimes reports for one write of a new file, made to happen: the file appears empty,
    // the watcher handles that, then its content is written. That second write is itself two steps (a
    // truncate, then the text), and how many change events it arrives as is the OS's choice: one, or two
    // under load on Linux. So this case checks the outcome, not the count (unlike every other case here):
    // the empty file and the full one were both handled, nothing was dropped, and the full content is served.
    const rel = "src/patterns/atoms/zz-split/zz-split.hbs";
    const content = "<p>split</p>\n";
    const b = await testBench();
    const warn = vi.spyOn(console, "warn");
    try {
      const from = handled.length;
      const result = await b.step(async () => {
        await mkdir(b.at("src/patterns/atoms/zz-split"), { recursive: true });
        await saveInTwoSteps(b.at(rel), "");
        await whenHandled(() => handled.slice(from).some(h => h.event === "add" && h.path === b.at(rel)));
        await saveInTwoSteps(b.at(rel), content);
      }); // No declared events: the step waits until the last write of the file is handled, whatever the count.
      // Its folder and the empty file came first, then one or more changes, and nothing else.
      expect(result.events.slice(0, 2)).toEqual([["addDir", "src/patterns/atoms/zz-split"], ["add", rel]]);
      expect(result.events.slice(2).length).toBeGreaterThanOrEqual(1);
      expect(result.events.slice(2).every(([event, path]) => event === "change" && path === rel)).toBe(true);
      // Both states were handled, as the handler read them (the stamp ends in the size): the empty file by
      // the add, the full one by a change. A dropped change leaves only the empty one.
      const sizes = handled.slice(from).filter(h => h.path === b.at(rel) && h.stamp !== null)
        .map(h => [h.event, Number(h.stamp!.split(":").pop())]);
      expect(sizes[0]).toEqual(["add", 0]);
      expect(sizes.some(([event, size]) => event === "change" && size === Buffer.byteLength(content))).toBe(true);
      // The full content is what pd dev serves.
      expect(await (await fetch(`${b.origin}/preview/atoms/zz-split`)).text()).toContain("<p>split</p>");
      // Every kind of message, each named exactly; a repeat of one is the extra event above. Its content-swap
      // names the new component. (Changed with linked packages being watched: the package stylesheet edited
      // the case before now reloads in its own step, so this restyle no longer picks it up.)
      expect([...new Set(result.messages)].sort()).toEqual([
        "{\"type\":\"collision\",\"handle\":\"atoms-baseless-2\",\"incumbentPath\":\"<root>/src/patterns/atoms/baseless-2/baseless-2.hbs\",\"quarantinedPath\":\"<root>/src/patterns/atoms/baseless/baseless-2.hbs\"}",
        "{\"type\":\"content-swap\",\"componentId\":\"atoms/zz-split\"}",
        "{\"type\":\"tree-changed\"}",
      ]);
      expect(warn.mock.calls.map(c => c.join(" ")).filter(m => m.includes("zz-split"))).toEqual([]);
    } finally {
      warn.mockRestore();
      await b.close();
    }
  }, 60_000);
});

describe("the watcher on the storefront bench", () => {
  const SETUP: Record<string, Act> = {
    "removing it": async b => { await b.step(() => b.create("pages/zz-char.md", "---\ntitle: Char\n---\n"), [["add", "pages/zz-char.md"]]); },
  };
  const CASES: Case[] = [
    ["a page", b => b.edit("pages/about.md", "\nMore.\n"), [["change", "pages/about.md"]], [
      "{\"type\":\"page-changed\",\"route\":\"/about/\"}",
    ]],
    ["a new page", b => b.create("pages/zz-char.md", "---\ntitle: Char\n---\n"), [["add", "pages/zz-char.md"]], [
      "{\"type\":\"page-changed\",\"route\":null}",
    ]],
    ["removing it", b => b.remove("pages/zz-char.md"), [["unlink", "pages/zz-char.md"]], [
      "{\"type\":\"page-changed\",\"route\":null}",
    ]],
    ["a layout", b => b.edit("src/patterns/layouts/page/page.hbs", "\n"), [["change", "src/patterns/layouts/page/page.hbs"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"layouts/page\"}",
    ]],
    ["a partial's stylesheet", b => b.edit("src/styles/partials/footer.scss", "\n.zz-char { color: red; }\n"), [["change", "src/styles/partials/footer.scss"]], [
      "{\"type\":\"css-link-swap\",\"componentId\":\"partials/footer\",\"href\":\"/_pd/components/partials/footer.css?v=<t>\",\"orderedHrefs\":[\"/_pd/components/components/callout.css?v=<t>\"]}",
    ]],
    ["a base-layer file", b => b.edit("src/styles/site/tokens.scss", "\n:root { --wf-char: 1; }\n"), [["change", "src/styles/site/tokens.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"components/callout\"}",
      "{\"type\":\"page-changed\",\"route\":\"/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/about/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/setup/\"}",
    ]],
    ["a new base-layer file", b => b.create("src/styles/site/zz-char.scss", ".site { --wf-char2: 1; }\n"), [["add", "src/styles/site/zz-char.scss"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"components/callout\"}",
      "{\"type\":\"page-changed\",\"route\":\"/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/about/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/\"}",
      "{\"type\":\"page-changed\",\"route\":\"/guides/setup/\"}",
    ]],
    ["the component's data", b => b.edit("src/patterns/components/callout/callout.json", "\n"), [["change", "src/patterns/components/callout/callout.json"]], [
      "{\"type\":\"content-swap\",\"componentId\":\"components/callout\"}",
    ]],
  ];
  for (const [name, act, events, messages] of CASES) {
    it(`sends what it sends for ${name}`, async () => {
      const b = await storefrontBench(SETUP[name]);
      try {
        expect(await b.step(() => act(b), events)).toEqual({ messages, events });
      } finally {
        await b.close();
      }
    }, 60_000);
  }
});

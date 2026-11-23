// The project graph follows every save: the next answer after the watcher has handled a file is the graph of the
// files as they are now. One case per input the graph is built from: a template (includes), a stylesheet (mentions),
// a page (places), a component's docs (requires) and an assets.css file (defines). The last two change no input
// object the graph is kept under, only the watch generation (graph/current.ts), so they run on the same copy served
// as a style guide alone: with a site, the harness's barrier file in the pages folder gives a new page model on every
// step, and the graph is built again whatever the generation says. Observed over /api/graph after Bench.step()
// (watch-harness.ts), on a copy of storefront-bench.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import type { GraphEdge, ProjectGraphJson } from "@pattern-dump/contracts";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let tmp = "";
let b: Bench;
/** The same copy, as a style guide alone (no site): no page model to change on every step. */
let guide: Bench;

const withExtra = { ...benchConfig, assets: { ...benchConfig.assets, css: ["graph-extra.css"] } };
const config = validateConfig(withExtra, "storefront-bench");
const { site: _site, ...guideOnly } = withExtra;
const guideConfig = validateConfig(guideOnly, "storefront-bench");

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-watch-graph-"));
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(tmp, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  await save(join(tmp, "src/assets/graph-extra.css"), `.extra-a { color: red; }\n`);
  b = new Bench(tmp, null);
  await b.start(config);
  guide = new Bench(tmp, null);
  await guide.start(guideConfig);
}, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const graph = async (on: Bench = b): Promise<ProjectGraphJson> => (await fetch(`${on.origin}/api/graph`)).json() as Promise<ProjectGraphJson>;
const edge = (e: Partial<GraphEdge>) => expect.objectContaining(e);
const append = async (rel: string, text: string): Promise<void> => { await b.edit(rel, text); };

describe("the project graph after a save", () => {
  it("a template that includes another component", async () => {
    const e = { kind: "includes" as const, from: "component:components/callout", to: "component:components/icon-label" };
    expect((await graph()).edges).not.toContainEqual(edge(e));
    await b.step(() => append("src/patterns/components/callout/callout.hbs", `{{> components-icon-label label="x" }}\n`));
    expect((await graph()).edges).toContainEqual(edge(e));
  });

  it("a stylesheet that reaches into another component's class", async () => {
    const e = { kind: "mentions" as const, from: "stylesheet:src/styles/components/card.scss", to: "class:icon-label" };
    expect((await graph()).edges).not.toContainEqual(edge(e));
    await b.step(() => append("src/styles/components/card.scss", `.card .icon-label { margin: 0; }\n`));
    expect((await graph()).edges).toContainEqual(edge({ ...e, selector: ".card .icon-label" }));
  });

  it("a page that places a component", async () => {
    const e = { kind: "places" as const, from: "page:/about/", to: "component:components/callout", how: "tag" as const };
    expect((await graph()).edges).not.toContainEqual(edge(e));
    await b.step(() => append("pages/about.md", `\n<pd-components-callout heading="Placed"></pd-components-callout>\n`));
    expect((await graph()).edges).toContainEqual(edge(e));
  });

  it("a component's docs that require a script (a style guide alone)", async () => {
    const e = { kind: "requires" as const, from: "component:components/callout", to: "asset:script/graph-extra" };
    expect((await graph(guide)).edges).not.toContainEqual(edge(e));
    const md = await readFile(guide.at("src/patterns/components/callout/callout.md"), "utf8");
    await guide.step(() => save(guide.at("src/patterns/components/callout/callout.md"), md.replace(/^---\n/, "---\nrequireScript: graph-extra\n")));
    expect((await graph(guide)).edges).toContainEqual(edge(e));
  });

  it("an assets.css file that defines a class (a style guide alone)", async () => {
    const e = { kind: "defines" as const, from: "stylesheet:src/assets/graph-extra.css", to: "class:extra-b" };
    expect((await graph(guide)).edges).not.toContainEqual(edge(e));
    await guide.step(() => guide.edit("src/assets/graph-extra.css", `.extra-b { color: blue; }\n`));
    expect((await graph(guide)).edges).toContainEqual(edge(e));
  });
});

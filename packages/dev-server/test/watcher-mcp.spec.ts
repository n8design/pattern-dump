// A save changes the MCP server's next answer: a template's include (usage), a stylesheet's rule that reaches into
// another component's class (ownership), a page's placement (usage's pages). Over HTTP inside pd dev, observed after
// the watcher has handled the file (Bench.step, watch-harness.ts); and over stdio (pd mcp), a process the harness
// can't watch, so there the next answers are asked until the change shows, with a deadline, the outcome named.
// On copies of storefront-bench.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { Bench, closeAll } from "./watch-harness.js";
import { call, httpClient, stdioClient } from "./mcp-client.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
let tmp = "";

async function benchCopy(name: string): Promise<string> {
  const root = join(tmp, name);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  return root;
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-watch-mcp-")); }, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

type Usage = { components: string[]; pages: Array<{ route: string; how: string }> };
type Ownership = { stylesClassesOf: Array<{ component: string }> };

/** Each save, and the answer it must change, by tool. */
const CASES = [
  {
    what: "a template's include (usage)",
    file: "src/patterns/components/callout/callout.hbs", text: `{{> components-icon-label label="x" }}\n`,
    tool: "usage", args: { id: "components/icon-label" },
    changed: (a: unknown) => (a as Usage).components.includes("components/callout"),
  },
  {
    what: "a stylesheet that styles another component's class (ownership)",
    file: "src/styles/components/card.scss", text: `.card .icon-label { margin: 0; }\n`,
    tool: "ownership", args: { id: "components/card" },
    changed: (a: unknown) => (a as Ownership).stylesClassesOf.some(c => c.component === "components/icon-label"),
  },
  {
    what: "a page's placement (usage's pages)",
    file: "pages/about.md", text: `\n<pd-components-callout heading="Placed"></pd-components-callout>\n`,
    tool: "usage", args: { id: "components/callout" },
    changed: (a: unknown) => (a as Usage).pages.some(p => p.route === "/about/" && p.how === "tag"),
  },
] as const;

describe("over HTTP, inside pd dev", () => {
  let b: Bench;
  let client: Client;
  beforeAll(async () => {
    b = new Bench(await benchCopy("http"), null);
    await b.start(config);
    client = await httpClient(Number(new URL(b.origin).port));
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  for (const c of CASES) {
    it(`a save changes the next answer: ${c.what}`, async () => {
      expect(c.changed((await call(client, c.tool, c.args)).answer)).toBe(false);
      await b.step(() => b.edit(c.file, c.text));
      expect(c.changed((await call(client, c.tool, c.args)).answer)).toBe(true);
    });
  }
});

describe("over stdio, pd mcp", () => {
  let root = "";
  let client: Client;
  beforeAll(async () => {
    root = await benchCopy("stdio");
    // The bench's own config, with its paths read against the copy: the copy can't resolve the config's imports.
    client = await stdioClient(root, join(repo, "storefront-bench/pattern-dump.config.ts"));
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  for (const c of CASES) {
    it(`a save changes the next answer: ${c.what}`, async () => {
      expect(c.changed((await call(client, c.tool, c.args)).answer)).toBe(false);
      await save(join(root, c.file), `${await readFile(join(root, c.file), "utf8")}${c.text}`);
      // Until the answer has the change: the watcher of a process the harness can't hook into.
      const deadline = Date.now() + 20_000;
      let answer: unknown;
      do { answer = (await call(client, c.tool, c.args)).answer; } while (!c.changed(answer) && Date.now() < deadline && await new Promise(r => setTimeout(r, 100, true)));
      expect(c.changed(answer), `${c.tool} ${JSON.stringify(c.args)} after the save: ${JSON.stringify(answer)}`).toBe(true);
    }, 30_000);
  }
});

// Files as they arrive, through the real watcher: what pd dev serves after each, never which events came. Each
// case is a shape a watcher has been seen to get wrong, alone or under load: a new file in a folder that already
// exists, a file created empty and then written (in an existing folder and in a new one), a folder made and a
// file renamed into it next to one written in place, and a folder two levels deep made in one go. The quick
// second save is watcher-quick-save.spec.ts, an in-place edit is watcher.spec.ts's content swap, and two
// watched folders whose names share a prefix are storefront-watch.spec.ts's "still the pages folder".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { Bench, closeAll, handled, whenHandled } from "./watch-harness.js";
import { save, saveInTwoSteps } from "../../../test-support/save.js";

let tmp = "";
let b: Bench;

beforeAll(async () => {
  tmp = realpathSync(await mkdtemp(join(tmpdir(), "pd-arrivals-")));
  const root = join(tmp, "site");
  await save(join(root, "src/patterns/atoms/btn/btn.hbs"), "<button class=\"btn\">One</button>\n");
  await mkdir(join(root, "src/styles"), { recursive: true });
  b = new Bench(root, "atoms/btn");
  await b.start(validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
  }), "site"));
}, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const tree = async (): Promise<string> => (await (await fetch(`${b.origin}/api/tree`)).text());
const preview = async (id: string): Promise<string> => (await (await fetch(`${b.origin}/preview/${id}`)).text());
const doc = async (id: string): Promise<string | undefined> =>
  ((await (await fetch(`${b.origin}/api/component/${id}`)).json()) as { doc?: string }).doc;
/** Until the last write of `rel` so far is handled: between the two writes of a file written in two steps. */
async function handledOnce(from: number, rel: string): Promise<void> {
  await whenHandled(() => b.handledSince(from).some(([, p]) => p === rel),
    () => `${rel} handled; handled: ${JSON.stringify(b.handledSince(from))}`);
}

describe("a file that arrives while pd dev runs", () => {
  it("new, in a folder that already exists, in one write: in the tree, rendering what was written", async () => {
    await b.step(() => b.create("src/patterns/atoms/btn-ghost.hbs", "<button class=\"ghost\">Ghost</button>\n"));
    expect(await tree()).toContain("\"path\":\"atoms/btn-ghost\"");
    expect(await preview("atoms/btn-ghost")).toContain("<button class=\"ghost\">Ghost</button>");
  }, 30_000);

  it("created empty, then written, in a folder that already exists: it renders what was written", async () => {
    const rel = "src/patterns/atoms/later.hbs";
    await b.step(async () => {
      const from = handled.length;
      await saveInTwoSteps(b.at(rel), "");
      await handledOnce(from, rel);
      await saveInTwoSteps(b.at(rel), "<p class=\"later\">written</p>\n");
    });
    expect(await tree()).toContain("\"path\":\"atoms/later\"");
    expect(await preview("atoms/later")).toContain("<p class=\"later\">written</p>");
  }, 30_000);

  it("created empty, then written, in a folder made a moment before: its docs are what was written", async () => {
    const dir = "src/patterns/molecules/fresh";
    const md = `${dir}/fresh.md`;
    await b.step(async () => {
      const from = handled.length;
      await b.create(`${dir}/fresh.hbs`, "<p class=\"fresh\">Fresh</p>\n");
      await saveInTwoSteps(b.at(md), "");
      await handledOnce(from, md);
      await saveInTwoSteps(b.at(md), "# Fresh\n\nWritten after it was created.\n");
    });
    expect(await tree()).toContain("\"path\":\"molecules/fresh\"");
    expect(await doc("molecules/fresh")).toContain("Written after it was created.");
  }, 30_000);

  it("in a folder made a moment before, one file renamed in and one written in place: both are served", async () => {
    const dir = "src/patterns/molecules/pair";
    await b.step(async () => {
      await mkdir(b.at(dir));
      await b.create(`${dir}/pair.hbs`, "<p class=\"pair\">Pair</p>\n");
      await saveInTwoSteps(b.at(`${dir}/pair.md`), "# Pair\n\nIts docs.\n");
    });
    expect(await tree()).toContain("\"path\":\"molecules/pair\"");
    expect(await preview("molecules/pair")).toContain("<p class=\"pair\">Pair</p>");
    expect(await doc("molecules/pair")).toContain("Its docs.");
  }, 30_000);

  it("in a folder two levels deep, made in one go, renamed in: in the tree, rendering what was written", async () => {
    const dir = "src/patterns/organisms/outer/inner";
    await b.step(async () => {
      await mkdir(b.at(dir), { recursive: true });
      await b.create(`${dir}/deep.hbs`, "<p class=\"deep\">Deep</p>\n");
    });
    expect(await tree()).toContain("\"path\":\"organisms/outer/inner/deep\"");
    expect(await preview("organisms/outer/inner/deep")).toContain("<p class=\"deep\">Deep</p>");
  }, 30_000);
});

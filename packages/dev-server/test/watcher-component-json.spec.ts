// A component's .json added or removed while pd dev runs: each kind discovery reads by name is seen
// without a restart, in the project's patterns and in a linked package's the same. A schema
// (`<stem>.schema.json`) is the component's schema, data (`<stem>.json`) is what it renders with, and
// variant data (`<base>~<variant>.json`) is a variant of its own. Observed over HTTP after the watcher has
// handled the file (watch-harness.ts), with the messages it sent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { previewUrl } from "@pattern-dump/contracts";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;

const MANIFEST = { patterns: "patterns", styles: { dir: "styles" } };
const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  packages: ["@acme/ds"],
}), "site");

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

/** A fresh project with its own component (atoms/btn) and a linked package's (atoms/chip), neither with any .json. */
async function project(): Promise<Bench> {
  const root = join(tmp, `site-${n++}`);
  await write(join(root, "src/patterns/atoms/btn/btn.hbs"), `<button class="btn">{{label}}</button>\n`);
  await mkdir(join(root, "src/styles"), { recursive: true });
  const pkg = join(root, "vendor/ds");
  await write(join(pkg, "package.json"), JSON.stringify({ name: "@acme/ds", version: "1.0.0", patternDump: MANIFEST }));
  await write(join(pkg, "patterns/atoms/chip/chip.hbs"), `<span class="chip">{{label}}</span>\n`);
  await mkdir(join(pkg, "styles"), { recursive: true });
  await mkdir(join(root, "node_modules/@acme"), { recursive: true });
  await symlink(join("..", "..", "vendor", "ds"), join(root, "node_modules/@acme/ds"));
  const b = new Bench(root, null);
  await b.start(config);
  return b;
}

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-component-json-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

type Detail = { document?: string; variants: Array<{ name: string }>; source: { json?: string; schema?: string } };
const detail = async (b: Bench, id: string): Promise<Detail> => (await fetch(`${b.origin}/api/component/${id}`)).json() as Promise<Detail>;
const variants = async (b: Bench, id: string): Promise<string[]> => (await detail(b, id)).variants.map(v => v.name);

// Where each component's files are, by the root it is in.
const ROOTS = [
  { root: "the project's patterns", id: "atoms/btn", dir: "src/patterns/atoms/btn", stem: "btn" },
  { root: "a linked package's patterns", id: "atoms/chip", dir: "vendor/ds/patterns/atoms/chip", stem: "chip" },
];

/** What a .json added or removed sends: the tree, and a reload of the component it belongs to. */
const sent = (id: string) => [`{"type":"content-swap","componentId":"${id}"}`, `{"type":"tree-changed"}`];

for (const { root, id, dir, stem } of ROOTS) {
  describe(`a component's .json added and removed, in ${root}`, () => {
    let b: Bench;
    beforeAll(async () => { b = await project(); }, 60_000);

    it("data: renders with it once added, and without it once removed", async () => {
      const file = `${dir}/${stem}.json`;
      expect((await detail(b, id)).source.json).toBeUndefined();

      const added = await b.step(() => b.create(file, `{ "label": "From its data" }\n`), [["add", file]]);
      expect(added.messages).toEqual(sent(id));
      const withData = await detail(b, id);
      expect(withData.source.json).toContain("From its data");
      expect(withData.document).toContain("From its data");

      const removed = await b.step(() => b.remove(file), [["unlink", file]]);
      expect(removed.messages).toEqual(sent(id));
      const without = await detail(b, id);
      expect(without.source.json).toBeUndefined();
      expect(without.document).not.toContain("From its data");
    }, 60_000);

    it("schema: is the component's schema once added, and not once removed", async () => {
      const file = `${dir}/${stem}.schema.json`;
      const schema = `{ "type": "object", "properties": { "label": { "type": "string", "title": "Its label" } } }\n`;
      expect((await detail(b, id)).source.schema).toBeUndefined();

      const added = await b.step(() => b.create(file, schema), [["add", file]]);
      expect(added.messages).toEqual(sent(id));
      expect((await detail(b, id)).source.schema).toContain("Its label");

      const removed = await b.step(() => b.remove(file), [["unlink", file]]);
      expect(removed.messages).toEqual(sent(id));
      expect((await detail(b, id)).source.schema).toBeUndefined();
    }, 60_000);

    it("variant data: is one of the component's variants once added, and not once removed", async () => {
      const file = `${dir}/${stem}~big.json`;
      expect(await variants(b, id)).toEqual([]);

      const added = await b.step(() => b.create(file, `{ "label": "Big" }\n`), [["add", file]]);
      expect(added.messages).toEqual(sent(id));
      expect(await variants(b, id)).toEqual(["big"]);
      const preview = await fetch(`${b.origin}${previewUrl(id, "big")}`);
      expect(preview.status).toBe(200);
      expect(await preview.text()).toContain(">Big<");

      const removed = await b.step(() => b.remove(file), [["unlink", file]]);
      expect(removed.messages).toEqual(sent(id));
      expect(await variants(b, id)).toEqual([]);
    }, 60_000);
  });
}

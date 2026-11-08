// A storefront page deleted while the pages folder is read (listed, gone when its file is read) is not a
// page. Produced by failing the read of that one file the way the file system does, so it does not depend
// on timing. A page deleted after the folder was read: storefront-page-deleted.spec.ts, with no mock.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

// Files whose read fails with ENOENT, as if deleted after the folder listed them.
const gone = vi.hoisted(() => new Set<string>());
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = ((path: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
    if (gone.has(String(path))) {
      return Promise.reject(Object.assign(new Error(`ENOENT: no such file or directory, open '${String(path)}'`), { code: "ENOENT" }));
    }
    return (fs.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof fs.readFile;
  return { ...fs, readFile, default: { ...fs, readFile } };
});

let tmp = "";
let dir = "";
// The 404 is decided before anything is rendered, so the assembly is never asked for more.
const assembly = { live: undefined } as unknown as PageAssembly;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-page-gone-"));
  dir = join(tmp, "pages");
  await mkdir(dir, { recursive: true });
  await save(join(dir, "index.md"), "---\ntitle: Home\n---\n\nHome.\n");
  await save(join(dir, "about.md"), "---\ntitle: About\n---\n\nAbout.\n");
});
afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a page deleted while the folder is read", () => {
  it("while the folder is read: it is not a page, and the folder's other pages are", async () => {
    gone.add(join(dir, "about.md"));
    try {
      const model = await readPages(dir);
      expect([...model.files.keys()]).toEqual(["/"]);
      expect(model.problems).toEqual([]);
      expect((await assemblePage("/about/", model, assembly)).status).toBe(404);
    } finally {
      gone.clear();
    }
  });
});

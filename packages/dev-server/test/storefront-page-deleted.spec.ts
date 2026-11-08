// A storefront page deleted after the pages folder was read for a request is a 404, never an unhandled
// error: a real page in a temp folder, read, then deleted before the request. No mock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let dir = "";
// The 404 is decided before anything is rendered, so the assembly is never asked for more.
const assembly = { live: undefined } as unknown as PageAssembly;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-page-deleted-"));
  dir = join(tmp, "pages");
  await mkdir(dir, { recursive: true });
  await save(join(dir, "index.md"), "---\ntitle: Home\n---\n\nHome.\n");
  await save(join(dir, "about.md"), "---\ntitle: About\n---\n\nAbout.\n");
});
afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a page deleted after the folder was read", () => {
  it("is a 404: there is no page at its route", async () => {
    const model = await readPages(dir);
    expect(model.files.has("/about/")).toBe(true);
    await rm(join(dir, "about.md"));
    const page = await assemblePage("/about/", model, assembly);
    expect(page.status).toBe(404);
    expect(page.problems).toEqual(["there is no page at /about/"]);
    expect(page.html).toContain("there is no page at /about/");
  });
});

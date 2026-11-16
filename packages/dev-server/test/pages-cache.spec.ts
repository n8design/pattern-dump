// pages-cache.ts: the storefront's page model is not read again for every request. pd build reads it once; every
// other server keeps it only while the pages folder is as it was, so a new, changed or deleted page is in the next
// reading without a watcher.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPagesCache } from "../src/storefront/pages-cache.js";
import { readPages } from "../src/storefront/pages.js";
import { save } from "../../../test-support/save.js";

let tmp = "", pages = "";
beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "pd-pages-cache-")));
  pages = join(tmp, "pages");
  await mkdir(pages, { recursive: true });
  await save(join(pages, "index.md"), "---\ntitle: Home\n---\n\nHello.\n");
  await save(join(pages, "about.md"), "---\ntitle: About\n---\n\nAbout.\n");
});
afterEach(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** A reader that counts its readings. */
const counting = () => {
  const counter = { readings: 0, read: () => { counter.readings++; return readPages(pages); } };
  return counter;
};
const titles = (model: Awaited<ReturnType<typeof readPages>>): string[] => model.pages.map(p => p.title).sort();

describe("the pages cache of pd dev", () => {
  it("reads once while the folder is as it was", async () => {
    const cache = createPagesCache(pages, false);
    const c = counting();
    const first = await cache.get("a", c.read);
    expect(await cache.get("a", c.read)).toBe(first);
    expect(c.readings).toBe(1);
  });

  it("reads again when a page changes, and the reading has the change", async () => {
    const cache = createPagesCache(pages, false);
    const c = counting();
    expect(titles(await cache.get("a", c.read))).toEqual(["About", "Home"]);
    await save(join(pages, "about.md"), "---\ntitle: About this site\n---\n\nAbout.\n");
    expect(titles(await cache.get("a", c.read))).toEqual(["About this site", "Home"]);
    expect(c.readings).toBe(2);
  });

  it("reads again for a new page and for a deleted one", async () => {
    const cache = createPagesCache(pages, false);
    const c = counting();
    await cache.get("a", c.read);
    await save(join(pages, "contact.md"), "---\ntitle: Contact\n---\n");
    expect(titles(await cache.get("a", c.read))).toEqual(["About", "Contact", "Home"]);
    await rm(join(pages, "about.md"));
    expect(titles(await cache.get("a", c.read))).toEqual(["Contact", "Home"]);
    expect(c.readings).toBe(3);
  });

  it("reads again for other options", async () => {
    const cache = createPagesCache(pages, false);
    const c = counting();
    await cache.get("a", c.read);
    await cache.get("b", c.read);
    expect(c.readings).toBe(2);
  });

  it("does not keep a reading that failed", async () => {
    const cache = createPagesCache(pages, false);
    await expect(cache.get("a", () => Promise.reject(new Error("unreadable")))).rejects.toThrow("unreadable");
    const c = counting();
    expect(titles(await cache.get("a", c.read))).toEqual(["About", "Home"]);
    expect(c.readings).toBe(1);
  });
});

describe("the pages cache of pd build", () => {
  it("reads once for the build, whatever happens in the folder", async () => {
    const cache = createPagesCache(pages, true);
    const c = counting();
    const first = await cache.get("a", c.read);
    await save(join(pages, "contact.md"), "---\ntitle: Contact\n---\n");
    expect(await cache.get("a", c.read)).toBe(first);
    expect(c.readings).toBe(1);
  });
});

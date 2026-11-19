// pages-cache.ts: the storefront's page model is not read again for every request. pd build reads it once; every
// other server keeps it only while the pages folder is as it was, so a new, changed or deleted page is in the next
// reading without a watcher.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPagesCache, renderError } from "../src/storefront/pages-cache.js";
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

describe("the shared model is read-only", () => {
  // Consecutive requests get the same model: a change made while serving one page would show on every later one.
  for (const once of [false, true]) {
    it(`throws on a change instead of keeping it (${once ? "pd build" : "pd dev"})`, async () => {
      const cache = createPagesCache(pages, once);
      const model = await cache.get("a", () => readPages(pages));
      const page = model.files.get("/about/")!;
      expect(page).toBeDefined();
      expect(() => { (page as { route: string }).route = "/elsewhere/"; }).toThrow(TypeError);
      expect(() => { page.frontmatter.values["title"] = "Changed"; }).toThrow(TypeError);
      expect(() => { (model.pages as unknown[]).push({}); }).toThrow(TypeError);
      expect(() => { model.files.delete("/about/"); }).toThrow(TypeError);
      expect(() => { model.entries.set("/new/", model.entries.get("/about/")!); }).toThrow(TypeError);
      expect(() => { model.problems.push("x"); }).toThrow(TypeError);
      // Nothing changed, and the next request gets the same, whole model.
      const again = await cache.get("a", () => readPages(pages));
      expect(again).toBe(model);
      expect(again.files.get("/about/")?.route).toBe("/about/");
      expect(titles(again)).toEqual(["About", "Home"]);
    });
  }
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

describe("the message of a change to the shared model", () => {
  /** A helper as a project writes one, in its own function, so the stack names it. */
  function retitleHelper(page: { route: string }): void { page.route = "/elsewhere/"; }

  it("says the data is shared and read-only, and names the code that changed it", async () => {
    const model = await createPagesCache(pages, true).get("a", () => readPages(pages));
    let thrown: unknown;
    try { retitleHelper(model.files.get("/about/")!); } catch (e) { thrown = e; }
    const text = renderError(thrown);
    expect(text).toContain("Cannot assign to read only property 'route'");
    expect(text).toContain("shared by every page, so it is read-only");
    expect(text).toMatch(/changed at retitleHelper \(.*pages-cache\.spec\.ts:\d+:\d+\)/);
  });

  it("does the same for a map of the model", async () => {
    const model = await createPagesCache(pages, true).get("a", () => readPages(pages));
    let thrown: unknown;
    try { model.files.clear(); } catch (e) { thrown = e; }
    expect(renderError(thrown)).toMatch(/^Cannot clear in a read-only Map\. The site's page data is shared/);
  });

  it("adds nothing to a message the renderer has explained already", () => {
    const explained = new TypeError("Cannot assign to read only property 'tone' of object '#<Object>', while rendering atoms/card. "
      + "A render's data (the component's data files, the global data, a site page's data) is shared by every render, so it is "
      + "read-only: copy a value before changing it (changed at shout (helpers.js:1:2))");
    expect(renderError(explained)).toBe(explained.message);
  });

  it("leaves any other error as it was", () => {
    expect(renderError(new Error("Missing helper: \"x\""))).toBe("Missing helper: \"x\"");
    expect(renderError(new TypeError("x is not a function"))).toBe("x is not a function");
    expect(renderError("text")).toBe("text");
  });
});

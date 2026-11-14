// Collections on the rendered page, in pd dev and on the built root: the articles folder's index.md lists its pages
// newest first as cards (page.children), the one without a description by its first paragraph, unshortened in the
// markup and clamped to three lines by the card's CSS; the home page shows the two newest (site.collections). In pd
// dev a draft written while the site is open is listed, marked, and removing it takes it away.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";
import { isDev } from "./helpers.js";
import { save } from "../../test-support/save.js";

const HARBOUR_TEASER = "This article has no description, so its listing shows this first paragraph instead: the text of the page as it "
  + "starts, without its markup, never shortened in the data. The card in the listing limits it to three lines.";

test("the listing shows the folder's pages newest first, each card linking to its page", async ({ page }) => {
  await page.goto("/articles/");
  await expect(page.locator(".card-title a")).toHaveText(["A harbour of cable cars", "Plain on purpose"]);
  expect(await page.locator(".card-title a").evaluateAll(as => as.map(a => a.getAttribute("href")))).toEqual(["/articles/harbour/", "/articles/plain/"]);
  await expect(page.locator(".card-date time")).toHaveText(["2026-11-01", "2026-10-02"]);
  await expect(page.locator(".card-teaser").nth(1)).toHaveText("Why the bench's skin is a wireframe.");
  // The harbour card's image, with its variants for an 8rem box.
  await expect(page.locator(".card img")).toHaveCount(1);
  await expect(page.locator(".card img")).toHaveAttribute("sizes", "8rem");
});

test("a page with no description: the first paragraph, whole in the markup, three lines on screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/articles/");
  const teaser = page.locator(".card-teaser").first();
  // The text is all there: textContent, not what is painted.
  expect((await teaser.textContent())?.trim()).toBe(HARBOUR_TEASER);
  // Painted: three lines, the rest clipped.
  const box = await teaser.evaluate(el => {
    const s = getComputedStyle(el);
    return { height: el.getBoundingClientRect().height, scroll: el.scrollHeight, line: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2 };
  });
  expect(box.scroll).toBeGreaterThan(box.height);
  expect(Math.round(box.height / box.line)).toBe(3);
});

test("the home page lists the newest articles from site.collections", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-latest h2")).toHaveText("Latest articles");
  await expect(page.locator(".home-latest a")).toHaveText(["A harbour of cable cars", "Plain on purpose"]);
});

test.describe("a draft", () => {
  const draft = fileURLToPath(new URL("../pages/articles/zz-draft.md", import.meta.url));
  test.afterEach(async () => { await rm(draft, { force: true }); });

  test("pd dev lists it, marked, as soon as it is written, and takes it away when it goes", async ({ page }, info) => {
    test.skip(!isDev(info), "drafts are shown by pd dev only; storefront-drafts.spec.ts checks that a build leaves them out");
    await page.goto("/articles/");
    await expect(page.locator(".card-title a")).toHaveCount(2);
    await save(draft, "---\nlayout: article\ntitle: Written ahead\ndescription: Not yet published.\ndate: 2026-11-20\ndraft: true\n---\n\nSoon.\n");
    await expect(page.locator(".card-title a")).toHaveText(["Written ahead", "A harbour of cable cars", "Plain on purpose"], { timeout: 10_000 });
    await expect(page.locator(".card").first().locator(".card-draft")).toHaveText("Draft");
    await rm(draft);
    await expect(page.locator(".card-title a")).toHaveText(["A harbour of cable cars", "Plain on purpose"], { timeout: 10_000 });
  });
});

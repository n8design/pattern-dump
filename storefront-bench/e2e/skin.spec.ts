// The skin as a browser paints it — from pd dev, and from the built root on a static host: its fonts,
// its colour schemes, its one brand token, its cards, and no accessibility violations in light or dark.
import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const ROUTES = ["/", "/about/", "/guides/", "/guides/setup/"];

/** Wait until every live example's frame has been fitted and every font face in use has loaded. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLIFrameElement>("figure.doc-example iframe")]
    .every(f => f.style.height !== "" && f.style.height !== "1px"));
  await page.evaluate(() => document.fonts.ready);
}

test.describe("the skin", () => {
  test("loads its own fonts: Montserrat for display, Source Serif 4 (roman and italic) for text", async ({ page }) => {
    await page.goto("/guides/setup/");
    await settle(page);
    const fonts = await page.evaluate(() => ({
      loaded: [...document.fonts].filter(f => f.status === "loaded").map(f => `${f.family} ${f.style}`).sort(),
      title: getComputedStyle(document.querySelector("h1")!).fontFamily,
      text: getComputedStyle(document.querySelector(".article-body p")!).fontFamily,
    }));
    // All three faces: the tagline is set in italic.
    expect(fonts.loaded).toEqual(["Montserrat normal", "Source Serif 4 italic", "Source Serif 4 normal"]);
    expect(fonts.title).toMatch(/^"?Montserrat"?,/);
    expect(fonts.text).toMatch(/^"Source Serif 4",/);
  });

  for (const [scheme, paper] of [["light", "oklch(0.985 0.006 85)"], ["dark", "oklch(0.18 0.015 260)"]] as const) {
    test(`follows the ${scheme} colour scheme, on the page and inside its live example`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await settle(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(paper);
      expect(await page.locator("figure.doc-example iframe").evaluate((f: HTMLIFrameElement) =>
        f.contentWindow!.getComputedStyle(f.contentDocument!.body).backgroundColor)).toBe(paper);
    });
  }

  test("takes its brand colour from --sk-accent alone", async ({ page }) => {
    await page.goto("/");
    const read = () => page.evaluate(() => ({
      mark: getComputedStyle(document.querySelector(".site-title")!, "::before").backgroundColor,
      cover: getComputedStyle(document.querySelector(".home-cover")!).backgroundColor,
      current: getComputedStyle(document.querySelector('.site-nav a[aria-current="page"]')!).textDecorationColor,
    }));
    const before = await read();
    await page.addStyleTag({ content: ":root { --sk-accent: rgb(0, 110, 70); }" });
    const after = await read();
    expect(after.mark).toBe("rgb(0, 110, 70)");
    expect(after.current).toBe("rgb(0, 110, 70)");
    // The cover's wash is mixed from the accent, so it follows too.
    expect(after.cover).not.toBe(before.cover);
  });

  for (const [name, width, beside] of [["a wide card", 1440, true], ["a narrow card", 390, false]] as const) {
    test(`${name} sets a folder's pages ${beside ? "beside" : "beneath"} its title`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const card = page.locator(".card", { has: page.locator('.card-title[href="/guides/"]') });
      const box = await card.evaluate(c => {
        const t = c.querySelector(".card-title")!.getBoundingClientRect(), p = c.querySelector(".card-pages")!.getBoundingClientRect();
        return { titleRight: t.right, titleBottom: t.bottom, pagesLeft: p.left, pagesTop: p.top };
      });
      if (beside) expect(box.pagesLeft).toBeGreaterThan(box.titleRight);
      else expect(box.pagesTop).toBeGreaterThanOrEqual(box.titleBottom);
    });
  }
});

test.describe("accessibility (axe)", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const route of ROUTES) {
      test(`${route} in ${scheme}: no violations, live examples included`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(route);
        await settle(page);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const summary = violations.map(v => `[${v.impact}] ${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`).join("\n");
        expect(violations, `axe violations:\n${summary}`).toEqual([]);
      });
    }
  }
});

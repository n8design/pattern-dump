// Every storefront page, rendered in a browser — from pd dev, and from the built root on a static host.
import { expect, test } from "@playwright/test";

// route, document title, heading, the header label that is the page itself, the one that is its section.
const PAGES: Array<[route: string, title: string, heading: string, page: string | null, section: string | null]> = [
  ["/", "Storefront bench", "Storefront bench", "Storefront bench ©2026", null],
  ["/about/", "About — Storefront bench", "About", "(02) About", null],
  ["/guides/", "Guides — Storefront bench", "Guides", "(01) Guides", null],
  ["/guides/setup/", "Setup — Storefront bench", "Setup", null, "(01) Guides"],
];

test.describe("storefront pages", () => {
  for (const [route, title, heading, current, section] of PAGES) {
    test(`${route} renders through its layout, with the header marking it or its section current`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      await expect(page.locator("h1")).toHaveText(heading);
      await expect(page.locator('.site-header [aria-current="page"]')).toHaveText(current ? [current] : []);
      await expect(page.locator('.site-header [aria-current="true"]')).toHaveText(section ? [section] : []);
      await expect(page.locator(".site-footer")).toContainText("Built with Pattern Dump from the storefront bench.");
    });
  }

  test("the header numbers the sections from 01, one label each, the home page left out", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".site-nav a")).toHaveText(["(01) Guides", "(02) About"]);
    await expect(page.locator(".site-title")).toHaveAttribute("href", "/");
  });

  for (const [width, rows] of [[1440, 1], [390, 2]] as const) {
    test(`lays the header out as ${rows === 1 ? "one row of four labels" : "two rows"} at ${width}px, the tagline at the end`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/guides/setup/");
      const boxes = await page.locator(".site-header").evaluate(h => {
        const box = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
        const labels = [h.querySelector(".site-title")!, ...h.querySelectorAll(".site-nav a"), h.querySelector(".site-tagline")!];
        const tagline = box(h.querySelector(".site-tagline")!), header = h.getBoundingClientRect();
        // Rows by each label's text box: tops within 4px of each other are one row (baselines align; a
        // real second row is a line height further down).
        const tops = labels.map(l => box(l).top).sort((a, b) => a - b);
        const rowCount = tops.filter((t, i) => i === 0 || t - tops[i - 1] > 4).length;
        return { rowCount, lefts: labels.map(l => Math.round(box(l).left)), taglineEnd: Math.abs(tagline.right - header.right) < 2 };
      });
      expect(boxes.rowCount).toBe(rows);
      if (rows === 1) expect([...boxes.lefts].sort((a, b) => a - b)).toEqual(boxes.lefts);
      expect(boxes.taglineEnd).toBe(true);
    });
  }

  test("marks the section a page is in with the accent", async ({ page }) => {
    await page.goto("/guides/setup/");
    const colours = await page.locator(".site-nav a").evaluateAll(as => {
      const probe = document.createElement("i");
      probe.style.color = "var(--sk-accent-text)";
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return as.map(a => getComputedStyle(a).color === accent);
    });
    expect(colours).toEqual([true, false]);
  });

  test("loads no workbench shell stylesheet", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(ls => ls.map(l => l.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).not.toContain("/_pd/main.css");
    expect(hrefs.some(h => h?.startsWith("/_pd/themes/"))).toBe(false);
  });
});

test.describe("live examples", () => {
  for (const [route, id] of [["/", "components/callout"], ["/guides/setup/", "components/callout~warning"]] as const) {
    test(`${route}: the ${id} frame fits its preview's height and fills the column's width`, async ({ page }) => {
      await page.goto(route);
      const frame = page.locator(`figure.doc-example iframe[src="/preview/${id}"]`);
      await expect(frame).toHaveCount(1);
      // Height: the frame follows the height its preview document posts (shorter than the UA's 150px).
      await expect.poll(async () => frame.evaluate((f: HTMLIFrameElement) => {
        const doc = f.contentDocument?.documentElement;
        const box = f.getBoundingClientRect().height - (f.offsetHeight - f.clientHeight);
        return doc ? Math.abs(box - doc.scrollHeight) <= 1 && box < 150 : false;
      })).toBe(true);
      // Width: the frame is exactly as wide as its container's content box.
      const widths = await frame.evaluate((f: HTMLIFrameElement) => {
        const fig = f.closest("figure")!;
        const cs = getComputedStyle(fig);
        return { frame: f.getBoundingClientRect().width, container: fig.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
      });
      expect(Math.abs(widths.frame - widths.container)).toBeLessThan(0.5);
      // The component inside is painted with its own CSS.
      await expect.poll(() => frame.evaluate((f: HTMLIFrameElement) => {
        const el = f.contentDocument?.querySelector(".callout");
        return el ? getComputedStyle(el).borderInlineStartWidth : null;
      })).toBe("4px");
    });
  }
});

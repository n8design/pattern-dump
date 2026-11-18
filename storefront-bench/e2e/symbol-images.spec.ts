// Symbol images (`![Alt](#stem)` on the setup guide), read off the paint: a symbol drawn from the page's sprite takes
// the bench's colour tokens and follows the page's color-scheme (as a skin's light and dark switch sets it), its
// marker and gradient paint, it keeps its aspect ratio and stays in the column, and its standalone file shows as an
// <img>. Each colour is compared with a probe painted with the same token, never with a value written here. In pd dev
// and on the built site; in pd dev, a source edited while the page is open shows on the open page.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { isDev } from "./helpers.js";
import { save } from "../../test-support/save.js";

const FLOW = `svg.doc-image[aria-label="A filled box points to an outlined box"]`;
const LAYERS = `svg.doc-image[aria-label="Two layers, the lower one fading out"]`;

/** The painted colour at a point of the page, from a one-pixel screenshot, decoded by the page itself. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 }, scale: "css" });
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png.toString("base64"));
}

/** The painted colour of a probe square in `token`, added to the page for the comparison. */
async function probe(page: Page, token: string): Promise<number[]> {
  const box = await page.evaluate(t => {
    const d = document.createElement("div");
    d.className = "pd-test-probe";
    d.style.cssText = `position:fixed;left:0;top:0;width:8px;height:8px;background:var(${t});z-index:2147483647`;
    document.body.append(d);
    return d.getBoundingClientRect().toJSON() as { x: number; y: number };
  }, token);
  const c = await pixel(page, box.x + 4, box.y + 4);
  await page.evaluate(() => document.querySelectorAll(".pd-test-probe").forEach(p => p.remove()));
  return c;
}

/** A point of a symbol, in its source's coordinates (both sources are 400 × 200), on the page. */
async function at(page: Page, selector: string, x: number, y: number): Promise<number[]> {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  return pixel(page, box.x + x * box.width / 400, box.y + y * box.height / 200);
}

const near = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 3);

test("a symbol takes the page's tokens in light and dark, with its marker, its gradient and currentColor", async ({ page }) => {
  await page.goto("/guides/setup/");
  for (const scheme of ["light", "dark"] as const) {
    // What a skin's light and dark switch does: the page's color-scheme, here on <html>.
    await page.evaluate(s => { document.documentElement.style.colorScheme = s; }, scheme);
    const fill = await probe(page, "--color-fill"), line = await probe(page, "--color-line");
    expect(near(fill, line), "the probes differ").toBe(false);
    expect(near(await at(page, FLOW, 80, 100), fill), `${scheme}: the filled box`).toBe(true);
    expect(near(await at(page, FLOW, 246, 100), fill), `${scheme}: the marker`).toBe(true);
    expect(near(await at(page, FLOW, 200, 100), line), `${scheme}: the line`).toBe(true);
    expect(near(await at(page, LAYERS, 200, 55), fill), `${scheme}: the layer, from its <style> class rule`).toBe(true);
    expect(near(await at(page, LAYERS, 23, 145), line), `${scheme}: the gradient's start`).toBe(true);
    // currentColor is the text colour around the image.
    const text = await page.locator(FLOW).evaluate(e => getComputedStyle(e).color);
    const rgb = text.match(/\d+/g)!.slice(0, 3).map(Number);
    expect(near(await at(page, FLOW, 320, 100), rgb), `${scheme}: currentColor`).toBe(true);
  }
  const light = await (async () => { await page.evaluate(() => { document.documentElement.style.colorScheme = "light"; }); return probe(page, "--color-fill"); })();
  const dark = await (async () => { await page.evaluate(() => { document.documentElement.style.colorScheme = "dark"; }); return probe(page, "--color-fill"); })();
  expect(near(light, dark), "light and dark are different colours").toBe(false);
});

test("a symbol keeps its aspect ratio and stays in the column, the sprite takes no room, the caption is a figure", async ({ page }) => {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/guides/setup/");
    const box = await page.locator(FLOW).evaluate(e => {
      const r = e.getBoundingClientRect();
      return { width: r.width, height: r.height, column: e.closest(".site-main")!.getBoundingClientRect().width };
    });
    expect(box.width, `${width}px`).toBeLessThanOrEqual(Math.min(400, box.column));
    expect(Math.abs(box.height - box.width / 2), `${width}px`).toBeLessThan(1);
  }
  const sprite = await page.locator("body > svg:first-child").evaluate(e => ({ ...e.getBoundingClientRect().toJSON(), display: getComputedStyle(e).display }));
  // Hidden by its size, never display:none (which keeps its markers and gradients from painting).
  expect([sprite.width, sprite.height]).toEqual([0, 0]);
  expect(sprite.display).not.toBe("none");
  await expect(page.locator(`figure.doc-figure:has(${LAYERS}) figcaption`)).toHaveText("Two layers, drawn from the bench's tokens");
});

test("a symbol's standalone file shows as an <img>, in the light and the dark of its own query", async ({ page, request }) => {
  const res = await request.get("/_pd/symbols/flow.svg");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\/svg\+xml\b/);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/guides/setup/");
    await page.evaluate(s => { document.documentElement.style.colorScheme = s; }, scheme);
    const fill = await probe(page, "--color-fill");
    await page.evaluate(() => {
      const img = Object.assign(document.createElement("img"), { id: "pd-test-img", src: "/_pd/symbols/flow.svg", width: 400, height: 200, alt: "" });
      img.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647";
      document.body.append(img);
      return img.decode();
    });
    expect(near(await pixel(page, 80, 100), fill), `${scheme}: the file's filled box`).toBe(true);
  }
});

const source = fileURLToPath(new URL("../src/assets/symbols/flow.svg", import.meta.url));
test("an edited source shows on the page already open", async ({ page }, info) => {
  test.skip(!isDev(info), "pd dev only: the built site doesn't change while it is open");
  const original = await readFile(source, "utf8");
  try {
    await page.goto("/guides/setup/");
    const fill = await probe(page, "--color-fill"), line = await probe(page, "--color-line");
    expect(near(await at(page, FLOW, 80, 100), fill)).toBe(true);
    await save(source, original.replace(`<rect x="20" y="60" width="120" height="80" fill="var(--color-fill)"/>`,
      `<rect x="20" y="60" width="120" height="80" fill="var(--color-line)"/>`));
    // The open page's state, not a reload event: the box is painted in the new colour. The page reloads to get there,
    // and a read that meets the reload (its document gone mid-read) is "not painted yet", never the outcome.
    const painted = async (): Promise<boolean> => {
      try { return near(await at(page, FLOW, 80, 100), line); } catch { return false; }
    };
    await expect.poll(painted, { timeout: 10_000 }).toBe(true);
  } finally {
    await save(source, original);
  }
});

// A live example starts at the height its component declares (x-pd-example-height in the callout's schema), so
// the page doesn't move when the preview reports its own; the fitter grows it from there. The declaration must
// err short: a frame can be fitted taller, never shorter, so one declared taller than its content would stay
// too tall. Checked on both examples the bench shows (the callout and its warning variant, which share the
// value), in pd dev and in the built site.
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures.js";
import { examplesFitted } from "./helpers.js";

const schema = JSON.parse(readFileSync(new URL("../src/patterns/components/callout/callout.schema.json", import.meta.url), "utf8")) as Record<string, unknown>;
const DECLARED = schema["x-pd-example-height"];
const ROUTES = ["/", "/guides/setup/"];

test.describe("a live example's declared height", () => {
  test("the bench's callout declares one", () => {
    expect(DECLARED).toBe(112);
  });

  for (const route of ROUTES) {
    test(`the frame starts at it before its preview reports, on ${route}`, async ({ page }) => {
      // The preview never arrives, so no pd-height can: the frame's height is the one it starts at.
      await page.route("**/preview/**", r => r.abort());
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const frame = page.locator("figure.doc-example iframe");
      await expect(frame).toHaveAttribute("height", String(DECLARED));
      expect(await frame.evaluate(f => f.getBoundingClientRect().height)).toBe(DECLARED);
    });

    for (const width of [1000, 390]) {
      test(`it errs short, and the frame is fitted to the content at ${width}px, on ${route}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route);
        await examplesFitted(page);
        const { box, content } = await page.locator("figure.doc-example iframe").evaluate((f: HTMLIFrameElement) => ({
          box: f.getBoundingClientRect().height,
          // The root's own box, which unlike scrollHeight is not floored at the frame's height: the content's.
          content: f.contentDocument!.documentElement.getBoundingClientRect().height,
        }));
        expect(content).toBeGreaterThanOrEqual(DECLARED as number);
        expect(Math.abs(box - content)).toBeLessThanOrEqual(1);
      });
    }
  }

  test("at the widest column the declared height is the content's: the frame doesn't grow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await examplesFitted(page);
    expect(await page.locator("figure.doc-example iframe").evaluate(f => f.getBoundingClientRect().height)).toBe(DECLARED);
  });
});

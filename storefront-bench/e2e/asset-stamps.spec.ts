// In pd dev a page's stylesheet links carry the content hash of the sheet as served (?v=<hash>), so when a
// stylesheet changes, the page that is already open links the new one: its link's stamp changes without a
// manual reload, and comes back when the change is undone.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";
import { isDev } from "./helpers.js";
import { save } from "../../test-support/save.js";

// The slide is placed on /guides/ itself (pd- tags), so the page links its sheet and paints it.
const sheet = fileURLToPath(new URL("../src/styles/components/slide.scss", import.meta.url));
test("a changed stylesheet gets a new stamp on the page that is open", async ({ page }, info) => {
  test.skip(!isDev(info), "pd dev only: the built site doesn't change while it is open");
  const original = await readFile(sheet, "utf8");
  await page.goto("/guides/");
  const link = page.locator('link[rel="stylesheet"][href^="/_pd/components/components/slide.css"]');
  const before = await link.getAttribute("href");
  expect(before).toMatch(/\?v=[0-9a-f]{10}$/);
  try {
    await save(sheet, `${original}\n.slide { outline: 1px solid; }\n`);
    await expect(link).not.toHaveAttribute("href", before!, { timeout: 10_000 });
    expect(await link.getAttribute("href")).toMatch(/\?v=[0-9a-f]{10}$/);
    // The open page shows the new sheet: its rule paints.
    await expect.poll(() => page.locator(".slide").first().evaluate(e => getComputedStyle(e).outlineStyle)).toBe("solid");
  } finally {
    await save(sheet, original);
  }
  await expect(link).toHaveAttribute("href", before!, { timeout: 10_000 });
});

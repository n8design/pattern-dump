// A theme switch only swaps values: it never reloads the preview, so its scroll, an open dialog and typed input stay,
// and the preview's data-theme names the theme the picker shows. Run twice: on test-bench as it is (attribute switch,
// project "chromium") and with stylesheet switching (project "themes-stylesheet"), where only the active theme's
// sheet is linked and a new one must load before the old one leaves.
import { test, expect, type Page } from "@playwright/test";
import { gotoComponentReady, selectTheme } from "./helpers.js";

const frame = (page: Page) => page.frameLocator("#preview-frame");
const stylesheetMode = (name: string) => name === "themes-stylesheet";

/** Inside the preview: a marker on its window, a tall page scrolled down, an open dialog with typed input. */
async function furnish(page: Page): Promise<void> {
  const f = page.frame({ url: "about:srcdoc" })!;
  await f.evaluate(() => {
    (window as unknown as { __pdMarker: string }).__pdMarker = "still here";
    const tall = document.createElement("div");
    tall.style.height = "3000px";
    document.body.append(tall);
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<input id="pd-typed" aria-label="Typed">`;
    document.body.append(dialog);
    dialog.show();
    window.scrollTo(0, 700);
  });
  await frame(page).locator("#pd-typed").fill("typed before the switch");
}

async function state(page: Page) {
  return page.frame({ url: "about:srcdoc" })!.evaluate(() => ({
    marker: (window as unknown as { __pdMarker?: string }).__pdMarker,
    scrollY: window.scrollY,
    dialogOpen: document.querySelector("dialog")?.open,
    typed: (document.getElementById("pd-typed") as HTMLInputElement | null)?.value,
    theme: document.body.getAttribute("data-theme"),
    themeLinks: [...document.querySelectorAll("link[data-pd-theme]")].map(l => l.getAttribute("data-pd-theme")),
  }));
}

test.describe("a theme switch", () => {
  test("never reloads the preview, and data-theme names the picked theme", async ({ page }, info) => {
    await gotoComponentReady(page, "atoms/button");
    await furnish(page);
    const before = await state(page);
    expect(before).toMatchObject({ marker: "still here", dialogOpen: true, typed: "typed before the switch", theme: "light" });
    expect(before.scrollY).toBeGreaterThan(0);

    await selectTheme(page, "brand-red");
    await expect.poll(async () => (await state(page)).theme).toBe("brand-red");
    const after = await state(page);
    expect(after).toMatchObject({ marker: "still here", dialogOpen: true, typed: "typed before the switch", scrollY: before.scrollY });
    await expect(page.locator(".theme-picker-current-name")).toHaveText("brand-red");
    // Stylesheet switching: exactly one theme sheet, the picked one.
    if (stylesheetMode(info.project.name)) expect(after.themeLinks).toEqual(["brand-red"]);
  });

  test("a preview opened with a theme in effect has it from the first paint", async ({ page }, info) => {
    await gotoComponentReady(page, "atoms/button");
    await selectTheme(page, "brand-teal");
    await expect.poll(async () => (await state(page)).theme).toBe("brand-teal");
    // Another component, the theme still in effect (stored): the document the frame gets has it already, so nothing
    // is switched after its first paint.
    await gotoComponentReady(page, "atoms/chip");
    const srcdoc = (await page.locator("#preview-frame").getAttribute("srcdoc")) ?? "";
    expect(srcdoc).toMatch(/<body[^>]* data-theme="brand-teal"/);
    if (stylesheetMode(info.project.name)) expect(srcdoc).toContain(`data-pd-theme="brand-teal"`);
    expect((await state(page)).theme).toBe("brand-teal");
  });
});

test.describe("a stylesheet theme switch", () => {
  test.beforeEach(({}, info) => { test.skip(!stylesheetMode(info.project.name), "stylesheet switching only"); });

  test("keeps the current sheet until the new one has loaded: no frame without a theme", async ({ page }) => {
    await gotoComponentReady(page, "atoms/button");
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    await page.route("**/_pd/themes/brand-blue.css*", async route => { await held; await route.continue(); });
    // Every animation frame from here on: how many theme sheets are loaded in the preview, the current one and one
    // on its way (never 0). A link whose sheet is still loading has none (link.sheet is null), so rewriting one link's
    // href would show here as 0.
    const f = page.frame({ url: "about:srcdoc" })!;
    await f.evaluate(() => {
      const w = window as unknown as { __pdCounts: number[] };
      w.__pdCounts = [];
      const tick = () => {
        const links = document.querySelectorAll<HTMLLinkElement>("link[data-pd-theme], link[data-pd-theme-next]");
        w.__pdCounts.push([...links].filter(l => l.sheet !== null).length);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await selectTheme(page, "brand-blue");
    await page.waitForTimeout(300); // frames while the new sheet is held back
    const during = await state(page);
    expect(during.themeLinks).toEqual(["light"]);
    expect(during.theme).toBe("light");
    release();
    await expect.poll(async () => (await state(page)).themeLinks).toEqual(["brand-blue"]);
    expect((await state(page)).theme).toBe("brand-blue");
    const counts = await f.evaluate(() => (window as unknown as { __pdCounts: number[] }).__pdCounts);
    expect(counts.length).toBeGreaterThan(5);
    expect(counts.filter(n => n === 0)).toEqual([]);
  });

  test("keeps the current theme when the new sheet fails, and says so in the Console", async ({ page }) => {
    await gotoComponentReady(page, "atoms/button");
    await page.route("**/_pd/themes/brand-red.css*", route => route.fulfill({ status: 500, body: "no" }));
    await selectTheme(page, "brand-red");
    await expect(page.locator(".console p[data-level=error]").last())
      .toHaveText(`The theme "brand-red" could not be loaded: its stylesheet answered with an error, so the preview keeps its theme`);
    expect(await state(page)).toMatchObject({ themeLinks: ["light"], theme: "light" });
  });
});

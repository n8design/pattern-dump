import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";

async function openA11yPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.click(".a11y-picker-summary");
}

async function iframeFilter(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement;
    return getComputedStyle(f).filter;
  });
}

// ── no localStorage write after UI interaction ────────────────────────────────

test("selecting a CVD type via the rail control does not write to localStorage", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  await openA11yPanel(page);

  // Click the Deuteranopia radio button.
  await page.click("[data-cvd-type='deuteranopia']");

  // Confirm the filter is now active (proves the click was handled).
  expect(await iframeFilter(page)).toMatch(/url\(["']?#cvd/);

  // CVD must not appear in localStorage.
  const stored = await page.evaluate(() => localStorage.getItem("pd-view-state") ?? "");
  expect(stored).not.toContain("cvd");
  expect(stored).not.toContain("deuteranopia");
});

// ── arrow-key navigation + roving tabindex ────────────────────────────────────

test("arrow keys move focus through the CVD type radiogroup and update the filter", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  await openA11yPanel(page);

  // Focus the "None" radio (tab-index 0, should be the entry point).
  const noneBtn = page.locator("[data-cvd-type='none']");
  await noneBtn.focus();

  // ArrowRight → Protanopia.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-cvd-type='protanopia']")).toBeFocused();
  expect(await iframeFilter(page)).toMatch(/url\(["']?#cvd/);

  // ArrowRight again → Deuteranopia.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-cvd-type='deuteranopia']")).toBeFocused();

  // ArrowLeft → back to Protanopia.
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-cvd-type='protanopia']")).toBeFocused();

  // ArrowLeft → back to None, filter should be removed.
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-cvd-type='none']")).toBeFocused();
  expect(await iframeFilter(page)).not.toMatch(/url\(["']?#cvd/);
});

test("only the active CVD type radio is in the tab sequence (roving tabindex)", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  await openA11yPanel(page);

  // Initially None is active — only None should have tabIndex 0.
  const tabIndices = await page.evaluate(() => {
    const btns = [...document.querySelectorAll<HTMLButtonElement>("[data-cvd-type]")];
    return btns.map(b => ({ type: b.dataset.cvdType, tabIndex: b.tabIndex }));
  });
  expect(tabIndices.find(b => b.type === "none")?.tabIndex).toBe(0);
  expect(tabIndices.filter(b => b.type !== "none").every(b => b.tabIndex === -1)).toBe(true);

  // Click Tritanopia — now only Tritanopia should have tabIndex 0.
  await page.click("[data-cvd-type='tritanopia']");
  const tabIndicesAfter = await page.evaluate(() => {
    const btns = [...document.querySelectorAll<HTMLButtonElement>("[data-cvd-type]")];
    return btns.map(b => ({ type: b.dataset.cvdType, tabIndex: b.tabIndex }));
  });
  expect(tabIndicesAfter.find(b => b.type === "tritanopia")?.tabIndex).toBe(0);
  expect(tabIndicesAfter.filter(b => b.type !== "tritanopia").every(b => b.tabIndex === -1)).toBe(true);
});

// ── full round-trip: UI → URL → reload rehydrates control ────────────────────

test("setting CVD type + severity via the UI updates the URL", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  await openA11yPanel(page);

  // Select Protanopia.
  await page.click("[data-cvd-type='protanopia']");

  // Adjust the severity slider to 0.5.
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>(".cvd-severity-slider")!;
    slider.value = "0.5";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // URL must carry the CVD param (URLSearchParams encodes ':' as %3A; decode to compare).
  const cvdParam = new URL(page.url()).searchParams.get("cvd");
  expect(cvdParam).toBe("protanopia:0.5");
});

test("arrival with ?cvd= URL restores type radio and slider, ?cvd= stays in URL", async ({ page }) => {
  await gotoComponent(page, "atoms/button", "?cvd=tritanopia:0.70");

  // The Tritanopia radio must be checked.
  const tritan = page.locator("[data-cvd-type='tritanopia']");
  await expect(tritan).toHaveAttribute("aria-checked", "true");

  // The slider must reflect the severity.
  const sliderVal = await page.evaluate(
    () => (document.querySelector<HTMLInputElement>(".cvd-severity-slider")?.value ?? ""),
  );
  expect(parseFloat(sliderVal)).toBeCloseTo(0.70, 2);

  // None radio must be unchecked.
  await expect(page.locator("[data-cvd-type='none']")).toHaveAttribute("aria-checked", "false");

  // Filter must be active.
  expect(await iframeFilter(page)).toMatch(/url\(["']?#cvd/);

  // ?cvd= must not be stripped from the URL.
  expect(page.url()).toContain("cvd=");
});

// ── slider disabled when type=none ────────────────────────────────────────────

test("severity slider is disabled when type is none and enabled when a type is selected", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  await openA11yPanel(page);

  // Initially type=none → slider disabled.
  await expect(page.locator(".cvd-severity-slider")).toBeDisabled();

  // Select a type → slider enabled.
  await page.click("[data-cvd-type='deuteranopia']");
  await expect(page.locator(".cvd-severity-slider")).toBeEnabled();

  // Back to None → slider disabled again.
  await page.click("[data-cvd-type='none']");
  await expect(page.locator(".cvd-severity-slider")).toBeDisabled();
});

// ── CVD signal — presence / absence ──────────────────────────────────────────

test("type=none: signal element is absent from the DOM", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  // At type=none the .a11y-signal element must not exist in the DOM — not merely hidden.
  await expect(page.locator(".a11y-signal")).not.toBeAttached();
});

test("active CVD: signal element is present in summary with icon carrier", async ({ page }) => {
  await gotoComponent(page, "atoms/button", "?cvd=deuteranopia:0.7");
  // Signal element must be in the DOM when CVD is active.
  await expect(page.locator(".a11y-signal")).toBeAttached();
  // Icon (primary non-colour carrier) must be present in the summary.
  const html = await page.locator(".a11y-picker-summary").innerHTML();
  expect(html).toContain("<svg");
});

test("accessible name is 'Accessibility' regardless of label width state", async ({ page }) => {
  await gotoComponent(page, "atoms/button");
  await expect(page.locator(".a11y-picker-summary")).toHaveAttribute("aria-label", "Accessibility");
});

// ── auto-open: one-shot on ?cvd= arrival ─────────────────────────────────────

test("?cvd= arrival auto-opens the a11y panel; user can collapse it", async ({ page }) => {
  await page.goto("/atoms/button?cvd=tritanopia:0.7");
  await page.waitForSelector("#preview-frame[srcdoc]");
  // Panel must be open after hydrate — no user action needed.
  await expect(page.locator(".a11y-picker")).toHaveAttribute("open", "");
  // User closes the panel — it stays closed.
  await page.click(".a11y-picker-summary");
  await expect(page.locator(".a11y-picker")).not.toHaveAttribute("open");
  // ?cvd= must not be stripped from the URL.
  expect(page.url()).toContain("cvd=");
});

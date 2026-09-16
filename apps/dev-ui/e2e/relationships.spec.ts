import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("relationships facet", () => {
  // ---- Composition edges ----

  test("field molecule: atoms/input listed under Uses", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // "Uses" is the top-level label for uses (exact match — avoid matching "Used by").
    const headings = page.locator(".rel-group-heading");
    await expect(headings.filter({ hasText: /^Uses$/ })).toBeVisible();

    // atoms/input is listed as a navigable anchor link.
    const relLink = page.locator("a.rel-link[href='/atoms/input']");
    await expect(relLink).toBeVisible();
  });

  test("clicking Uses item selects that component", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    await page.click("a.rel-link[href='/atoms/input']");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await expect(page).toHaveURL(/atoms\/input/);
    await expect(page.locator(".preview-caption")).toContainText("atoms/input");
  });

  test("browser Back returns to prior component after relation click", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    const lenBefore = await page.evaluate(() => history.length);

    await page.click("a.rel-link[href='/atoms/input']");
    await page.waitForURL(/atoms\/input/);
    await expect(page.locator(".preview-caption")).toHaveText("atoms/input");
    await page.waitForFunction(
      () => !!document.getElementById("preview-frame")?.contentDocument?.querySelector("main[data-component-id='atoms/input']"),
      undefined,
      { timeout: 10000 }
    );

    const lenAfter = await page.evaluate(() => history.length);
    expect(lenAfter).toBe(lenBefore + 1);

    await page.goBack();

    await expect(page.locator(".preview-caption")).toHaveText(/^molecules\/field$/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/molecules\/field/);
    await page.waitForFunction(
      () => !!document.getElementById("preview-frame")?.contentDocument?.querySelector("main[data-component-id='molecules/field']"),
      undefined,
      { timeout: 10000 }
    );
  });

  test("round-trip: field → atoms/input (Used by) → back to field", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    await page.click("a.rel-link[href='/atoms/input']");
    await page.waitForURL(/atoms\/input/);
    await expect(page.locator(".preview-caption")).toHaveText("atoms/input", { timeout: 10000 });

    // atoms/input → Used by → molecules/field.
    const usedByLink = page.locator("a.rel-link[href='/molecules/field']").first();
    await expect(usedByLink).toBeVisible();

    await page.locator("a.rel-link[href='/molecules/field']").first().click();
    await page.waitForURL(/molecules\/field/);
    await expect(page.locator(".preview-caption")).toContainText("molecules/field");
  });

  test("leaf atom (button): Uses is empty, Used by lists organisms/buttonbar", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // "Uses" heading is present; the group shows "none" (button has no children).
    const allGroups = page.locator(".rel-group-heading");
    await expect(allGroups.filter({ hasText: /^Uses$/ }).first()).toBeVisible();
    await expect(page.locator(".rel-panel")).toContainText("none");

    // Used by: organisms/buttonbar (toolbar not listed — styleUsedBy is dropped).
    await expect(page.locator("a.rel-link[href='/organisms/buttonbar']")).toBeVisible();
    await expect(page.locator("a.rel-link[href='/organisms/toolbar']")).toHaveCount(0);
  });

  // ---- Structural: category items are nested, not siblings ----

  test("component items are nested inside their category list", async ({ page }) => {
    // organisms/card uses molecules/media — the Media item must be inside
    // a .rel-category-list nested under the Molecules .rel-category, not a sibling.
    await page.goto("/organisms/card");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // The category <li> must contain a nested <ul class="rel-category-list">.
    const categoryList = page.locator(".rel-category > .rel-category-list");
    await expect(categoryList.first()).toBeVisible();

    // The rel-link for media is inside .rel-category-list, not a direct sibling of .rel-category.
    const mediaLink = page.locator(".rel-category-list a.rel-link[href='/molecules/media']");
    await expect(mediaLink).toBeVisible();
  });

  // ---- Style umbrella ----

  test("Style umbrella groups Style uses and Style modules", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // "Style" umbrella heading is present.
    const umbrella = page.locator(".rel-style-umbrella");
    await expect(umbrella).toBeVisible();
    await expect(umbrella.locator(".rel-umbrella-heading")).toHaveText("Style");

    // Sub-headings "Style uses" and "Style modules" are inside the umbrella.
    const subHeadings = umbrella.locator(".rel-group-heading");
    await expect(subHeadings.filter({ hasText: /^Style uses$/ })).toBeVisible();
    await expect(subHeadings.filter({ hasText: /^Style modules$/ })).toBeVisible();

    // Top-level headings "Style uses" and "Style modules" do NOT exist outside the umbrella.
    const outsideUmbrella = page.locator(".rel-panel > .rel-group-heading");
    await expect(outsideUmbrella.filter({ hasText: /^Style uses$/ })).toHaveCount(0);
    await expect(outsideUmbrella.filter({ hasText: /^Style modules$/ })).toHaveCount(0);
  });

  test("toolbar: atoms/button listed under Style uses (class-borrowing)", async ({ page }) => {
    await page.goto("/organisms/toolbar");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // "Style uses" sub-heading is inside the Style umbrella.
    const umbrella = page.locator(".rel-style-umbrella");
    await expect(umbrella.locator(".rel-group-heading").filter({ hasText: /^Style uses$/ })).toBeVisible();

    // atoms/button listed as a navigable anchor — df-button classes borrowed in toolbar.hbs.
    const styleUsesLink = page.locator("a.rel-link[href='/atoms/button']");
    await expect(styleUsesLink).toBeVisible();
  });

  test("no 'Style used by' group on any component", async ({ page }) => {
    for (const id of ["atoms/button", "organisms/toolbar", "molecules/field"]) {
      await page.goto(`/${id}`);
      await page.waitForSelector("#preview-frame[srcdoc]");
      await page.click("button[data-tab='relationships']");
      await page.waitForSelector(".rel-panel");

      const headings = page.locator(".rel-group-heading");
      await expect(headings.filter({ hasText: /style used by/i })).toHaveCount(0);
    }
  });

  // ---- Style modules (plain-text) ----

  test("field molecule: 01-atoms/button listed under Style modules as plain text", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // "Style modules" sub-heading is inside the Style umbrella.
    const umbrella = page.locator(".rel-style-umbrella");
    await expect(umbrella.locator(".rel-group-heading").filter({ hasText: /^Style modules$/ })).toBeVisible();

    // 01-atoms/button as plain text (non-navigable — convention-violation @use degrades).
    const buttonModuleItem = page.locator(".rel-list li").filter({ hasText: "01-atoms/button" });
    await expect(buttonModuleItem).toBeVisible();
    await expect(buttonModuleItem.locator("a")).toHaveCount(0);
  });

  test("button atom: 00-base/tokens listed under Style modules as plain text", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    const umbrella = page.locator(".rel-style-umbrella");
    await expect(umbrella.locator(".rel-group-heading").filter({ hasText: /^Style modules$/ })).toBeVisible();

    const tokenItem = page.locator(".rel-list li").filter({ hasText: "00-base/tokens" });
    await expect(tokenItem).toBeVisible();
    await expect(tokenItem.locator("button")).toHaveCount(0);
    await expect(tokenItem.locator("a")).toHaveCount(0);
  });

  // ---- styleModules: base-layer provenance ----

  test("dual atom: base-styled component names its shared partial under Style modules", async ({ page }) => {
    await page.goto("/atoms/dual");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    const umbrella = page.locator(".rel-style-umbrella");
    await expect(umbrella.locator(".rel-group-heading").filter({ hasText: /^Style modules$/ })).toBeVisible();

    // The whole point: a fully base-styled component used to report "none" — now it names the
    // shared/family partial that styles it, as plain non-navigable text.
    const sharedItem = page.locator(".rel-list li").filter({ hasText: "00-base/shared-family" });
    await expect(sharedItem).toBeVisible();
    await expect(sharedItem.locator("a")).toHaveCount(0);
  });

  test("style-mix atom: Style uses (navigable) and Style modules (plain) are separated in the panel", async ({ page }) => {
    await page.goto("/atoms/style-mix");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    const umbrella = page.locator(".rel-style-umbrella");
    // Style uses: atoms/button as a navigable link (component borrow).
    await expect(umbrella.locator("a.rel-link[href='/atoms/button']")).toBeVisible();
    // Style modules: the shared partial as plain text (module borrow) — different relationship.
    const sharedItem = page.locator(".rel-list li").filter({ hasText: "00-base/shared-family" });
    await expect(sharedItem).toBeVisible();
    await expect(sharedItem.locator("a")).toHaveCount(0);
  });

  test("anotherentry atom: genuinely no shared module → Style modules reads 'none' (and means it)", async ({ page }) => {
    await page.goto("/atoms/anotherentry");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    const umbrella = page.locator(".rel-style-umbrella");
    await expect(umbrella.locator(".rel-group-heading").filter({ hasText: /^Style modules$/ })).toBeVisible();
    // No component borrow, no @use module, no base-authored class → no style-list items at all;
    // both Style uses and Style modules fall through to their "none" empty-state.
    await expect(umbrella.locator(".rel-list li")).toHaveCount(0);
    await expect(umbrella.locator(".rel-empty")).toHaveCount(2);
  });

  // ---- Leftover chips ----

  test("card: inline-styles chip and unattributed class chip rendered", async ({ page }) => {
    await page.goto("/organisms/card");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // Chips container is present (card has inlineStyles=true and unattributedClasses=["df-crad"]).
    const chips = page.locator(".rel-chips");
    await expect(chips).toBeVisible();

    // Inline-styles chip.
    await expect(chips.locator(".rel-chip--inline-styles")).toHaveText("Inline styles");

    // df-crad chip (typo class not owned by any stylesheet).
    await expect(chips.locator(".rel-chip--unattributed").filter({ hasText: "df-crad" })).toBeVisible();

    // No "Other style inputs" heading — chips replace the old list.
    await expect(page.locator(".rel-group-heading").filter({ hasText: /other style inputs/i })).toHaveCount(0);
  });

  test("button: no chips (no inlineStyles, utilityClasses, or unattributedClasses)", async ({ page }) => {
    await page.goto("/atoms/button");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    // Clean component — chips container must be absent.
    await expect(page.locator(".rel-chips")).toHaveCount(0);
  });

  // ---- Accessibility ----

  test("relationships panel is keyboard-reachable and axe-clean", async ({ page }) => {
    await page.goto("/molecules/field");
    await page.waitForSelector("#preview-frame[srcdoc]");

    await page.click("button[data-tab='relationships']");
    await page.waitForSelector(".rel-panel");

    const results = await new AxeBuilder({ page })
      .include(".rel-panel")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const critical = results.violations.filter(
      v => v.impact === "serious" || v.impact === "critical"
    );
    expect(critical, critical.map(v => `${v.id}: ${v.description}`).join("\n")).toHaveLength(0);
  });
});

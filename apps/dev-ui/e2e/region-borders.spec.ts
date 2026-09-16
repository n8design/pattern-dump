import { test, expect } from "@playwright/test";

async function gotoShell(page: import("@playwright/test").Page) {
  await page.goto("/atoms/button");
  await page.waitForSelector("#preview-frame[srcdoc]");
  // pd-height shrinks the iframe from its intrinsic 150px to the true content height (~81px),
  // which triggers a compositor repaint. During this ~250ms window the compositor hit-test
  // tree is stale and page.mouse.move events don't reach shell regions. Poll until a known
  // shell element is reachable before any hover/mouse test runs.
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".dock");
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 40);
      return hit !== null && hit !== document.documentElement;
    },
    undefined,
    { timeout: 3000 },
  );
}

// Resolve a CSS custom property to the colour value it produces.
// Appends a scratch element with the token as border-color, reads the resolved RGB.
// Keeps the assertion independent of seed hex values — tokens can be tuned live.
function resolveToken(
  page: import("@playwright/test").Page,
  token: string,
): Promise<string> {
  return page.evaluate((tok) => {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;pointer-events:none;width:1px;height:1px;border:1px solid var(${tok})`;
    document.body.appendChild(el);
    const colour = getComputedStyle(el).borderTopColor;
    document.body.removeChild(el);
    return colour;
  }, token);
}

test.describe("shell region borders", () => {
  // ---- Surface field ----

  test("body background resolves to --pd-surface", async ({ page }) => {
    await gotoShell(page);

    const [bodyBg, tokenBg] = await page.evaluate(() => {
      const body = getComputedStyle(document.body).backgroundColor;
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;pointer-events:none;width:1px;height:1px;background:var(--pd-surface)";
      document.body.appendChild(el);
      const tok = getComputedStyle(el).backgroundColor;
      document.body.removeChild(el);
      return [body, tok];
    });

    expect(bodyBg).toBe(tokenBg);
  });

  // ---- Rest-state borders ----

  test("sidebar right border resolves to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);

    const borderColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const restColor = await resolveToken(page, "--pd-border-rest");
    expect(borderColor).toBe(restColor);
  });

  test("dock top border resolves to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);

    const borderColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderTopColor,
    );
    const restColor = await resolveToken(page, "--pd-border-rest");
    expect(borderColor).toBe(restColor);
  });

  test("dock left border resolves to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);

    const borderColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderLeftColor,
    );
    const restColor = await resolveToken(page, "--pd-border-rest");
    expect(borderColor).toBe(restColor);
  });

  test("dock right border resolves to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);

    const borderColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderRightColor,
    );
    const restColor = await resolveToken(page, "--pd-border-rest");
    expect(borderColor).toBe(restColor);
  });

  test("panel left border resolves to --pd-border-rest", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    // Panel is open at wide viewport — border is visible.
    await page.waitForSelector(".main[data-panel-open]");

    const borderColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".panel")!).borderLeftColor,
    );
    const restColor = await resolveToken(page, "--pd-border-rest");
    expect(borderColor).toBe(restColor);
  });

  // ---- Radius ----

  test("all three regions have border-radius 0", async ({ page }) => {
    await gotoShell(page);

    const radii = await page.evaluate(() => ({
      sidebar: getComputedStyle(document.querySelector(".sidebar")!).borderRadius,
      dock:    getComputedStyle(document.querySelector(".dock")!).borderRadius,
      panel:   getComputedStyle(document.querySelector(".panel")!).borderRadius,
    }));

    expect(radii.sidebar).toBe("0px");
    expect(radii.dock).toBe("0px");
    expect(radii.panel).toBe("0px");
  });

  // ---- Excluded regions carry no border ----

  test("stage has no border (border-style none on all sides)", async ({ page }) => {
    await gotoShell(page);

    const styles = await page.evaluate(() => {
      const el = document.querySelector(".stage")!;
      const cs = getComputedStyle(el);
      return {
        top:    cs.borderTopStyle,
        right:  cs.borderRightStyle,
        bottom: cs.borderBottomStyle,
        left:   cs.borderLeftStyle,
      };
    });

    expect(styles.top).toBe("none");
    expect(styles.right).toBe("none");
    expect(styles.bottom).toBe("none");
    expect(styles.left).toBe("none");
  });

  // ---- Hover darkens the boundary ----

  test("hovering sidebar-w splitter firms sidebar right border to --pd-border-active", async ({ page }) => {
    await gotoShell(page);

    await page.locator('[data-resize="sidebar-w"]').hover();

    const hoverColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(hoverColor).toBe(activeToken);
  });

  test("hovering dock-h splitter firms dock top border to --pd-border-active", async ({ page }) => {
    await gotoShell(page);

    await page.locator('[data-resize="dock-h"]').hover();

    const hoverColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderTopColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(hoverColor).toBe(activeToken);
  });

  test("hovering panel-w splitter firms panel left border to --pd-border-active", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    await page.waitForSelector(".main[data-panel-open]");

    await page.locator('[data-resize="panel-w"]').hover();

    const hoverColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".panel")!).borderLeftColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(hoverColor).toBe(activeToken);
  });

  // ---- Active darkest ----

  test("pressing sidebar-w splitter applies --pd-border-active", async ({ page }) => {
    await gotoShell(page);

    await page.locator('[data-resize="sidebar-w"]').hover();
    await page.mouse.down();

    const activeColor = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    await page.mouse.up();

    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(activeColor).toBe(activeToken);
  });
});

test.describe("shell dividers", () => {
  // ---- Rail dividers carry the sand tone (--pd-divider) ----
  //
  // These asserted `rgba(0, 0, 0, 0)` under the seam-ownership approach, where dividers were
  // drawn by a separate mechanism and the element border stayed transparent. `ad5e95d
  // revert(shell): restore full-height element borders` returned to plain element borders and
  // the shell settled on a deliberate two-tone divider language:
  //   rail furniture  → sand  `--pd-divider`     (_rail.scss, _stage.scss)
  //   dock/panel chrome → cool-grey `--pd-border-rest` (_dock.scss:296, _relationships.scss:14)
  // Asserting the token rather than a literal keeps these independent of seed hex values,
  // matching the region-border tests above.

  test("rail-brand bottom border resolves to --pd-divider", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".rail-brand")!).borderBottomColor,
    );
    expect(color).toBe(dividerColor);
  });

  test("theme-picker bottom border resolves to --pd-divider", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".theme-picker")!).borderBottomColor,
    );
    expect(color).toBe(dividerColor);
  });

  test("a11y-picker bottom border resolves to --pd-divider", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".a11y-picker")!).borderBottomColor,
    );
    expect(color).toBe(dividerColor);
  });

  test("rail-toggle-cluster bottom border resolves to --pd-divider", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".rail-toggle-cluster")!).borderBottomColor,
    );
    expect(color).toBe(dividerColor);
  });

  test("rail-vp-cluster bottom border resolves to --pd-divider", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".rail-vp-cluster")!).borderBottomColor,
    );
    expect(color).toBe(dividerColor);
  });

  test("rail-status top border resolves to --pd-divider", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".rail-status")!).borderTopColor,
    );
    expect(color).toBe(dividerColor);
  });

  test("variant-bar bottom border resolves to --pd-divider", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".variant-bar")!).borderBottomColor,
    );
    expect(color).toBe(dividerColor);
  });

  // ---- Dock and panel chrome carries the cool-grey tone (--pd-border-rest) ----
  // Deliberately NOT sand — see the note in _dock.scss:296.

  test("dock-header bottom border resolves to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);
    const restColor = await resolveToken(page, "--pd-border-rest");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock-header")!).borderBottomColor,
    );
    expect(color).toBe(restColor);
  });

  test("dock-facets bottom border resolves to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);
    const restColor = await resolveToken(page, "--pd-border-rest");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock-facets")!).borderBottomColor,
    );
    expect(color).toBe(restColor);
  });

  test("panel-tabs bottom border resolves to --pd-border-rest", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    await page.waitForSelector(".main[data-panel-open]");
    const restColor = await resolveToken(page, "--pd-border-rest");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".panel-tabs")!).borderBottomColor,
    );
    expect(color).toBe(restColor);
  });

  test("cvd-type-btn borders resolve to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);
    // Open the a11y-picker to make cvd buttons accessible.
    await page.locator(".a11y-picker > .a11y-picker-summary").click();
    const restColor = await resolveToken(page, "--pd-border-rest");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector("button.cvd-type-btn")!).borderTopColor,
    );
    expect(color).toBe(restColor);
  });

  test("dock-copy-btn borders resolve to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);
    const restColor = await resolveToken(page, "--pd-border-rest");
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector("button.dock-copy-btn")!).borderTopColor,
    );
    expect(color).toBe(restColor);
  });

  // ---- Tab-style controls carry no border box at all ----
  //
  // These three are borderless by `border-style: none` (computed width 0), not by a transparent
  // colour — so `borderTopColor` computes to the currentColor fallback, never `rgba(0, 0, 0, 0)`.
  // Assert the mechanism that actually holds: no border box. Their selected state is carried by
  // font-weight/opacity and the underline, covered by the tests below.

  test("dock-tab has no border box", async ({ page }) => {
    await gotoShell(page);
    const border = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector("button.dock-tab")!);
      return { style: cs.borderTopStyle, width: cs.borderTopWidth };
    });
    expect(border.style).toBe("none");
    expect(border.width).toBe("0px");
  });

  test("dock-facet has no border box", async ({ page }) => {
    await gotoShell(page);
    const border = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector("button.dock-facet")!);
      return { style: cs.borderTopStyle, width: cs.borderTopWidth };
    });
    expect(border.style).toBe("none");
    expect(border.width).toBe("0px");
  });

  test("panel-tabs buttons have no border box", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    await page.waitForSelector(".main[data-panel-open]");
    const border = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".panel-tabs button")!);
      return { style: cs.borderTopStyle, width: cs.borderTopWidth };
    });
    expect(border.style).toBe("none");
    expect(border.width).toBe("0px");
  });

  // Guard: the two divider tones must stay distinct. Without this, if --pd-divider were ever
  // undefined both it and the element border would fall back to the same computed colour and
  // every token comparison above would pass vacuously.
  test("sand divider and cool-grey border tones are distinct", async ({ page }) => {
    await gotoShell(page);
    const dividerColor = await resolveToken(page, "--pd-divider");
    const restColor = await resolveToken(page, "--pd-border-rest");
    expect(dividerColor).not.toBe(restColor);
    expect(dividerColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(restColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  // ---- Region borders unaffected ----

  test("region borders still resolve to --pd-border-rest after divider routing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    await page.waitForSelector(".main[data-panel-open]");

    const restColor = await resolveToken(page, "--pd-border-rest");
    const borders = await page.evaluate(() => ({
      sidebar: getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
      dock:    getComputedStyle(document.querySelector(".dock")!).borderTopColor,
      panel:   getComputedStyle(document.querySelector(".panel")!).borderLeftColor,
    }));

    expect(borders.sidebar).toBe(restColor);
    expect(borders.dock).toBe(restColor);
    expect(borders.panel).toBe(restColor);
  });

  // ---- State signals still readable ----

  test("selected dock tab is distinguished by font-weight", async ({ page }) => {
    await gotoShell(page);
    const weights = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll("button.dock-tab"));
      return tabs.map(t => ({
        selected: t.getAttribute("aria-selected") === "true",
        fontWeight: getComputedStyle(t).fontWeight,
      }));
    });
    const sel  = weights.find(t => t.selected);
    const rest = weights.find(t => !t.selected);
    expect(sel).toBeDefined();
    expect(rest).toBeDefined();
    expect(Number(sel!.fontWeight)).toBeGreaterThan(Number(rest!.fontWeight));
  });

  test("checked cvd toggle is distinguished by opacity and font-weight", async ({ page }) => {
    await gotoShell(page);
    await page.locator(".a11y-picker > .a11y-picker-summary").click();
    const states = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button.cvd-type-btn"));
      return btns.map(b => ({
        checked: b.getAttribute("aria-checked") === "true",
        opacity: parseFloat(getComputedStyle(b).opacity),
        fontWeight: getComputedStyle(b).fontWeight,
      }));
    });
    const checked = states.find(b => b.checked);
    const rest    = states.find(b => !b.checked);
    expect(checked).toBeDefined();
    expect(rest).toBeDefined();
    expect(checked!.opacity).toBeGreaterThan(rest!.opacity);
    expect(Number(checked!.fontWeight)).toBeGreaterThan(Number(rest!.fontWeight));
  });

  test("selected dock facet is distinguished by opacity and font-weight", async ({ page }) => {
    await gotoShell(page);
    const states = await page.evaluate(() => {
      const facets = Array.from(document.querySelectorAll("button.dock-facet"));
      return facets.map(f => ({
        selected: f.getAttribute("aria-selected") === "true",
        opacity: parseFloat(getComputedStyle(f).opacity),
        fontWeight: getComputedStyle(f).fontWeight,
      }));
    });
    const sel  = states.find(f => f.selected);
    const rest = states.find(f => !f.selected);
    expect(sel).toBeDefined();
    expect(rest).toBeDefined();
    expect(sel!.opacity).toBeGreaterThan(rest!.opacity);
    expect(Number(sel!.fontWeight)).toBeGreaterThan(Number(rest!.fontWeight));
  });

  test("selected panel tab is distinguished by font-weight", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    await page.waitForSelector(".main[data-panel-open]");
    const weights = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".panel-tabs button"));
      return btns.map(b => ({
        selected: b.getAttribute("aria-selected") === "true",
        fontWeight: getComputedStyle(b).fontWeight,
      }));
    });
    const sel  = weights.find(b => b.selected);
    const rest = weights.find(b => !b.selected);
    expect(sel).toBeDefined();
    expect(rest).toBeDefined();
    expect(Number(sel!.fontWeight)).toBeGreaterThan(Number(rest!.fontWeight));
  });
});

test.describe("shell active-region affordance", () => {
  // ---- Region body hover firms boundary ----

  test("hovering inside sidebar body firms right border to --pd-border-active", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);

    const rect = await page.evaluate(() => {
      const r = document.querySelector(".sidebar")!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    // Move to a point deep in the body, well away from the right-edge splitter
    await page.mouse.move(rect.x + 50, rect.y + rect.h / 2);

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("hovering inside dock body firms top border to --pd-border-active", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);

    const rect = await page.evaluate(() => {
      const r = document.querySelector(".dock")!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    // Move well below the top-edge splitter (8px), into the dock body
    await page.mouse.move(rect.x + rect.w / 2, rect.y + 40);

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderTopColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("hovering inside dock body firms left border to --pd-border-active", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);

    const rect = await page.evaluate(() => {
      const r = document.querySelector(".dock")!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    await page.mouse.move(rect.x + rect.w / 2, rect.y + 40);

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderLeftColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("hovering inside dock body firms right border to --pd-border-active", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);

    const rect = await page.evaluate(() => {
      const r = document.querySelector(".dock")!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    await page.mouse.move(rect.x + rect.w / 2, rect.y + 40);

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderRightColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("hovering inside panel body firms left border to --pd-border-active", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    await page.waitForSelector(".main[data-panel-open]");

    const rect = await page.evaluate(() => {
      const r = document.querySelector(".panel")!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    // Move well right of the left-edge splitter (8px), into the panel body
    await page.mouse.move(rect.x + 50, rect.y + rect.h / 2);

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".panel")!).borderLeftColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  // ---- Focus-within firms boundary ----

  test("focus within sidebar firms right border to --pd-border-active", async ({ page }) => {
    await gotoShell(page);

    await page.locator(".sidebar-search input").focus();

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("focus within dock firms top border to --pd-border-active", async ({ page }) => {
    await gotoShell(page);

    await page.locator("button.dock-tab").first().focus();

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderTopColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("focus within dock firms left border to --pd-border-active", async ({ page }) => {
    await gotoShell(page);

    await page.locator("button.dock-tab").first().focus();

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderLeftColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("focus within dock firms right border to --pd-border-active", async ({ page }) => {
    await gotoShell(page);

    await page.locator("button.dock-tab").first().focus();

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".dock")!).borderRightColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  test("focus within panel firms left border to --pd-border-active", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);
    await page.waitForSelector(".main[data-panel-open]");

    await page.locator(".panel-tabs button").first().focus();

    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector(".panel")!).borderLeftColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(color).toBe(activeToken);
  });

  // ---- Leave / blur restores rest ----

  test("moving pointer out of sidebar restores right border to --pd-border-rest", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoShell(page);

    const rect = await page.evaluate(() => {
      const r = document.querySelector(".sidebar")!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    await page.mouse.move(rect.x + 50, rect.y + rect.h / 2); // enter

    const firmed = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(firmed).toBe(activeToken); // confirm it was firmed

    await page.mouse.move(640, 300); // move to stage centre

    const restored = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const restToken = await resolveToken(page, "--pd-border-rest");
    expect(restored).toBe(restToken);
  });

  test("blurring from sidebar restores right border to --pd-border-rest", async ({ page }) => {
    await gotoShell(page);

    await page.locator(".sidebar-search input").focus();

    const firmed = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const activeToken = await resolveToken(page, "--pd-border-active");
    expect(firmed).toBe(activeToken); // confirm it was firmed

    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    const restored = await page.evaluate(
      () => getComputedStyle(document.querySelector(".sidebar")!).borderRightColor,
    );
    const restToken = await resolveToken(page, "--pd-border-rest");
    expect(restored).toBe(restToken);
  });
});

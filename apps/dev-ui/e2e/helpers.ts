// Shared E2E helpers.
//
// These were duplicated per spec — `gotoComponent` in 14 files, `selectTheme` in 2. The copies had
// drifted into THREE different readiness contracts, which is why this module exports two navigation
// helpers rather than one: merging them would silently change the wait for eleven specs.
//
//   1. `gotoComponent`      — resolves as soon as the iframe has a srcdoc. Cheapest. What most
//                             specs used, and enough when the assertion targets shell chrome.
//   2. `gotoComponentReady` — additionally waits for the REQUESTED component to be present inside
//                             the iframe. Strictly stronger: it cannot resolve against the
//                             "about:blank" transitional state, which matters for specs that mutate
//                             files and then re-navigate.
//
// Tier 3 — additionally waiting for every linked stylesheet's cssRules to be reachable — stays
// local to css-external.spec.ts. It is used by one spec, needs a 15s budget, and exists to serve
// CSSOM rule-counting; hoisting a single-use helper would add indirection without removing any
// duplication.
//
// Each spec kept the tier it already had. Upgrading the eleven tier-1 callers to tier 2 is probably
// correct and would remove a class of latent race, but it is a behaviour change to eleven specs and
// belongs in its own commit with its own evidence — not smuggled into a deduplication.

import type { Page } from "@playwright/test";

/** Navigate to a component and wait for the preview iframe to receive a srcdoc. */
export async function gotoComponent(page: Page, id: string, search = ""): Promise<void> {
  await page.goto(`/${id}${search}`);
  await page.waitForSelector("#preview-frame[srcdoc]");
}

/**
 * Navigate and wait until the iframe actually contains the requested component — not merely any
 * srcdoc. Use when a previous navigation or an HMR reload could leave a stale/blank document.
 */
export async function gotoComponentReady(page: Page, id: string, search = ""): Promise<void> {
  await page.goto(`/${id}${search}`);
  await page.waitForFunction((componentId: string) => {
    const f = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    return !!f?.contentDocument?.querySelector(`main[data-component-id='${componentId}']`);
  }, id);
}

/**
 * Select a theme by value.
 *
 * The picker is radio inputs inside a <details> (it was a <select class="theme-select"> until it
 * was rebuilt). Dispatching `change` programmatically matches the old `selectOption()` semantics and
 * works even when the <li> chip covers the input.
 *
 * Throws when the radio is absent: a silent no-op here is exactly how a11y-rendered.spec.ts's
 * theme-rescan test came to assert nothing at all.
 */
export async function selectTheme(page: Page, name: string): Promise<void> {
  const found = await page.evaluate((n) => {
    const radio = document.querySelector(`input.theme-radio[value="${n}"]`) as HTMLInputElement | null;
    if (!radio) return false;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, name);
  if (!found) throw new Error(`selectTheme: no theme radio with value "${name}"`);
}

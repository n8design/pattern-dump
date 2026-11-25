// The Nav Rail's theme picker, and applying a theme to the previews.
//
// activeThemeName() is the load-bearing piece. store.local.theme is "" until the user picks one, and
// "" means "follow the project default" — the server then falls back to its configured defaultTheme,
// so the preview is themed either way. Anything that DISPLAYS the theme must use activeThemeName();
// anything that SENDS it to the server keeps passing the raw stored value, so "" keeps meaning
// "follow the default" rather than pinning a name. Getting that backwards is exactly how the picker
// came to report "(no theme)" over a document that was plainly themed.
//
// The radio inputs are sr-only; the chip <label> is the real affordance.
//
// populateThemePicker takes the post-apply hook as a parameter — see its docblock. The rescan it
// triggers belongs to the Console dock, and a rail module must not import one.

import type { ThemeSummary } from "@pattern-dump/contracts";
import { themeCssUrl } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { resourceUrl } from "../core/runtime.js";
import { store } from "../core/store.js";


/** Build a swatch strip element from a token map. Null slots render as an "undefined" mark. */
export function buildSwatchStrip(tokens: Record<string, string | null> | undefined, slots: string[]): HTMLElement {
  const strip = document.createElement("span");
  strip.className = "theme-swatch-strip";
  strip.setAttribute("aria-hidden", "true");
  if (!tokens || slots.length === 0) return strip;
  for (const slot of slots) {
    const band = document.createElement("span");
    const value = tokens[slot];
    if (value !== null && value !== undefined) {
      band.className = "theme-swatch-band";
      band.style.background = value;
    } else {
      band.className = "theme-swatch-band theme-swatch-undefined";
    }
    strip.appendChild(band);
  }
  return strip;
}

/**
 * The theme actually in effect: the user's explicit choice, else the project's configured default.
 *
 * store.local.theme is "" until the user picks one, and "" means "follow the project default" —
 * previewUrl omits the param and the server falls back to its configured defaultTheme, so the
 * preview is themed either way. Anything that DISPLAYS the theme must use this; anything that
 * SENDS it to the server must keep passing the raw stored value, so that "" keeps meaning "follow
 * the default" rather than pinning a name.
 */
export function activeThemeName(): string {
  return store.local.theme || session.serverDefaultTheme;
}

/**
 * Build the theme picker.
 *
 * `onThemeApplied` is injected rather than calling the diagnostics rescan directly. The picker is
 * Nav Rail chrome; refreshDiagnostics and runRenderedA11yScan are the Console dock's. A rail module
 * importing a dock module is a cross-region edge, which the ESLint rule rejects — correctly, since
 * "the theme changed" and "therefore re-run the rendered a11y scan" are two regions' concerns joined
 * by a policy that belongs to neither.
 *
 * The behaviour is unchanged: the caller passes exactly the block that used to live here, including
 * its `dockTab === "diagnostics"` guard. a11y-rendered.spec.ts pins it.
 */
export function populateThemePicker(fetchedThemes: ThemeSummary[], onThemeApplied: () => void): void {
  // The EFFECTIVE theme, not the stored one. store.local.theme is "" until the user picks
  // explicitly, and "" means "follow the project default" — the server then falls back to its
  // configured defaultTheme, so the preview is themed regardless. Reporting the raw stored value
  // made the picker read "(no theme)" over a document that was plainly themed.
  //
  // Deliberately NOT seeding store.local.theme with the default: keeping it "" is what lets a later
  // change to the project's configured default carry through to anyone who never chose a theme. The
  // fix is presentational; stored state keeps its meaning.
  const currentTheme = activeThemeName();
  // Each theme's own slot list: themes can come from different sources (the project and a pattern
  // package) that name their swatch properties differently.
  const defaultSlots = ["--bodyBackground", "--themePrimary", "--accent"];
  const slotsOf = (t: ThemeSummary | undefined): string[] => t?.tokens ? Object.keys(t.tokens) : defaultSlots;

  // Update the summary swatch and name to show the current theme.
  // Named activeTheme, not `current`: the module-level `current` is the selected ComponentDetail,
  // and a ThemeSummary shadowing it inside this function is a trap — especially with the session
  // state extraction turning `current` into a property access.
  const activeTheme = fetchedThemes.find(t => t.name === currentTheme);
  dom.themePickerSwatch.innerHTML = "";
  dom.themePickerSwatch.appendChild(buildSwatchStrip(activeTheme?.tokens, slotsOf(activeTheme)));
  // Still reachable — and then genuinely true — when the project configures no themes at all.
  dom.themePickerCurrentName.textContent = currentTheme || "(no theme)";
  dom.themePickerReadout.textContent = currentTheme || "";

  dom.themePickerList.innerHTML = "";
  for (const t of fetchedThemes) {
    const li = document.createElement("li");
    li.className = "theme-swatch-item";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "pd-theme";
    radio.id = `pd-theme-${t.name}`;
    radio.className = "theme-radio";
    radio.value = t.name;
    radio.checked = t.name === currentTheme;

    const label = document.createElement("label");
    label.htmlFor = radio.id;
    label.className = "theme-swatch-chip";
    label.title = t.name;
    label.setAttribute("aria-label", t.name);
    label.appendChild(buildSwatchStrip(t.tokens, slotsOf(t)));

    radio.addEventListener("change", () => {
      store.setLocal({ theme: t.name });
      applyTheme(t.name);
      dom.themePickerCurrentName.textContent = t.name;
      dom.themePickerReadout.textContent = t.name;
      dom.themePickerSwatch.innerHTML = "";
      dom.themePickerSwatch.appendChild(buildSwatchStrip(t.tokens, slotsOf(t)));
      onThemeApplied();
    });

    label.addEventListener("mouseover", () => { dom.themePickerReadout.textContent = t.name; });
    label.addEventListener("focus", () => { dom.themePickerReadout.textContent = t.name; });
    // activeThemeName(), not store.local.theme: on a fresh load the stored value is "" and the
    // readout would blank out on mouseleave even though a theme is plainly in effect.
    label.addEventListener("mouseleave", () => { dom.themePickerReadout.textContent = activeThemeName(); });
    label.addEventListener("blur", () => { dom.themePickerReadout.textContent = activeThemeName(); });

    li.appendChild(radio);
    li.appendChild(label);
    dom.themePickerList.appendChild(li);
  }
}


export function applyTheme(theme: string): void {
  applyThemeToIframe(dom.iframe, theme);
  document.querySelectorAll(".gallery-item iframe").forEach((f) => {
    applyThemeToIframe(f as HTMLIFrameElement, theme);
  });
}

/** Sent on a preview frame (the shell's element, not its document) once a theme is in effect in it: at once for an
 *  attribute switch, when the theme's stylesheet has loaded for a stylesheet switch. The Stage follows it. */
export const THEME_APPLIED = "pd-theme-applied";

/** Sent on a preview frame when a theme's stylesheet fails to load (a stylesheet switch): `detail` names the theme. The
 *  theme in effect stays as it was. The app writes it to the Console (a rail module doesn't import the dock). */
export const THEME_FAILED = "pd-theme-failed";

/**
 * Puts `theme` in effect in a preview frame, without reloading it: its scroll, an open dialog and typed input stay.
 *
 * - attribute switch: every theme is linked; `data-theme` on the body selects one.
 * - stylesheet switch: only the active theme's sheet is linked. The new sheet goes in beside the current one, and
 *   the current one leaves only once the new one has loaded, so no frame is ever without a theme. On an error the
 *   current one stays. `data-theme` names the theme in effect here too.
 */
export function applyThemeToIframe(f: HTMLIFrameElement, theme: string): void {
  const doc = f.contentDocument;
  const body = doc?.body;
  if (!doc || !body) return;
  if (session.themeSwitch === "stylesheet") {
    const current = doc.querySelector<HTMLLinkElement>("link[data-pd-theme]");
    if (!current || !theme) return;
    // A switch still loading is overtaken: only the last theme asked for goes in.
    for (const pending of doc.querySelectorAll<HTMLLinkElement>("link[data-pd-theme-next]")) pending.remove();
    if (current.getAttribute("data-pd-theme") === theme) {
      body.setAttribute("data-theme", theme);
      f.dispatchEvent(new Event(THEME_APPLIED));
      return;
    }
    const next = doc.createElement("link");
    next.rel = "stylesheet";
    next.setAttribute("data-pd-theme-next", theme);
    next.addEventListener("load", () => {
      if (!next.isConnected) return;
      current.remove();
      next.removeAttribute("data-pd-theme-next");
      next.setAttribute("data-pd-theme", theme);
      body.setAttribute("data-theme", theme);
      f.dispatchEvent(new Event(THEME_APPLIED));
    }, { once: true });
    next.addEventListener("error", () => {
      if (!next.isConnected) return;
      next.remove();
      f.dispatchEvent(new CustomEvent(THEME_FAILED, { detail: theme }));
    }, { once: true });
    next.href = resourceUrl(themeCssUrl(theme));
    current.after(next);
    return;
  }
  if (theme) body.setAttribute("data-theme", theme);
  else body.removeAttribute("data-theme");
  f.dispatchEvent(new Event(THEME_APPLIED));
}

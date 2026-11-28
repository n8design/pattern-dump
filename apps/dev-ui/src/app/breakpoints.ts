// The narrow-layout media query, as the compiled CSS writes it (styles/layout/_main.scss with
// $bp-narrow from styles/abstracts/_breakpoints.scss). breakpoints.spec.ts compiles the Sass and fails
// when the two differ, so the script and the CSS agree at every text size.
export const NARROW_QUERY = "(max-width: 56.25em)";

/** True when the viewport is at or below the narrow breakpoint, the same test the CSS makes. */
export function isNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

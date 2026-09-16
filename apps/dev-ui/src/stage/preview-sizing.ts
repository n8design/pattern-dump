// Preview iframe sizing — the convergence guard shared by pd-height and pd-width.

/**
 * Write a viewport custom property (`--vp-h` / `--vp-w`) on the preview iframe ONLY when it changes
 * by more than 1px.
 *
 * Why the guard exists: a CSS custom-property write forces a style recalculation **even when the
 * computed result is identical**, and that recalc re-triggers the srcdoc ResizeObserver, which
 * re-posts `pd-height`/`pd-width`, which writes the property again — a self-sustaining feedback
 * loop. The 50ms debounce in the srcdoc only *paces* it; it never closes it. Skipping the no-op
 * write closes it. (Retina + a late-loading external font keep the body's height moving enough to
 * sustain the loop; integer-happy layouts at DPR 1 hide it by luck — which is why it can be quiet in
 * one place and permanent in another.)
 *
 * This was diagnosed once, the width handler was guarded, and the height handler was left
 * unguarded. Both now call this single function, so the two can never drift apart again.
 *
 * `parseFloat("max-content") → NaN → 0`, so the first write (the seed value is a keyword) always
 * passes; only subsequent no-op writes are suppressed.
 */
export function setVpProp(el: HTMLElement, prop: "--vp-h" | "--vp-w", value: number): void {
  const cur = parseFloat(el.style.getPropertyValue(prop)) || 0;
  if (Math.abs(value - cur) > 1) {
    el.style.setProperty(prop, `${value}px`);
  }
}

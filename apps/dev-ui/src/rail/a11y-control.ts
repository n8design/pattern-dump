// The CVD (colour-vision-deficiency) simulation control — the rail's a11y picker.
//
// Rail chrome: the type radiogroup, the severity slider, and the collapsed-rail signal badge. The
// simulation MATH lives in core/cvd-math.ts and the filter it drives paints on the stage iframe, so
// the feature spans two regions by nature. This module owns the CONTROL half only; nothing here
// reaches into the stage beyond setting the filter value, and the matrix itself is imported from
// core rather than recomputed.
//
// CVD state is URL-only, never localStorage — an accessibility simulation is a thing you share in a
// link, not a preference that silently persists into someone else's next session.

import { computeCvdMatrix, cvdMatrixToValues } from "../core/cvd-math.js";
import { dom } from "../core/dom.js";
import { setupRadiogroupKeyboard } from "../core/radiogroup.js";
import { store } from "../core/store.js";

// ─── CVD overlay ─────────────────────────────────────────────────────────

export function applyCvd(): void {
  const { type, severity } = store.url.cvd;
  if (type === "none" || !dom.cvdFeMatrix) {
    dom.iframe.style.removeProperty("filter");
    return;
  }
  dom.cvdFeMatrix.setAttribute("values", cvdMatrixToValues(computeCvdMatrix(type, severity)));
  dom.iframe.style.setProperty("filter", "url(#cvd-filter)");
}

// Mirror of applyViewport()'s roving-tabindex block — keeps CVD type radiogroup conformant.
export function applyType(): void {
  const type = store.url.cvd.type;
  dom.cvdTypeGroup.querySelectorAll<HTMLButtonElement>("[role='radio']").forEach(btn => {
    const active = btn.dataset.cvdType === type;
    btn.setAttribute("aria-checked", String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  dom.cvdSeveritySlider.disabled = type === "none";
  updateSeverityFill();
  updateSignal();
}

// Drive the slider's red-fill stop (--fill, a %) from its value. The CSS gradient paints
// --pd-accent up to --fill and hairline beyond; at value 0 the fill is 0% (no red), and the
// :disabled state ignores it entirely (no red when type=None). Enabled + >0 → red proportional.
export function updateSeverityFill(): void {
  const min = parseFloat(dom.cvdSeveritySlider.min || "0");
  const max = parseFloat(dom.cvdSeveritySlider.max || "1");
  const v = parseFloat(dom.cvdSeveritySlider.value);
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  dom.cvdSeveritySlider.style.setProperty("--fill", `${pct}%`);
}

// Inject or remove the active-CVD signal badge in the collapsed summary.
// Active = type !== "none" AND severity > 0 — same definition as applyCvd().
// Signal is ABSENT from the DOM when inactive; never merely styled-off.
export function updateSignal(): void {
  const { type, severity } = store.url.cvd;
  const active = type !== "none" && severity > 0;
  const summary = dom.a11yDetails.querySelector<HTMLElement>(".a11y-picker-summary")!;
  const existing = summary.querySelector<HTMLElement>(".a11y-signal");
  if (!active) { existing?.remove(); return; }
  const el = existing ?? (() => {
    const s = document.createElement("span");
    s.className = "a11y-signal";
    s.setAttribute("aria-hidden", "true");
    summary.appendChild(s);
    return s;
  })();
  const LABELS: Record<string, string> = {
    protanopia: "Protanopia", deuteranopia: "Deuteranopia",
    tritanopia: "Tritanopia",  achromatopsia: "Achrom.",
  };
  el.textContent = `${LABELS[type] ?? type} · ${severity.toFixed(2)}`;
}

export function initA11yControl(): void {
  // Sync slider to URL-hydrated severity (only when a non-none type is active).
  if (store.url.cvd.type !== "none") {
    dom.cvdSeveritySlider.value = String(store.url.cvd.severity);
  }
  applyType();

  setupRadiogroupKeyboard(dom.cvdTypeGroup);

  dom.cvdTypeGroup.querySelectorAll<HTMLButtonElement>("[role='radio']").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.cvdType as import("../core/store.js").CvdType;
      // When switching to a non-none type, read severity from the slider (not from store,
      // which holds 0 at first activation) so the user gets the slider's current position.
      const severity = type === "none" ? 0 : parseFloat(dom.cvdSeveritySlider.value);
      store.setUrl({ cvd: { type, severity } });
      const u = new URL(window.location.href);
      if (type === "none") u.searchParams.delete("cvd");
      else u.searchParams.set("cvd", `${type}:${severity}`);
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
      applyType();
      applyCvd();
    });
  });

  dom.cvdSeveritySlider.addEventListener("input", () => {
    const type = store.url.cvd.type;
    if (type === "none") return;
    const severityStr = dom.cvdSeveritySlider.value;
    const severity = parseFloat(severityStr);
    store.setUrl({ cvd: { type, severity } });
    const u = new URL(window.location.href);
    u.searchParams.set("cvd", `${type}:${severityStr}`);
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    updateSeverityFill();
    applyCvd();
    updateSignal();
  });
}

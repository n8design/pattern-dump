// Shared severity glyph — ONE source for the Diagnostics tab marker, the accordion head marker,
// and the per-row dots (match-by-construction; no two look-alike marks that drift). Returns the
// glyph markup only; shape + colour are self-contained on the element's own [data-severity]
// (see `.pd-sev-glyph` in styles/regions/_dock.scss), so a bare dot needs no ancestor context:
//   error   → ● filled dot      (--pd-accent)
//   warning → ▲ filled triangle (--pd-warning)
// "info" and anything else → no glyph (empty string): severity has no neutral mark. The glyph is
// purely decorative (the count digit / row text carries the meaning), hence aria-hidden.
export function severityGlyph(severity: string): string {
  if (severity === "error" || severity === "warning") {
    return `<span class="pd-sev-glyph" data-severity="${severity}" aria-hidden="true"></span>`;
  }
  return "";
}

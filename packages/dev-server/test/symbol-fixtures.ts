// Two symbol sources drawn for the tests (generated here, no outside source): each uses two colour tokens, one
// currentColor, a marker and a gradient with internal ids, and a <style> class rule.
export const FLOW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">
  <title id="title">A filled box points to an outlined box</title>
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z" fill="var(--color-primary)"/></marker></defs>
  <rect x="20" y="60" width="120" height="80" fill="var(--color-primary)"/>
  <line x1="140" y1="100" x2="255" y2="100" stroke="var(--color-text)" stroke-width="4" marker-end="url(#arrow)"/>
  <rect x="300" y="90" width="40" height="20" fill="currentColor"/>
</svg>`;

export const LAYERS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <style>.layer { fill: var(--color-surface-subtle); stroke: var(--color-border); stroke-width: 4; }</style>
  <defs><linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="var(--color-border)"/></linearGradient></defs>
  <rect class="layer" x="20" y="20" width="360" height="70"/>
  <rect x="20" y="110" width="360" height="70" fill="url(#fade)"/>
</svg>`;

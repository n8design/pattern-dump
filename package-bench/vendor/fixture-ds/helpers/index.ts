// The design system's Handlebars helpers. Compiled to dist/helpers.js, which the manifest names.
export function dsLabel(label: unknown): string {
  return `DS:${String(label)}`;
}

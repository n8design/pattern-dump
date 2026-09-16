// Handlebars partial-reference parsing.
//
// A LEAF: no imports, no state. It exists as its own module because two independent concerns need
// it — the composition registry (to derive `uses`/`usedBy` edges) and requires-aggregation (to walk
// a component's include tree). Whichever of those is extracted first would otherwise have to own
// it, and the second would import across a sibling boundary.

/**
 * Static partial names referenced by a template, in both include forms.
 *
 * Returns STATIC includes only. `dynamicPartial`'s runtime string lookup is deliberately not
 * detected — it cannot be derived from source, and the derived graph is honest about missing it
 * rather than guessing.
 */
export function parsePartialsFromHbs(hbs: string): string[] {
  const partials = new Set<string>();
  // `#?>` matches both the inline partial `{{> name}}` and the block partial `{{#> name}}…{{/name}}`.
  // A block partial is a static include and composes its target, so it is a real `uses` edge (unlike
  // dynamicPartial's runtime string lookup). The unquoted name pattern excludes `@partial-block`.
  // Quoted form: {{> "atoms-badge~info"}} — required when the name contains ~ (Handlebars
  // treats ~ as whitespace-control in unquoted position, so variant handles must be quoted).
  for (const [, name] of hbs.matchAll(/\{\{#?>\s*"([^"]+)"/g)) {
    partials.add(name);
  }
  // Unquoted form: {{> atoms-button}} / {{#> molecules-dialog-content}}.
  for (const [, name] of hbs.matchAll(/\{\{#?>\s*([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    partials.add(name);
  }
  return [...partials];
}

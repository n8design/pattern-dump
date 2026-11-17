// What a check works out from a template's text alone (the bare calls of a helper, the items a list writes as text,
// what it outputs unescaped), kept by that text: a render, and every site page that renders a layout, asked for it
// again and parsed the template each time. The same text gives the same answer, so an edited template is a new key
// and nothing has to be dropped. Kept for up to MOST texts, then started again, so a long pd dev session that edits
// templates doesn't keep every version.
const MOST = 10_000;
const kept = new Map<string, unknown>();

/** A value frozen with every object and array in it: a kept answer is shared by every caller. */
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) frozen(v);
    Object.freeze(value);
  }
  return value;
}

/** `make()`'s answer for the template text `template` (and `kind`, which names the question and its other inputs). */
export function byTemplate<T>(kind: string, template: string, make: () => T): T {
  const key = `${kind}\u0000${template}`;
  if (kept.has(key)) return kept.get(key) as T;
  if (kept.size >= MOST) kept.clear();
  const value = frozen(make());
  kept.set(key, value);
  return value;
}

// Reconcile a preview document's pd-managed <link> set against the server's ordered closure.
//
// In core/ because it is pure: it operates only on the Document it is handed, reads no shared state,
// and belongs to no region. Its sole caller is the HMR client (app/hmr), but a pure helper does not
// become orchestration by having one orchestrating caller.
//
// Cascade order is the thing to protect. New links go in at their topological slot — before the
// first existing pd-link that should follow them — never appended last, because a component's CSS
// must load after the CSS of the components it depends on.

/**
 * Reconcile a preview document's pd-managed `<link>` set against the ordered closure
 * emitted by the server. Performs add / remove / bump in-place without touching the srcdoc
 * or any non-pd links (base, themes, asset CSS).
 *
 * Cascade order is preserved: new links are inserted at their topological slot (before the
 * first existing pd-link that should follow them), never appended last.
 */
export function reconcilePdLinks(doc: Document | null, orderedHrefs: string[]): void {
  if (!doc) return;

  // Parse desired set: [{id, href}, …] in topological order.
  const desired = orderedHrefs.flatMap(href => {
    const m = href.match(/\/_pd\/components\/(.+?)\.css/);
    return m ? [{ id: m[1], href }] : [];
  });
  const desiredIds = new Set(desired.map(d => d.id));

  // Snapshot existing pd-links before any mutation.
  const existing = Array.from(doc.querySelectorAll<HTMLLinkElement>("link[data-pd-comp]"));
  const existingMap = new Map(existing.map(l => [l.dataset.pdComp!, l]));

  // 1. REMOVE — links no longer in closure.
  for (const link of existing) {
    if (!desiredIds.has(link.dataset.pdComp!)) link.remove();
  }

  // 2. BUMP or ADD — walk desired order.
  for (let i = 0; i < desired.length; i++) {
    const { id, href } = desired[i];
    const existingLink = existingMap.get(id);
    if (existingLink) {
      existingLink.href = href;
    } else {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.pdComp = id;
      // Insert before the first surviving pd-link whose desired index > i.
      let anchor: Element | null = null;
      for (let j = i + 1; j < desired.length; j++) {
        const follower = existingMap.get(desired[j].id);
        if (follower?.parentNode === doc.head) { anchor = follower; break; }
      }
      doc.head.insertBefore(link, anchor);
    }
  }
}

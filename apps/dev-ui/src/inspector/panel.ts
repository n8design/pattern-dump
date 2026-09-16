// The Inspector panel — Docs, Relationships and Audit facets.
//
// renderPanel's branch ORDER is load-bearing. The Audit branch sits deliberately ABOVE the
// `!session.current` guard, because the corpus audit is selection-independent: it must render even
// with nothing selected. Moving the guard up to "tidy" the function would blank the audit facet on
// every folder overview.
//
// Depends on ./audit.js, never the reverse — the audit facet does not know the panel exists.

import type { StyleModuleId } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { routeHref } from "../core/runtime.js";
import { store } from "../core/store.js";
import { renderAuditFacet } from "./audit.js";

export async function renderPanel(): Promise<void> {
  // Audit facet — the corpus diagnostics view. Selection-INDEPENDENT: it must render (and not blank)
  // regardless of `current`, so it sits ABOVE the `!current` guard. It renders from a cached rollup
  // and never refetches on a `renderPanel()` triggered by a selection change (Commit 3 wires the fetch).
  if (store.local.panelTab === "audit") {
    await renderAuditFacet();
    return;
  }
  if (!session.current) {
    dom.panelContent.innerHTML = "<p>Select a component to view docs.</p>";
    return;
  }
  if (store.local.panelTab === "docs") {
    dom.panelContent.innerHTML = session.current.doc
      ? session.current.doc
      : '<p class="doc-empty">No Documentation found</p>';
    return;
  }
  if (store.local.panelTab === "relationships") {
    const relAvail = session.current.relationships;
    dom.panelContent.innerHTML = "";
    const section = document.createElement("section");
    section.className = "rel-panel";
    section.setAttribute("aria-label", "Component relationships");

    // Helper: render a group of navigable component ids, grouped by category.
    // Component items are nested inside their category's own <ul> (structural hierarchy).
    function appendComponentGroup(
      label: string, ids: string[], container: HTMLElement, headingTag: "h3" | "h4" = "h3"
    ): void {
      const h = document.createElement(headingTag);
      h.className = "rel-group-heading";
      h.textContent = label;
      container.appendChild(h);

      if (ids.length === 0) {
        const empty = document.createElement("p");
        empty.className = "rel-empty";
        empty.textContent = "none";
        container.appendChild(empty);
        return;
      }

      // Group by top-level folder (category), preserving nav order.
      const byCategory = new Map<string, string[]>();
      for (const id of ids) {
        const cat = session.componentRegistry.get(id)?.category ?? id.split("/")[0];
        const bucket = byCategory.get(cat) ?? [];
        bucket.push(id);
        byCategory.set(cat, bucket);
      }
      const sortedCategories = [...byCategory.keys()].sort(
        (a, b) => (session.navCategoryOrder.get(a) ?? 999) - (session.navCategoryOrder.get(b) ?? 999)
      );

      const list = document.createElement("ul");
      list.className = "rel-list";
      for (const cat of sortedCategories) {
        const catIds = byCategory.get(cat)!;
        const catLi = document.createElement("li");
        catLi.className = "rel-category";

        // Category label (visual grouping, not a semantic heading).
        const catSpan = document.createElement("span");
        catSpan.className = "rel-category-heading";
        catSpan.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
        catLi.appendChild(catSpan);

        // Sort items within category by resolved title.
        catIds.sort((a, b) => {
          const ta = session.componentRegistry.get(a)?.title ?? a;
          const tb = session.componentRegistry.get(b)?.title ?? b;
          return ta.localeCompare(tb);
        });

        // Nest component items inside the category's own list.
        const catList = document.createElement("ul");
        catList.className = "rel-category-list";
        for (const id of catIds) {
          const meta = session.componentRegistry.get(id);
          const isPrivate = meta?.visibility === "private";
          const li = document.createElement("li");
          li.className = "rel-item";
          const a = document.createElement("a");
          a.className = "rel-link";
          a.href = routeHref(`/${id}`);
          a.textContent = meta?.title ?? id;
          li.appendChild(a);
          if (isPrivate) {
            const badge = document.createElement("span");
            badge.className = "rel-private-badge";
            badge.textContent = " private";
            li.appendChild(badge);
          }
          catList.appendChild(li);
        }
        catLi.appendChild(catList);
        list.appendChild(catLi);
      }
      container.appendChild(list);
    }

    // Helper: render a plain-text (non-navigable) group.
    function appendPlainGroup(
      label: string, ids: StyleModuleId[], container: HTMLElement, headingTag: "h3" | "h4" = "h3"
    ): void {
      const h = document.createElement(headingTag);
      h.className = "rel-group-heading";
      h.textContent = label;
      container.appendChild(h);
      if (ids.length === 0) {
        const empty = document.createElement("p");
        empty.className = "rel-empty";
        empty.textContent = "none";
        container.appendChild(empty);
        return;
      }
      const list = document.createElement("ul");
      list.className = "rel-list";
      for (const id of ids) {
        const li = document.createElement("li");
        li.className = "rel-item";
        li.textContent = id;
        list.appendChild(li);
      }
      container.appendChild(list);
    }

    // Top-level composition groups.
    appendComponentGroup("Uses",    relAvail.uses,   section);
    appendComponentGroup("Used by", relAvail.usedBy, section);

    // Style umbrella: groups Style uses + Style modules under a shared heading.
    const styleUmbrella = document.createElement("div");
    styleUmbrella.className = "rel-style-umbrella";
    const styleH = document.createElement("h3");
    styleH.className = "rel-group-heading rel-umbrella-heading";
    styleH.textContent = "Style";
    styleUmbrella.appendChild(styleH);
    appendComponentGroup("Style uses",    relAvail.styleUses,             styleUmbrella, "h4");
    // "Style modules" surfaces two distinct relationships as one plain list (separable in the
    // payload): @use dependencies (styleUsesModules) + class-borrowed shared modules (styleModules).
    const styleModulesAll = [...new Set([
      ...(relAvail.styleUsesModules ?? []),
      ...(relAvail.styleModules ?? []),
    ])].sort();
    appendPlainGroup("Style modules",     styleModulesAll,                styleUmbrella, "h4");
    section.appendChild(styleUmbrella);

    // Leftover chips: inlineStyles, utilityClasses, unattributedClasses.
    const hasChips = relAvail.inlineStyles || relAvail.utilityClasses || (relAvail.unattributedClasses?.length ?? 0) > 0;
    if (hasChips) {
      const chips = document.createElement("div");
      chips.className = "rel-chips";
      if (relAvail.inlineStyles) {
        const chip = document.createElement("span");
        chip.className = "rel-chip rel-chip--inline-styles";
        chip.textContent = "Inline styles";
        chips.appendChild(chip);
      }
      if (relAvail.utilityClasses) {
        const chip = document.createElement("span");
        chip.className = "rel-chip rel-chip--utility-classes";
        chip.textContent = "Utility classes";
        chips.appendChild(chip);
      }
      for (const cls of (relAvail.unattributedClasses ?? [])) {
        const chip = document.createElement("span");
        chip.className = "rel-chip rel-chip--unattributed";
        chip.textContent = cls;
        chips.appendChild(chip);
      }
      section.appendChild(chips);
    }

    dom.panelContent.appendChild(section);
    return;
  }
}

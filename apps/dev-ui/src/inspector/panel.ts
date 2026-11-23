// The Inspector panel — Docs, Relationships and Audit facets.
//
// renderPanel's branch ORDER is load-bearing. The Audit branch sits deliberately ABOVE the
// `!session.current` guard, because the corpus audit is selection-independent: it must render even
// with nothing selected. Moving the guard up to "tidy" the function would blank the audit facet on
// every folder overview.
//
// Depends on ./audit.js, never the reverse — the audit facet does not know the panel exists.

import type { StyleCoupling, StyleModuleId } from "@pattern-dump/contracts";
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
      label: string, ids: string[], container: HTMLElement, headingTag: "h3" | "h4" = "h3", emptyText = "none"
    ): void {
      const h = document.createElement(headingTag);
      h.className = "rel-group-heading";
      h.textContent = label;
      container.appendChild(h);

      if (ids.length === 0) {
        const empty = document.createElement("p");
        empty.className = "rel-empty";
        empty.textContent = emptyText;
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
          a.textContent = shownName(id);
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

    // Helper: how a component is named, by its title; a variant (atoms/price~sale) by its base's title and its name.
    function shownName(id: string): string {
      const tilde = id.indexOf("~");
      if (tilde < 0) return session.componentRegistry.get(id)?.title ?? id;
      const base = id.slice(0, tilde);
      return `${session.componentRegistry.get(base)?.title ?? base} · ${id.slice(tilde + 1)}`;
    }

    // Helper: a sub-group of style couplings, each a link to the other component, its stylesheet and its classes.
    function appendCouplings(label: string, couplings: StyleCoupling[], container: HTMLElement, emptyText: string, own: boolean): void {
      const h = document.createElement("h4");
      h.className = "rel-group-heading";
      h.textContent = label;
      container.appendChild(h);
      if (couplings.length === 0) {
        const empty = document.createElement("p");
        empty.className = "rel-empty";
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
      }
      const list = document.createElement("ul");
      list.className = "rel-list rel-couplings";
      for (const c of couplings) {
        const li = document.createElement("li");
        li.className = "rel-coupling";
        const a = document.createElement("a");
        a.className = "rel-link";
        a.href = routeHref(`/${c.component}`);
        a.textContent = shownName(c.component);
        li.appendChild(a);
        const where = document.createElement("span");
        where.className = "rel-coupling-sheet";
        // A template's <style> is named as such: its own as in the Stylesheet group above, another's by its template.
        const inline = c.stylesheet.endsWith(".hbs");
        where.textContent = !inline ? ` in ${c.stylesheet}`
          : own ? " in its template's <style>" : ` in the <style> of ${c.stylesheet}`;
        li.appendChild(where);
        const classes = document.createElement("ul");
        classes.className = "rel-coupling-classes";
        for (const cls of c.classes) {
          const ci = document.createElement("li");
          const code = document.createElement("code");
          code.textContent = `.${cls.name}`;
          ci.appendChild(code);
          ci.append(" in ");
          const sel = document.createElement("code");
          sel.textContent = cls.selector;
          ci.appendChild(sel);
          classes.appendChild(ci);
        }
        li.appendChild(classes);
        list.appendChild(li);
      }
      container.appendChild(list);
    }

    // Helper: render a plain-text (non-navigable) group.
    function appendPlainGroup(
      label: string, ids: StyleModuleId[], container: HTMLElement, headingTag: "h3" | "h4" = "h3", emptyText = "none"
    ): void {
      const h = document.createElement(headingTag);
      h.className = "rel-group-heading";
      h.textContent = label;
      container.appendChild(h);
      if (ids.length === 0) {
        const empty = document.createElement("p");
        empty.className = "rel-empty";
        empty.textContent = emptyText;
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
    // A layout of a project with a website: the pages that render with it, and where each got its layout.
    if (relAvail.pages) {
      appendPlainGroup("Pages", relAvail.pages.map(p => {
        if (p.source === "generated") {
          const kind = p.generated.kind;
          const what = p.generated.term !== undefined ? `the page of the ${kind} "${p.generated.term}"` : `the index of the ${kind === "tag" ? "tags" : "categories"}`;
          return `${p.route} (${what}, from site.${kind}Pages)`;
        }
        return `${p.path} (${
          p.source === "own" ? "its own layout" : p.source === "default" ? "the default layout" : `childLayout of ${p.from ?? "its folder"}`
        })`;
      }), section);
    }

    // Style umbrella: its own stylesheets, the classes it borrows, the style couplings both ways, and the modules.
    const styleUmbrella = document.createElement("div");
    styleUmbrella.className = "rel-style-umbrella";
    const styleH = document.createElement("h3");
    styleH.className = "rel-group-heading rel-umbrella-heading";
    styleH.textContent = "Style";
    styleUmbrella.appendChild(styleH);
    appendPlainGroup("Stylesheet", (relAvail.stylesheets ?? []).map(sheet =>
      sheet.source === "inline" ? "its template's <style>"
        : sheet.source === "external" ? `${sheet.file} (on another host, not read)`
          : sheet.file), styleUmbrella, "h4", "None: no stylesheet is named after it");
    appendComponentGroup("Borrows classes from", relAvail.styleUses, styleUmbrella, "h4",
      "None: its template uses only its own classes and the base layer");
    appendCouplings("Styles classes of", relAvail.stylesClassesOf ?? [], styleUmbrella,
      "None: its stylesheets style only its own classes", true);
    appendCouplings("Its classes are styled by", relAvail.classesStyledBy ?? [], styleUmbrella,
      "None: no other component's stylesheet styles its classes", false);
    // "Style modules" surfaces two distinct relationships as one plain list (separable in the
    // payload): @use dependencies (styleUsesModules) + class-borrowed shared modules (styleModules).
    const styleModulesAll = [...new Set([
      ...(relAvail.styleUsesModules ?? []),
      ...(relAvail.styleModules ?? []),
    ])].sort();
    appendPlainGroup("Style modules",     styleModulesAll,                styleUmbrella, "h4");
    section.appendChild(styleUmbrella);

    // Leftovers: inline styles and utility classes, a sentence each; the classes no stylesheet defines, as chips
    // under a heading of their own.
    const unattributed = relAvail.unattributedClasses ?? [];
    if (relAvail.inlineStyles || relAvail.utilityClasses || unattributed.length > 0) {
      const chips = document.createElement("div");
      chips.className = "rel-chips";
      const note = (cls: string, label: string, text: string): void => {
        const p = document.createElement("p");
        p.className = `rel-note ${cls}`;
        const b = document.createElement("span");
        b.className = "rel-chip";
        b.textContent = label;
        p.append(b, ` ${text}`);
        chips.appendChild(p);
      };
      if (relAvail.inlineStyles) note("rel-chip--inline-styles", "Inline styles", "Its template has a style attribute or a <style> element.");
      if (relAvail.utilityClasses) note("rel-chip--utility-classes", "Utility classes", "Its template uses classes of a utility framework.");
      if (unattributed.length > 0) {
        const h = document.createElement("h4");
        h.className = "rel-group-heading rel-unattributed-heading";
        h.textContent = "Classes no stylesheet defines";
        chips.appendChild(h);
        for (const cls of unattributed) {
          const chip = document.createElement("span");
          chip.className = "rel-chip rel-chip--unattributed";
          chip.textContent = cls;
          chips.appendChild(chip);
        }
      }
      section.appendChild(chips);
    }

    dom.panelContent.appendChild(section);
    return;
  }
}

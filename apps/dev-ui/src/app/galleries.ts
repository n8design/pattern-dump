// The Stage's gallery views — every variant of one component, and a folder's overview.
//
// Split out of navigation.ts, where it had pushed the module past its size ceiling while being a
// separate concern: navigation decides WHAT to show, galleries RENDER a grid of live previews. The
// dependency runs one way — navigateVariants and navigateOverview call in here, and nothing here
// navigates. Gallery links are real <a href>s intercepted by app/wiring, never handled locally.
//
// In app/ rather than stage/ because each tile applies the active theme through rail/theme; a stage
// module importing a rail module is a cross-region edge.
//
// Each tile's iframe gets its own load listener to re-apply theme and height, because a gallery tile
// is a separate document and the main preview's listener does not reach it.

import type { FolderOverview } from "@pattern-dump/contracts";
import { previewUrl } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";
import { session } from "../core/session.js";
import { resourceUrl, routeHref } from "../core/runtime.js";
import { store } from "../core/store.js";
import { applyThemeToIframe } from "../rail/theme.js";
import { currentVpParam } from "../stage/viewport.js";
import { measureContentWidth } from "../stage/content-width.js";

export async function buildVariantsGallery(): Promise<void> {
  if (!session.current) return;
  dom.variantsGalleryEl.innerHTML = "";

  const gallery = document.createElement("div");
  gallery.className = "gallery";

  const currentTheme = store.local.theme;
  const allVariants: Array<{ name: string; variantParam: string | undefined }> = [
    { name: "default", variantParam: undefined },
    ...session.current.variants.map(v => ({ name: v.name, variantParam: v.name })),
  ];

  // Fetch all variant documents in parallel before building DOM — variant galleries are small
  // (default + 2-5 named variants) so upfront fetch doesn't regress load time.
  // Theme is passed so data-theme is baked pre-paint.
  const docs = await Promise.all(
    allVariants.map(v => fetch(previewUrl(session.current!.id, v.variantParam, currentTheme || undefined)).then(r => r.text()))
  );

  for (let i = 0; i < allVariants.length; i++) {
    const v = allVariants[i];
    const fig = document.createElement("figure");
    fig.className = "preview gallery-item";

    const isDefault = v.variantParam === undefined;
    const labelText = isDefault ? session.current.title : `${session.current.title} — ${v.name}`;
    const labelHref = isDefault
      ? `/${session.current.id}${currentVpParam()}`
      : `/${session.current.id}${currentVpParam()}#${encodeURIComponent(v.name)}`;

    const h2 = document.createElement("h2");
    h2.className = "gallery-label";
    const lnk = document.createElement("a");
    lnk.className = "gallery-label-link";
    lnk.href = labelHref;
    lnk.textContent = labelText;

    h2.appendChild(lnk);

    const f = document.createElement("iframe");
    f.title = labelText;
    f.srcdoc = docs[i];
    // data-pd-variant is the identity hook for per-tile srcdoc reload on JS changes.
    // "" = default variant (no ?v= param); named variants use their name.
    f.dataset.pdVariant = v.variantParam ?? "";
    f.addEventListener("load", () => {
      if (store.local.theme) applyThemeToIframe(f, store.local.theme);
      const h = f.contentDocument?.documentElement?.scrollHeight;
      if (typeof h === "number" && h > 0) f.style.setProperty("--vp-h", `${h}px`);
      measureContentWidth(f);
    });

    fig.appendChild(h2);
    fig.appendChild(f);
    gallery.appendChild(fig);
  }

  dom.variantsGalleryEl.appendChild(gallery);
}

export function renderOverview(overview: FolderOverview): void {
  dom.categoryOverview.innerHTML = "";
  if (overview.doc) {
    const docDiv = document.createElement("div");
    docDiv.className = "overview-doc";
    docDiv.innerHTML = overview.doc;
    dom.categoryOverview.appendChild(docDiv);
  }
  if (overview.components.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No components found.";
    dom.categoryOverview.appendChild(p);
    return;
  }
  const gallery = document.createElement("div");
  gallery.className = "gallery";
  for (const item of overview.components) {
    const fig = document.createElement("figure");
    fig.className = "preview gallery-item";
    if (item.source) fig.dataset.package = item.source;

    const h2 = document.createElement("h2");
    h2.className = "gallery-label";
    const lnk = document.createElement("a");
    lnk.className = "gallery-label-link";
    lnk.href = routeHref(`/${item.id}`);
    lnk.textContent = item.title;
    h2.appendChild(lnk);

    const f = document.createElement("iframe");
    f.title = item.title;
    f.addEventListener("load", () => {
      if (store.local.theme) applyThemeToIframe(f, store.local.theme);
      const h = f.contentDocument?.documentElement?.scrollHeight;
      if (typeof h === "number" && h > 0) f.style.setProperty("--vp-h", `${h}px`);
      measureContentWidth(f);
    });
    f.src = resourceUrl(previewUrl(item.id, undefined, store.local.theme || undefined));

    fig.appendChild(h2);
    fig.appendChild(f);
    gallery.appendChild(fig);
  }
  dom.categoryOverview.appendChild(gallery);
}

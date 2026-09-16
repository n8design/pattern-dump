// The Nav Rail's brand slot.
//
// Renders whatever the project declared under `shell.brand` in its config — a logo, a wordmark, or
// nothing at all. Pure rail chrome: it reads `dom` and the config value it is handed, and touches no
// other region.

import type { ShellBrandConfig } from "@pattern-dump/contracts";
import { dom } from "../core/dom.js";


export function renderBrand(brand?: ShellBrandConfig | null): void {
  dom.railBrandEl.innerHTML = "";

  let inner: HTMLElement;
  if (typeof brand?.logo === "string") {
    const img = document.createElement("img");
    img.src = brand.logo;
    img.alt = brand.logoAlt ?? "";
    img.className = "rail-brand-logo";
    inner = img;
  } else if (brand?.logo && typeof brand.logo === "object") {
    const picture = document.createElement("picture");
    const source = document.createElement("source");
    source.media = "(prefers-color-scheme: dark)";
    source.srcset = brand.logo.dark;
    const img = document.createElement("img");
    img.src = brand.logo.light;
    img.alt = brand.logoAlt ?? "";
    picture.appendChild(source);
    picture.appendChild(img);
    inner = picture;
  } else {
    const span = document.createElement("span");
    span.className = "rail-brand-title";
    span.textContent = brand?.title ?? "Pattern Dump";
    inner = span;
  }

  if (brand?.href) {
    const a = document.createElement("a");
    a.href = brand.href;
    a.className = "rail-brand-link";
    a.appendChild(inner);
    dom.railBrandEl.appendChild(a);
  } else {
    dom.railBrandEl.appendChild(inner);
  }
}

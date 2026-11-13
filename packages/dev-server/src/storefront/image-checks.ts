// The checks on a storefront page's images, over the HTML of its body or its layout:
//
//   size      an <img> without both a width and a height: the page shifts when it loads. External images too.
//   raster    an <img> whose src or a srcset candidate is a raster file (JPEG, PNG, GIF, WebP, AVIF, TIFF, by
//             extension; or a data: URI of a raster type) not served by the image route (/_pd/images/): it is
//             served as it is, without its WebP variants. SVG is exempt.
//   external  an <img> from another site (http(s):// or //): Pattern Dump can't make variants of it, so it is
//             exempt from the raster check and reported once, for the build report's notes.
//
// <img> only: og:image and twitter:image stay the original file (decided), an icon is a <link>, and a stylesheet's
// url() has no variant mechanism, so there is no fix an error there could name. page.ts turns the findings into page
// problems in pd build and into warnings in pd dev.
import { parse } from "node-html-parser";
import { PD_ROUTE_PREFIX } from "@pattern-dump/contracts";

export interface ImageFinding { kind: "size" | "raster" | "external"; src: string }

const RASTER_EXT = /\.(jpe?g|png|gif|webp|avif|tiff?)$/i;
const RASTER_DATA = /^data:image\/(?!svg\+xml)[a-z0-9.+-]+[;,]/i;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** A URL without its query and fragment (a content stamp is `?v=…`). */
const pathOf = (url: string) => url.replace(/[?#].*$/, "");

/** The URLs of a srcset: the first word of each candidate. A data: URI holds commas, so it is taken whole. */
function srcsetUrls(srcset: string): string[] {
  if (srcset.trim().startsWith("data:")) return [srcset.trim().split(/\s+/)[0]!];
  return srcset.split(",").map(c => c.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

/** Every finding about the <img> elements of `html`, in document order. */
export function checkImages(html: string): ImageFinding[] {
  const findings: ImageFinding[] = [];
  for (const img of parse(html).querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    const width = img.getAttribute("width")?.trim();
    const height = img.getAttribute("height")?.trim();
    if (!width || !height) findings.push({ kind: "size", src });
    const reported = new Set<string>();
    for (const url of [src, ...srcsetUrls(img.getAttribute("srcset") ?? "")]) {
      if (url === "" || reported.has(url)) continue;
      reported.add(url);
      if (EXTERNAL.test(url)) { findings.push({ kind: "external", src: url }); continue; }
      if (url.startsWith("data:")) { if (RASTER_DATA.test(url)) findings.push({ kind: "raster", src: url }); continue; }
      const path = pathOf(url);
      if (path.startsWith(PD_ROUTE_PREFIX.images)) continue;
      if (RASTER_EXT.test(path)) findings.push({ kind: "raster", src: path });
    }
  }
  return findings;
}

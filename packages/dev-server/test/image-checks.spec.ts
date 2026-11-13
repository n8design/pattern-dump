// The checks on a storefront page's images (image-checks.ts): an <img> needs a width and a height, external or not;
// a raster image must come through the image route (/_pd/images/), as its WebP variants; SVG, image-route variants
// and external images are exempt from that, and an external image is reported as such.
import { describe, expect, it } from "vitest";
import { checkImages } from "../src/storefront/image-checks.js";

const kinds = (html: string) => checkImages(html).map(f => `${f.kind} ${f.src}`);

describe("checkImages", () => {
  it("passes what {{pd-image}} and prose images write, and a sized SVG", () => {
    expect(kinds(`<img src="/_pd/images/images/a.0123456789.960.webp" srcset="/_pd/images/images/a.0123456789.480.webp 480w, `
      + `/_pd/images/images/a.0123456789.960.webp 960w" sizes="auto, 100vw" width="960" height="640" alt="A">`)).toEqual([]);
    expect(kinds(`<img src="/assets/images/mark.svg?v=0123456789" width="48" height="24" alt="">`)).toEqual([]);
  });

  it("an <img> without both width and height, wherever it points", () => {
    expect(kinds(`<img src="/assets/images/mark.svg" alt="">`)).toEqual(["size /assets/images/mark.svg"]);
    expect(kinds(`<img src="/assets/images/mark.svg" width="48" alt="">`)).toEqual(["size /assets/images/mark.svg"]);
    expect(kinds(`<img src="/assets/images/mark.svg" width="" height="24" alt="">`)).toEqual(["size /assets/images/mark.svg"]);
    expect(kinds(`<img src="https://example.com/x.svg" alt="">`)).toEqual(["size https://example.com/x.svg", "external https://example.com/x.svg"]);
  });

  it("a raster that is not an image-route variant, in src or in any srcset candidate, stamped or not", () => {
    expect(kinds(`<img src="/assets/images/logo.png?v=0123456789" width="10" height="10" alt="">`))
      .toEqual(["raster /assets/images/logo.png"]);
    for (const ext of ["jpg", "JPEG", "gif", "webp", "avif", "tif"]) {
      expect(kinds(`<img src="/assets/x.${ext}" width="1" height="1" alt="">`)).toEqual([`raster /assets/x.${ext}`]);
    }
    expect(kinds(`<img src="/_pd/images/images/a.0123456789.480.webp" srcset="/assets/images/a.jpg 2x" width="1" height="1" alt="">`))
      .toEqual(["raster /assets/images/a.jpg"]);
    expect(kinds(`<img src="images/a.png" width="1" height="1" alt="">`)).toEqual(["raster images/a.png"]);
    expect(kinds(`<img src="data:image/png;base64,iVBOR" width="1" height="1" alt="">`)).toEqual(["raster data:image/png;base64,iVBOR"]);
    expect(kinds(`<img src="data:image/svg+xml,%3Csvg%2F%3E" width="1" height="1" alt="">`)).toEqual([]);
  });

  it("an external raster is exempt from the WebP check, and reported as external, once", () => {
    expect(kinds(`<img src="https://example.com/a.jpg" srcset="https://example.com/a.jpg 1x, //cdn.example.com/a@2x.jpg 2x" width="1" height="1" alt="">`))
      .toEqual(["external https://example.com/a.jpg", "external //cdn.example.com/a@2x.jpg"]);
  });

  it("looks at <img> only: og:image, icons and a stylesheet's url() are not its business", () => {
    expect(kinds(`<meta property="og:image" content="/assets/images/share.png"><link rel="icon" href="/assets/images/favicon.png">`
      + `<div style="background:url(/assets/images/bg.jpg)"></div>`)).toEqual([]);
  });
});

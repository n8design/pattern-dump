import { expect, type Page, type TestInfo } from "@playwright/test";

export const DEV_PORT = process.env["SF_DEV_PORT"] ?? "4300";
export const DEV = `http://live.localhost:${DEV_PORT}`;
export const WORKBENCH = `http://pd.localhost:${DEV_PORT}`;
export const STATIC = `http://127.0.0.1:${process.env["SF_STATIC_PORT"] ?? "4400"}`;
/** storefront.workbenchUrl in the bench's config: what built pages link to. */
export const BUILD_WORKBENCH_URL = "https://workbench.example.test/";
/** storefront.url in the bench's config: the address built pages give as their own. */
export const SITE_URL = "https://bench.example.test/";

/** Whether this test runs against pd dev (true) or the built root on a static host (false). */
export const isDev = (info: TestInfo): boolean => info.project.name === "storefront";

/** The page's DOM as markup, without pd dev's live-reload client. */
export const domWithoutLiveClient = (page: Page): Promise<string> => page.evaluate(() => {
  const d = document.documentElement.cloneNode(true) as HTMLElement;
  d.querySelectorAll("script[data-pd-live]").forEach(s => s.remove());
  return d.outerHTML;
});

/**
 * Every live example on the page has the height its preview reported: the fitter has written it (the frame no
 * longer has no inline height, or the 1px an undeclared frame starts at), and the frame's content box equals its
 * preview document's height. Until then a frame can grow, and whatever sits below it moves; wait for this
 * before clicking at or below an example.
 */
export const examplesFitted = (page: Page): Promise<void> => expect.poll(() =>
  page.locator("figure.doc-example iframe").evaluateAll(frames => frames.length > 0 && frames.every(node => {
    const f = node as HTMLIFrameElement;
    const doc = f.contentDocument;
    if (!doc || doc.URL === "about:blank" || f.style.height === "1px" || f.style.height === "") return false;
    const box = f.getBoundingClientRect().height - (f.offsetHeight - f.clientHeight);
    return Math.abs(box - doc.documentElement.scrollHeight) <= 1;
  }))).toBe(true);

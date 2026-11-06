import type { Page, TestInfo } from "@playwright/test";

export const DEV_PORT = process.env["SF_DEV_PORT"] ?? "4300";
export const DEV = `http://live.localhost:${DEV_PORT}`;
export const WORKBENCH = `http://pd.localhost:${DEV_PORT}`;
export const STATIC = `http://127.0.0.1:${process.env["SF_STATIC_PORT"] ?? "4400"}`;
/** storefront.workbenchUrl in the bench's config: what built pages link to. */
export const BUILD_WORKBENCH_URL = "https://workbench.example.test/";

/** Whether this test runs against pd dev (true) or the built root on a static host (false). */
export const isDev = (info: TestInfo): boolean => info.project.name === "storefront";

/** The page's DOM as markup, without pd dev's live-reload client. */
export const domWithoutLiveClient = (page: Page): Promise<string> => page.evaluate(() => {
  const d = document.documentElement.cloneNode(true) as HTMLElement;
  d.querySelectorAll("script[data-pd-live]").forEach(s => s.remove());
  return d.outerHTML;
});

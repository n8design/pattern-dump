// What pd build prints (buildReportLines): the social images' section, each page without a card as a warning under
// it, and the count of those pages next to last, written to be seen, above NOT CHECKED, which stays last.
import { describe, expect, it } from "vitest";
import type { StaticBuildReport } from "@pattern-dump/dev-server";
import { buildReportLines } from "./index.js";

const base: StaticBuildReport = {
  outDir: "/p/dist", basePath: "/", files: 10, bytes: 1024, components: 4, warnings: [], notes: ["a note"], borrowedStyles: 0, ms: 1200,
  storefront: { outDir: "/p/site", basePath: "/", pages: 5, files: 20, bytes: 2048 },
};
const W1 = (page: string) => `${page}: no social image: its card is missing or stale and Playwright isn't installed: run pd social, or install Playwright`;

describe("pd build's report: social images", () => {
  it("where each page's card came from, and nothing loud when every page has one", () => {
    const lines = buildReportLines({ ...base, socialImages: { pages: 5, rendered: 2, cached: 2, committed: 1, missing: [], siteImage: true } }, undefined);
    expect(lines).toContain("[pd build] social images: 5 pages (2 rendered, 2 from the cache, 1 committed)");
    expect(lines.some(l => l.includes("NO SOCIAL IMAGE"))).toBe(false);
  });

  it("each page without a card as a warning, and the count above NOT CHECKED, which stays last", () => {
    const lines = buildReportLines({
      ...base, skippedChecks: ["html"],
      socialImages: { pages: 5, rendered: 0, cached: 3, committed: 0, missing: [W1("guide/install.md"), W1("index.md")], siteImage: true },
    }, undefined);
    const at = lines.indexOf("[pd build] social images: 5 pages (3 from the cache, 2 without one:)");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 3)).toEqual([`[pd build]   warning: ${W1("guide/install.md")}`, `[pd build]   warning: ${W1("index.md")}`]);
    expect(lines.slice(-2)).toEqual([
      "[pd build] NO SOCIAL IMAGE: 2 pages use the site image instead (run pd social, or install Playwright)",
      "[pd build] NOT CHECKED: the components' markup against HTML's content model (html), as asked (--skip-checks or build.skipChecks)",
    ]);
  });

  it("without the site's image, says the pages have none; one page, said as one", () => {
    const one = buildReportLines({ ...base, socialImages: { pages: 1, rendered: 0, cached: 0, committed: 0, missing: [W1("index.md")], siteImage: false } }, undefined);
    expect(one).toContain("[pd build] social images: 1 page (1 without one:)");
    expect(one.at(-1)).toBe("[pd build] NO SOCIAL IMAGE: 1 page has no link-preview image (run pd social, or install Playwright)");
    const two = buildReportLines({ ...base, socialImages: { pages: 2, rendered: 0, cached: 0, committed: 0, missing: [W1("a.md"), W1("b.md")], siteImage: false } }, undefined);
    expect(two.at(-1)).toBe("[pd build] NO SOCIAL IMAGE: 2 pages have no link-preview image (run pd social, or install Playwright)");
    const site = buildReportLines({ ...base, socialImages: { pages: 1, rendered: 0, cached: 0, committed: 0, missing: [W1("index.md")], siteImage: true } }, undefined);
    expect(site.at(-1)).toBe("[pd build] NO SOCIAL IMAGE: 1 page uses the site image instead (run pd social, or install Playwright)");
  });
});

describe("pd build's report: mounts", () => {
  it("one line: the files and size of all mounts, then each mount's, in the config's order", () => {
    const lines = buildReportLines({ ...base, mounts: [
      { to: "/htwoo-core/", files: 550, bytes: 17.4 * 1024 * 1024 }, { to: "/", files: 1, bytes: 3 * 1024 },
    ] }, undefined);
    expect(lines.filter(l => l.includes("mounts"))).toEqual([
      "[pd build] mounts: 551 files (17.4 MB), copied as they are: /htwoo-core/ 550 files (17.4 MB), / 1 file (3 KB)"]);
  });

  it("no line without mounts", () => {
    expect(buildReportLines(base, undefined).some(l => l.includes("mounts"))).toBe(false);
  });
});

describe("pd build's report: a workbench it doesn't build", () => {
  const nowb: StaticBuildReport = { ...base, workbench: false };
  it("names where the pages link to it", () => {
    expect(buildReportLines(nowb, "https://wb.example.test/")[0])
      .toBe("[pd build] workbench: not built (build.workbench: false); the pages link to it at https://wb.example.test/");
  });
  it("says the pages link to none without site.workbenchUrl", () => {
    expect(buildReportLines(nowb, undefined)[0])
      .toBe("[pd build] workbench: not built (build.workbench: false), and the pages link to none (no site.workbenchUrl)");
  });
});

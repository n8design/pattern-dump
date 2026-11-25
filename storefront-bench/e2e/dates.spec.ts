// A page's dates, as the doc layout shows them, read off the rendered DOM in pd dev and the built root: page.created
// from git (the page's first commit), page.updated from the page's own `updated:`. Git's last commit is shown nowhere:
// a typo fix moves it. The bench's pages are committed in Pattern Dump's own history, so the expected dates are read
// from git here, at test time (the author date). Neither page has been renamed, so a plain log of its path is its
// whole history.
import { expect, test } from "./fixtures.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bench = fileURLToPath(new URL("../", import.meta.url));
/** A day as the bench writes it for readers: its lang is the default, "en", in the long style. */
const asText = (iso: string): string =>
  new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const commits = (page: string): string[] =>
  execFileSync("git", ["log", "--format=%aI", "--", `pages/${page}`], { cwd: bench, encoding: "utf8" }).split("\n").filter(Boolean);

for (const [route, file, updated] of [["/guides/setup/", "guides/setup.md", "2026-11-15"], ["/about/", "about.md", null]] as const) {
  test(`${route} shows its first commit and ${updated ? "its own updated date" : "no updated date"}, never git's last commit`, async ({ page }) => {
    const log = commits(file);
    expect(log.length).toBeGreaterThan(0);
    await page.goto(route);
    await expect(page.locator(".doc-created")).toHaveAttribute("datetime", log.at(-1)!);
    // As text, the author's day of the first commit (the first ten characters, in the author's own offset).
    await expect(page.locator(".doc-created")).toHaveText(asText(log.at(-1)!));
    if (updated) {
      await expect(page.locator(".doc-updated")).toHaveAttribute("datetime", updated);
      await expect(page.locator(".doc-updated")).toHaveText(asText(updated));
    } else await expect(page.locator(".doc-updated")).toHaveCount(0);
    // Git's last commit, when it isn't the first, is nowhere on the page; nor are the layout's sample dates.
    if (log.length > 1) expect(await page.content()).not.toContain(log[0]!);
    await expect(page.locator("body")).not.toContainText("2026-01-10T10:00:00+01:00");
    await expect(page.locator("body")).not.toContainText("2026-03-20");
    await expect(page.locator("body")).not.toContainText("January 10, 2026");
    await expect(page.locator("body")).not.toContainText("March 20, 2026");
  });
}

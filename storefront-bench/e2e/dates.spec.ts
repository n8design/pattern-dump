// A page's dates from git, as the doc layout shows them from page.created and page.modified, read off the
// rendered DOM in pd dev and the built root. The bench's pages are committed in Pattern Dump's own history,
// so the expected dates are read from git here, at test time: the first and the last commit of each page
// (its author date). Neither page has been renamed, so a plain log of its path is its whole history.
import { expect, test } from "./fixtures.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bench = fileURLToPath(new URL("../", import.meta.url));
const commits = (page: string): string[] =>
  execFileSync("git", ["log", "--format=%aI", "--", `pages/${page}`], { cwd: bench, encoding: "utf8" }).split("\n").filter(Boolean);

for (const [route, file] of [["/guides/setup/", "guides/setup.md"], ["/about/", "about.md"]] as const) {
  test(`${route} shows when its page was first and last committed`, async ({ page }) => {
    const log = commits(file);
    expect(log.length).toBeGreaterThan(0);
    await page.goto(route);
    await expect(page.locator(".doc-created")).toHaveAttribute("datetime", log.at(-1)!);
    await expect(page.locator(".doc-modified")).toHaveAttribute("datetime", log[0]!);
    // Never the layout's sample dates.
    await expect(page.locator("body")).not.toContainText("2026-01-10T10:00:00+01:00");
  });
}


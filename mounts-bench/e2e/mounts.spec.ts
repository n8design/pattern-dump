// The mounts as a browser loads them, in pd dev and in the built site at / and under /bench/: a mounted page paints
// with its own stylesheet, image and script, the root files load, and a link from the site's page reaches the mount.
// Read off the rendered page, not the served bytes (the unit specs compare those).
import { expect, test } from "@playwright/test";

test("the site's page links into a mount, and the mounted page is the tool's", async ({ page }, info) => {
  const prefix = info.project.name === "mounts-static-base" ? "/bench" : "";
  await page.goto(`${prefix}/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mounts bench");
  await page.getByRole("link", { name: "tool's pages" }).click();
  await expect(page).toHaveURL(new RegExp(`${prefix}/tool/$`));
  await expect(page).toHaveTitle("The tool");
});

test("a mounted page with relative links paints with its own stylesheet, wherever the site is", async ({ page }, info) => {
  const prefix = info.project.name === "mounts-static-base" ? "/bench" : "";
  await page.goto(`${prefix}/tool/guide/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The guide");
  // The tool's style.css, through ../style.css: the font it sets, as painted.
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe("sans-serif");
  await page.getByRole("link", { name: "A page of it" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A page of the guide");
});

test("a mounted page with links from the root loads its image and runs its script, at the site's root", async ({ page }, info) => {
  // The tool wrote /tool/style.css, /tool/logo.png and /tool/app.js from the host's root: under /bench/ they are not
  // there, which is the tool's to fix (byte for byte), so this is checked where they are.
  test.skip(info.project.name === "mounts-static-base", "the tool's own root-relative links assume the host's root");
  await page.goto("/tool/");
  const logo = page.getByRole("img", { name: "The tool's logo" });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => [img.complete, img.naturalWidth])).toEqual([true, 4]);
  await expect(page.locator("html")).toHaveAttribute("data-tool", "ready");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toContain("/tool/logo.png");
});

test("the root files load, with pd dev's content types", async ({ page }, info) => {
  const prefix = info.project.name === "mounts-static-base" ? "/bench" : "";
  await page.goto(`${prefix}/`);
  for (const [path, type] of [["/favicon.ico", "image/x-icon"], ["/manifest.webmanifest", "application/manifest+json"], ["/123456/x.css", "text/css"]]) {
    const res = await page.request.get(`${new URL(page.url()).origin}${prefix}${path}`);
    expect(res.status(), path).toBe(200);
    // A static host's types are its own (here the suite's file server); pd dev's are Pattern Dump's.
    if (info.project.name === "mounts-dev") expect(res.headers()["content-type"], path).toBe(type);
  }
});

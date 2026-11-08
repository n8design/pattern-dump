// A change made while a page's live-reload socket is not yet open reaches no socket of the page; the page
// still reloads, once, when the socket opens: `hello` says the current generation, the page's own is
// behind it. The socket is held with page.routeWebSocket until the change has been handled (the server's
// generation has moved past the page's), then let through. The spec writes into the bench's stylesheets
// and restores them after the test.
import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PD_GENERATION_HEADER, generationBehind } from "@pattern-dump/contracts";

const nav = fileURLToPath(new URL("../src/styles/partials/nav.scss", import.meta.url));
let original = "";

test.beforeEach(async () => { original = await readFile(nav, "utf8"); });
test.afterEach(async ({ page }) => {
  const before = (await page.request.get("/api/version")).headers()[PD_GENERATION_HEADER.toLowerCase()];
  await writeFile(nav, original);
  // Let the restore be handled before the next spec.
  await expect.poll(async () => generationBehind(before, (await page.request.get("/api/version")).headers()[PD_GENERATION_HEADER.toLowerCase()]), { timeout: 10_000 }).toBe(true);
});

test("a change sent before the page's socket opened reloads the page once the socket opens", async ({ page }) => {
  let release = (): void => {};
  const opened = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.routeWebSocket(/:\d+\/?$/, async ws => {
    if (!held) { held = true; await opened; }
    ws.connectToServer();
  });

  await page.goto("/about/");
  await expect(page.locator("h1")).toHaveText("About");
  const generation = await page.evaluate(() => /var g="([^"]*)"/.exec(document.querySelector("script[data-pd-live]")?.textContent ?? "")?.[1] ?? "");
  expect(generation).not.toBe("");

  // The change, handled while the socket is held: its reload message reaches no socket of this page.
  await writeFile(nav, `${original}\n.site-nav-list {\n  color: rgb(9, 8, 7);\n}\n`);
  await expect.poll(async () => generationBehind(generation, (await page.request.get("/api/version")).headers()[PD_GENERATION_HEADER.toLowerCase()]), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator(".site-nav-list")).not.toHaveCSS("color", "rgb(9, 8, 7)");

  // The socket opens: hello says the page is behind, and it reloads, once.
  await page.evaluate(() => { (window as unknown as { stale: boolean }).stale = true; });
  let navigations = 0;
  page.on("framenavigated", f => { if (f === page.mainFrame()) navigations++; });
  release();
  await expect.poll(() => page.evaluate(() => !(window as unknown as { stale?: boolean }).stale).catch(() => false), { timeout: 10_000 }).toBe(true);
  await expect(page.locator(".site-nav-list")).toHaveCSS("color", "rgb(9, 8, 7)");
  // The reloaded page took the current generation: no second reload.
  await page.waitForTimeout(1_500);
  expect(navigations).toBe(1);
});

test("one change that sends several reload messages reloads the page once", async ({ page }) => {
  const svg = fileURLToPath(new URL("../src/assets/images/bench-blocks.svg", import.meta.url));
  const before = await readFile(svg, "utf8");
  // A component open in the workbench: an asset change then sends its reload too, and one per page.
  await page.request.get(`http://127.0.0.1:${process.env["SF_DEV_PORT"] ?? "4300"}/api/component/components/callout`);
  await page.goto("/about/");
  await expect(page.locator("h1")).toHaveText("About");
  let navigations = 0;
  page.on("framenavigated", f => { if (f === page.mainFrame()) navigations++; });
  try {
    await writeFile(svg, `${before}<!-- changed -->\n`);
    await expect.poll(() => navigations, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.locator("h1")).toHaveText("About");
    // Its socket reopened after the reload; hello finds it current: no second reload.
    await page.waitForTimeout(2_000);
    expect(navigations).toBe(1);
  } finally {
    await writeFile(svg, before);
  }
});

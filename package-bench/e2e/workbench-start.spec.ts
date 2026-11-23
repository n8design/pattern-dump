// The workbench opens on its start item (config shell.start: molecules/card) at its root, in pd dev and in the static
// build: the URL names the item, its preview renders, and Back doesn't return to an empty root. Read off the rendered
// page. pd dev is the suite's own (port 4800); the static workbench is the one the suite builds, served here.
import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freePort } from "../../packages/dev-server/test/free-ports.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const DEV = `http://localhost:${process.env["PB_DEV_PORT"] ?? "4800"}`;
const WORKBENCH_OUT = path.join(os.tmpdir(), "pd-e2e-package-bench-workbench");

async function opensOnStart(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/`);
  await expect(page).toHaveURL(`${base}/molecules/card`);
  await expect(page.locator(".preview-caption")).toHaveText("molecules/card");
  const frame = page.frameLocator("#preview-frame");
  await expect(frame.locator(".ds-card")).toBeVisible();
  const box = await page.locator("#preview-frame").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(0);
  // shell.inset: 0, so the card sits flush in its frame.
  await expect(page.locator("#preview-frame")).toHaveCSS("padding-top", "0px");
}

test("pd dev: the root opens the start item", async ({ page }) => {
  await page.goto("about:blank");
  await opensOnStart(page, DEV);
  // The root was replaced, not added: Back leaves the workbench.
  await page.goBack();
  await expect(page).toHaveURL("about:blank");
});

test.describe("the static workbench", () => {
  let server: ChildProcess;
  let base = "";
  test.beforeAll(async () => {
    const port = await freePort();
    server = spawn(process.execPath, [path.join(repo, "apps/dev-ui/e2e/static-server.mjs"), "--dir", WORKBENCH_OUT, "--base", "/", "--port", String(port)]);
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/`)).ok) break; } catch { /* not up */ }
      await new Promise(r => setTimeout(r, 100));
    }
  });
  test.afterAll(() => { server?.kill(); });

  test("the root opens the start item", async ({ page }) => {
    await opensOnStart(page, base);
  });
});

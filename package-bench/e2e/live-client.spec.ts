// The demo's setup: a site whose design system is a linked pattern package (a file: dependency), published under
// a path (storefront.url ".../sub/"), with a site page open in pd dev. A change to the linked package, or to the
// page itself, shows on the open page with no manual refresh, read off the rendered DOM:
//   - under the base path: the package's base-layer stylesheet, and the page's own markdown (each sent as a
//     page-changed for a site route, which the page must match with its path under /sub/);
//   - after pd dev restarts while the page is open: the package's component template (the page's socket went
//     with the old process; the page connects again).
// Its own pd dev, the CLI as a person runs it, on free ports, with the bench's config under the path (--config).
// The spec writes into the bench and restores every file afterwards.
import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import benchConfig from "../pattern-dump.config.js";
import { freePort } from "../../packages/dev-server/test/free-ports.js";
import { save } from "../../test-support/save.js";

const bench = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../../packages/cli/dist/index.js", import.meta.url));
const at = (rel: string) => join(bench, rel);
const CHANGED = [
  "vendor/fixture-ds/patterns/molecules/card/card.hbs", "vendor/fixture-ds/styles/base/reset.scss", "pages/index.md",
];
const originals = new Map<string, string>();

let tmp = "";
let configFile = "";
let ports = { port: 0, wsPort: 0 };
let dev: ChildProcess | undefined;

/** Rewrite a file: `change` replaced by `to`, which must be there. */
async function edit(rel: string, change: string, to: string): Promise<void> {
  const text = await readFile(at(rel), "utf8");
  if (!text.includes(change)) throw new Error(`${rel} has no "${change}"`);
  await save(at(rel), text.replace(change, to));
}

/** `pd dev` on the bench, on `ports`; resolves once it says it is ready. */
function startDev(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [cli, "dev", "--root", bench, "--config", configFile,
    "--port", String(ports.port), "--ws-port", String(ports.wsPort)], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  return new Promise((resolve, reject) => {
    child.stdout!.on("data", (d: Buffer) => { out += String(d); if (out.includes("Ready in")) resolve(child); });
    child.stderr!.on("data", (d: Buffer) => { out += String(d); });
    child.on("exit", code => reject(new Error(`pd dev exited (${code}):\n${out}`)));
  });
}

/** Stop `pd dev` as Ctrl-C does, and wait until the process is gone. */
async function stopDev(): Promise<void> {
  const child = dev;
  dev = undefined;
  if (!child || child.exitCode !== null) return;
  const gone = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGINT");
  await gone;
}

/** The site's home page, open, its card's preview loaded. */
async function openHome(page: Page): Promise<void> {
  await page.goto(`http://live.localhost:${ports.port}/sub/`);
  await expect(page.frameLocator("figure.doc-example iframe").locator(".ds-card")).toBeVisible();
}

test.beforeAll(async () => {
  for (const rel of CHANGED) originals.set(rel, await readFile(at(rel), "utf8"));
  tmp = await mkdtemp(join(tmpdir(), "pd-e2e-live-client-"));
  configFile = join(tmp, "pattern-dump.config.json");
  await save(configFile, JSON.stringify({
    ...benchConfig, storefront: { ...benchConfig.storefront, url: "https://package-bench.example.test/sub/" },
  }));
  ports = { port: await freePort(), wsPort: await freePort() };
  dev = await startDev();
});
test.afterAll(async () => {
  for (const [rel, text] of originals) await save(at(rel), text);
  await stopDev();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

test("under a base path, a change to the linked package's base layer and to the page shows on the open page", async ({ page }) => {
  test.setTimeout(60_000);
  await openHome(page);
  await expect(page.locator("body")).toHaveCSS("letter-spacing", "normal");
  await edit("vendor/fixture-ds/styles/base/reset.scss", "margin: 0;", "margin: 0;\n  letter-spacing: 2px;");
  await expect(page.locator("body")).toHaveCSS("letter-spacing", "2px", { timeout: 15_000 });

  await edit("pages/index.md", "Its layout is the skin's", "Its layout, edited while open, is the skin's");
  await expect(page.locator("body")).toContainText("Its layout, edited while open, is the skin's", { timeout: 15_000 });
});

test("after pd dev restarts with the page open, a change to the linked package's component shows on it", async ({ page }) => {
  test.setTimeout(90_000);
  await openHome(page);
  // Stopped and started again on the same ports, as a person does.
  await stopDev();
  dev = await startDev();
  await edit("vendor/fixture-ds/patterns/molecules/card/card.hbs", `<div class="ds-card">`, `<div class="ds-card" data-v="restarted">`);
  await expect(page.frameLocator("figure.doc-example iframe").locator(`.ds-card[data-v="restarted"]`)).toBeVisible({ timeout: 15_000 });
});

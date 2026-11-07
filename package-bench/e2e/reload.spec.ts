// One running pd dev, never restarted, and two pages open in a real browser: the workbench (pd.localhost)
// and the storefront home page (live.localhost), which embeds the design system's card. Each edit to a
// linked package, through its real folder vendor/ (and once through node_modules/), must reach both
// pages, read off the rendered DOM. The spec writes into the bench and restores every file afterwards.
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEV_PORT = process.env["PB_DEV_PORT"] ?? "4800";
const WORKBENCH = `http://pd.localhost:${DEV_PORT}`;
const STOREFRONT = `http://live.localhost:${DEV_PORT}`;
const bench = fileURLToPath(new URL("../", import.meta.url));
const repo = join(bench, "..");
const at = (rel: string) => join(bench, rel);

// Every file the spec changes, as it was, and every file it adds.
const CHANGED = [
  "vendor/fixture-ds/patterns/molecules/card/card.hbs", "vendor/fixture-ds/patterns/molecules/card/card.json",
  "vendor/fixture-ds/styles/molecules/card.scss", "vendor/fixture-ds/styles/base/reset.scss",
  "vendor/fixture-ds/themes/light.theme.scss", "vendor/fixture-ds/assets/pd-fixture-ds/dot.svg",
  "vendor/fixture-skin/patterns/layouts/page/page.hbs", "vendor/fixture-ds/helpers/index.ts", "pages/index.md",
];
const ADDED = ["vendor/fixture-ds/patterns/atoms/tag"];
const originals = new Map<string, string>();

/** Rewrite a file in place: `change` replaced by `to`, which must be there. */
async function edit(rel: string, change: string, to: string): Promise<void> {
  const text = await readFile(at(rel), "utf8");
  if (!text.includes(change)) throw new Error(`${rel} has no "${change}"`);
  await writeFile(at(rel), text.replace(change, to));
}
/** A new file, written beside the bench and renamed into place, so it appears complete in one event. */
async function create(rel: string, text: string): Promise<void> {
  const staged = join(bench, ".out", `staged-${Date.now()}`);
  await mkdir(dirname(staged), { recursive: true });
  await writeFile(staged, text);
  await mkdir(dirname(at(rel)), { recursive: true });
  await rename(staged, at(rel));
}
/** The design system's helpers, compiled again from their source, as its own build does. */
function rebuildHelpers(): void {
  execFileSync(join(repo, "node_modules", ".bin", "esbuild"), [
    "vendor/fixture-ds/helpers/index.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=vendor/fixture-ds/dist/helpers.js",
  ], { cwd: bench, stdio: "pipe" });
}

test.beforeAll(async () => { for (const rel of CHANGED) originals.set(rel, await readFile(at(rel), "utf8")); });
test.afterAll(async () => {
  for (const [rel, text] of originals) await writeFile(at(rel), text);
  for (const rel of ADDED) await rm(at(rel), { recursive: true, force: true });
  rebuildHelpers();
});

/** The card as each open page shows it: the workbench's preview, and the storefront page's frame. */
const workbenchCard = (page: Page): FrameLocator => page.frameLocator("#preview-frame");
const storefrontCard = (page: Page): FrameLocator => page.frameLocator(`figure.doc-example iframe[src="/preview/molecules/card"]`);

test("edits to linked packages reach the open workbench and storefront page, with no restart", async ({ browser }) => {
  test.setTimeout(180_000);
  const workbench = await (await browser.newContext()).newPage();
  const storefront = await (await browser.newContext()).newPage();
  await workbench.goto(`${WORKBENCH}/molecules/card`);
  await expect(workbenchCard(workbench).locator(".ds-card")).toBeVisible();
  await storefront.goto(`${STOREFRONT}/`);
  await expect(storefrontCard(storefront).locator(".ds-card")).toBeVisible();
  const both = (): FrameLocator[] => [workbenchCard(workbench), storefrontCard(storefront)];

  await test.step("a component template", async () => {
    await edit("vendor/fixture-ds/patterns/molecules/card/card.hbs", `<div class="ds-card">`, `<div class="ds-card" data-v="2">`);
    for (const f of both()) await expect(f.locator(`.ds-card[data-v="2"]`)).toBeVisible();
  });

  await test.step("its data", async () => {
    await edit("vendor/fixture-ds/patterns/molecules/card/card.json", `"title": "Card"`, `"title": "Card two"`);
    for (const f of both()) await expect(f.locator(".ds-card-title")).toHaveText("Card two");
  });

  await test.step("its data, through node_modules/", async () => {
    const text = await readFile(at("vendor/fixture-ds/patterns/molecules/card/card.json"), "utf8");
    await writeFile(join(repo, "node_modules", "pd-fixture-ds", "patterns", "molecules", "card", "card.json"), text.replace(`"Card two"`, `"Card three"`));
    for (const f of both()) await expect(f.locator(".ds-card-title")).toHaveText("Card three");
  });

  await test.step("its stylesheet", async () => {
    await edit("vendor/fixture-ds/styles/molecules/card.scss", "padding: 1rem;", "padding: 1.5rem;");
    for (const f of both()) await expect(f.locator(".ds-card")).toHaveCSS("padding-top", "24px");
  });

  await test.step("a base-layer file", async () => {
    await edit("vendor/fixture-ds/styles/base/reset.scss", "margin: 0;", "margin: 0;\n  letter-spacing: 0.1em;");
    for (const f of both()) await expect(f.locator("body")).not.toHaveCSS("letter-spacing", "normal");
    // The storefront page links the base layer itself, too.
    await expect(storefront.locator("body")).not.toHaveCSS("letter-spacing", "normal");
  });

  await test.step("a theme", async () => {
    await edit("vendor/fixture-ds/themes/light.theme.scss", "--ds-ink: #111;", "--ds-ink: rgb(10 20 30);");
    for (const f of both()) await expect(f.locator("body")).toHaveCSS("color", "rgb(10, 20, 30)");
  });

  await test.step("an asset referenced from CSS", async () => {
    // Both pages load it again, with its new bytes (it is a background in the chip's stylesheet).
    const fresh = (page: Page) => page.waitForResponse(async r => r.url().endsWith("/assets/pd-fixture-ds/dot.svg") && (await r.text()).includes("data-v2"));
    const loaded = [fresh(workbench), fresh(storefront)];
    await edit("vendor/fixture-ds/assets/pd-fixture-ds/dot.svg", "<svg ", `<svg data-v2="" `);
    await Promise.all(loaded);
  });

  await test.step("a new component", async () => {
    // The storefront page embeds a component that is not there yet: a listed problem, until it arrives.
    await edit("pages/index.md", "```pattern molecules/card\n```\n", "```pattern molecules/card\n```\n\n```pattern atoms/tag\n```\n");
    await expect(storefront.locator("body")).toContainText("atoms/tag");
    await expect(storefront.locator(`iframe[src="/preview/atoms/tag"]`)).toHaveCount(0);
    await create("vendor/fixture-ds/patterns/atoms/tag/tag.hbs", `<b class="ds-tag">new tag</b>\n`);
    // The workbench's tree lists it (inside the atoms folder, collapsed or not).
    await expect(workbench.locator(`.sidebar-tree a.tree-link[href="/atoms/tag"]`)).toBeAttached();
    await expect(storefront.frameLocator(`iframe[src="/preview/atoms/tag"]`).locator(".ds-tag")).toHaveText("new tag");
  });

  await test.step("a skin layout", async () => {
    await workbench.goto(`${WORKBENCH}/layouts/page`);
    await expect(workbench.frameLocator("#preview-frame").locator(".sk-page")).toBeVisible();
    await edit("vendor/fixture-skin/patterns/layouts/page/page.hbs", `<main class="sk-page">`, `<main class="sk-page" data-v="2">`);
    await expect(workbench.frameLocator("#preview-frame").locator(`.sk-page[data-v="2"]`)).toBeVisible();
    await expect(storefront.locator(`.sk-page[data-v="2"]`)).toBeVisible();
  });

  await test.step("a compiled helper, rebuilt into dist/", async () => {
    await workbench.goto(`${WORKBENCH}/molecules/card`);
    await expect(workbenchCard(workbench).locator(".ds-chip")).toHaveText("DS:In a card");
    await edit("vendor/fixture-ds/helpers/index.ts", "return `DS:${String(label)}`;", "return `DS2:${String(label)}`;");
    rebuildHelpers();
    for (const f of both()) await expect(f.locator(".ds-chip")).toHaveText("DS2:In a card");
  });
});

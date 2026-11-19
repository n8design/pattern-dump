// HMR error surfacing.
//
// Covers a path that had NO test and was silently broken: the server pushes
// { type:"error", scope:"build", message:"SCSS error: …" } with NO componentId, and the client's
// error branch was gated on componentId — so a broken .scss produced nothing in the UI at all. It
// reached only the dev-server's terminal.
//
// Writes into the git-tracked test-bench, like the other HMR specs, and restores in a finally.

import { test, expect } from "@playwright/test";
import { gotoComponent } from "./helpers.js";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { save, saveInTwoSteps } from "../../../test-support/save.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testBench = path.resolve(__dirname, "../../../test-bench");
const scss = path.join(testBench, "src/styles/01-atoms/button.scss");

const consoleLines = "#dock-panel-console .console p";

test.describe("HMR — build errors reach the Console", () => {
  test.describe.configure({ retries: 2 });

  test("a broken .scss surfaces a build error, not silence", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoComponent(page, "atoms/button");
    await page.click("#dock-tab-console");
    await expect(page.locator("#dock-panel-console")).not.toHaveAttribute("hidden", /.*/);

    const original = await readFile(scss, "utf8");
    try {
      // Unclosed brace + unknown function: sass cannot compile this.
      await save(scss, `${original}\n.pd-broken { color: ; `);

      // Scoped to build errors: test-bench carries a real handle collision, which is also an error
      // line on the Console from the moment the page connects (see the startup-collision test).
      const errorLine = page.locator(`${consoleLines}[data-level="error"]`, { hasText: "Build error" });
      await expect(errorLine.first()).toBeAttached({ timeout: 20_000 });
      // The server's formatted message must actually reach the user, not just a generic label.
      await expect(errorLine.first()).toContainText(/SCSS/i);
    } finally {
      await save(scss, original);
      // Let the restore's own watcher event land so it cannot leak into the next spec.
      await page.waitForTimeout(1500);
    }
  });

  // A collision found at STARTUP happens before any browser is connected, so a plain push reaches
  // nobody. The hotreloader retains the current collisions and replays them to each new connection.
  // test-bench ships one: atoms/baseless-2/baseless-2.hbs and atoms/baseless/baseless-2.hbs.
  test("a collision present at startup is on the Console after a fresh load", async ({ page }) => {
    await gotoComponent(page, "atoms/button");
    await page.click("#dock-tab-console");
    const line = page.locator(`${consoleLines}[data-level="error"]`, { hasText: "atoms-baseless-2" });
    await expect(line).toHaveCount(1, { timeout: 10_000 });
    await expect(line).toContainText("baseless/baseless-2.hbs");
  });

  // A collision quarantines a component OUT of the tree. The server pushed a CollisionMessage, but the
  // client had no branch for it, so the component simply vanished with no explanation on screen.
  test("a handle collision surfaces both paths on the Console", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoComponent(page, "atoms/button");
    await page.click("#dock-tab-console");

    // atoms/<slug> and atoms/<slug>-group/<slug> derive the same handle, atoms-<slug>.
    const slug = `collide-${Date.now()}`;
    const atoms = path.join(testBench, "src/patterns/atoms");
    const flat = path.join(atoms, `${slug}.hbs`);
    const groupDir = path.join(atoms, `${slug}-group`);
    try {
      await save(flat, `<p>${slug}</p>\n`);
      await mkdir(groupDir, { recursive: true });
      // In place, as on main: renamed into a folder made a moment ago, a file can be missed by the watcher
      // (open: fix/watcher-new-folder). Back to save() once that is fixed.
      await saveInTwoSteps(path.join(groupDir, `${slug}.hbs`), `<p>${slug} nested</p>\n`);

      const line = page.locator(`${consoleLines}[data-level="error"]`, { hasText: `atoms-${slug}` });
      await expect(line.first()).toBeAttached({ timeout: 20_000 });
      await expect(line.first()).toContainText(/Handle collision/);
      await expect(line.first()).toContainText(`${slug}-group`);
    } finally {
      await rm(flat, { force: true });
      await rm(groupDir, { recursive: true, force: true });
      await page.waitForTimeout(1500);
    }
  });

  // A data variant with no base template to overlay is left out of the tree. Until 0.7.0 nothing said so; now the
  // server reports it like a collision, naming the data file and the template it needs.
  test("a data variant with no base template is named on the Console", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoComponent(page, "atoms/button");
    await page.click("#dock-tab-console");

    const slug = `orphan-${Date.now()}`;
    const variant = path.join(testBench, "src/patterns/atoms", `${slug}~loud.json`);
    try {
      await save(variant, `{ "tone": "loud" }\n`);
      // A warning, not an error: nothing breaks, the variant just doesn't appear.
      const line = page.locator(`${consoleLines}[data-level="warn"]`, { hasText: `${slug}~loud.json` });
      await expect(line.first()).toBeAttached({ timeout: 20_000 });
      await expect(line.first()).toContainText(`${slug}.hbs`);
      await expect(line.first()).toContainText("left out");
      await expect(line.first()).toHaveText(/^Warning: Data variant left out: /);
      await expect(page.locator(`${consoleLines}[data-level="error"]`, { hasText: `${slug}~loud.json` })).toHaveCount(0);
      // The rendered line, under the OS's light and dark setting: the text is the normal ink at 4.5:1 or more on the
      // Console's ground (the word carries the meaning, not colour), and the marker paints in --pd-warning.
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        const painted = await line.first().evaluate((el: HTMLElement) => {
          // Any CSS colour (rgb(), oklch(), …) as sRGB 0–255 plus alpha 0–255: painted on a 1×1 canvas and read back.
          const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
          const rgb = (c: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
          const lum = (c: number[]) => {
            const [r, g, b] = c.slice(0, 3).map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
          };
          let ground = "";
          for (let n: Element | null = el; n && !ground; n = n.parentElement) {
            const bg = getComputedStyle(n).backgroundColor;
            if (bg && bg !== "transparent" && rgb(bg)[3] !== 0) ground = bg;
          }
          const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(rgb(ground || "rgb(255, 255, 255)"))];
          const probe = document.createElement("span");
          probe.style.borderLeft = "1px solid var(--pd-warning)";
          document.body.appendChild(probe);
          const warning = getComputedStyle(probe).borderLeftColor;
          probe.remove();
          const s = getComputedStyle(el);
          return {
            contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            inkIsBodyInk: s.color === getComputedStyle(el.parentElement!).color,
            borderStyle: s.borderInlineStartStyle, borderWidth: parseFloat(s.borderInlineStartWidth),
            borderColor: s.borderInlineStartColor, warning,
          };
        });
        expect(painted.contrast, colorScheme).toBeGreaterThanOrEqual(4.5);
        expect(painted.inkIsBodyInk, colorScheme).toBe(true);
        expect(painted.borderStyle, colorScheme).toBe("solid");
        expect(painted.borderWidth, colorScheme).toBeGreaterThanOrEqual(2);
        expect(painted.borderColor, colorScheme).toBe(painted.warning);
      }
    } finally {
      await rm(variant, { force: true });
      await page.waitForTimeout(1500);
    }
  });

  test("a healthy edit logs no error line", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoComponent(page, "atoms/button");
    await page.click("#dock-tab-console");

    // Standing errors (test-bench's startup collision) are already on the Console; the edit must add
    // none. Wait for the socket to have delivered them first, so the baseline is not taken early.
    const errors = page.locator(`${consoleLines}[data-level="error"]`);
    await expect(page.locator(consoleLines, { hasText: "HMR connected" })).toBeAttached();
    await expect(errors.first()).toBeAttached({ timeout: 10_000 });
    const before = await errors.count();

    const original = await readFile(scss, "utf8");
    try {
      await save(scss, `${original}\n/* harmless marker */\n`);
      // Give the watcher time to process a VALID edit; no error line may appear.
      await page.waitForTimeout(2500);
      await expect(errors).toHaveCount(before);
      await expect(page.locator(consoleLines, { hasText: "Build error" })).toHaveCount(0);
    } finally {
      await save(scss, original);
      await page.waitForTimeout(1500);
    }
  });
});

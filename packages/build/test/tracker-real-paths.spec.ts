// The Sass dependency tracker records a partial by its real path, so an edit the watcher reports at the
// real file finds the stylesheets that reached the partial through a link (a package's link in
// node_modules, as a `@use` into another package does).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSassDependencyTracker } from "../src/index.js";

let tmp = "";
let styles = "";
let partial = "";

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-tracker-real-"));
  const real = join(tmp, "vendor", "core");
  partial = join(real, "_tokens.scss");
  await mkdir(real, { recursive: true });
  await writeFile(partial, "$ink: red;\n");
  await mkdir(join(tmp, "node_modules"), { recursive: true });
  await symlink(real, join(tmp, "node_modules", "core"));
  styles = join(tmp, "styles");
  await mkdir(styles, { recursive: true });
  // Reached through the link, as Sass reaches another package's partial through node_modules.
  await writeFile(join(styles, "chip.scss"), `@use "../node_modules/core/tokens";\n.chip {\n  color: tokens.$ink;\n}\n`);
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("createSassDependencyTracker", () => {
  it("recompiles a stylesheet when the partial it reached through a link changes at its real path", async () => {
    const tracker = await createSassDependencyTracker([styles]);
    await writeFile(partial, "$ink: blue;\n");
    const { recompiledFiles, css } = await tracker.update(realpathSync(partial));
    expect(recompiledFiles).toEqual([join(styles, "chip.scss")]);
    expect(css).toContain("color: blue");
  });
});

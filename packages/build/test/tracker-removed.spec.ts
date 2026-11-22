// The Sass dependency tracker and a removed file (CR-024): a removed stylesheet leaves the combined CSS with no
// error of its own; a stylesheet that loaded a removed partial recompiles and fails with its own error. The temp
// folder is reached through a link on macOS (/var → /private/var), as a watcher may report it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSassDependencyTracker } from "../src/index.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-tracker-removed-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("createSassDependencyTracker, a removed file", () => {
  it("a stylesheet: its CSS leaves, and nothing fails", async () => {
    const styles = join(tmp, "a");
    await mkdir(styles, { recursive: true });
    await save(join(styles, "chip.scss"), ".chip {\n  color: red;\n}\n");
    await save(join(styles, "card.scss"), ".card {\n  color: blue;\n}\n");
    const tracker = await createSassDependencyTracker([styles]);
    await rm(join(styles, "chip.scss"));
    const { css, recompiledFiles, errors } = await tracker.update(join(styles, "chip.scss"));
    expect(css).not.toContain(".chip");
    expect(css).toContain(".card");
    expect(recompiledFiles).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("a partial: the stylesheet that used it fails with its own error", async () => {
    const styles = join(tmp, "b");
    await mkdir(styles, { recursive: true });
    await save(join(styles, "_tokens.scss"), "$gap: 1rem;\n");
    await save(join(styles, "card.scss"), `@use "tokens";\n.card {\n  padding: tokens.$gap;\n}\n`);
    const tracker = await createSassDependencyTracker([styles]);
    await rm(join(styles, "_tokens.scss"));
    const { errors } = await tracker.update(join(styles, "_tokens.scss"));
    expect(errors.map(e => e.file)).toEqual([join(styles, "card.scss")]);
  });
});

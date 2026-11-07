// The browser suite refuses to start when the bench's vendor/ or pages/ differ from git, and says how
// to restore them; on the committed bench it starts.
import { afterEach, describe, expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { guard, guardedStatus, refusal, RESTORE } from "../e2e/guard.js";

const stray = join(fileURLToPath(new URL("../vendor/fixture-ds/patterns/", import.meta.url)), "zz-guard-probe.hbs");
afterEach(async () => { await rm(stray, { force: true }); });

describe("the package bench's e2e guard", () => {
  it("lets the suite start when the guarded paths are as committed, and only then", () => {
    expect(refusal("")).toBeNull();
    const clean = guardedStatus() === "";
    if (clean) expect(() => guard()).not.toThrow();
    else expect(() => guard()).toThrow("differ from git");
  });

  it("refuses, naming each difference and the command that restores them", () => {
    expect(refusal(" M package-bench/vendor/fixture-ds/styles/molecules/card.scss\n?? package-bench/pages/zz.md\n")).toBe(
      "package-bench e2e: package-bench/vendor and package-bench/pages differ from git, so the suite would not start from the committed bench:\n"
      + "   M package-bench/vendor/fixture-ds/styles/molecules/card.scss\n  ?? package-bench/pages/zz.md\n"
      + `Restore them with:\n  ${RESTORE}`,
    );
    expect(RESTORE).toBe("git checkout -- package-bench/vendor package-bench/pages && git clean -fd -- package-bench/vendor package-bench/pages");
  });

  it("refuses on a real stray file in vendor/", async () => {
    await writeFile(stray, "<p>stray</p>\n");
    expect(() => guard()).toThrow(/package-bench e2e: .* differ from git[\s\S]*\?\? package-bench\/vendor\/fixture-ds\/patterns\/zz-guard-probe\.hbs[\s\S]*Restore them with/);
  });
});

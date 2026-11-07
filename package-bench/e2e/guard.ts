// The reload spec writes into vendor/ and pages/ and restores them afterwards. If an earlier run was
// stopped before it could, they differ from git, and a new run would start from the wrong files and
// restore the wrong ones. The suite refuses to start then, saying how to restore them.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARDED = ["package-bench/vendor", "package-bench/pages"];
export const RESTORE = `git checkout -- ${GUARDED.join(" ")} && git clean -fd -- ${GUARDED.join(" ")}`;

/** Why the suite must not start, from `git status --porcelain` on the guarded paths; null when clean. */
export function refusal(porcelain: string): string | null {
  const lines = porcelain.split("\n").filter(Boolean);
  if (!lines.length) return null;
  return `package-bench e2e: ${GUARDED.join(" and ")} differ from git, so the suite would not start from the `
    + `committed bench:\n${lines.map(l => `  ${l}`).join("\n")}\nRestore them with:\n  ${RESTORE}`;
}

/** `git status --porcelain` on the guarded paths, from the repo root. */
export function guardedStatus(): string {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return execFileSync("git", ["status", "--porcelain", "--", ...GUARDED], { cwd: repo, encoding: "utf8" });
}

/** Throw the refusal, if there is one. */
export function guard(): void {
  const why = refusal(guardedStatus());
  if (why) throw new Error(why);
}

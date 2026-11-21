// Per-root scratch directory.
//
// A LEAF. Derived artifacts (the diagnostics graph, CONFLICTS/FLATTENED reports) are written
// outside the subject tree — PD never writes into a root it is reading, which is what makes
// foreign-system rendering safe on a read-only checkout. The path is keyed by a hash of the
// resolved root so two projects never collide.
//
// It lives in the user's own cache folder, not the shared temp folder: there another user could create it first,
// plant a link in it, or write a clean audit for `pd audit` to reuse. ensureScratchDir creates it for the user
// only and checks it before anything reads or writes it.

import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** The platform's per-user cache folder: `%LOCALAPPDATA%` on Windows; elsewhere `$XDG_CACHE_HOME` when it is set
 *  to an absolute path, else `~/Library/Caches` (macOS) or `~/.cache`. */
export function userCacheDir(
  env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir(),
): string {
  if (platform === "win32") return env.LOCALAPPDATA || join(home, "AppData", "Local");
  const xdg = env.XDG_CACHE_HOME;
  if (xdg && isAbsolute(xdg)) return xdg;
  return platform === "darwin" ? join(home, "Library", "Caches") : join(home, ".cache");
}

export function pdScratchDir(root: string, cache: string = userCacheDir()): string {
  const key = createHash("sha1").update(resolve(root)).digest("hex").slice(0, 16);
  return join(cache, "pattern-dump", key);
}

/**
 * The scratch folder of `root`, created for this user only (0700) and checked: it and the `pattern-dump` folder
 * above it must each be a folder, not a link, and on POSIX owned by this user with no access for anyone else.
 * Throws, naming the folder, when one is not; nothing is written into or read from it then.
 */
export async function ensureScratchDir(root: string, cache: string = userCacheDir()): Promise<string> {
  const dir = pdScratchDir(root, cache);
  await mkdir(cache, { recursive: true });
  for (const folder of [dirname(dir), dir]) {
    await mkdir(folder, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
    const st = await lstat(folder);
    const refuse = (why: string): never => {
      throw new Error(`pd: the scratch folder ${folder} ${why}: remove it, and Pattern Dump creates it again for you alone`);
    };
    if (st.isSymbolicLink()) refuse("is a link");
    if (!st.isDirectory()) refuse("is not a folder");
    if (process.platform !== "win32") {
      if (process.getuid && st.uid !== process.getuid()) refuse("belongs to another user");
      if (st.mode & 0o022) refuse("can be written by other users");
      if (st.mode & 0o077) refuse("can be read by other users");
    }
  }
  return dir;
}

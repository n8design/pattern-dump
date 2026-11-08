// How a test writes a file: every suite, unit and end-to-end, writes through these two, never with a plain
// writeFile or appendFile (packages/dev-server/test/raw-writes-guard.spec.ts holds every test file to that).
//
// A file written in place is truncated, then written, and the OS may report that as one change or two: on
// Linux a reload or a rebuild can follow each. A test that means one save, and asserts what follows it, then
// fails at random. save() makes one save one event: the text is written to a staging file outside every
// watched folder, on the same filesystem, and renamed into place. saveInTwoSteps() is for a test whose point
// is the editor-style save, and which must hold whether it arrives as one event or two.
import { mkdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
// One staging folder per filesystem a test writes to: the repository's (its fixtures) and the temp folder's
// (the copies tests make). Neither is inside a folder any test watches.
const STAGING = [join(repo, "node_modules", ".cache", "pd-save"), join(tmpdir(), "pd-save")];
let staged = 0;

/** The device a path is on: its own, or its nearest existing ancestor's. */
async function deviceOf(path: string): Promise<number> {
  for (let p = path; ; p = dirname(p)) {
    try { return (await stat(p)).dev; } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || dirname(p) === p) throw err;
    }
  }
}

async function stagingFor(path: string): Promise<string> {
  const dev = await deviceOf(dirname(path));
  for (const dir of STAGING) {
    await mkdir(dir, { recursive: true });
    if ((await stat(dir)).dev === dev) return dir;
  }
  // Renamed across filesystems, the file would be copied in place, which is what save() exists to avoid.
  throw new Error(`save(${path}): no staging folder on its filesystem (tried ${STAGING.join(", ")})`);
}

/** Write `data` to `path` as one save: complete, in one event. Creates the folder it goes in. A path that is a
 *  link is saved to the file it links to, as an editor does, so the link stays a link. */
export async function save(path: string, data: string | Uint8Array): Promise<void> {
  const target = await realpath(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return path;
    throw err;
  });
  await mkdir(dirname(target), { recursive: true });
  const staging = join(await stagingFor(target), `${process.pid}-${staged++}`);
  await writeFile(staging, data);
  await rename(staging, target);
}

/** Write `data` to `path` in place, as an editor saves: truncated, then written. The OS may report it as one
 *  change or two, and a test that uses it must hold either way. */
export function saveInTwoSteps(path: string, data: string | Uint8Array): Promise<void> {
  return writeFile(path, data);
}

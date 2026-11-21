// Vitest global setup: the per-user cache folder, where Pattern Dump keeps each project's scratch folder
// (scratch.ts), is a temporary one for the run. Tests audit many temporary projects; in the real cache each would
// leave a folder behind for good. Set before any worker starts, so workers and the processes they spawn inherit it.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function setup(): Promise<() => Promise<void>> {
  const cache = await mkdtemp(join(tmpdir(), "pd-test-cache-"));
  process.env.XDG_CACHE_HOME = cache;
  process.env.LOCALAPPDATA = cache;
  return async () => { await rm(cache, { recursive: true, force: true }); };
}

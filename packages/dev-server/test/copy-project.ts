// A whole project copied for a spec, such as the shared test-bench. Other specs serve that tree at the same time,
// and pd dev writes `.pd-watch-start` into each folder it watches for a moment as it starts (watch.ts,
// startBarrier): a copy that lists the file and reaches it after pd dev removed it fails with ENOENT. The copy
// leaves it out, as `pd build` does.
import { cp } from "node:fs/promises";
import { basename } from "node:path";

export function copyProject(from: string, to: string): Promise<void> {
  return cp(from, to, { recursive: true, filter: src => basename(src) !== ".pd-watch-start" });
}

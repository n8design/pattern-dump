// A served project on a live-reload port nobody else holds. A free port can be taken by another test file
// between finding it and binding it, so a start that loses it tries again on a fresh one. Sets no test hook,
// so a spec that must run without one can use it.
import { createServer } from "node:net";
import type { PatternDumpConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";

/** A port free at the moment of asking. */
export const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

/** Start pd dev on any workbench port and a free live-reload port, trying a fresh one when the port was taken. */
export async function startOnFreeWsPort(
  cfg: PatternDumpConfig, root: string, attempts = 5,
): Promise<{ server: DevServer; wsPort: number }> {
  for (let attempt = 1; ; attempt++) {
    const wsPort = await freePort();
    try {
      return { server: await startDevServer(cfg, root, { port: 0, wsPort }), wsPort };
    } catch (e) {
      if (!(e instanceof Error && e.name === "PortInUseError") || attempt >= attempts) throw e;
    }
  }
}

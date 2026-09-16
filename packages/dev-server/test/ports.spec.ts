// A taken port stops `pd dev` with a message that says what happened and how to get past it —
// never a raw EADDRINUSE stack from an unhandled 'error' event.

import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";
import { describeBindError, PortInUseError } from "../src/ports.js";

const testBench = fileURLToPath(new URL("../../../test-bench/", import.meta.url));
const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});

let blocker: Server | undefined;
afterEach(async () => { await new Promise<void>(r => blocker ? blocker.close(() => r()) : r()); blocker = undefined; });

/** Occupy a free port the way another `pd dev` would, and return it. The workbench binds 127.0.0.1
 *  and live reload binds every interface, so each is blocked on its own address. */
async function occupy(host?: string): Promise<number> {
  blocker = createServer();
  await new Promise<void>(r => host ? blocker!.listen(0, host, r) : blocker!.listen(0, r));
  return (blocker!.address() as { port: number }).port;
}

describe("describeBindError", () => {
  const inUse = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });

  it("names the workbench port and suggests moving both ports", () => {
    const e = describeBindError(inUse, 4000, "workbench", { http: 4000, wsChosen: false }) as PortInUseError;
    expect(e).toBeInstanceOf(PortInUseError);
    expect(e.code).toBe("EADDRINUSE");
    expect(e.message).toContain("Port 4000 is already in use, so the workbench cannot start");
    expect(e.message).toContain("pd dev --port 4100   (live reload then uses 4101)");
  });

  it("for a derived live-reload port suggests --port; for a chosen one, --ws-port", () => {
    const derived = describeBindError(inUse, 4001, "live reload", { http: 4000, wsChosen: false }) as Error;
    expect(derived.message).toContain("so live reload cannot start");
    expect(derived.message).toContain("pd dev --port 4100");
    const chosen = describeBindError(inUse, 5555, "live reload", { http: 4000, wsChosen: true }) as Error;
    expect(chosen.message).toContain("pd dev --ws-port <a free port>");
  });

  it("passes any other error through untouched", () => {
    const other = new Error("boom");
    expect(describeBindError(other, 4000, "workbench", { http: 4000, wsChosen: false })).toBe(other);
  });
});

describe("startDevServer on a taken port", () => {
  it("rejects with PortInUseError when the live-reload port is taken", async () => {
    const taken = await occupy();
    await expect(startDevServer(config, testBench, { port: 0, wsPort: taken }))
      .rejects.toMatchObject({ name: "PortInUseError", port: taken, message: expect.stringContaining("live reload cannot start") });
  }, 60_000);

  it("rejects with PortInUseError when the workbench port is taken, and releases live reload", async () => {
    const taken = await occupy("127.0.0.1");
    const ws = await (async () => { const s = createServer(); await new Promise<void>(r => s.listen(0, r)); const p = (s.address() as { port: number }).port; await new Promise<void>(r => s.close(() => r())); return p; })();
    await expect(startDevServer(config, testBench, { port: taken, wsPort: ws }))
      .rejects.toMatchObject({ name: "PortInUseError", port: taken, message: expect.stringContaining("the workbench cannot start") });
    // The live-reload socket opened before the failure was closed again: its port is free.
    const probe = createServer();
    await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(ws, resolve); });
    await new Promise<void>(r => probe.close(() => r()));
  }, 60_000);
});

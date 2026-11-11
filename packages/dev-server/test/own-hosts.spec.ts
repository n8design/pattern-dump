// The host names pd dev answers to (own-hosts.ts), from its config: the workbench's, and storefront.host. A
// browser page from any other origin can't open the live-reload socket; a handshake without an Origin (a
// process, not a page) still can.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { defineConfig, validateConfig, type PatternDumpConfig } from "@pattern-dump/config";
import type { DevServer } from "@pattern-dump/dev-server";
import { isOwnHost, isOwnOrigin, ownHosts } from "../src/own-hosts.js";
import { startOnFreeWsPort } from "./free-ports.js";
import { save } from "../../../test-support/save.js";

describe("ownHosts, isOwnHost, isOwnOrigin", () => {
  const withStorefront = ownHosts("docs.localhost");

  it("are the workbench's names, and storefront.host when there is a storefront", () => {
    expect([...ownHosts(undefined)].sort()).toEqual(["127.0.0.1", "localhost", "pd.localhost"]);
    expect([...withStorefront].sort()).toEqual(["127.0.0.1", "docs.localhost", "localhost", "pd.localhost"]);
  });

  it("isOwnHost: one of the names at pd dev's port, in any case; nothing else", () => {
    for (const ok of ["localhost:4000", "127.0.0.1:4000", "pd.localhost:4000", "docs.localhost:4000", "PD.LocalHost:4000"]) {
      expect(isOwnHost(ok, withStorefront, 4000), ok).toBe(true);
    }
    for (const no of [undefined, "", "localhost", "localhost:4001", "live.localhost:4000", "evil.example:4000",
      "localhost.evil.example:4000", "127.0.0.1.nip.io:4000", "[::1]:4000", "localhost:4000@evil.example"]) {
      expect(isOwnHost(no, withStorefront, 4000), String(no)).toBe(false);
    }
    expect(isOwnHost("localhost", withStorefront, 80)).toBe(true);
  });

  it("isOwnOrigin: an http page on one of the names at pd dev's port; nothing else", () => {
    expect(isOwnOrigin("http://pd.localhost:4000", withStorefront, 4000)).toBe(true);
    expect(isOwnOrigin("http://docs.localhost:4000", withStorefront, 4000)).toBe(true);
    for (const no of ["https://pd.localhost:4000", "http://pd.localhost:4001", "http://evil.example:4000", "http://live.localhost:4000",
      "null", "file://", "http://user@localhost:4000", "not a url"]) {
      expect(isOwnOrigin(no, withStorefront, 4000), no).toBe(false);
    }
  });
});

/** Open the socket with `origin` (none when undefined): its first frame's type, or the handshake's refusal. */
const handshake = (wsPort: number, origin: string | undefined): Promise<string> => new Promise(resolve => {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, origin === undefined ? {} : { origin });
  ws.once("message", d => { resolve((JSON.parse(String(d)) as { type: string }).type); ws.close(); });
  ws.once("unexpected-response", (_req, res) => { resolve(`refused ${res.statusCode}`); ws.terminate(); });
  ws.once("error", e => resolve(`error ${e.message}`));
});

describe("pd dev's live-reload socket", () => {
  let tmp = "";
  const servers: DevServer[] = [];
  const config = (storefront: boolean, host?: string): PatternDumpConfig => validateConfig(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist", styles: { strategy: "parallel", dir: "./src/styles" },
    ...(storefront ? { storefront: { pagesDir: "./pages", outDir: "./.out/storefront", ...(host ? { host } : {}) } } : {}),
  }), "own-hosts");
  let root = "";
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "pd-own-hosts-"));
    root = join(tmp, "p");
    for (const [rel, text] of Object.entries({ "src/patterns/atoms/chip/chip.hbs": "<p>chip</p>\n", "src/styles/atoms/chip.scss": "p{margin:0}\n", "pages/index.md": "# Home\n" })) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await save(join(root, rel), text);
    }
  });
  afterAll(async () => {
    for (const s of servers) await s.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });
  const start = async (cfg: PatternDumpConfig) => {
    const { server, wsPort } = await startOnFreeWsPort(cfg, root);
    servers.push(server);
    return { port: server.port, wsPort };
  };

  it("accepts pages from its own hosts at its port, with a custom storefront.host, and a handshake with no Origin", async () => {
    const { port, wsPort } = await start(config(true, "docs.localhost"));
    for (const host of ["localhost", "127.0.0.1", "pd.localhost", "docs.localhost"]) {
      expect(await handshake(wsPort, `http://${host}:${port}`), host).toBe("hello");
    }
    expect(await handshake(wsPort, undefined)).toBe("hello");
  }, 60_000);

  it("refuses a page from any other origin: another site, another port, https, or the default storefront host it replaced", async () => {
    const { port, wsPort } = await start(config(true, "docs.localhost"));
    for (const origin of ["http://evil.example", `http://evil.example:${port}`, `http://localhost:${port + 1}`, `https://localhost:${port}`,
      `http://live.localhost:${port}`, "null"]) {
      expect(await handshake(wsPort, origin), origin).toBe("refused 401");
    }
  }, 60_000);

  it("without a storefront, a storefront host is no host of its own", async () => {
    const { port, wsPort } = await start(config(false));
    expect(await handshake(wsPort, `http://live.localhost:${port}`)).toBe("refused 401");
    expect(await handshake(wsPort, `http://pd.localhost:${port}`)).toBe("hello");
  }, 60_000);
});

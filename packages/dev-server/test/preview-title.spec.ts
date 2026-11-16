// A preview document has a <title>, as every page should: the component's title as the Inspector shows it (its .md
// title, else its name), a variant's name after it, then the workbench's name, separated by " · ". The same in GET
// /preview/:id (a live example's frame, open-in-new-tab) and in the document of GET /api/component/:id.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@pattern-dump/config";
import type { ComponentDetailResponse } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";

const testBench = fileURLToPath(new URL("../../../test-bench/", import.meta.url));
const base = {
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel" as const, dir: "./src/styles" },
};

const servers: DevServer[] = [];
let plain: DevServer;
let branded: DevServer;
beforeAll(async () => {
  plain = await startDevServer(defineConfig(base), testBench, { port: 0, live: false });
  branded = await startDevServer(defineConfig({ ...base, shell: { brand: { title: "Acme <DS>" } } }), testBench, { port: 0, live: false });
  servers.push(plain, branded);
}, 60_000);
afterAll(async () => { await Promise.all(servers.map(s => s.close())); });

const titleOf = (doc: string): string | undefined => /<title>([^<]*)<\/title>/.exec(doc)?.[1];
const preview = async (s: DevServer, path: string) => (await fetch(`http://127.0.0.1:${s.port}/preview/${path}`)).text();
const detail = async (s: DevServer, id: string) =>
  (await (await fetch(`http://127.0.0.1:${s.port}/api/component/${id}`)).json() as ComponentDetailResponse).document;

describe("a preview document's title", () => {
  it("names the component and the workbench", async () => {
    expect(titleOf(await preview(plain, "atoms/button"))).toBe("Button · Pattern Dump");
    expect(titleOf(await detail(plain, "atoms/button"))).toBe("Button · Pattern Dump");
  });

  it("names a variant after its component, by its id or by ?variant=", async () => {
    expect(titleOf(await preview(plain, "atoms/button~secondary"))).toBe("Button · secondary · Pattern Dump");
    expect(titleOf(await preview(plain, "atoms/button?variant=secondary"))).toBe("Button · secondary · Pattern Dump");
  });

  it("takes the workbench's own name, escaped", async () => {
    expect(titleOf(await preview(branded, "atoms/button"))).toBe("Button · Acme &lt;DS&gt;");
  });
});

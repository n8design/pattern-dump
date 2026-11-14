// A storefront page loads the behaviour scripts its components bring (requireScript), as a preview of the same
// components does: every script of its layout's composition, and of each component it places with a pd- tag, each
// once, stamped with its content hash. The bench's header (in every layout) and slider (placed on the guides page)
// each have one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
let server: DevServer;
beforeAll(async () => { server = await startDevServer(validateConfig(benchConfig, "storefront-bench"), bench, { port: 0, live: false }); });
afterAll(async () => { await server?.close(); });

function get(path: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${PD_HOSTS.storefront}:${server.port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}
const scriptsOf = (html: string) => [...html.slice(0, html.indexOf("</head>")).matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map(m => m[1]!);
const sha10 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 10);

describe("behaviour scripts on storefront pages", () => {
  it("a page loads its layout's scripts, and those of the components it places, each once", async () => {
    const guides = scriptsOf((await get("/guides/")).body.toString("utf8")).map(s => s.replace(/\?v=[0-9a-f]{10}$/, ""));
    expect(guides).toEqual(["/_pd/scripts/header-ready.js", "/_pd/scripts/slider-ready.js"]);
  });

  it("a page that places nothing loads only its layout's", async () => {
    const about = scriptsOf((await get("/about/")).body.toString("utf8")).map(s => s.replace(/\?v=[0-9a-f]{10}$/, ""));
    expect(about).toEqual(["/_pd/scripts/header-ready.js"]);
  });

  it("each is stamped with the hash of the script as served", async () => {
    const scripts = scriptsOf((await get("/guides/")).body.toString("utf8"));
    expect(scripts).toHaveLength(2);
    for (const src of scripts) {
      const [path, v] = src.split("?v=");
      const script = await get(path!);
      expect(script.status, path).toBe(200);
      expect(v, path).toBe(sha10(script.body));
    }
  });
});

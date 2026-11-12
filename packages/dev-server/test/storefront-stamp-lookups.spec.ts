// How a stamp lookup behaves at its edges, on a copy of storefront-bench with a page of links:
//  - it never reads outside the project: a reference that climbs out of the assets folder stays unstamped
//    (the path containment the asset route has, #28), and the file out there is never what a stamp is made of;
//  - only "no such file" is remembered: any other failure is reported and asked again by the next page, so a
//    script that fails to compile once is stamped once it compiles.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { PD_HOSTS } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const bench = fileURLToPath(new URL("../../../storefront-bench/", import.meta.url));
const config = validateConfig({ ...benchConfig, scriptsDir: "./src/scripts" }, "storefront-bench");
const SITE = config.storefront!.host ?? PD_HOSTS.storefront;
const SECRET = "outside the project: never read\n";
// The assets folder is <tmp>/site/src/assets. The sentinel is in the project's own folder (outside the assets,
// two levels up) and above the project (three up): each path reaches one of them if containment fails.
const OUTSIDE = [
  "/assets/../../outside.txt", "/assets/%2e%2e/%2e%2e/%2e%2e/outside.txt",
  "/assets/..%2F..%2Foutside.txt", "/assets/..%2F..%2F..%2Foutside.txt",
  "/assets/images/..%2F..%2F..%2Foutside.txt", "/assets/images/..%2F..%2F..%2F..%2Foutside.txt",
  "/assets/..%5C..%5Coutside.txt",
];
let tmp = "";
let root = "";
let server: DevServer;

function get(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `${SITE}:${server.port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-stamp-lookups-"));
  root = join(tmp, "site");
  await cp(bench, root, { recursive: true, filter: src => !/[/\\](?:node_modules|\.out|test-results|e2e)(?:[/\\]|$)/.test(src) });
  await save(join(tmp, "outside.txt"), SECRET);
  await save(join(root, "outside.txt"), SECRET);
  await mkdir(join(root, "src", "scripts"), { recursive: true });
  await save(join(root, "pages", "links.md"), "---\ntitle: Links\n---\n\n"
    + OUTSIDE.map((p, i) => `- [outside ${i}](${p})`).join("\n") + "\n");
  // Its own page, asked for only by the second test: no lookup of the script happens before it.
  await save(join(root, "pages", "script.md"), "---\ntitle: Script\n---\n\n[the script](/_pd/scripts/zz-once.js)\n");
  await save(join(root, "src", "assets", "images", "zz-locked.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>\n`);
  await save(join(root, "pages", "locked.md"), "---\ntitle: Locked\n---\n\n[the image](/assets/images/zz-locked.svg)\n");
  server = await startDevServer(config, root, { port: 0, live: false });
});
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a stamp lookup", () => {
  it("never reads outside the project: a reference that climbs out stays unstamped", async () => {
    const page = await get("/links/");
    expect(page.status).toBe(200);
    const secretStamp = createHash("sha256").update(SECRET).digest("hex").slice(0, 10);
    expect(page.body).not.toContain(secretStamp);
    for (const p of OUTSIDE) {
      const href = /href="([^"]*outside\.txt[^"]*)"/g;
      const hrefs = [...page.body.matchAll(href)].map(m => m[1]!);
      expect(hrefs.some(h => /\?v=/.test(h)), `${p}: ${hrefs.join(" ")}`).toBe(false);
      // And the path itself serves nothing from out there.
      const res = await get(p);
      expect(res.body, p).not.toContain(SECRET.trim());
    }
  });

  it("asks again after a failure that isn't a missing file, and reports it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Fails to compile on the first page, compiles on the second; the server has no watcher here, so only the
      // lookup being asked again can find out.
      await save(join(root, "src", "scripts", "zz-once.ts"), `export const = ;\n`);
      const first = await get("/script/");
      expect(first.body).toContain(`href="/_pd/scripts/zz-once.js"`);
      expect(errors.mock.calls.flat().join("\n")).toMatch(/\/_pd\/scripts\/zz-once\.js.*500/);
      await save(join(root, "src", "scripts", "zz-once.ts"), `export const once = 2;\n`);
      const second = await get("/script/");
      expect(second.body).toMatch(/href="\/_pd\/scripts\/zz-once\.js\?v=[0-9a-f]{10}"/);
    } finally {
      errors.mockRestore();
    }
  });

  // chmod can't keep root out, and does nothing on Windows: there the file is readable and the case can't happen.
  const unreadable = process.platform !== "win32" && process.getuid?.() !== 0;
  it.skipIf(!unreadable)("treats a file it can't read as a failure to ask again, not as a missing file", async () => {
    const file = join(root, "src", "assets", "images", "zz-locked.svg");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await chmod(file, 0o000);
      expect((await get("/assets/images/zz-locked.svg")).status).toBe(500);
      expect((await get("/locked/")).body).toContain(`href="/assets/images/zz-locked.svg"`);
      expect(errors.mock.calls.flat().join("\n")).toMatch(/\/assets\/images\/zz-locked\.svg.*500/);
      await chmod(file, 0o644);
      expect((await get("/locked/")).body).toMatch(/href="\/assets\/images\/zz-locked\.svg\?v=[0-9a-f]{10}"/);
    } finally {
      await chmod(file, 0o644);
      errors.mockRestore();
    }
  });
});

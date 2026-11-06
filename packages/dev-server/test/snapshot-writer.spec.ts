// The snapshot writer: every file in a build output root is written through one, to the path
// staticPathFor names, at most once. Exercised against a small local server, so each response is
// exactly what the test says it is.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createSnapshotWriter, type SnapshotCounts } from "../src/snapshot-writer.js";

let server: Server;
let origin = "";
let tmp = "";
let root = "";
let counts: SnapshotCounts;

const RESPONSES: Record<string, { status: number; type?: string; body: string | Buffer }> = {
  "/api/tree": { status: 200, type: "application/json", body: `{"u":"/preview/atoms/a"}` },
  "/preview/atoms/a": { status: 200, type: "text/html; charset=utf-8", body: `<link href="/_pd/components/atoms/a.css">` },
  "/assets/logo.png": { status: 200, type: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  "/_pd/scripts/t.js": { status: 200, type: "application/javascript", body: `console.log("/_pd/x")` },
  "/source/atoms/a/data": { status: 404, type: "text/plain", body: "Data file not found" },
  "/api/component/atoms/broken": { status: 500, type: "text/plain", body: "Render error: Parse error on line 2\nmore" },
};

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p)); else out.push(relative(root, p));
  }
  return out.sort();
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const r = RESPONSES[req.url ?? ""] ?? { status: 404, type: "text/plain", body: "nope" };
    res.writeHead(r.status, r.type ? { "Content-Type": r.type } : {});
    res.end(r.body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  origin = `http://127.0.0.1:${addr.port}`;
  tmp = await mkdtemp(join(tmpdir(), "pd-snapshot-writer-"));
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(tmp, { recursive: true, force: true });
});

let n = 0;
beforeEach(() => {
  root = join(tmp, `root-${n++}`);
  counts = { files: 0, bytes: 0, warnings: [] };
});

describe("createSnapshotWriter", () => {
  it("writes a text response to its staticPathFor file, under the base path, and returns the body as served", async () => {
    const w = createSnapshotWriter({ outDir: root, basePath: "/pd/", origin, report: counts });
    expect(await w.capture("/api/tree")).toBe(`{"u":"/preview/atoms/a"}`);
    expect(await readFile(join(root, "api", "tree.json"), "utf8")).toBe(`{"u":"/pd/preview/atoms/a"}`);
    expect(await w.capture("/preview/atoms/a")).toBe(`<link href="/_pd/components/atoms/a.css">`);
    expect(await readFile(join(root, "preview", "atoms", "a", "index.html"), "utf8")).toBe(`<link href="/pd/_pd/components/atoms/a.css">`);
    expect(counts).toEqual({ files: 2, bytes: 27 + 44, warnings: [] });
  });

  it("writes other responses byte for byte, and returns a script's text", async () => {
    const w = createSnapshotWriter({ outDir: root, basePath: "/pd/", origin, report: counts });
    expect(await w.capture("/assets/logo.png")).toBeNull();
    expect(await readFile(join(root, "assets", "logo.png"))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    // A script is not rewritten (it is not text/html, css or json) but its text is returned, so the
    // caller can find what it references.
    expect(await w.capture("/_pd/scripts/t.js")).toBe(`console.log("/_pd/x")`);
    expect(await readFile(join(root, "_pd", "scripts", "t.js"), "utf8")).toBe(`console.log("/_pd/x")`);
    expect(counts.files).toBe(2);
  });

  it("writes each file once: the first writer of a path wins", async () => {
    const w = createSnapshotWriter({ outDir: root, basePath: "/", origin, report: counts });
    await w.capture("/preview/atoms/a");
    expect(await w.capture("/preview/atoms/a")).toBeNull();
    // A body for the same file — as a shell route whose file a capture already wrote — is skipped.
    await w.store("/preview/atoms/a", "<p>shell</p>");
    expect(await readFile(join(root, "preview", "atoms", "a", "index.html"), "utf8")).toBe(`<link href="/_pd/components/atoms/a.css">`);
    await w.store("/atoms/a", "<p>shell</p>");
    await w.store("/atoms/a", "<p>other</p>");
    expect(await readFile(join(root, "atoms", "a", "index.html"), "utf8")).toBe("<p>shell</p>");
    expect(counts.files).toBe(2);
  });

  it("rewrites a stored body for the base path once", async () => {
    const w = createSnapshotWriter({ outDir: root, basePath: "/pd/", origin, report: counts });
    await w.store("/", `<script src="/_pd/main.js"></script>`);
    expect(await readFile(join(root, "index.html"), "utf8")).toBe(`<script src="/pd/_pd/main.js"></script>`);
  });

  it("reports failures as warnings and writes nothing; an optional 404 is not listed", async () => {
    const w = createSnapshotWriter({ outDir: root, basePath: "/", origin, report: counts });
    expect(await w.capture("/source/atoms/a/data", { optional: true })).toBeNull();
    expect(await w.capture("/api/missing")).toBeNull();
    expect(await w.capture("/api/component/atoms/broken")).toBeNull();
    expect(counts.warnings).toEqual(["404 /api/missing", "500 /api/component/atoms/broken: Render error: Parse error on line 2"]);
    expect(w.failures).toEqual([]);
    expect(await files(root)).toEqual([]);
    expect(counts.files).toBe(0);
  });

  it("records a fatal capture's failure in failures, not in the warnings, even when it is also optional", async () => {
    const w = createSnapshotWriter({ outDir: root, basePath: "/", origin, report: counts });
    await w.capture("/api/missing", { fatal: true });
    await w.capture("/api/component/atoms/broken", { fatal: true });
    await w.capture("/source/atoms/a/data", { fatal: true, optional: true });
    expect(w.failures).toEqual([
      "404 /api/missing",
      "500 /api/component/atoms/broken: Render error: Parse error on line 2",
      "404 /source/atoms/a/data",
    ]);
    expect(counts.warnings).toEqual([]);
    expect(await files(root)).toEqual([]);
  });

  it("keeps a separate record per writer, so two output roots can hold the same path", async () => {
    const rootA = join(root, "a"), rootB = join(root, "b");
    const a = createSnapshotWriter({ outDir: rootA, basePath: "/pd/", origin, report: counts });
    const b = createSnapshotWriter({ outDir: rootB, basePath: "/", origin, report: counts });
    await a.capture("/preview/atoms/a");
    await b.capture("/preview/atoms/a");
    expect(await readFile(join(rootA, "preview", "atoms", "a", "index.html"), "utf8")).toBe(`<link href="/pd/_pd/components/atoms/a.css">`);
    expect(await readFile(join(rootB, "preview", "atoms", "a", "index.html"), "utf8")).toBe(`<link href="/_pd/components/atoms/a.css">`);
    expect(counts.files).toBe(2);
  });
});

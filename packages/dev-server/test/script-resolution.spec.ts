// A requireScript / globalScripts id that cannot resolve.
//
// Scripts are TypeScript by contract, so an id resolves only as `<scriptsDir>/<id>.ts`. A typo — or a
// `.js` file that does exist, since normalizeScriptId strips the extension — used to reach esbuild as a
// path already known to be absent, so the preview embedded a raw ENOENT and nothing was reported at
// startup. Every other unreadable subject input is isolated and logged once (project-loaders).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";
import { reportUnresolvableScripts } from "../src/requires.js";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { save } from "../../../test-support/save.js";

let dir = "";
let server: { port: number; close: () => Promise<void> };
const get = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pd-scripts-"));
  for (const d of ["src/patterns/atoms", "src/styles", "src/scripts"]) await mkdir(join(dir, d), { recursive: true });
  await save(join(dir, "src/patterns/atoms/widget.hbs"), `<div class="widget">w</div>\n`);
  // The id names a .js file that exists; resolution is .ts-only, so it cannot resolve.
  await save(join(dir, "src/patterns/atoms/widget.md"), `---\nrequireScript: legacy.js\n---\n`);
  await save(join(dir, "src/scripts/legacy.js"), `console.log("legacy");\n`);
  await save(join(dir, "src/scripts/real.ts"), `document.body.dataset.real = "1";\n`);
  server = await startDevServer(defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { dir: "./src/styles" }, scriptsDir: "./src/scripts",
  }), dir, { port: 0, wsPort: 0 });
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("an unresolvable script id", () => {
  it("is a 404 naming the id and where it was looked for, not a compile error", async () => {
    const res = await get("/_pd/scripts/legacy.js");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain(`No script "legacy"`);
    expect(body).toContain("legacy.ts");
    expect(body).toContain("src/scripts");
    expect(body).not.toContain("ENOENT");
  });

  it("is reported once at startup, naming the component", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { discoveryMap } = await buildDiscoveryMap(join(dir, "src/patterns"));
      await reportUnresolvableScripts(discoveryMap, [join(dir, "src/scripts")], ["missing-global", "https://cdn.example/x.js"], dir);
      const lines = warn.mock.calls.map(c => String(c[0]));
      expect(lines).toContainEqual(expect.stringContaining(`requireScript "legacy.js" on atoms/widget`));
      expect(lines).toContainEqual(expect.stringContaining(`globalScripts "missing-global"`));
      // A full URL is loaded by the browser, never compiled: not a miss.
      expect(lines.join("\n")).not.toContain("cdn.example");
    } finally { warn.mockRestore(); }
  });

  it("a resolvable id still compiles and is served", async () => {
    const res = await get("/_pd/scripts/real.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("dataset");
  });
});

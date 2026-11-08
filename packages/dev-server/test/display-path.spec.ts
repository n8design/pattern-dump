// How a diagnostic names a source file: relative to the project root for the project's own files,
// `<package name>/<path in the package>` for a package's, through its node_modules link or its real
// folder alike. Never an absolute path, checked on test-bench as served.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import type { ComponentDetailResponse } from "@pattern-dump/contracts";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { createDisplayPath } from "../src/display-path.js";
import testBenchConfig from "../../../test-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let project = "";
let vendor = "";
let link = "";

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-display-path-"));
  project = join(tmp, "site");
  vendor = join(project, "vendor", "ds");
  link = join(project, "node_modules", "@acme", "ds");
  await mkdir(join(vendor, "patterns"), { recursive: true });
  await mkdir(join(project, "node_modules", "@acme"), { recursive: true });
  await save(join(vendor, "package.json"), "{}");
  // What npm makes of a `file:` dependency: a link in node_modules to the real folder.
  await symlink(join("..", "..", "vendor", "ds"), link);
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("createDisplayPath", () => {
  const display = () => createDisplayPath(project, [{ name: "@acme/ds", dir: link }]);

  it("names a project file relative to the project root", () => {
    expect(display()(join(project, "src", "patterns", "atoms", "x", "x.json"))).toBe("src/patterns/atoms/x/x.json");
  });

  it("names a package file by the package's name, through its link or its real folder", () => {
    expect(display()(join(link, "patterns", "atoms", "x", "x.json"))).toBe("@acme/ds/patterns/atoms/x/x.json");
    expect(display()(join(vendor, "patterns", "atoms", "x", "x.json"))).toBe("@acme/ds/patterns/atoms/x/x.json");
  });

  it("names a package inside the project's own tree as the package, not by its project path", () => {
    expect(display()(join(project, "vendor", "ds", "patterns", "a.json"))).toBe("@acme/ds/patterns/a.json");
  });

  it("leaves a path outside every known folder for the renderer to name", () => {
    const outside = join(tmp, "elsewhere", "a.json");
    expect(display()(outside)).toBe(outside);
  });
});

describe("test-bench as served", () => {
  let server: DevServer;
  const root = fileURLToPath(new URL("../../../test-bench/", import.meta.url));
  beforeAll(async () => {
    server = await startDevServer(validateConfig(testBenchConfig, "test-bench"), root, { port: 0, live: false });
  }, 120_000);
  afterAll(async () => { await server?.close(); });

  it("names an invalid data file by its path in the project, never absolute", async () => {
    const detail = await (await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/data-invalid`)).json() as ComponentDetailResponse;
    const files = (detail.diagnostics ?? []).filter(d => d.kind === "DATA_INVALID").map(d => d.location?.file);
    expect(files).toEqual(["src/patterns/atoms/data-invalid/data-invalid.json"]);
    for (const f of files) expect(isAbsolute(f!)).toBe(false);
  });
});

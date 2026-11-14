// A schema field named like a registered helper (`id`) can never be shown: besides the component's diagnostic, pd dev
// says so in the terminal, once per field for the server, and pd audit re-audits a component when its schema
// changes (the schema is part of the hash its cached verdict is kept under).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import { componentContentHash } from "../src/diagnostics.js";
import { save } from "../../../test-support/save.js";

let root = "";
let server: DevServer;
const SCHEMA = "src/patterns/atoms/badge/badge.schema.json";
const schema = (fields: string[]) => JSON.stringify({ properties: Object.fromEntries(fields.map(f => [f, { type: "string" }])) });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pd-helper-names-"));
  await save(join(root, "src/patterns/atoms/badge/badge.hbs"), `<span class="badge">{{label}}</span>\n`);
  await save(join(root, SCHEMA), schema(["label", "id"]));
});
afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("a schema field named like a helper", () => {
  it("is said in pd dev's terminal, once per field however often the component renders", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    server = await startDevServer(validateConfig(defineConfig({ outDir: "./dist" }), "test"), root, { port: 0, live: false });
    for (let i = 0; i < 3; i++) expect((await fetch(`http://127.0.0.1:${server.port}/api/component/atoms/badge`)).status).toBe(200);
    const said = errors.mock.calls.map(c => String(c[0])).filter(l => l.includes("registered helper"));
    expect(said).toEqual([`[dev-server] error: ${SCHEMA} (#/properties/id): "id" is the name of a registered helper, `
      + "so {{id}} would call the helper, not read this field"]);
  });

  it("changes the component's audit hash when only its schema changes", async () => {
    const hash = async () => componentContentHash("atoms/badge", (await buildDiscoveryMap(join(root, "src/patterns"))).discoveryMap, "g");
    const before = await hash();
    await save(join(root, SCHEMA), schema(["label"]));
    expect(await hash()).not.toBe(before);
  });
});

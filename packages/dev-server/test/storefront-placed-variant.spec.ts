// A pd- tag places a variant by its handle (`<pd-atoms-pill~loud>`). Its values are checked against the variant's
// own `.schema.json` when it has one, else the base's: a data-overlay variant has the base's markup, so the base's
// schema describes it. The lookup used to take the variant's entry alone, so the usual case (a data-overlay variant
// with no schema of its own) failed with "has no schema, so it cannot be placed with values". On a copy of the
// storefront bench, as in storefront-placed.spec.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
const json = (v: unknown) => JSON.stringify(v);
const FM = "---\ntitle: Case\n---\n\n";
const ADDED: Record<string, string> = {
  "src/patterns/atoms/pill/pill.hbs": `<span class="pill pill--{{tone}}">{{label}}</span>\n`,
  "src/patterns/atoms/pill/pill.json": json({ tone: "plain", label: "Pill" }),
  "src/patterns/atoms/pill/pill.schema.json": json({ required: ["label"], properties: { label: { type: "string" }, tone: { type: "string" } } }),
  // A data-overlay variant with no schema of its own: the base's applies.
  "src/patterns/atoms/pill/pill~loud.json": json({ tone: "loud" }),
  // A data-overlay variant with its own schema, which allows only its own tones.
  "src/patterns/atoms/pill/pill~quiet.json": json({ tone: "quiet" }),
  "src/patterns/atoms/pill/pill~quiet.schema.json": json({ required: ["label"], properties: { label: { type: "string" }, tone: { type: "string", enum: ["quiet", "hushed"] } } }),
  "pages/loud.md": `${FM}<pd-atoms-pill~loud label="Loud one"></pd-atoms-pill~loud>\n`,
  "pages/quiet.md": `${FM}<pd-atoms-pill~quiet label="Quiet one" tone="plain"></pd-atoms-pill~quiet>\n`,
  "pages/typo.md": `${FM}<pd-atoms-pill~loud lable="Loud one"></pd-atoms-pill~loud>\n`,
};

let tmp = "";
let server: DevServer;
async function benchCopy(name: string, extra: Record<string, string>): Promise<string> {
  const root = join(tmp, name);
  for (const file of execFileSync("git", ["ls-files", "storefront-bench"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const to = join(root, file.slice("storefront-bench/".length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(repo, file), to);
  }
  for (const [rel, text] of Object.entries(extra)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}
function get(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `live.localhost:${server.port}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, `"`).replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const problemsOf = (html: string) => [...html.matchAll(/<li>([^<]*)<\/li>/g)].map(m => unescape(m[1]));

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-storefront-placed-variant-"));
  server = await startDevServer(config, await benchCopy("bench", ADDED), { port: 0, live: false });
}, 60_000);
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a pd- tag that places a variant", () => {
  it("a data-overlay variant without a schema of its own is checked against the base's, and renders", async () => {
    const page = await get("/loud/");
    expect(problemsOf(page.body)).toEqual([]);
    expect(page.status).toBe(200);
    // Only what the tag sets: a placement's unset keys are null, so no sample data (the variant's .json included)
    // reaches a real page (declared-values.ts).
    expect(page.body).toContain(`<span class="pill pill--">Loud one</span>`);
  });

  it("the base's schema names a misspelled key", async () => {
    const page = await get("/typo/");
    expect(page.status).toBe(500);
    expect(problemsOf(page.body)).toEqual([
      `typo.md:5:21: <pd-atoms-pill~loud>: "lable" is not declared by atoms/pill~loud: did you mean "label"?`,
      `typo.md:5:1: <pd-atoms-pill~loud>: "label" is required by atoms/pill~loud`,
    ]);
  });

  it("a variant's own schema wins over the base's", async () => {
    const page = await get("/quiet/");
    expect(page.status).toBe(500);
    expect(problemsOf(page.body)).toHaveLength(1);
    expect(problemsOf(page.body)[0]).toContain("tone");
  });
});

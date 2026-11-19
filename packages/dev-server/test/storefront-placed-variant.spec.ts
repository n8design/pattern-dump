// A pd- tag places a variant by its handle (`<pd-atoms-pill~loud>`). Its values are checked against the variant's
// own `.schema.json` when it has one, else the base's: a data-overlay variant has the base's markup, so the base's
// schema describes it. The lookup used to take the variant's entry alone, so the usual case (a data-overlay variant
// with no schema of its own) failed with "has no schema, so it cannot be placed with values".
//
// The variant's data comes with it: each key whose value in the variant's .json differs from the base's .json, and
// that the tag leaves unset, takes the variant's value (`tone: loud`). Keys the two share are sample text and stay
// out, as every unset key of a placement does; the tag's own values win. The variant's data comes before the check, so
// a required key the variant sets counts as given; a required key that neither the tag nor the variant's data sets
// (a key the variant's .json leaves out, or one it shares with the base's) still fails. On a copy of the storefront
// bench, as in storefront-placed.spec.ts.
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
  "src/patterns/atoms/pill/pill.hbs": `<span class="pill pill--{{tone}}" title="{{hint}}">{{label}}</span>\n`,
  "src/patterns/atoms/pill/pill.json": json({ tone: "plain", label: "Pill", hint: "A sample hint" }),
  "src/patterns/atoms/pill/pill.schema.json": json({ required: ["label"], properties: { label: { type: "string" }, tone: { type: "string" }, hint: { type: "string" } } }),
  // A data-overlay variant with no schema of its own: the base's applies. Its tone and label differ from the base's,
  // its hint is the same.
  "src/patterns/atoms/pill/pill~loud.json": json({ tone: "loud", label: "LOUD", hint: "A sample hint" }),
  // A data-overlay variant with its own schema, which allows only its own tones.
  "src/patterns/atoms/pill/pill~quiet.json": json({ tone: "quiet" }),
  // A data-overlay variant whose label is the base's: sample text, so it does not count as given.
  "src/patterns/atoms/pill/pill~same.json": json({ tone: "same", label: "Pill" }),
  "src/patterns/atoms/pill/pill~quiet.schema.json": json({ required: ["label"], properties: { label: { type: "string" }, tone: { type: "string", enum: ["quiet", "hushed"] } } }),
  "pages/loud.md": `${FM}<pd-atoms-pill~loud label="Loud one"></pd-atoms-pill~loud>\n`,
  "pages/quiet.md": `${FM}<pd-atoms-pill~quiet label="Quiet one" tone="plain"></pd-atoms-pill~quiet>\n`,
  "pages/typo.md": `${FM}<pd-atoms-pill~loud lable="Loud one"></pd-atoms-pill~loud>\n`,
  "pages/loud-bare.md": `${FM}<pd-atoms-pill~loud></pd-atoms-pill~loud>\n`,
  "pages/quiet-bare.md": `${FM}<pd-atoms-pill~quiet></pd-atoms-pill~quiet>\n`,
  "pages/same-bare.md": `${FM}<pd-atoms-pill~same></pd-atoms-pill~same>\n`,
  "pages/own-tone.md": `${FM}<pd-atoms-pill~loud label="Soft one" tone="soft"></pd-atoms-pill~loud>\n`,
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
  it("a data-overlay variant without a schema of its own is checked against the base's, and renders with the data that makes it the variant", async () => {
    const page = await get("/loud/");
    expect(problemsOf(page.body)).toEqual([]);
    expect(page.status).toBe(200);
    // tone differs from the base's, so it comes through; hint is the base's sample text, so it stays out.
    expect(page.body).toContain(`<span class="pill pill--loud" title="">Loud one</span>`);
  });

  it("the tag's own values win over the variant's", async () => {
    const page = await get("/own-tone/");
    expect(page.status).toBe(200);
    expect(page.body).toContain(`<span class="pill pill--soft" title="">Soft one</span>`);
  });

  it("a required key the variant's data sets counts as given: the tag can leave it out", async () => {
    const page = await get("/loud-bare/");
    expect(problemsOf(page.body)).toEqual([]);
    expect(page.status).toBe(200);
    expect(page.body).toContain(`<span class="pill pill--loud" title="">LOUD</span>`);
  });

  it("a required key the variant's data leaves out is still required, with the same message", async () => {
    const page = await get("/quiet-bare/");
    expect(page.status).toBe(500);
    expect(problemsOf(page.body)).toEqual([`quiet-bare.md:5:1: <pd-atoms-pill~quiet>: "label" is required by atoms/pill~quiet`]);
  });

  it("a required key the variant shares with the base is sample text: still required", async () => {
    const page = await get("/same-bare/");
    expect(page.status).toBe(500);
    expect(problemsOf(page.body)).toEqual([`same-bare.md:5:1: <pd-atoms-pill~same>: "label" is required by atoms/pill~same`]);
  });

  it("the base's schema names a misspelled key", async () => {
    // label is required, and pill~loud.json sets it ("LOUD"), so the misspelling is the one problem.
    const page = await get("/typo/");
    expect(page.status).toBe(500);
    expect(problemsOf(page.body)).toEqual([
      `typo.md:5:21: <pd-atoms-pill~loud>: "lable" is not declared by atoms/pill~loud: did you mean "label"?`,
    ]);
  });

  it("a variant's own schema wins over the base's", async () => {
    const page = await get("/quiet/");
    expect(page.status).toBe(500);
    expect(problemsOf(page.body)).toHaveLength(1);
    expect(problemsOf(page.body)[0]).toContain("tone");
  });
});

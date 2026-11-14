// Storefront pages place components with values (pd- tags): the component renders into the page through
// render(), its stylesheets (and those of the components placed inside it) are linked in the page head, and
// every problem is listed on the page in pd dev and fails pd build, as file:line:column. On a copy of the
// storefront bench with a slider and a slide added, and one page per failure case. Their classes are not the
// bench's own slider's (.slider, .slide), so the stylesheets linked are theirs alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@pattern-dump/config";
import { buildStaticSite, startDevServer, type DevServer } from "@pattern-dump/dev-server";
import benchConfig from "../../../storefront-bench/pattern-dump.config.js";
import { save } from "../../../test-support/save.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const config = validateConfig(benchConfig, "storefront-bench");
const json = (v: unknown) => JSON.stringify(v);
const FM = "---\ntitle: Case\n---\n\n";
const ADDED: Record<string, string> = {
  "src/patterns/molecules/slider/slider.hbs": `<section class="carousel" aria-label="{{label}}" data-per-view="{{perView}}">{{#each slides}}<div class="carousel-item">{{> atoms-slide}}</div>{{/each}}</section>\n`,
  "src/patterns/molecules/slider/slider.schema.json": json({ required: ["label", "slides"], properties: {
    label: { type: "string" }, perView: { type: "integer", enum: [1, 2, 3] }, loop: { type: "boolean" },
    slides: { type: "array", items: { "x-pd-component": "atoms/slide" } } } }),
  "src/patterns/atoms/slide/slide.hbs": `<figure class="carousel-slide"><img src="{{image}}" alt="{{alt}}" width="320" height="180">{{#if caption}}<figcaption>{{{caption}}}</figcaption>{{/if}}</figure>\n`,
  "src/patterns/atoms/slide/slide.schema.json": json({ "x-pd-content": "caption", required: ["image", "alt"], properties: {
    image: { type: "string" }, alt: { type: "string" }, caption: { type: "string", contentMediaType: "text/markdown" } } }),
  // A field named like a registered helper (`id`): {{id}} calls the helper, so the value could never show.
  "src/patterns/atoms/badge/badge.hbs": `<span class="badge" id="{{id}}">{{label}}</span>\n`,
  "src/patterns/atoms/badge/badge.schema.json": json({ required: ["label"], properties: { label: { type: "string" }, id: { type: "string" } } }),
  "src/styles/molecules/slider.scss": ".carousel {\n  display: flex;\n}\n",
  "src/styles/atoms/slide.scss": ".carousel-slide {\n  margin: 0;\n}\n",
  "pages/talks.md": `---\ntitle: Talks\n---\n\n## Recent talks\n\n<pd-molecules-slider label="Recent talks" per-view="1" loop>\n  <pd-atoms-slide image="/assets/images/bench-blocks.svg" alt="On stage">ESPC **2025**</pd-atoms-slide>\n  <pd-atoms-slide image="/assets/images/bench-blocks.svg" alt="Audience">Collab Summit</pd-atoms-slide>\n</pd-molecules-slider>\n`,
};
const CASES: Record<string, [body: string, problem: string]> = {
  "case-1": [`<pd-molecules-slidr label="x"></pd-molecules-slidr>\n`,
    `case-1.md:5:1: <pd-molecules-slidr>: there is no component "molecules-slidr" — did you mean <pd-molecules-slider>?`],
  "case-2": [`<pd-molecules-slider label="x" per-veiw="2">\n  <pd-atoms-slide image="a.jpg" alt="a"></pd-atoms-slide>\n</pd-molecules-slider>\n`,
    `case-2.md:5:32: <pd-molecules-slider>: "per-veiw" is not declared by molecules/slider — did you mean "per-view"?`],
  "case-3": [`<pd-molecules-slider label="x" per-view="two">\n  <pd-atoms-slide image="a.jpg" alt="a"></pd-atoms-slide>\n</pd-molecules-slider>\n`,
    `case-3.md:5:32: <pd-molecules-slider>.per-view must be a whole number (got "two")`],
  "case-4": [`<pd-molecules-slider label="x">\n  <pd-atoms-slide image="a.jpg">Caption</pd-atoms-slide>\n</pd-molecules-slider>\n`,
    `case-4.md:6:3: <pd-molecules-slider>.<pd-atoms-slide>[1]: "alt" is required by atoms/slide`],
  "case-5": [`<pd-molecules-slider label="x">\n  <pd-atoms-slide image="a.jpg" alt="a"></pd-atoms-slide>\n  <pd-molecules-slider label="inner"></pd-molecules-slider>\n</pd-molecules-slider>\n`,
    `case-5.md:7:3: <pd-molecules-slider> cannot be placed inside <pd-molecules-slider> — it takes <pd-atoms-slide>`],
  "case-6": [`<pd-atoms-badge label="New"></pd-atoms-badge>\n`,
    `case-6.md:5:1: atoms/badge cannot be placed: its schema (src/patterns/atoms/badge/badge.schema.json, #/properties/id): `
      + `"id" is the name of a registered helper, so {{id}} would call the helper, not read this field`],
};

let tmp = "";
let server: DevServer;
/** A copy of the bench's tracked files, with `extra` written over it. */
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
  tmp = await mkdtemp(join(tmpdir(), "pd-storefront-placed-"));
  const cases = Object.fromEntries(Object.entries(CASES).map(([name, [body]]) => [`pages/${name}.md`, FM + body]));
  const root = await benchCopy("bench", { ...ADDED, ...cases });
  server = await startDevServer(config, root, { port: 0, live: false });
}, 60_000);
afterAll(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("a storefront page that places a component", () => {
  it("renders it into the page, children as data, and links its stylesheets and its children's", async () => {
    const page = await get("/talks/");
    expect(page.status).toBe(200);
    // (The body's lines are as the components write them: an indented include adds no indentation. The slides'
    // image is a real asset, so the storefront host stamps it: compared without its stamp.)
    expect(page.body.replace(/(bench-blocks\.svg)\?v=[0-9a-f]{10}/g, "$1")).toContain(`<section class="carousel" aria-label="Recent talks" data-per-view="1">`
      + `<div class="carousel-item"><figure class="carousel-slide"><img src="/assets/images/bench-blocks.svg" alt="On stage" width="320" height="180"><figcaption><p>ESPC <strong>2025</strong></p>\n</figcaption></figure>\n</div>`
      + `<div class="carousel-item"><figure class="carousel-slide"><img src="/assets/images/bench-blocks.svg" alt="Audience" width="320" height="180"><figcaption><p>Collab Summit</p>\n</figcaption></figure>\n</div></section>`);
    // The placed component's stylesheet, and the nested slide's, each stamped with its content hash.
    expect(page.body).toMatch(/<link rel="stylesheet" href="\/_pd\/components\/molecules\/slider\.css\?v=[0-9a-f]{10}" data-pd-comp="molecules\/slider">/);
    expect(page.body).toMatch(/<link rel="stylesheet" href="\/_pd\/components\/atoms\/slide\.css\?v=[0-9a-f]{10}" data-pd-comp="atoms\/slide">/);
  });

  for (const [name, [, problem]] of Object.entries(CASES)) {
    it(`lists its problem with file, line and column: ${name}`, async () => {
      const page = await get(`/${name}/`);
      expect(page.status).toBe(500);
      expect(problemsOf(page.body)).toEqual([problem]);
    });
  }

  it("fails pd build with that problem, and builds a site whose placements are sound", async () => {
    const broken = await benchCopy("broken", { ...ADDED, "pages/case-2.md": FM + CASES["case-2"][0] });
    await expect(buildStaticSite(config, broken, { outDir: join(tmp, "out-broken"), pdVersion: "0.0.0-test" }))
      .rejects.toThrow(CASES["case-2"][1]);
    const sound = await benchCopy("sound", ADDED);
    await expect(buildStaticSite(config, sound, { outDir: join(tmp, "out-sound"), pdVersion: "0.0.0-test" })).resolves.toBeDefined();
  }, 120_000);
});

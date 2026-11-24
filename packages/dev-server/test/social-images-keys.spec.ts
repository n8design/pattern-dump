// Social images, the keys (social-images.ts, frontmatter-contract.ts): `socialImage` names a variant of the social
// image component, or `false`; a folder sets it for its pages through childDefaults, nearest folder wins, the page's
// own first; it is the build's, never the layout's. The component itself is checked when the site's pages are, and
// each of its problems is every page's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildDiscoveryMap } from "@pattern-dump/discovery";
import { createRenderer } from "@pattern-dump/renderer";
import { buildCompositionRegistry } from "../src/composition.js";
import { readPages } from "../src/storefront/pages.js";
import { assemblePage, type PageAssembly } from "../src/storefront/page.js";
import { checkPageFrontmatter } from "../src/storefront/frontmatter-contract.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-social-keys-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

const json = (v: unknown) => JSON.stringify(v);
const COMPONENT = "components/social-image";
const FILES: Record<string, string> = {
  "patterns/layouts/page/page.hbs": "<main><h1>{{title}}</h1>{{{body}}}</main>",
  "patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" } } }),
  "patterns/components/social-image/social-image.hbs": `<div class="card"><p>{{section}}</p><h1>{{title}}</h1></div>`,
  "patterns/components/social-image/social-image.schema.json": json({ properties: { title: { type: "string" }, section: { type: "string" } } }),
  "patterns/components/social-image/social-image~guide.hbs": `<div class="card card--guide"><h1>{{title}}</h1></div>`,
  "patterns/components/social-image/social-image~release.json": json({ tone: "dark" }),
};

let n = 0;
async function project(files: Record<string, string | null>): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({ ...FILES, ...files })) {
    if (text === null) continue;
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await save(join(root, rel), text);
  }
  return root;
}
const fm = (lines: string[], body = "Text.") => `---\n${lines.join("\n")}\n---\n\n${body}\n`;

/** The build keys and problems of the page at `route`, checked with the social image component (or `component`). */
async function checked(root: string, route: string, component: string | null = COMPONENT) {
  const { discoveryMap } = await buildDiscoveryMap(join(root, "patterns"));
  const model = await readPages(join(root, "pages"));
  const page = model.files.get(route);
  if (!page) throw new Error(`no page at ${route}`);
  return checkPageFrontmatter(page, discoveryMap, model.categories, model.tags, p => p, component ?? undefined);
}
const messages = (c: Awaited<ReturnType<typeof checked>>) => c.problems.map(p => `${p.file}${p.line !== undefined ? `:${p.line}` : ""}: ${p.message}`);

/** The page at `route`, assembled with the social image component (or `component`): its problems. */
async function assembledProblems(root: string, route: string, component: string | undefined = COMPONENT): Promise<string[]> {
  const patterns = join(root, "patterns");
  const { discoveryMap, handleMap } = await buildDiscoveryMap(patterns);
  const a: PageAssembly = {
    discoveryMap, handleMap, composition: await buildCompositionRegistry(patterns, handleMap, discoveryMap),
    render: createRenderer({ patternsDir: patterns, discoveryMap, handleMap }), shown: p => p, site: undefined,
    workbenchUrl: "https://wb.test/", head: async () => "", image: async () => ({ ok: true }) as never,
    ...(component !== undefined ? { socialComponent: component } : {}),
  };
  return (await assemblePage(route, await readPages(join(root, "pages")), a)).problems;
}

describe("socialImage: which variant", () => {
  it("a folder's choice reaches a page two levels down, naming the index.md it came from", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/docs/index.md": fm(["title: Docs", "childDefaults:", "  socialImage: guide"]),
      "pages/docs/setup/index.md": fm(["title: Setup"]),
      "pages/docs/setup/install.md": fm(["title: Install"]),
    });
    const c = await checked(root, "/docs/setup/install/");
    expect(c.problems).toEqual([]);
    expect(c.build.socialImage).toBe("guide");
  });

  it("a page's own wins over its folder's", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/docs/index.md": fm(["title: Docs", "childDefaults:", "  socialImage: guide"]),
      "pages/docs/news.md": fm(["title: News", "socialImage: release"]),
    });
    expect((await checked(root, "/docs/news/")).build.socialImage).toBe("release");
  });

  it("false: none for the page, or the folder's pages", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home", "socialImage: false"]),
      "pages/docs/index.md": fm(["title: Docs", "childDefaults:", "  socialImage: false"]),
      "pages/docs/a.md": fm(["title: A"]),
    });
    expect((await checked(root, "/")).build.socialImage).toBe(false);
    expect((await checked(root, "/docs/a/")).build.socialImage).toBe(false);
  });

  it("without it: no key, so the component itself", async () => {
    const root = await project({ "pages/index.md": fm(["title: Home"]) });
    const c = await checked(root, "/");
    expect(c.problems).toEqual([]);
    expect("socialImage" in c.build).toBe(false);
  });

  it("an unknown variant fails, with the variants there are", async () => {
    const root = await project({ "pages/index.md": fm(["title: Home", "socialImage: news"]) });
    expect(messages(await checked(root, "/"))).toEqual([
      `index.md:3: socialImage "news" is not a variant of components/social-image: its variants are "guide", "release"`]);
  });

  it("a component with no variants says so", async () => {
    const root = await project({
      "patterns/components/social-image/social-image~guide.hbs": null, "patterns/components/social-image/social-image~release.json": null,
      "pages/index.md": fm(["title: Home", "socialImage: guide"]),
    });
    expect(messages(await checked(root, "/"))).toEqual([
      `index.md:3: socialImage "guide" is not a variant of components/social-image: it has no variants`]);
  });

  it("a value that can't be a variant's name", async () => {
    const root = await project({ "pages/index.md": fm(["title: Home", "socialImage: [guide, release]"]) });
    expect(messages(await checked(root, "/"))).toEqual([
      `index.md:3: socialImage must be a variant of components/social-image, such as "guide", or false`]);
  });

  it("a folder's unknown variant is found on its index.md, though the folder has no pages yet", async () => {
    const root = await project({
      "pages/index.md": fm(["title: Home"]),
      "pages/docs/index.md": fm(["title: Docs", "childDefaults:", "  socialImage: news"]),
    });
    expect(messages(await checked(root, "/docs/"))).toEqual([
      `docs/index.md:4: childDefaults.socialImage "news" is not a variant of components/social-image: its variants are "guide", "release"`]);
  });

  it("set on a site without social images: an error", async () => {
    const root = await project({ "pages/index.md": fm(["title: Home", "socialImage: guide"]) });
    expect(messages(await checked(root, "/", null))).toEqual([
      `index.md:3: socialImage is set, but site.socialImages is not, so there is no social image component: set site.socialImages.component, or remove socialImage`]);
  });
});

describe("socialImage is the build's, never the layout's", () => {
  it("doesn't reach the layout's values", async () => {
    const root = await project({ "pages/index.md": fm(["title: Home", "socialImage: guide"]) });
    const c = await checked(root, "/");
    expect(c.problems).toEqual([]);
    expect(c.values).toEqual({ title: "Home" });
  });

  it("a layout can't declare it", async () => {
    const root = await project({
      "patterns/layouts/page/page.schema.json": json({ properties: { title: { type: "string" }, socialImage: { type: "string" } } }),
      "pages/index.md": fm(["title: Home"]),
    });
    expect(messages(await checked(root, "/"))).toEqual([
      `index.md: layout "page" declares "socialImage", which a page sets for the build, not for its layout: rename it in the layout's schema`]);
  });
});

describe("the social image component, checked with the site's pages", () => {
  const pages = { "pages/index.md": fm(["title: Home"]), "pages/about.md": fm(["title: About"]) };

  it("as it should be: no problem", async () => {
    const root = await project(pages);
    expect(await assembledProblems(root, "/")).toEqual([]);
  });

  it("missing: every page's problem, with a near name", async () => {
    const root = await project(pages);
    const problem = `site.socialImages.component is "components/social-imag", and there is no such component: did you mean "components/social-image"?`;
    expect(await assembledProblems(root, "/", "components/social-imag")).toEqual([problem]);
    expect(await assembledProblems(root, "/about/", "components/social-imag")).toEqual([problem]);
  });

  it("without a schema", async () => {
    const root = await project({ ...pages, "patterns/components/social-image/social-image.schema.json": null });
    expect(await assembledProblems(root, "/about/")).toEqual([
      `site.socialImages.component: components/social-image has no schema: a social image component declares the fields it uses in social-image.schema.json, beside its template`]);
  });

  it("a schema that can't be read: every page's problem already, as for any component's schema", async () => {
    const root = await project({ ...pages, "patterns/components/social-image/social-image.schema.json": "{ not json" });
    const problems = await assembledProblems(root, "/about/");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/social-image\.schema\.json:1:3: not valid JSON \(.+\), so components\/social-image isn't checked against its schema until it's fixed$/);
  });

  it("a field it doesn't get: named; one a variant's data gives: allowed", async () => {
    const root = await project({ ...pages, "patterns/components/social-image/social-image.schema.json": json({ properties: {
      title: { type: "string" }, description: { type: "string" }, section: { type: "string" }, date: { type: "string" },
      site: { type: "object" }, tone: { type: "string" }, author: { type: "string" },
    } }) });
    expect(await assembledProblems(root, "/about/")).toEqual([
      `components/social-image declares "author", which a social image doesn't get: it gets title, description, section, date and site, and what a variant's data gives`]);
  });
});

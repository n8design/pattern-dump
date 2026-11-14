// A storefront page, assembled: its markdown and frontmatter checked, the markdown rendered with live
// examples as frames, and the result rendered through the page's layout — a component like any other,
// through render(). The document around it is the storefront's: its <head> (title, description, and the
// stylesheet layers the caller builds from the layout's CSS closure), the inlined iframe height fitter
// (the one implementation, in contracts), and in `pd dev` the live-reload client.
//
// Every problem is fatal (D7): a page with any — in the pages folder, the page's frontmatter, the site
// values, or its examples and links — is not rendered, and the error document lists them all instead.
//
// The layout's own sample data sits beneath what a page passes in (the renderer's data cascade). So
// every key the layout declares and the page does not set is passed as null, and every site key the base
// partial declares and the config does not set is too: the sample data stays in the workbench and can
// never show on a real page. A layout that declares `page` gets what is derived for the page (derived.ts),
// each declared sub-key present and null where nothing is.

import { createHeightFitter, generationBehind, PD_ROUTES, type DiscoveryMap, type ImageLookup, type Render, type StorefrontNavItem } from "@pattern-dump/contracts";
import { frontmatterBody, frontmatterBodyOffset, readFrontmatterStrict } from "../frontmatter.js";
import { escapeAttr, escapeHtml } from "../http-utils.js";
import { isHelperNameProblem, readProseSlot } from "@pattern-dump/renderer";
import { renderDoc, type ProseImages } from "../markdown.js";
import { readSchema, type PlacedProblem } from "./declared-values.js";
import { checkPageFrontmatter } from "./frontmatter-contract.js";
import { DEFAULT_LAYOUT, NOT_FOUND_FILE, type PageModel } from "./pages.js";
import { checkSite, SITE_SCHEMA_OWNER } from "./site.js";
import { resolveNavigations } from "./navigations.js";
import { checkSampleData } from "./sample-data.js";
import { checkPageDeclaration, pageValue, positionOf, type PageHeading } from "./derived.js";
import { collidingHeadings, idsBesides } from "./anchors.js";
import type { GitDates, PageDates } from "./git-dates.js";
import type { CompositionRegistry } from "../composition.js";
import { readFile } from "node:fs/promises";
import type { PageImage, PageImageCheck } from "./page-image.js";
import { jsonLdScript } from "./json-ld.js";
import { checkHeadMarkup, HEAD_PARTIAL } from "./head-partial.js";
import { checkImages, type ImageFinding } from "./image-checks.js";
import { checkLinks } from "./links.js";
import { checkPageBasics } from "./page-basics.js";
import { redirectsOf } from "./redirects.js";
import { dateOf, entriesOf, type Entry } from "./collections.js";

/** Said once (the same text from every page) when JSON-LD and the sitemap leave dates out for a shallow clone. */
export const SHALLOW_SEO_NOTE = "the repository is a shallow clone, so pages have no dateModified in their JSON-LD "
  + "and no lastmod in the sitemap: build from the full history (in CI, check out with fetch-depth: 0)";

export interface PageAssembly {
  discoveryMap: DiscoveryMap;
  /** Handle to component id: a page places a component by its handle (`<pd-molecules-slider>`). */
  handleMap: Map<string, string>;
  /** A file as problems name it: never an absolute path. */
  shown(path: string): string;
  /** Which components include which: the layout's include tree, for its sample-data check. */
  composition: CompositionRegistry;
  render: Render;
  /** The stylesheet links for a page rendered with `layoutId` whose markup is `html`. */
  head(layoutId: string, html: string): Promise<string>;
  /** storefront.site from the config. */
  site: Record<string, unknown> | undefined;
  /** Where links into the workbench start, ending with "/". */
  workbenchUrl: string;
  /** Set in `pd dev`: the live-reload socket's port, and the generation the page's request took. */
  live?: { wsPort: number; generation: string };
  /** The pages' dates from git (git-dates.ts). Without it, a layout's page.created and page.modified are null. */
  dates?: GitDates;
  /** Checks a link-preview image path against the project's assets (page-image.ts). */
  image(path: string): Promise<PageImageCheck>;
  /** storefront.image: the image of every page that names none. */
  siteImage?: string;
  /** The site's address, ending with "/", when storefront.url is set: canonical, og:url, og:image and
   *  JSON-LD are built from it. Without it they are left out. */
  siteUrl?: string;
  /** <html lang>. Default: "en". */
  lang?: string;
  /** storefront.index: false gives every page noindex. Default: true. */
  siteIndex?: boolean;
  /** The image index, ready for this render: a page's images from the assets are written with their variants
   *  (markdown.ts, ProseImages). Without it, a page's images are written as markdown writes them. */
  images?: () => Promise<ImageLookup>;
}

export interface AssembledPage {
  status: 200 | 404 | 500;
  html: string;
  /** Every problem, one line each. Empty for a page that rendered. */
  problems: string[];
  /** Notes about a page that rendered, one line each: a heading whose anchor was suffixed (anchors.ts). */
  notes: string[];
}

/** The fitter's glue: a frame with a declared height (its `height` attribute, from the component's
 *  x-pd-example-height) starts there; any other starts at 1px, from script, so with scripting off it keeps
 *  the UA default height and stays readable. Then each follows the pd-height its preview document posts.
 *  A frame can be fitted taller but never shorter than it starts (scrollHeight never drops below the frame's
 *  own height), which is why a declared height errs short and an undeclared frame can't keep the UA's 150px. */
export function fitterScript(): string {
  return `<script>(function(){var createHeightFitter=(${createHeightFitter.toString()});`
    + `var fitter=createHeightFitter({write:function(f,h){f.style.height=h+"px";}});`
    + `var frames=function(){return document.querySelectorAll("figure.doc-example iframe");};`
    + `frames().forEach(function(f){if(!f.hasAttribute("height"))f.style.height="1px";});`
    + `addEventListener("message",function(e){var m=fitter.fromMessage(e,frames());if(m)fitter.accept(m.frame,m.height);});`
    + `})();</script>`;
}

/**
 * `pd dev` only: reload when this page or the nav changes, or a component or stylesheet does; list a
 * build problem (a reload that failed, a restart that is needed) in a notice on the page, which the next
 * reload clears. On the storefront's own page, never inside a preview.
 *
 * The page carries the generation its request took (PD_GENERATION_HEADER). A change sent while the page
 * was being rendered, loaded or reloaded reached no socket of it; `hello` says the current generation, and
 * a page behind it reloads, once: the reloaded page takes the current one. The comparison is contracts'
 * `generationBehind`, inlined, as the fitter is.
 */
export function liveScript(wsPort: number, generation = ""): string {
  return `<script data-pd-live>(function(){var g=${JSON.stringify(generation)};`
    + `var behind=(${generationBehind.toString()});`
    + `var ws=new WebSocket("ws://"+location.hostname+":${wsPort}");`
    + `ws.onmessage=function(e){var m;try{m=JSON.parse(e.data);}catch(x){return;}`
    + `if(m.type==="hello"){if(behind(g,m.generation))location.reload();return;}`
    + `if((m.type==="page-changed"&&(m.route===null||m.route===location.pathname))||m.type==="content-swap"||m.type==="css-link-swap")location.reload();`
    + `else if(m.type==="error")(${LIVE_NOTICE})(String(m.message));};`
    + `})();${exampleHeightCheck()}</script>`;
}

/** The live client's notice: one fixed list on the page, a line added per problem; the next reload clears it. */
const LIVE_NOTICE = `function(t){var n=document.querySelector("[data-pd-live-notice]");`
  + `if(!n){n=document.createElement("div");n.setAttribute("data-pd-live-notice","");n.setAttribute("role","alert");`
  + `n.style.cssText="position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:2147483647;padding:.75rem 1rem;background:#fff;color:#000;border:2px solid #b00020;font:14px/1.4 system-ui,sans-serif";`
  + `n.appendChild(document.createElement("ul"));document.body.appendChild(n);}`
  + `var li=document.createElement("li");li.textContent=t;n.firstChild.appendChild(li);}`;

/**
 * Part of the live client, so `pd dev` only: warn when a live example is declared taller than its content (x-pd-example-height), the one
 * mistake the fitter can't correct. Once per load of each frame with a declared height, after its fonts are
 * ready: the preview's root box is the content's own height (scrollHeight is floored at the frame's). A root box
 * exactly as tall as the frame is ambiguous (`html { height: 100% }` fills any frame) and stays silent; only a
 * root clearly shorter than the declared height warns, on the console and in the live notice. Each check ends
 * in one console.debug line saying its outcome.
 */
function exampleHeightCheck(): string {
  return `(function(){var notice=(${LIVE_NOTICE});`
    + `document.querySelectorAll("figure.doc-example iframe[height]").forEach(function(f){`
    + `var check=function(){var d=f.contentDocument;if(!d||d.URL==="about:blank")return;d.fonts.ready.then(function(){`
    + `var declared=Number(f.getAttribute("height")),root=d.documentElement.getBoundingClientRect().height,id=f.title,outcome="fits";`
    + `if(root===f.clientHeight)outcome="can't tell (the content is as tall as its frame)";`
    + `else if(root<declared-1){outcome="too tall";var t=id+": its live example is declared "+declared+"px tall (x-pd-example-height), but its content is "+Math.round(root)`
    + `+"px. A frame is never fitted shorter than it starts, so it stays too tall: declare at most "+Math.floor(root)+".";console.warn(t);notice(t);}`
    + `console.debug("[pd] example height of "+id+": "+outcome);});};`
    + `f.addEventListener("load",check);if(f.contentDocument&&f.contentDocument.readyState==="complete")check();});`
    + `})();`;
}

function document(head: string, body: string, live: PageAssembly["live"], lang = "en"): string {
  return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${head}
</head>
<body>
${body}
${live ? liveScript(live.wsPort, live.generation) : ""}
</body>
</html>`;
}

/**
 * A page's search and link-preview tags, after its title and description. Without the site's address only
 * what needs none: robots. With it: canonical, Open Graph (og:image with its size when the page has an
 * image) and the Twitter card, large only with an image.
 */
export function seoTags(p: {
  route: string; title: string; description: string | undefined; siteTitle: string | undefined;
  siteUrl: string | undefined; image: PageImage | undefined; index: boolean;
}): string[] {
  const tags: string[] = [];
  if (!p.index) tags.push(`<meta name="robots" content="noindex">`);
  if (p.siteUrl === undefined) return tags;
  const abs = (path: string) => new URL(path.replace(/^\//, ""), p.siteUrl).href;
  const url = abs(p.route);
  tags.push(
    `<link rel="canonical" href="${escapeAttr(url)}">`,
    `<meta property="og:type" content="website">`,
    ...(p.siteTitle ? [`<meta property="og:site_name" content="${escapeAttr(p.siteTitle)}">`] : []),
    `<meta property="og:title" content="${escapeAttr(p.title)}">`,
    ...(p.description ? [`<meta property="og:description" content="${escapeAttr(p.description)}">`] : []),
    `<meta property="og:url" content="${escapeAttr(url)}">`,
  );
  if (p.image) {
    tags.push(
      `<meta property="og:image" content="${escapeAttr(abs(p.image.path))}">`,
      `<meta property="og:image:width" content="${p.image.width}">`,
      `<meta property="og:image:height" content="${p.image.height}">`,
    );
  }
  tags.push(`<meta name="twitter:card" content="${p.image ? "summary_large_image" : "summary"}">`);
  return tags;
}

/** The URLs in markup's href, src, poster, action and srcset that are relative: not root-relative ("/…"), not
 *  a fragment ("#…"), and with no scheme. Each once, in order. */
export function relativeUrls(markup: string): string[] {
  const urls: string[] = [];
  for (const m of markup.matchAll(/\s(href|src|poster|action|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (m[2] ?? m[3] ?? "").trim();
    const candidates = m[1]!.toLowerCase() === "srcset" ? value.split(",").map(c => c.trim().split(/\s+/)[0] ?? "") : [value];
    for (const u of candidates) if (u !== "" && !/^(?:\/|#|[a-z][a-z0-9+.-]*:)/i.test(u)) urls.push(u);
  }
  return [...new Set(urls)];
}

/** The built-in 404 page's markdown, through the default layout: with a title when that layout declares one. */
function builtInNotFound(layoutDeclaresTitle: boolean): string {
  const body = "There is no page at this address. Start again from the [home page](/).\n";
  return layoutDeclaresTitle ? `---\ntitle: Page not found\n---\n\n${body}` : `# Page not found\n\n${body}`;
}
/** The 404 page of a site with no 404.md and no default layout. */
const BUILT_IN_NOT_FOUND_DOCUMENT = `<main>\n<h1>Page not found</h1>\n<p>There is no page at this address. <a href="/">Go to the home page</a>.</p>\n</main>`;

/** The document shown instead of a page that has problems: every problem, escaped. */
/** `siteWide`: the problems that are the whole site's, not this page's (storefront.site): each is marked
 *  data-pd-site, so a build that crawls every page lists it once. */
export function errorDocument(route: string, problems: string[], live: PageAssembly["live"], siteWide: readonly string[] = []): string {
  const items = problems.map(p => `<li${siteWide.includes(p) ? " data-pd-site" : ""}>${escapeHtml(p)}</li>`).join("\n");
  return document(`<title>Problems — ${escapeHtml(route)}</title>`,
    `<main>\n<h1>The page ${escapeHtml(route)} cannot be built</h1>\n<ul class="pd-problems">\n${items}\n</ul>\n</main>`, live);
}

/** Declared keys the values do not set, as null; the values themselves as they are. */
const withDeclaredAbsentAsNull = (values: Record<string, unknown>, declared: string[], except: readonly string[] = []): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of declared) if (!except.includes(key)) out[key] = null;
  return { ...out, ...values };
};

const markCurrent = (nav: StorefrontNavItem[], route: string): unknown[] => nav.map(item => ({
  ...item,
  ...(item.route === route ? { current: true } : {}),
  ...(item.children ? { children: item.children.map(c => ({ ...c, ...(c.route === route ? { current: true } : {}) })) } : {}),
}));

export async function assemblePage(route: string, model: PageModel, a: PageAssembly): Promise<AssembledPage> {
  let siteWide: string[] = [];
  const fail = (problems: string[]): AssembledPage => ({ status: 500, html: errorDocument(route, problems, a.live, siteWide), problems, notes: [] });

  // The pages folder as a whole: a problem there is a problem for every page.
  if (model.problems.length) return fail(model.problems);

  const notFound = (): AssembledPage =>
    ({ status: 404, html: errorDocument(route, [`there is no page at ${route}`], a.live), problems: [`there is no page at ${route}`], notes: [] });
  // The site's "not found" page, at /404.html: its 404.md, or a built-in one through the default layout.
  const isNotFound = route === PD_ROUTES.notFound;
  let page = isNotFound ? model.notFound : model.files.get(route);
  let source: string | undefined;
  if (isNotFound && !page) {
    const layoutId = `layouts/${DEFAULT_LAYOUT}`;
    if (!a.discoveryMap.has(layoutId)) {
      return { status: 404, html: document(`<title>Page not found</title>`, BUILT_IN_NOT_FOUND_DOCUMENT, a.live, a.lang), problems: [],
        notes: [`there is no ${NOT_FOUND_FILE} and no ${layoutId}, so the 404 page is a plain one of Pattern Dump's`] };
    }
    const declared = (await readSchema(a.discoveryMap.get(layoutId)?.schemaPath)).schema?.properties ?? {};
    source = builtInNotFound(Object.hasOwn(declared, "title"));
    page = { route, file: "", path: `${NOT_FOUND_FILE} (built in)`, frontmatter: readFrontmatterStrict(source) };
  }
  if (!page) return notFound();
  // A page the folder listed can be gone by now (deleted between reading the folder and this request):
  // then there is no page at this route.
  if (source === undefined) {
    try {
      source = await readFile(page.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return notFound();
      throw e;
    }
  }

  const problems: string[] = [];
  const checked = await checkPageFrontmatter(page, a.discoveryMap);
  problems.push(...checked.problems.map(p => `${p.file}${p.line !== undefined ? `:${p.line}` : ""}: ${p.message}`));
  if (isNotFound && checked.build.redirectFrom) {
    const line = page.frontmatter.lines["redirectFrom"];
    problems.push(`${page.path}${line !== undefined ? `:${line}` : ""}: the 404 page can't have redirectFrom: it is served for every address that has no page`);
  }
  const site = await checkSite(a.site, a.discoveryMap, new Set([...model.files.values()].map(f => f.path)));
  siteWide = site.problems;
  problems.push(...site.problems);

  // The link-preview image: the page's own, else the site's. A bad site image is the whole site's problem.
  const imageLine = page.frontmatter.lines["image"];
  const imageCheck = checked.build.image !== undefined ? await a.image(checked.build.image)
    : a.siteImage !== undefined ? await a.image(a.siteImage) : undefined;
  if (imageCheck && !imageCheck.ok) {
    if (checked.build.image !== undefined) problems.push(`${page.path}${imageLine !== undefined ? `:${imageLine}` : ""}: ${imageCheck.message}`);
    else {
      const p = `storefront.image: ${imageCheck.message}`;
      siteWide = [...siteWide, p];
      problems.push(p);
    }
  }

  // The layout's slot for the page's images (x-pd-prose-images), and the image index they are looked up in.
  const layoutSchema = (await readSchema(a.discoveryMap.get(checked.layoutId)?.schemaPath)).schema;
  const proseSlot = readProseSlot(layoutSchema);
  const imageLookup = a.images ? await a.images() : undefined;

  /** The page's markdown, rendered; its headings' anchors never take one of `takenIds`. */
  const renderBody = async (takenIds: string[] = []) => {
    const prose: ProseImages | undefined = imageLookup ? {
      layoutId: checked.layoutId, lookup: imageLookup, lineOffset: frontmatterBodyOffset(source), problems: [],
      ...(proseSlot.slot ? { slot: proseSlot.slot } : {}), ...(proseSlot.problem ? { slotProblem: proseSlot.problem } : {}),
    } : undefined;
    const docProblems: string[] = [];
    const placedProblems: PlacedProblem[] = [];
    const headings: PageHeading[] = [];
    const body = await renderDoc(
      frontmatterBody(source),
      (id, variant) => a.render({ component: id, variant }).then(r => r.html),
      a.discoveryMap,
      {
        embed: "frame", workbenchUrl: a.workbenchUrl, problems: docProblems, headings, takenIds, ...(prose ? { prose } : {}),
        // Components placed with values (pd- tags): checked against their schemas, rendered into the page.
        placed: {
          lineOffset: frontmatterBodyOffset(source),
          problems: placedProblems,
          deps: {
            discoveryMap: a.discoveryMap, handleMap: a.handleMap, composition: a.composition, render: a.render,
            schemaOf: async id => (await readSchema(a.discoveryMap.get(id)?.schemaPath)).schema,
            shown: a.shown,
          },
        },
      },
    );
    return { body, headings, docProblems, placedProblems, imageProblems: prose?.problems ?? [] };
  };
  const first = await renderBody();
  problems.push(...first.docProblems.map(p => `${page.path}: ${p}`));
  problems.push(...first.placedProblems.map(p => `${page.path}:${p.at.line}:${p.at.column}: ${p.message}`));
  problems.push(...first.imageProblems.map(p => `${page.path}:${p.line}: ${p.message}`));

  // The layout's sample data, and that of every partial it includes, must stay out of real pages.
  const siteSchema = (await readSchema(a.discoveryMap.get(SITE_SCHEMA_OWNER)?.schemaPath)).schema;
  const layoutDeclared = Object.keys(layoutSchema?.properties ?? {});
  const siteDeclared = Object.keys(siteSchema?.properties?.site?.properties ?? {});
  const pageDeclaration = checkPageDeclaration(layoutSchema, checked.layoutId);
  problems.push(...pageDeclaration.problems);
  // Dates for a layout that shows them, and for the JSON-LD of a site with an address; the git pass never
  // runs for a site that needs neither. Only a layout that shows dates is stopped by an unreliable one (a
  // shallow clone in pd build) or noted about a missing one: the JSON-LD just leaves the date out.
  const notes: string[] = [];
  let dates: Partial<PageDates> = {};
  let modified: string | null = null;
  // datePublished: the page's own date, else the day git first saw it.
  let published: string | null = checked.build.date ?? null;
  const mode = a.live ? "dev" : "build";
  const declares = (k: string) => pageDeclaration.declared?.includes(k) ?? false;
  const showsDates = declares("created") || declares("modified");
  if (a.dates && !isNotFound && (showsDates || a.siteUrl !== undefined)) {
    const dated = await a.dates.of(page.path, mode);
    if (showsDates) {
      dates = dated.dates;
      notes.push(...dated.notes);
      problems.push(...dated.problems);
    }
    if (dated.shallow) notes.push(SHALLOW_SEO_NOTE);
    else { modified = dated.dates.modified; published ??= dated.dates.created; }
  }
  // A listing's entries, and the page's own date and tags (collections.ts), for a layout that shows them.
  const listing: { children?: Entry[]; date?: string | null; tags?: string[] } = {};
  if (declares("children")) {
    const listed = isNotFound ? { entries: [], problems: [], notes: [] } : await entriesOf(route, model, { dates: a.dates, mode });
    listing.children = listed.entries;
    problems.push(...listed.problems);
    notes.push(...listed.notes);
  }
  if (declares("date")) {
    const dated = isNotFound ? { date: null, problems: [], notes: [] } : await dateOf(route, model, a.dates, mode);
    listing.date = dated.date;
    problems.push(...dated.problems);
    notes.push(...dated.notes);
  }
  if (declares("tags")) listing.tags = model.entries.get(route)?.tags ?? [];
  if (a.discoveryMap.has(checked.layoutId)) {
    problems.push(...await checkSampleData(checked.layoutId, a.discoveryMap, a.composition, layoutDeclared, siteDeclared, pageDeclaration.declared, site.listed));
  }
  // The skin's head partial: the same for every page, so its problems are the whole site's.
  const hasHead = a.discoveryMap.has(HEAD_PARTIAL);
  if (hasHead) {
    const headSample = await checkSampleData(HEAD_PARTIAL, a.discoveryMap, a.composition, [], siteDeclared, undefined, site.listed);
    siteWide = [...siteWide, ...headSample];
    problems.push(...headSample);
  }
  if (problems.length) return fail(problems);

  // What the layout gets: its declared values, null where the page sets none, then what the storefront fills.
  const siteData = {
    ...withDeclaredAbsentAsNull(site.values, siteDeclared),
    ...(site.listed.length ? { navigations: resolveNavigations(site.navigations, site.listed, model, route) } : {}),
  };
  const dataFor = (body: string, headings: PageHeading[]) => ({
    ...withDeclaredAbsentAsNull(checked.values, layoutDeclared, ["body", "nav", "site", "page"]),
    body,
    nav: markCurrent(model.nav, route),
    site: siteData,
    ...(pageDeclaration.declared ? { page: pageValue(pageDeclaration.declared, { headings, ...positionOf(route, model), ...dates, ...listing }) } : {}),
  });
  // A template that fails to render (a helper it calls that is not registered, say) is a page problem
  // like any other, listed and escaped, never an unhandled 500.
  const renderLayout = async (body: string, headings: PageHeading[]): Promise<Awaited<ReturnType<Render>> | AssembledPage> => {
    try {
      return await a.render({ component: checked.layoutId, data: dataFor(body, headings) });
    } catch (e) {
      return fail([`${page.path}: ${e instanceof Error ? e.message : String(e)}`]);
    }
  };
  const isFailed = (r: Awaited<ReturnType<Render>> | AssembledPage): r is AssembledPage => "status" in r;
  let rendered = await renderLayout(first.body, first.headings);
  let finalBody = first.body;
  if (isFailed(rendered)) return rendered;
  // A layout field named like a registered helper can never be shown by its name: the page fails, as the
  // workbench shows the same SCHEMA_INVALID on the layout.
  const helperNamed = (rendered.meta?.diagnostics ?? []).filter(d => d.kind === "SCHEMA_INVALID" && isHelperNameProblem(d.message));
  if (helperNamed.length) {
    return fail(helperNamed.map(d => `${d.location?.file ?? checked.layoutId} (${d.path ?? "#"}): ${d.message}`));
  }

  // A heading's anchor the layout has as an id too: the body again, with the layout's ids taken, so the
  // heading gets the next free suffix, and the layout again, with the anchors that now hold.
  const layoutIds = idsBesides(rendered.html, first.headings);
  const colliding = collidingHeadings(first.headings, layoutIds);
  if (colliding.length) {
    const second = await renderBody(layoutIds);
    rendered = await renderLayout(second.body, second.headings);
    finalBody = second.body;
    if (isFailed(rendered)) return rendered;
    const still = collidingHeadings(second.headings, idsBesides(rendered.html, second.headings));
    if (still.length) {
      return fail(still.map(h => `${page.path}: heading "${h.text}" is #${h.anchor}, which the layout has as an id as well, `
        + `even after the suffix: the layout must not make ids from page.headings`));
    }
    for (const [i, h] of first.headings.entries()) {
      const now = second.headings[i]!;
      if (now.anchor === h.anchor) continue;
      notes.push(`${page.path}: heading "${h.text}" is #${now.anchor}, ` + (layoutIds.includes(h.anchor)
        ? `because the layout uses id="${h.anchor}"`
        : `because #${h.anchor} went to an earlier heading whose anchor the layout uses`));
    }
  }

  const html = rendered.html;
  // The skin's head partial: the site's values, and body and nav as null so no sample of them can show.
  let headExtra = "";
  if (hasHead) {
    try {
      headExtra = (await a.render({ component: HEAD_PARTIAL, data: { site: siteData, body: null, nav: null } })).html.trim();
    } catch (e) {
      const p = `${HEAD_PARTIAL}: ${e instanceof Error ? e.message : String(e)}`;
      siteWide = [...siteWide, p];
      return fail([p]);
    }
    const markup = checkHeadMarkup(headExtra);
    if (markup.length) { siteWide = [...siteWide, ...markup]; return fail(markup); }
  }
  const title = typeof checked.values["title"] === "string" ? checked.values["title"] : isNotFound ? "Page not found" : route;
  const siteTitle = typeof site.values["title"] === "string" ? site.values["title"] : undefined;
  const description = typeof checked.values["description"] === "string" ? checked.values["description"] : undefined;
  const head = [
    `<title>${escapeHtml(siteTitle && siteTitle !== title ? `${title} — ${siteTitle}` : title)}</title>`,
    ...(description ? [`<meta name="description" content="${escapeAttr(description)}">`] : []),
    // The 404 page is served at every address that has none: no address of its own, never indexed.
    ...seoTags({
      route, title, description, siteTitle, siteUrl: isNotFound ? undefined : a.siteUrl,
      image: imageCheck?.ok ? imageCheck.image : undefined,
      index: !isNotFound && a.siteIndex !== false && checked.build.index !== false,
    }),
    ...(a.siteUrl !== undefined && !isNotFound
      ? [jsonLdScript({ siteUrl: a.siteUrl, siteTitle, route, title, description, breadcrumbs: positionOf(route, model).breadcrumbs, modified, published })]
      : []),
    ...(headExtra ? [headExtra] : []),
    await a.head(checked.layoutId, html),
  ].join("\n");
  // The 404 page is served at any depth, so every URL in it (its body's, its layout's, the head's) must be
  // root-relative or absolute: a relative one points somewhere else on every address.
  if (isNotFound) {
    const relative = relativeUrls(`${head}\n${html}`);
    if (relative.length) {
      return fail(relative.map(u => {
        const instead = u.startsWith("./") ? `use "/${u.slice(2)}" instead` : `write it from the site's root ("/…") instead`;
        return `the 404 page (${page!.path}): the URL "${u}" is relative, and the 404 page is served at every address, `
          + `so it only works from the site's root: ${instead}`;
      }));
    }
  }
  // The page's images (image-checks.ts): its body's named by its file, the rest (its layout and the partials that
  // layout includes) by the layout. In pd build a missing size and a raster served as it is fail the page; in pd dev
  // they are warnings, so editing is never blocked. An external image is a note in both.
  // The layout's are the page's less the body's: a layout's partial block indents what it wraps, so the body can't
  // be cut out of the page as written. An image both have is the body's.
  const ofBody = checkImages(finalBody);
  const ofLayout = checkImages(html);
  for (const f of ofBody) {
    const i = ofLayout.findIndex(g => g.kind === f.kind && g.src === f.src);
    if (i >= 0) ofLayout.splice(i, 1);
  }
  const imageProblems: string[] = [];
  const said = (where: string, f: ImageFinding) => {
    const tag = `<img src="${f.src.length > 80 ? `${f.src.slice(0, 77)}...` : f.src}">`;
    if (f.kind === "external") {
      notes.push(`${where}: ${tag} is an external image: Pattern Dump can't make WebP variants of it, so it is served as it is`);
    } else {
      imageProblems.push(f.kind === "size"
        ? `${where}: ${tag} has no width and height, so the page shifts when it loads: give both, or place it with {{pd-image}}`
        : `${where}: ${tag} is a raster image served as it is: place it with {{pd-image}} in a template, or as a markdown `
          + `image in a page, so it gets its WebP variants`);
    }
  };
  for (const f of ofBody) said(page.path, f);
  for (const f of ofLayout) said(checked.layoutId, f);
  if (imageProblems.length) {
    if (!a.live) return fail(imageProblems);
    notes.push(...imageProblems.map(p => `warning: ${p}`));
  }
  // pd dev: the page's links to the site's pages (and old routes that forward), and its own anchors, as warnings
  // (links.ts). pd build checks every link of every page once the whole site is built (static-build.ts).
  if (a.live) {
    const self = isNotFound ? PD_ROUTES.notFound : route;
    const routes = new Set<string>([...model.files.keys(), ...[...model.files.values()].flatMap(redirectsOf), PD_ROUTES.notFound]);
    routes.add(self);
    const links = checkLinks({ built: routes, documents: new Map([[self, html]]), pages: [self], pagesOnly: true });
    notes.push(...links.problems.map(p => `warning: ${page!.path}${p.slice(self.length)}`));
    // One main landmark and one <h1> (page-basics.ts): errors in pd build, warnings here.
    notes.push(...checkPageBasics(html).map(p => `warning: ${page!.path}: ${p}`));
  }
  return { status: isNotFound ? 404 : 200, html: document(head, `${html}\n${fitterScript()}`, a.live, a.lang), problems: [], notes };
}

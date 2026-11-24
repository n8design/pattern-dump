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

import { placementSchemaPath } from "../discovery-index.js";
import { createHeightFitter, generationBehind, PD_ROUTES, type DiscoveryMap, type ImageLookup, type Render, type StorefrontNavItem, type ThemeSwitch } from "@pattern-dump/contracts";
import { themeSyncScript } from "./theme-sync.js";
import { spriteMarkup, symbolId, type SymbolIndex, type SymbolSource } from "../symbols.js";
import { hideSvgBySize, svgIds } from "../requires.js";
import type { PageSymbolSets } from "./page-head.js";
import { defaultsNote, originOf, placeOf } from "./folder-defaults.js";
import { layoutIndex } from "./layout-index.js";
import { frontmatterBody, frontmatterBodyOffset, readFrontmatterStrict } from "../frontmatter.js";
import { escapeAttr, escapeHtml } from "../http-utils.js";
import type { SearchRecord } from "./search.js";
import { chooseRegion, layoutRegions, regionLandmarks, skinRegions } from "./regions.js";
import { derivedToc, TOC_ID, tocAnchorProblems } from "./toc.js";
import { placeTocItems, type PlacementDeps } from "./placed.js";
import { isHelperNameProblem, itemsWrittenAsText, readProseSlot, renderPlainTemplate } from "@pattern-dump/renderer";
import { basename } from "node:path";
import { renderDoc, type DocRegions, type ProseImages, type SymbolImages } from "../markdown.js";
import { readSchema, unreadableSchemas, type ObjectSchema, type PlacedProblem } from "./declared-values.js";
import { ASSEMBLY_KEYS, checkPageFrontmatter, RESERVED_KEYS } from "./frontmatter-contract.js";
import { DEFAULT_LAYOUT, NOT_FOUND_FILE, type PageFile, type PageModel } from "./pages.js";
import { renderError } from "./pages-cache.js";
import { designFiles } from "./design-files.js";
import { checkSite, SITE_SCHEMA_OWNER } from "./site.js";
import { resolveNavigations } from "./navigations.js";
import { checkPageDeclaration, FILLED, pageValue, positionOf, RETIRED, type DerivedPage, type PageHeading } from "./derived.js";
import { checkDeclaredQueries, declaredQueries, resolveQuery, type ResolvedQuery } from "./query.js";
import { collidingHeadings, idsBesides } from "./anchors.js";
import type { GitDates, PageDates } from "./git-dates.js";
import type { CompositionRegistry } from "../composition.js";
import { readFile } from "node:fs/promises";
import type { PageImage, PageImageCheck } from "./page-image.js";
import { jsonLdScript } from "./json-ld.js";
import { includeTree } from "../composition.js";
import { checkHeadMarkup, HEAD_PARTIAL } from "./head-partial.js";
import { checkImages, type ImageFinding } from "./image-checks.js";
import { checkLinks } from "./links.js";
import { checkPageBasics } from "./page-basics.js";
import { dateOf, entriesOf, resolveCollections, type Entry } from "./collections.js";
import { cardOf, checkEntries, readCard } from "./cards.js";
import { DEFAULT_VIEW_KEY, resolveView } from "./views.js";
import { termOf, type Category, type Term } from "./categories.js";
import type { GeneratedPage } from "./terms.js";

/** Said once (the same text from every page) when JSON-LD leaves git's date out for a shallow clone. */
export const SHALLOW_SEO_NOTE = "the repository is a shallow clone, so pages without a date of their own have no datePublished "
  + "in their JSON-LD: build from the full history (in CI, check out with fetch-depth: 0)";

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
  /** The page's stylesheets and scripts: of its layout, and of the components it places (`placed`, by id). */
  head(layoutId: string, html: string, placed: readonly string[]): Promise<string>;
  /** The stylesheets the page links only by a borrowed class, as messages (page-head.ts, pageBorrowedStyles), for
   *  the components it renders: its layout and what it places. Each becomes a warning on the page. */
  borrowed?(roots: readonly string[]): Promise<string[]>;
  /** storefront.site from the config. */
  site: Record<string, unknown> | undefined;
  /** Where links into the workbench start, ending with "/". */
  workbenchUrl: string;
  /** What templates get as `site.workbenchUrl`: pd dev's own workbench, or the configured site.workbenchUrl in pd
   *  build (which a site needs). Absent for a headless check of the pages (checkSitePages). */
  siteWorkbenchUrl?: string;
  /** Set in `pd dev`: the live-reload socket's port, the generation the page's request took, and the site's base
   *  path ("/" or "/docs/"), which the live client puts in front of a changed page's route. */
  live?: { wsPort: number; generation: string; basePath: string };
  /** The pages' dates from git (git-dates.ts). Without it, a layout's page.created is null. */
  dates?: GitDates;
  /** Checks a link-preview image path against the project's assets, or an image beside the pages when `beside` is
   *  its path in the pages folder (page-image.ts). */
  image(path: string, as?: { written: string; beside?: string }): Promise<PageImageCheck>;
  /** storefront.image: the image of every page that names none. */
  siteImage?: string;
  /** storefront.head: the site's own head file, by its absolute path and as the config names it. */
  siteHead?: { path: string; name: string };
  /** The path the site is published under ("/project/"), put in front of its references on the way out
   *  (base-path.ts). Here: the page's <meta name="pd-base-path">, and the hint on a link written with it already.
   *  Default "/". */
  basePath?: string;
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
  /** The symbols in the asset roots' symbols/ folders (symbols.ts): a page's `![Alt](#stem)` images are drawn from them,
   *  through a hidden sprite at the top of its body. Without it, such images are written as markdown writes them. */
  symbols?: () => Promise<SymbolIndex>;
  /** The symbol sets (`requireAssets`) of the page's layout and of the components it renders besides (`roots`), with
   *  each set no asset folder has (page-head.ts, pageSymbolSets). Without it, a page carries no symbol sets. */
  symbolSets?(roots: readonly string[]): Promise<PageSymbolSets>;
  /** The project's preview themes and how they switch: a page carries its own data-theme into the previews it
   *  embeds (theme-sync.ts). Without it, or with no themes, the page gets no such script. */
  themes?: { names: readonly string[]; switch: ThemeSwitch };
}

export interface AssembledPage {
  status: 200 | 404 | 500;
  html: string;
  /** Every problem, one line each. Empty for a page that rendered. */
  problems: string[];
  /** Notes about a page that rendered, one line each: a heading whose anchor was suffixed (anchors.ts). */
  notes: string[];
  /** What the page gives the site's search index (search.ts): a page of the site that rendered, other than the 404
   *  page, a tag or category page, and a page with `index: false`. */
  search?: SearchRecord;
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

/** The theme sync for a page's embedded previews (theme-sync.ts), on its own line; empty when it has none. */
function themeSync(a: PageAssembly, html: string): string {
  const script = a.themes ? themeSyncScript(a.themes.names, a.themes.switch, html) : "";
  return script ? `\n${script}` : "";
}

/** The copy buttons' script, on a page that has a code block (code-blocks.ts writes it without a button). Only where the
 *  browser can write to the clipboard, it puts a button in front of each block that copies the block's code (its
 *  data-raw), says "Copied" on the button for a moment, and says it in a polite live region too, since the button's
 *  name ("Copy source") doesn't change. Without scripting, or without a clipboard, the page has no button at all: no
 *  focus stop that does nothing, and none a skin's CSS could show. The block itself stays focusable. */
export function copyScript(): string {
  return `<script>(function(){if(!(navigator.clipboard&&navigator.clipboard.writeText))return;`
    + `var status=document.createElement("div");status.setAttribute("role","status");status.setAttribute("aria-live","polite");`
    + `status.style.cssText="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";`
    + `document.body.appendChild(status);`
    + `document.querySelectorAll(".shiki-container[data-raw]").forEach(function(c){`
    + `var b=document.createElement("button");b.type="button";b.className="copy-btn";b.setAttribute("aria-label","Copy source");b.textContent="Copy";`
    + `b.addEventListener("click",function(){var say=function(t){b.textContent=t;status.textContent=t;setTimeout(function(){b.textContent="Copy";status.textContent="";},1500);};`
    + `navigator.clipboard.writeText(c.getAttribute("data-raw")||"").then(function(){say("Copied");},function(){say("Not copied");});});`
    + `c.insertBefore(b,c.firstChild);});`
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
 *
 * A socket that closes (pd dev stopped or restarted, the machine asleep) is opened again a second later, and
 * again while nothing answers, as the workbench's is. The new socket's `hello` decides: a page that missed a
 * change, or whose server is another process now, is behind and reloads; one that missed nothing stays.
 *
 * `page-changed` names a site route ("/about/"); the page is served under the site's base path (`basePath`,
 * "/" or "/docs/", one trailing slash), so it compares the route there.
 */
export function liveScript(wsPort: number, generation = "", basePath = "/"): string {
  return `<script data-pd-live>(function(){var g=${JSON.stringify(generation)},base=${JSON.stringify(basePath)};`
    + `var behind=(${generationBehind.toString()});`
    + `function connect(){var ws=new WebSocket("ws://"+location.hostname+":${wsPort}");`
    + `ws.onmessage=function(e){var m;try{m=JSON.parse(e.data);}catch(x){return;}`
    + `if(m.type==="hello"){if(behind(g,m.generation))location.reload();return;}`
    + `if((m.type==="page-changed"&&(m.route===null||base+String(m.route).slice(1)===location.pathname))||m.type==="content-swap"||m.type==="css-link-swap")location.reload();`
    + `else if(m.type==="error")(${LIVE_NOTICE})(String(m.message));};`
    + `ws.onclose=function(){setTimeout(connect,1000);};}`
    + `connect();})();${exampleHeightCheck()}</script>`;
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

/** `base`: the path the site is published under, written as `<meta name="pd-base-path">` on every page of the site
 *  ("/" at a host's root), so a skin's own script can build a URL under it; undefined for a page that is not the
 *  site's (a page with problems). */
/** `regions`: the filled regions of a page whose layout declares regions (regions.ts), on <body> as data-pd-regions. */
function document(head: string, body: string, live: PageAssembly["live"], lang = "en", base?: string, regions?: readonly string[]): string {
  return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${base !== undefined ? `<meta name="pd-base-path" content="${escapeAttr(base)}">
` : ""}${head}
</head>
<body${regions ? ` data-pd-regions="${escapeAttr(regions.join(" "))}"` : ""}>
${body}
${live ? liveScript(live.wsPort, live.generation, live.basePath) : ""}
</body>
</html>`;
}

/** A page that is an article: its own date, its own updated (when it has one), its tags' and its categories' labels. */
export interface PageArticle { published: string; modified?: string; tags: string[]; sections: string[] }

/**
 * Whether the page at `route` is an article, for og:type and JSON-LD: a page whose frontmatter gives it a `date`, other
 * than the home page and a listing (a folder's index.md with pages under it). The date git gives a page is not one:
 * every committed page has it, so it says nothing about what the page is.
 */
export function articleOf(route: string, model: PageModel, ownDate: string | undefined, updated?: string): PageArticle | undefined {
  if (ownDate === undefined || route === "/" || (model.folders.get(route)?.children.length ?? 0) > 0) return undefined;
  const e = model.entries.get(route);
  return { published: ownDate, ...(updated !== undefined ? { modified: updated } : {}), tags: (e?.tags ?? []).map(t => t.label),
    sections: (e?.categories ?? []).map(c => c.label) };
}

/**
 * A page's search and link-preview tags, after its title and description. Without the site's address only
 * what needs none: robots. With it: canonical, Open Graph (og:image with its size when the page has an
 * image) and the Twitter card, large only with an image.
 */
export function seoTags(p: {
  route: string; title: string; description: string | undefined; siteTitle: string | undefined;
  siteUrl: string | undefined; image: PageImage | undefined; index: boolean;
  /** The page is an article (articleOf): og:type article, with its date, its first category as article:section (Open
   *  Graph has one) and one article:tag per tag, each by its label. */
  article?: PageArticle | undefined;
}): string[] {
  const tags: string[] = [];
  if (!p.index) tags.push(`<meta name="robots" content="noindex">`);
  if (p.siteUrl === undefined) return tags;
  const abs = (path: string) => new URL(path.replace(/^\//, ""), p.siteUrl).href;
  const url = abs(p.route);
  tags.push(
    `<link rel="canonical" href="${escapeAttr(url)}">`,
    `<meta property="og:type" content="${p.article ? "article" : "website"}">`,
    ...(p.siteTitle ? [`<meta property="og:site_name" content="${escapeAttr(p.siteTitle)}">`] : []),
    `<meta property="og:title" content="${escapeAttr(p.title)}">`,
    ...(p.description ? [`<meta property="og:description" content="${escapeAttr(p.description)}">`] : []),
    `<meta property="og:url" content="${escapeAttr(url)}">`,
  );
  if (p.article) {
    tags.push(`<meta property="article:published_time" content="${escapeAttr(p.article.published)}">`,
      ...(p.article.modified !== undefined ? [`<meta property="article:modified_time" content="${escapeAttr(p.article.modified)}">`] : []),
      ...(p.article.sections[0] !== undefined ? [`<meta property="article:section" content="${escapeAttr(p.article.sections[0])}">`] : []),
      ...p.article.tags.map(t => `<meta property="article:tag" content="${escapeAttr(t)}">`));
  }
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
  return document(`<title>Problems · ${escapeHtml(route)}</title>`,
    `<main>\n<h1>The page ${escapeHtml(route)} cannot be built</h1>\n<ul class="pd-problems">\n${items}\n</ul>\n</main>`, live);
}

/** Declared keys the values do not set, as null; the values themselves as they are. */
const withDeclaredAbsentAsNull = (values: Record<string, unknown>, declared: string[], except: readonly string[] = []): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of declared) if (!except.includes(key)) out[key] = null;
  return { ...out, ...values };
};

/** Where each route is in a nav: its entries' indexes and, for a child, its index among its parent's children. Worked
 *  out once per nav (the page model is shared by every page and never changed). */
const navPlaces = new WeakMap<readonly StorefrontNavItem[], Map<string, Array<[number, number | undefined]>>>();
function placesIn(nav: readonly StorefrontNavItem[]): Map<string, Array<[number, number | undefined]>> {
  let places = navPlaces.get(nav);
  if (!places) {
    places = new Map();
    const add = (route: string, at: [number, number | undefined]): void => { places!.set(route, [...places!.get(route) ?? [], at]); };
    nav.forEach((item, i) => { add(item.route, [i, undefined]); item.children?.forEach((c, j) => add(c.route, [i, j])); });
    navPlaces.set(nav, places);
  }
  return places;
}

/** The nav with `current: true` on the entries at `route`. Only those, and the entries holding them, are new objects;
 *  the rest are the model's own, shared by every page (frozen in the server). */
const markCurrent = (nav: readonly StorefrontNavItem[], route: string): unknown[] => {
  const out: unknown[] = [...nav];
  const children = new Map<number, unknown[]>();
  for (const [i, j] of placesIn(nav).get(route) ?? []) {
    const item = nav[i]!;
    if (j === undefined) { out[i] = { ...(out[i] as StorefrontNavItem), current: true }; continue; }
    const list = children.get(i) ?? [...item.children!];
    list[j] = { ...item.children![j]!, current: true };
    children.set(i, list);
  }
  for (const [i, list] of children) out[i] = { ...(out[i] as StorefrontNavItem), children: list };
  return out;
};

/** The paths of a site's pages and its folders, for checkSite: the same for every page, so worked out once per model. */
const sitePaths = new WeakMap<PageModel, { pages: Set<string>; folders: Set<string> }>();
function pathsOf(model: PageModel): { pages: Set<string>; folders: Set<string> } {
  let paths = sitePaths.get(model);
  if (!paths) {
    paths = {
      pages: new Set([...model.files.values()].map(f => f.path)),
      folders: new Set([...model.folders.keys()].filter(r => r !== "/").map(r => r.slice(1, -1))),
    };
    sitePaths.set(model, paths);
  }
  return paths;
}

/** A layout's default view for its listing: x-pd-view on page.listing, when it names one. */
const defaultView = (schema: { properties?: Record<string, unknown> } | undefined): string | undefined => {
  const listing = (schema?.properties?.["page"] as { properties?: Record<string, Record<string, unknown>> } | undefined)?.properties?.["listing"];
  const v = listing?.[DEFAULT_VIEW_KEY];
  return typeof v === "string" ? v : undefined;
};

/** A generated page (terms.ts) as a page file: its layout, its title and description as its frontmatter would give
 *  them (only what the layout declares; a layout that doesn't declare a title is a problem), and no body. */
async function generatedFile(g: GeneratedPage, discoveryMap: DiscoveryMap): Promise<{ page: PageFile; problems: string[] }> {
  const layoutId = (await layoutIndex(discoveryMap)).idOf(g.layout) ?? `layouts/${g.layout}`;
  const declared = (await readSchema(discoveryMap.get(layoutId)?.schemaPath, designFiles(discoveryMap))).schema?.properties ?? {};
  const problems: string[] = [];
  const values: Record<string, string> = { layout: g.layout };
  const whose = g.role === "index" ? `the index of the ${g.kind === "tag" ? "tags" : "categories"}` : `a ${g.kind} page`;
  if (Object.hasOwn(declared, "title")) values["title"] = g.title;
  else problems.push(`${layoutId}: ${whose}'s title is ${g.role === "index" ? "its title" : `the ${g.kind}'s label`}, so the layout declares "title"`);
  if (g.description !== null && Object.hasOwn(declared, "description")) values["description"] = g.description;
  return { page: { route: g.route, file: "", path: `${g.route.slice(1, -1)} (generated)`, frontmatter: { values, maps: {}, errors: [], lines: {} } }, problems };
}

/** Every template among `ids` (with what each includes) that writes a tag as text, which an object can't be shown as;
 *  and every schema among them that declares tags as strings, which a page's tags no longer are. */
async function tagsWrittenAsText(ids: readonly string[], a: PageAssembly): Promise<readonly string[]> {
  // From the design system's files alone: once per discovery for the same components (design-files.ts).
  return designFiles(a.discoveryMap).derived(`tags as text ${JSON.stringify(ids)}`, () => tagsAsTextIn(ids, a));
}
async function tagsAsTextIn(ids: readonly string[], a: PageAssembly): Promise<string[]> {
  const problems: string[] = [];
  for (const id of [...new Set(ids.flatMap(id => includeTree(id, a.composition)))]) {
    const entry = a.discoveryMap.get(id);
    const schema = (await readSchema(entry?.schemaPath, designFiles(a.discoveryMap))).schema;
    const tags = (schema?.properties?.["tags"] ?? (schema?.properties?.["page"] as ObjectSchema | undefined)?.properties?.["tags"]) as
      { items?: { type?: unknown } } | undefined;
    const itemType = tags?.items?.type;
    if (itemType === "string" || (Array.isArray(itemType) && itemType.includes("string") && !itemType.includes("object"))) {
      problems.push(`${id} (${basename(entry!.schemaPath!)}) declares tags as a list of strings, but a tag is an object since 0.5.0 `
        + `(key, label, description, route): declare its items as "type": "object", or leave items out`);
    }
    const hbs = entry?.hbsPath;
    if (!hbs) continue;
    const source = await designFiles(a.discoveryMap).text(hbs).catch(() => "");
    for (const f of itemsWrittenAsText(source, "tags")) {
      problems.push(`${id} (${basename(hbs)}:${f.line}): {{#each ${f.list}}} writes {{${f.item}}}, but a tag is an object since 0.5.0 `
        + `(key, label, description, route): write {{label}} to show it ({{key}} is its URL segment, {{route}} its page)`);
    }
  }
  return problems;
}

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
  // A tag or category page, or an index of them: generated, with no file.
  const generated = isNotFound || page ? undefined : model.generated.get(route);
  const generatedProblems: string[] = [];
  if (generated) {
    const g = await generatedFile(generated, a.discoveryMap);
    page = g.page;
    source = "";
    generatedProblems.push(...g.problems);
  }
  if (isNotFound && !page) {
    const layoutId = (await layoutIndex(a.discoveryMap)).idOf(DEFAULT_LAYOUT) ?? `layouts/${DEFAULT_LAYOUT}`;
    if (!a.discoveryMap.has(layoutId)) {
      return { status: 404, html: document(`<title>Page not found</title>`, BUILT_IN_NOT_FOUND_DOCUMENT, a.live, a.lang, a.basePath ?? "/"), problems: [],
        notes: [`there is no ${NOT_FOUND_FILE} and no ${layoutId}, so the 404 page is a plain one of Pattern Dump's`] };
    }
    const declared = (await readSchema(a.discoveryMap.get(layoutId)?.schemaPath, designFiles(a.discoveryMap))).schema?.properties ?? {};
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

  // A component schema that isn't JSON: every check that reads it would be off, so it is every page's problem (an
  // address with no page is still a 404, above: it has nothing to check).
  const brokenSchemas = await unreadableSchemas(a.discoveryMap, a.shown);
  if (brokenSchemas.length) { siteWide = brokenSchemas; return fail(brokenSchemas); }

  const problems: string[] = [...generatedProblems];
  const checked = await checkPageFrontmatter(page, a.discoveryMap, model.categories, model.tags, a.shown);
  problems.push(...checked.problems.map(p => `${p.file}${p.line !== undefined ? `:${p.line}` : ""}: ${p.message}`));
  if (isNotFound && checked.build.redirectFrom) {
    const line = page.frontmatter.lines["redirectFrom"];
    problems.push(`${page.path}${line !== undefined ? `:${line}` : ""}: the 404 page can't have redirectFrom: it is served for every address that has no page`);
  }
  const paths = pathsOf(model);
  const site = await checkSite(a.site, a.discoveryMap, paths.pages, { folders: paths.folders, leftOut: model.drafts });
  siteWide = site.problems;
  problems.push(...site.problems);

  // The link-preview image: the page's own, else the site's. A bad site image is the whole site's problem.
  const imageCheck = checked.build.image !== undefined ? await a.image(checked.build.image, checked.build.imageAs)
    : a.siteImage !== undefined ? await a.image(a.siteImage) : undefined;
  if (imageCheck && !imageCheck.ok) {
    if (checked.build.image !== undefined) problems.push(`${placeOf(page, "image")}: ${imageCheck.message}`);
    else {
      const p = `site.image: ${imageCheck.message}`;
      siteWide = [...siteWide, p];
      problems.push(p);
    }
  }

  // The layout's slot for the page's images (x-pd-prose-images), and the image index they are looked up in.
  const layoutSchema = (await readSchema(a.discoveryMap.get(checked.layoutId)?.schemaPath, designFiles(a.discoveryMap))).schema;
  const proseSlot = readProseSlot(layoutSchema);
  const imageLookup = a.images ? await a.images() : undefined;
  const symbolIndex = a.symbols ? await a.symbols() : undefined;

  // The layout's regions (regions.ts), the skin's, and whether the page shows the table of contents (toc.ts).
  const regionDecl = layoutRegions(layoutSchema, checked.layoutId);
  problems.push(...regionDecl.problems);
  const skin = await skinRegions(a.discoveryMap);
  const wantsToc = checked.build.toc ?? regionDecl.toc;
  const tocAt = page.frontmatter.lines["toc"];
  const tocOrigin = originOf(page, "toc");
  const tocWhat = checked.build.toc === true ? `toc: true${tocOrigin ? defaultsNote(tocOrigin) : ""}` : `${checked.layoutId} (page.regions, x-pd-toc)`;
  /** The page's markdown, rendered; its headings' anchors never take one of `takenIds`. */
  /** The components the page's pd- tags placed (the last rendering of its body). */
  const placedIds = new Set<string>();
  const renderBody = async (takenIds: string[] = []) => {
    const prose: ProseImages | undefined = imageLookup ? {
      layoutId: checked.layoutId, lookup: imageLookup, lineOffset: frontmatterBodyOffset(source), problems: [],
      // A page from the pages folder: its relative images are the ones beside it (page-images.ts).
      ...(page.file !== "" ? { pagePath: page.path } : {}),
      ...(proseSlot.slot ? { slot: proseSlot.slot } : {}), ...(proseSlot.problem ? { slotProblem: proseSlot.problem } : {}),
    } : undefined;
    const symbols: SymbolImages | undefined = symbolIndex ? {
      lookup: stem => symbolIndex.entries.get(stem), lineOffset: frontmatterBodyOffset(source), problems: [], used: [],
    } : undefined;
    const docProblems: string[] = [];
    placedIds.clear();
    const placedProblems: PlacedProblem[] = [];
    const headings: PageHeading[] = [];
    const regions: DocRegions = {
      choose: (region, what) => chooseRegion(region, what, checked.layoutId, regionDecl.regions, skin), filled: new Map(), toc: false, tocAnchors: [],
    };
    const deps: PlacementDeps = {
      discoveryMap: a.discoveryMap, handleMap: a.handleMap, composition: a.composition,
      // Each component rendered for a placement: the page loads its behaviour scripts (page-head.ts).
      render: input => { placedIds.add(input.component.split("~")[0]!); return a.render(input); },
      schemaOf: async id => (await readSchema(placementSchemaPath(id, a.discoveryMap), designFiles(a.discoveryMap))).schema,
      shown: a.shown,
    };
    const body = await renderDoc(
      frontmatterBody(source),
      (id, variant) => a.render({ component: id, variant }).then(r => r.html),
      a.discoveryMap,
      {
        embed: "frame", workbenchUrl: a.workbenchUrl, problems: docProblems, headings, takenIds, ...(prose ? { prose } : {}), ...(symbols ? { symbols } : {}),
        // Components placed with values (pd- tags): checked against their schemas, rendered into the page.
        placed: { lineOffset: frontmatterBodyOffset(source), problems: placedProblems, deps, regions },
      },
    );
    // The table of contents the page or its layout asks for, with the derived items, first in its region; none when the
    // page places a <pd-toc> itself, or has no heading for it.
    const items = derivedToc(headings);
    if (wantsToc && !isNotFound && !regions.toc && items.length) {
      const at = { line: tocAt ?? 1, column: 1 };
      const r = await placeTocItems(items, at, tocWhat, deps);
      placedProblems.push(...r.problems);
      if (r.html !== undefined && !r.problems.length) {
        const choice = r.region === undefined
          ? { to: "problem" as const, message: `${tocWhat}: ${TOC_ID} names no region (x-pd-region at its schema's root), so the table of contents has no place on the page` }
          : chooseRegion(r.region, r.regionFrom ?? tocWhat, checked.layoutId, regionDecl.regions, skin);
        if (choice.to === "problem") placedProblems.push({ at, message: choice.message });
        else if (choice.to === "region") {
          const brought = regionLandmarks(r.html);
          if (brought.length) placedProblems.push({ at, message: `${TOC_ID}: what it renders would bring ${brought.join(" and ")} into the region "${choice.region}": the page's landmarks are the layout's` });
          else regions.filled.set(choice.region, [r.html, ...regions.filled.get(choice.region) ?? []]);
        }
      }
    }
    return { body, headings, docProblems, placedProblems, imageProblems: [...prose?.problems ?? [], ...symbols?.problems ?? []],
      symbols: symbols?.used ?? [], regions };
  };
  const first = await renderBody();
  problems.push(...first.docProblems.map(p => `${page.path}: ${p}`));
  problems.push(...first.placedProblems.map(p => `${page.path}:${p.at.line}:${p.at.column}: ${p.message}`));
  problems.push(...first.imageProblems.map(p => `${page.path}:${p.line}: ${p.message}`));

  // The layout's sample data, and that of every partial it includes, must stay out of real pages.
  const siteSchema = (await readSchema(a.discoveryMap.get(SITE_SCHEMA_OWNER)?.schemaPath, designFiles(a.discoveryMap))).schema;
  const layoutDeclared = Object.keys(layoutSchema?.properties ?? {});
  const siteDeclared = Object.keys(siteSchema?.properties?.site?.properties ?? {});
  const pageDeclaration = checkPageDeclaration(layoutSchema, checked.layoutId);
  problems.push(...pageDeclaration.problems);
  // Dates for a layout that shows them, and for the JSON-LD of a site with an address; the git pass never
  // runs for a site that needs neither. Only a layout that shows dates is stopped by an unreliable one (a
  // shallow clone in pd build) or noted about a missing one: the JSON-LD just leaves the date out.
  const notes: string[] = [];
  let dates: Partial<Pick<PageDates, "created">> = {};
  // dateModified: the page's own updated; git's last commit counts a typo fix as a change, so it is never used.
  const modified: string | null = checked.build.updated ?? null;
  // datePublished: the page's own date, else the day git first saw it.
  let published: string | null = checked.build.date ?? null;
  const mode = a.live ? "dev" : "build";
  const declares = (k: string) => pageDeclaration.declared?.includes(k) ?? false;
  const showsDates = declares("created");
  if (a.dates && !isNotFound && (showsDates || a.siteUrl !== undefined)) {
    const dated = await a.dates.of(page.path, mode);
    if (showsDates) {
      dates = { created: dated.dates.created };
      notes.push(...dated.notes);
      problems.push(...dated.problems);
    }
    if (dated.shallow) notes.push(SHALLOW_SEO_NOTE);
    else published ??= dated.dates.created;
  }
  // A listing's entries, and the page's own date and tags (collections.ts), for a layout that shows them.
  const listing: { children?: Entry[]; date?: string | null; updated?: string | null; tags?: Term[]; categories?: Category[]; listing?: string | null;
    term?: GeneratedPage["term"] | null; terms?: GeneratedPage["terms"] | null } = {};
  // The layout's card for them (x-pd-card on page.children): every page of the listing is checked against it.
  const layoutCard = cardOf(layoutSchema?.properties?.["page"]?.properties?.["children"]);
  if (declares("children")) {
    const listed = isNotFound ? { entries: [], problems: [], notes: [] } : await entriesOf(route, model, { dates: a.dates, mode });
    listing.children = listed.entries;
    problems.push(...listed.problems);
    notes.push(...listed.notes);
    if (layoutCard !== undefined) {
      const read = await readCard(layoutCard, checked.layoutId, "the listing's card", a.discoveryMap);
      problems.push(...read.problems);
      if (read.card) problems.push(...checkEntries(listed.entries, read.card, page.path, model));
    }
  }
  // The listing through the view the page names (views.ts), for a layout that shows one (page.listing): every page
  // checked against the view's card, the view rendered once the page has no problems.
  let view: { id: string; entries: Entry[] } | undefined;
  if (!isNotFound) {
    const resolved = await resolveView({
      view: checked.build.view, line: page.frontmatter.lines["view"], path: page.path,
      layout: checked.layoutName, layoutId: checked.layoutId, shows: declares("listing"), discoveryMap: a.discoveryMap,
      fallback: defaultView(layoutSchema),
    });
    problems.push(...resolved.problems);
    if (resolved.view) {
      let entries = listing.children;
      if (entries === undefined) {
        const listed = await entriesOf(route, model, { dates: a.dates, mode });
        entries = listed.entries;
        problems.push(...listed.problems);
        notes.push(...listed.notes);
      }
      problems.push(...checkEntries(entries, resolved.view.card, page.path, model));
      view = { id: resolved.view.id, entries };
    }
  }
  // The layout's queries (query.ts): each resolved for the page, its options checked, its pages checked against its
  // view's card. The 404 page has no place among the pages, so its queries list none.
  const queries: ResolvedQuery[] = [];
  const declaredQs = pageDeclaration.declared ? declaredQueries(layoutSchema) : [];
  if (declaredQs.length) {
    const queryProblems = checkDeclaredQueries(layoutSchema, checked.layoutId, [...FILLED, ...Object.keys(RETIRED)],
      [...RESERVED_KEYS, ...ASSEMBLY_KEYS, ...layoutDeclared]);
    problems.push(...queryProblems);
    if (!queryProblems.length) {
      for (const q of declaredQs) {
        if (isNotFound) { queries.push({ name: q.name, entries: [], problems: [], notes: [] }); continue; }
        const r = await resolveQuery(q, { route, path: page.path, frontmatter: page.frontmatter, ...(page.defaults ? { defaults: page.defaults } : {}), layoutId: checked.layoutId, model,
          discoveryMap: a.discoveryMap, dates: a.dates, mode,
          ...(generated ? { own: {
            tags: generated.kind === "tag" && generated.term ? [generated.term.key] : [],
            categories: generated.kind === "category" && generated.term ? [generated.term.key] : [],
          } } : {}) });
        problems.push(...r.problems);
        notes.push(...r.notes);
        queries.push(r);
      }
    }
  }
  if (declares("date")) {
    const dated = isNotFound ? { date: null, problems: [], notes: [] } : await dateOf(route, model, a.dates, mode);
    listing.date = dated.date;
    problems.push(...dated.problems);
    notes.push(...dated.notes);
  }
  if (declares("updated")) listing.updated = checked.build.updated ?? null;
  // A page's own tags and categories, with their pages' routes (the 404 page has no entry: its own, by key).
  if (declares("tags")) listing.tags = model.entries.get(route)?.tags ?? (checked.build.tags ?? []).map(k => termOf(model.tags, k));
  if (declares("categories")) listing.categories = model.entries.get(route)?.categories ?? (checked.build.categories ?? []).map(k => termOf(model.categories, k));
  if (declares("term")) listing.term = generated?.term ?? null;
  if (declares("terms")) listing.terms = generated?.terms ?? null;
  // The collections the skin lists (site.collections), on every page.
  const collections = site.collections.length ? await resolveCollections(site.collections, model, { dates: a.dates, mode }) : undefined;
  if (collections) {
    problems.push(...collections.problems);
    notes.push(...collections.notes);
    // Deprecated (0.5.0): it keeps working, and a query is the one way to list pages. The same text on every page, so
    // a build says it once.
    notes.push(`warning: ${SITE_SCHEMA_OWNER} lists site.collections (${site.collections.join(", ")}), which is deprecated: declare a query `
      + `on the layouts that show it instead (x-pd-query on a sub-key of page, such as page.latest with `
      + `{ "collections": ["${site.collections[0]}"], "sort": "date", "limit": 3 })`);
  }
  notes.push(...site.notes ?? []);
  // The skin's head partial: the same for every page, so its problems are the whole site's.
  const hasHead = a.discoveryMap.has(HEAD_PARTIAL);
  // Tags are objects since 0.5.0: a template that still writes one as text fails, naming what to write.
  // A card's string tags are its check's problem already (cards.ts, naming the listing): not said twice.
  const STRING_TAGS = " declares tags as a list of strings";
  const named = new Set(problems.filter(p => p.includes(STRING_TAGS)).map(p => p.slice(0, p.indexOf(" ("))));
  problems.push(...(await tagsWrittenAsText([checked.layoutId, ...(view ? [view.id] : []), ...queries.flatMap(q => q.view ? [q.view.id] : [])]
    .filter(id => a.discoveryMap.has(id)), a)).filter(p => !(p.includes(STRING_TAGS) && named.has(p.slice(0, p.indexOf(" ("))))));
  if (problems.length) return fail(problems);
  if (view) {
    try {
      listing.listing = (await a.render({ component: view.id, data: { entries: view.entries }, sampleData: false })).html;
    } catch (e) {
      return fail([`${view.id}: ${renderError(e)}`]);
    }
  } else if (declares("listing")) listing.listing = null;
  // Each query's pages, and the same through its view: rendered once, and not at all when no page matched.
  const queryValues: Record<string, { entries: Entry[]; listing: string | null }> = {};
  for (const q of queries) {
    let html: string | null = null;
    if (q.view && q.entries.length) {
      try {
        html = (await a.render({ component: q.view.id, data: { entries: q.entries }, sampleData: false })).html;
      } catch (e) {
        return fail([`${q.view.id}: ${renderError(e)}`]);
      }
    }
    queryValues[q.name] = { entries: q.entries, listing: html };
  }
  notes.push(...checked.notes);
  // pd dev shows drafts and scheduled pages; each is said once, whichever page is open.
  if (a.live) {
    notes.push(...model.drafts.map(d => `${d} is a draft: pd build leaves it out`));
    notes.push(...model.scheduled.map(s => `${s.path} is scheduled for ${s.until}: pd build leaves it out until then`));
  }

  // What the layout gets: its declared values, null where the page sets none, then what the storefront fills.
  const siteData = {
    ...withDeclaredAbsentAsNull(site.values, siteDeclared),
    ...(site.listed.length ? { navigations: resolveNavigations(site.navigations, site.listed, model, route) } : {}),
    ...(collections ? { collections: collections.collections } : {}),
    ...(site.categories ? { categories: model.categories.list } : {}),
    ...(a.siteWorkbenchUrl !== undefined ? { workbenchUrl: a.siteWorkbenchUrl } : {}),
  };
  /** The layout's regions as it gets them: each one's HTML, null when empty. */
  const regionsOf = (filled: ReadonlyMap<string, string[]>): Record<string, string | null> =>
    Object.fromEntries(regionDecl.regions.map(r => [r, filled.get(r)?.length ? filled.get(r)!.join("\n") : null]));
  let currentRegions = first.regions.filled;
  // The page's rendered markdown goes into the layout's body slot: `body`, or the property its x-pd-content names.
  const dataFor = (body: string, headings: PageHeading[]) => ({
    ...withDeclaredAbsentAsNull(checked.values, layoutDeclared, ["body", "nav", "site", "page", checked.bodySlot]),
    [checked.bodySlot]: body,
    nav: markCurrent(model.nav, route),
    site: siteData,
    ...(pageDeclaration.declared ? { page: pageValue(pageDeclaration.declared, { headings, ...positionOf(route, model), ...dates, ...listing, ...queryValues, regions: regionsOf(currentRegions) } as Partial<DerivedPage>) } : {}),
  });
  // A template that fails to render (a helper it calls that is not registered, say) is a page problem
  // like any other, listed and escaped, never an unhandled 500.
  const renderLayout = async (body: string, headings: PageHeading[]): Promise<Awaited<ReturnType<Render>> | AssembledPage> => {
    try {
      return await a.render({ component: checked.layoutId, data: dataFor(body, headings), sampleData: false });
    } catch (e) {
      return fail([`${page.path}: ${renderError(e)}`]);
    }
  };
  const isFailed = (r: Awaited<ReturnType<Render>> | AssembledPage): r is AssembledPage => "status" in r;
  let rendered = await renderLayout(first.body, first.headings);
  let finalBody = first.body;
  let finalHeadings = first.headings;
  let finalRegions = first.regions;
  let finalSymbols = first.symbols;
  if (isFailed(rendered)) return rendered;
  // A layout field named like a registered helper can never be shown by its name: the page fails, as the
  // workbench shows the same SCHEMA_INVALID on the layout.
  const helperNamed = (rendered.meta?.diagnostics ?? []).filter(d => d.kind === "SCHEMA_INVALID" && isHelperNameProblem(d.message));
  if (helperNamed.length) {
    return fail(helperNamed.map(d => `${d.location?.file ?? checked.layoutId} (${d.path ?? "#"}): ${d.message}`));
  }

  // A heading's anchor the layout has as an id too: the body again, with the layout's ids taken, so the
  // heading gets the next free suffix, and the layout again, with the anchors that now hold.
  // The components the page renders besides its layout: what it places, its listing's view, its queries' views.
  const pageComponents = [...placedIds, ...(view ? [view.id] : []), ...queries.flatMap(q => q.view && queryValues[q.name]?.listing ? [q.view.id] : [])];
  // The symbol sets they need (requireAssets), as their previews load them: one the asset folders don't have fails the
  // page, and so does an id two of them declare, or one an image symbol has: a <use> of it could draw either.
  const iconSets = a.symbolSets ? await a.symbolSets([checked.layoutId, ...pageComponents]) : { sets: [], missing: [] };
  if (iconSets.missing.length) {
    return fail(iconSets.missing.map(m => `${page.path}: ${m.component} needs the symbol set "${m.id}" (requireAssets), `
      + `and no asset folder has ${m.id}.svg or images/${m.id}.svg`));
  }
  const imageSymbolIds = new Set(first.symbols.flatMap(symbolIds));
  const setOf = new Map<string, string>();
  const clashes: string[] = [];
  for (const set of iconSets.sets) {
    for (const id of new Set(svgIds(set.svg))) {
      const other = setOf.get(id);
      if (other !== undefined) clashes.push(`the symbol sets "${other}" and "${set.id}" both declare id="${id}"`);
      else if (imageSymbolIds.has(id)) clashes.push(`the symbol set "${set.id}" declares id="${id}", which a symbol image on the page has`);
      else setOf.set(id, set.id);
    }
  }
  if (clashes.length) return fail(clashes.map(c => `${page.path}: ${c}: a <use> of it could draw either`));
  // The page's symbols (at the top of its body, see below) hold ids too: a heading never takes one of them.
  const spriteIds = new Set([...imageSymbolIds, ...setOf.keys()]);
  const layoutIds = [...new Set([...idsBesides(rendered.html, first.headings), ...spriteIds])];
  const colliding = collidingHeadings(first.headings, layoutIds);
  if (colliding.length) {
    const second = await renderBody(layoutIds);
    currentRegions = second.regions.filled;
    finalHeadings = second.headings;
    finalRegions = second.regions;
    rendered = await renderLayout(second.body, second.headings);
    finalBody = second.body;
    finalSymbols = second.symbols;
    if (isFailed(rendered)) return rendered;
    const still = collidingHeadings(second.headings, [...idsBesides(rendered.html, second.headings), ...spriteIds]);
    if (still.length) {
      return fail(still.map(h => `${page.path}: heading "${h.text}" is #${h.anchor}, which the layout has as an id as well, `
        + `even after the suffix: the layout must not make ids from page.headings`));
    }
    for (const [i, h] of first.headings.entries()) {
      const now = second.headings[i]!;
      if (now.anchor === h.anchor) continue;
      notes.push(`${page.path}: heading "${h.text}" is #${now.anchor}, ` + (setOf.has(h.anchor)
        ? `because the symbol set "${setOf.get(h.anchor)}" on the page uses id="${h.anchor}"`
        : spriteIds.has(h.anchor)
        ? `because a symbol image on the page uses id="${h.anchor}"`
        : layoutIds.includes(h.anchor)
        ? `because the layout uses id="${h.anchor}"`
        : `because #${h.anchor} went to an earlier heading whose anchor the layout uses`));
    }
  }

  // A <pd-toc>'s #anchors, against the page's headings as they finally are (a suffix can still come from the layout).
  const finalRender = colliding.length ? finalRegions : first.regions;
  const badAnchors = tocAnchorProblems(finalRender.tocAnchors, finalHeadings);
  if (badAnchors.length) return fail(badAnchors.map(p => `${page.path}:${p.at.line}:${p.at.column}: ${p.message}`));

  const html = rendered.html;
  // The skin's head partial: the site's values, and body and nav as null so no sample of them can show.
  let headExtra = "";
  if (hasHead) {
    try {
      headExtra = (await a.render({ component: HEAD_PARTIAL, data: { site: siteData, body: null, nav: null }, sampleData: false })).html.trim();
    } catch (e) {
      const p = `${HEAD_PARTIAL}: ${renderError(e)}`;
      siteWide = [...siteWide, p];
      return fail([p]);
    }
    const markup = checkHeadMarkup(headExtra);
    if (markup.length) { siteWide = [...siteWide, ...markup]; return fail(markup); }
  }
  // The site's own head additions (storefront.head), after the skin's: rendered with the site's values, checked alike.
  let siteHead = "";
  if (a.siteHead) {
    const label = `site.head (${a.siteHead.name})`;
    let source: string;
    try { source = await readFile(a.siteHead.path, "utf8"); } catch {
      const p = `${label}: there is no such file`;
      siteWide = [...siteWide, p];
      return fail([p]);
    }
    try { siteHead = renderPlainTemplate(source, { site: siteData }).trim(); } catch (e) {
      const p = `${label}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
      siteWide = [...siteWide, p];
      return fail([p]);
    }
    const markup = checkHeadMarkup(siteHead, { label, subject: "the site's head" });
    if (markup.length) { siteWide = [...siteWide, ...markup]; return fail(markup); }
  }
  const title = typeof checked.values["title"] === "string" ? checked.values["title"] : isNotFound ? "Page not found" : route;
  const siteTitle = typeof site.values["title"] === "string" ? site.values["title"] : undefined;
  const description = typeof checked.values["description"] === "string" ? checked.values["description"] : undefined;
  const article = isNotFound ? undefined : articleOf(route, model, checked.build.date, checked.build.updated);
  const head = [
    `<title>${escapeHtml(siteTitle && siteTitle !== title ? `${title} · ${siteTitle}` : title)}</title>`,
    ...(description ? [`<meta name="description" content="${escapeAttr(description)}">`] : []),
    // The 404 page is served at every address that has none: no address of its own, never indexed.
    ...seoTags({
      route, title, description, siteTitle, siteUrl: isNotFound ? undefined : a.siteUrl,
      image: imageCheck?.ok ? imageCheck.image : undefined,
      index: !isNotFound && a.siteIndex !== false && checked.build.index !== false, article,
    }),
    ...(a.siteUrl !== undefined && !isNotFound
      ? [jsonLdScript({ siteUrl: a.siteUrl, siteTitle, route, title, description, breadcrumbs: positionOf(route, model).breadcrumbs, modified, published, article,
        ...(generated ? { collection: true } : {}) })]
      : []),
    // Code token colours, before every stylesheet of the site's: the pd-code layer is then declared first, so any rule
    // of the site's wins, layered or not (code.css, highlight.ts getCodeCSS).
    ...(html.includes(`class="shiki-container"`) ? [`<link rel="stylesheet" href="${PD_ROUTES.codeCss}">`] : []),
    ...(headExtra ? [headExtra] : []),
    ...(siteHead ? [siteHead] : []),
    await a.head(checked.layoutId, html, pageComponents),
  ].join("\n");
  if (a.borrowed) notes.push(...(await a.borrowed([checked.layoutId, ...pageComponents])).map(m => `warning: ${page?.path ?? route}: ${m}`));
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
    const routes = new Set<string>([...model.pages.map(p => p.route), ...model.pages.flatMap(p => p.redirectFrom ?? []), PD_ROUTES.notFound]);
    routes.add(self);
    const links = checkLinks({ built: routes, documents: new Map([[self, html]]), pages: [self], pagesOnly: true,
      ...(a.basePath !== undefined ? { pathHint: a.basePath } : {}) });
    notes.push(...links.problems.map(p => `warning: ${page!.path}${p.slice(self.length)}`));
    // One main landmark and one <h1> (page-basics.ts): errors in pd build, warnings here.
    notes.push(...checkPageBasics(html).map(p => `warning: ${page!.path}: ${p}`));
  }
  // The page's own content for the search index: its body, never the layout's markup (search.ts).
  const entry = model.entries.get(route);
  // The page's symbols, once each, hidden at the top of its body: outside the body the search index reads. The image
  // symbols first, then the symbol sets its components need, hidden by size as the image sprite is.
  const sprite = (finalSymbols.length ? `${spriteMarkup(finalSymbols)}\n` : "")
    + iconSets.sets.map(s => `${hideSvgBySize(s.svg.trim())}\n`).join("");
  const search: SearchRecord | undefined = isNotFound || generated || checked.build.index === false ? undefined : {
    route, title, body: finalBody, section: collectionOf(route, model), tags: (entry?.tags ?? []).map(t => t.label),
    categories: (entry?.categories ?? []).map(c => c.label), teaser: entry?.description ?? null, lang: a.lang ?? "en",
  };
  return { status: isNotFound ? 404 : 200, html: document(head, `${sprite}${html}\n${fitterScript()}${themeSync(a, html)}${html.includes(`class="shiki-container"`) ? `\n${copyScript()}` : ""}`, a.live, a.lang, a.basePath ?? "/",
    regionDecl.regions.length ? regionDecl.regions.filter(r => currentRegions.get(r)?.length) : undefined), problems: [], notes,
    ...(search ? { search } : {}) };
}

/** The label of the collection `route` is in: the folder that lists it (a folder's index page is its own), by its
 *  index page's title; null for a page at the top. */
export function collectionOf(route: string, model: PageModel): string | null {
  const folder = route !== "/" && model.folders.has(route) ? route
    : [...model.folders].find(([r, f]) => r !== "/" && f.children.includes(route))?.[0];
  return folder === undefined ? null : model.pages.find(p => p.route === folder)?.title ?? null;
}

/** Every id a symbol brings into the page: its own and each prefixed one inside it. */
function symbolIds(s: SymbolSource): string[] {
  return [symbolId(s.stem), ...s.ids];
}

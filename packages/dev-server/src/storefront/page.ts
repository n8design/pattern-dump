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
// never show on a real page.

import { createHeightFitter, type DiscoveryMap, type Render, type StorefrontNavItem } from "@pattern-dump/contracts";
import { frontmatterBody } from "../frontmatter.js";
import { escapeAttr, escapeHtml } from "../http-utils.js";
import { renderDoc } from "../markdown.js";
import { readSchema } from "./declared-values.js";
import { checkPageFrontmatter } from "./frontmatter-contract.js";
import type { PageModel } from "./pages.js";
import { checkSite, SITE_SCHEMA_OWNER } from "./site.js";
import { readFile } from "node:fs/promises";

export interface PageAssembly {
  discoveryMap: DiscoveryMap;
  render: Render;
  /** The stylesheet links for a page rendered with `layoutId` whose markup is `html`. */
  head(layoutId: string, html: string): Promise<string>;
  /** storefront.site from the config. */
  site: Record<string, unknown> | undefined;
  /** Where links into the workbench start, ending with "/". */
  workbenchUrl: string;
  /** Set in `pd dev`: the live-reload socket's port. */
  live?: { wsPort: number };
}

export interface AssembledPage {
  status: 200 | 404 | 500;
  html: string;
  /** Every problem, one line each. Empty for a page that rendered. */
  problems: string[];
}

/** The fitter's glue: frames start at 1px (from script, so with scripting off they keep the UA default
 *  height and stay readable), then follow the pd-height their preview documents post. */
export function fitterScript(): string {
  return `<script>(function(){var createHeightFitter=(${createHeightFitter.toString()});`
    + `var fitter=createHeightFitter({write:function(f,h){f.style.height=h+"px";}});`
    + `var frames=function(){return document.querySelectorAll("figure.doc-example iframe");};`
    + `frames().forEach(function(f){f.style.height="1px";});`
    + `addEventListener("message",function(e){var m=fitter.fromMessage(e,frames());if(m)fitter.accept(m.frame,m.height);});`
    + `})();</script>`;
}

/** `pd dev` only: reload when this page or the nav changes, or a component or stylesheet does. */
export function liveScript(wsPort: number): string {
  return `<script data-pd-live>(function(){var ws=new WebSocket("ws://"+location.hostname+":${wsPort}");`
    + `ws.onmessage=function(e){var m;try{m=JSON.parse(e.data);}catch(x){return;}`
    + `if((m.type==="page-changed"&&(m.route===null||m.route===location.pathname))||m.type==="content-swap"||m.type==="css-link-swap")location.reload();};`
    + `})();</script>`;
}

function document(head: string, body: string, live: PageAssembly["live"]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${head}
</head>
<body>
${body}
${live ? liveScript(live.wsPort) : ""}
</body>
</html>`;
}

/** The document shown instead of a page that has problems: every problem, escaped. */
export function errorDocument(route: string, problems: string[], live: PageAssembly["live"]): string {
  const items = problems.map(p => `<li>${escapeHtml(p)}</li>`).join("\n");
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
  const fail = (problems: string[]): AssembledPage => ({ status: 500, html: errorDocument(route, problems, a.live), problems });

  // The pages folder as a whole: a problem there is a problem for every page.
  if (model.problems.length) return fail(model.problems);

  const page = model.files.get(route);
  if (!page) {
    return { status: 404, html: errorDocument(route, [`there is no page at ${route}`], a.live), problems: [`there is no page at ${route}`] };
  }

  const problems: string[] = [];
  const checked = await checkPageFrontmatter(page, a.discoveryMap);
  problems.push(...checked.problems.map(p => `${p.file}${p.line !== undefined ? `:${p.line}` : ""}: ${p.message}`));
  const site = await checkSite(a.site, a.discoveryMap);
  problems.push(...site.problems);

  const docProblems: string[] = [];
  const body = await renderDoc(
    frontmatterBody(await readFile(page.file, "utf8")),
    (id, variant) => a.render({ component: id, variant }).then(r => r.html),
    a.discoveryMap,
    { embed: "frame", workbenchUrl: a.workbenchUrl, problems: docProblems },
  );
  problems.push(...docProblems.map(p => `${page.path}: ${p}`));
  if (problems.length) return fail(problems);

  // What the layout gets: its declared values, null where the page sets none, then what the storefront fills.
  const layoutSchema = (await readSchema(a.discoveryMap.get(checked.layoutId)?.schemaPath)).schema;
  const siteSchema = (await readSchema(a.discoveryMap.get(SITE_SCHEMA_OWNER)?.schemaPath)).schema;
  const data = {
    ...withDeclaredAbsentAsNull(checked.values, Object.keys(layoutSchema?.properties ?? {}), ["body", "nav", "site"]),
    body,
    nav: markCurrent(model.nav, route),
    site: withDeclaredAbsentAsNull(site.values, Object.keys(siteSchema?.properties?.site?.properties ?? {})),
  };
  const { html } = await a.render({ component: checked.layoutId, data });

  const title = typeof checked.values["title"] === "string" ? checked.values["title"] : route;
  const siteTitle = typeof site.values["title"] === "string" ? site.values["title"] : undefined;
  const description = typeof checked.values["description"] === "string" ? checked.values["description"] : undefined;
  const head = [
    `<title>${escapeHtml(siteTitle && siteTitle !== title ? `${title} — ${siteTitle}` : title)}</title>`,
    ...(description ? [`<meta name="description" content="${escapeAttr(description)}">`] : []),
    await a.head(checked.layoutId, html),
  ].join("\n");
  return { status: 200, html: document(head, `${html}\n${fitterScript()}`, a.live), problems: [] };
}

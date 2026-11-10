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

import { createHeightFitter, generationBehind, type DiscoveryMap, type Render, type StorefrontNavItem } from "@pattern-dump/contracts";
import { frontmatterBody, frontmatterBodyOffset } from "../frontmatter.js";
import { escapeAttr, escapeHtml } from "../http-utils.js";
import { isHelperNameProblem } from "@pattern-dump/renderer";
import { renderDoc } from "../markdown.js";
import { readSchema, type PlacedProblem } from "./declared-values.js";
import { checkPageFrontmatter } from "./frontmatter-contract.js";
import type { PageModel } from "./pages.js";
import { checkSite, SITE_SCHEMA_OWNER } from "./site.js";
import { checkSampleData } from "./sample-data.js";
import { checkPageDeclaration, pageValue, type PageHeading } from "./derived.js";
import type { CompositionRegistry } from "../composition.js";
import { readFile } from "node:fs/promises";

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
    + `else if(m.type==="error"){var n=document.querySelector("[data-pd-live-notice]");`
    + `if(!n){n=document.createElement("div");n.setAttribute("data-pd-live-notice","");n.setAttribute("role","alert");`
    + `n.style.cssText="position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:2147483647;padding:.75rem 1rem;background:#fff;color:#000;border:2px solid #b00020;font:14px/1.4 system-ui,sans-serif";`
    + `n.appendChild(document.createElement("ul"));document.body.appendChild(n);}`
    + `var li=document.createElement("li");li.textContent=String(m.message);n.firstChild.appendChild(li);}};`
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
${live ? liveScript(live.wsPort, live.generation) : ""}
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

  const notFound = (): AssembledPage =>
    ({ status: 404, html: errorDocument(route, [`there is no page at ${route}`], a.live), problems: [`there is no page at ${route}`] });
  const page = model.files.get(route);
  if (!page) return notFound();
  // A page the folder listed can be gone by now (deleted between reading the folder and this request):
  // then there is no page at this route.
  let source: string;
  try {
    source = await readFile(page.file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return notFound();
    throw e;
  }

  const problems: string[] = [];
  const checked = await checkPageFrontmatter(page, a.discoveryMap);
  problems.push(...checked.problems.map(p => `${p.file}${p.line !== undefined ? `:${p.line}` : ""}: ${p.message}`));
  const site = await checkSite(a.site, a.discoveryMap);
  problems.push(...site.problems);

  const docProblems: string[] = [];
  const placedProblems: PlacedProblem[] = [];
  const headings: PageHeading[] = [];
  const body = await renderDoc(
    frontmatterBody(source),
    (id, variant) => a.render({ component: id, variant }).then(r => r.html),
    a.discoveryMap,
    {
      embed: "frame", workbenchUrl: a.workbenchUrl, problems: docProblems, headings,
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
  problems.push(...docProblems.map(p => `${page.path}: ${p}`));
  problems.push(...placedProblems.map(p => `${page.path}:${p.at.line}:${p.at.column}: ${p.message}`));

  // The layout's sample data, and that of every partial it includes, must stay out of real pages.
  const layoutSchema = (await readSchema(a.discoveryMap.get(checked.layoutId)?.schemaPath)).schema;
  const siteSchema = (await readSchema(a.discoveryMap.get(SITE_SCHEMA_OWNER)?.schemaPath)).schema;
  const layoutDeclared = Object.keys(layoutSchema?.properties ?? {});
  const siteDeclared = Object.keys(siteSchema?.properties?.site?.properties ?? {});
  const pageDeclaration = checkPageDeclaration(layoutSchema, checked.layoutId);
  problems.push(...pageDeclaration.problems);
  if (a.discoveryMap.has(checked.layoutId)) {
    problems.push(...await checkSampleData(checked.layoutId, a.discoveryMap, a.composition, layoutDeclared, siteDeclared, pageDeclaration.declared));
  }
  if (problems.length) return fail(problems);

  // What the layout gets: its declared values, null where the page sets none, then what the storefront fills.
  const data = {
    ...withDeclaredAbsentAsNull(checked.values, layoutDeclared, ["body", "nav", "site", "page"]),
    body,
    nav: markCurrent(model.nav, route),
    site: withDeclaredAbsentAsNull(site.values, siteDeclared),
    ...(pageDeclaration.declared ? { page: pageValue(pageDeclaration.declared, { headings }) } : {}),
  };
  // A template that fails to render (a helper it calls that is not registered, say) is a page problem
  // like any other, listed and escaped, never an unhandled 500.
  let rendered: Awaited<ReturnType<Render>>;
  try {
    rendered = await a.render({ component: checked.layoutId, data });
  } catch (e) {
    return fail([`${page.path}: ${e instanceof Error ? e.message : String(e)}`]);
  }
  // A layout field named like a registered helper can never be shown by its name: the page fails, as the
  // workbench shows the same SCHEMA_INVALID on the layout.
  const helperNamed = (rendered.meta?.diagnostics ?? []).filter(d => d.kind === "SCHEMA_INVALID" && isHelperNameProblem(d.message));
  if (helperNamed.length) {
    return fail(helperNamed.map(d => `${d.location?.file ?? checked.layoutId} (${d.path ?? "#"}): ${d.message}`));
  }

  const html = rendered.html;
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

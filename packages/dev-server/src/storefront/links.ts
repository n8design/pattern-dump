// The internal link check of `pd build` (step 6). Every `href`, `src` and `srcset` of every element on a site page
// must resolve:
//   - a path (root-relative, or relative to the page) to a page or file the storefront build writes; a page by its
//     route with or without its trailing slash, or as its index.html;
//   - a `#fragment` to an element with that id (or an <a name>) in the target document; headings carry their anchors
//     as ids, so a link to a heading is checked;
//   - a URL on the site's own address (storefront.url) as its path;
//   - a URL into the workbench (storefront.workbenchUrl) to a page the workbench snapshot has: a component, its
//     variants page, a folder; a `#fragment` there names one of the component's variants.
// Other hosts are not fetched: they are listed, with the pages that link them, for the build report's notes.
// `mailto:`, `tel:`, `data:` and `javascript:` are skipped. Documents are read as tags (html-tags.ts), so a code
// example's text is never a link.
//
// Site pages are the storefront's pages and its 404 page. Component previews and redirect stubs are not checked as
// sources, but are valid targets.
import { attributesOf, startTags } from "./html-tags.js";

export interface LinkSite {
  /** Every URL the storefront build writes, as the crawl found it: page routes ("/guides/setup/") and files. */
  built: ReadonlySet<string>;
  /** The HTML of every built document, by its URL (sources and fragment targets). */
  documents: ReadonlyMap<string, string>;
  /** The site pages whose links are checked. */
  pages: readonly string[];
  /** storefront.url, ending with "/". */
  siteUrl?: string;
  /** storefront.workbenchUrl (ending with "/") and what the workbench snapshot has: its routes without the leading
   *  slash ("" for its home, "components/callout", "components/callout/variants", "components"), and each
   *  component's variants. */
  workbench?: { url: string; routes: ReadonlySet<string>; variants: ReadonlyMap<string, readonly string[]> };
  /** pd dev, as a page is assembled: only links to the site's pages (and anchors in the documents given) are checked;
   *  files the server serves (/_pd/, /assets/, /preview/) and other hosts are left to pd build. */
  pagesOnly?: boolean;
}

export interface LinkCheck {
  /** One line per broken reference: `<page>: <tag attr="url">: why`. */
  problems: string[];
  /** Each URL on another host, with the pages that link it, in the order found. */
  external: Map<string, string[]>;
  /** How many references were read. */
  references: number;
}

const SKIPPED = /^(?:mailto|tel|data|javascript):/i;
const OTHER_HOST = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Every id (and <a name>) of a document. */
function idsOf(html: string): Set<string> {
  const ids = new Set<string>();
  for (const tag of startTags(html)) {
    for (const a of attributesOf(tag)) {
      if (a.value === undefined) continue;
      if (a.name === "id" || (a.name === "name" && tag.name.toLowerCase() === "a")) ids.add(a.value);
    }
  }
  return ids;
}

/** Every [element, attribute, URL] a document's elements reference. */
function referencesOf(html: string): Array<[string, string, string]> {
  const refs: Array<[string, string, string]> = [];
  for (const tag of startTags(html)) {
    for (const a of attributesOf(tag)) {
      if (a.value === undefined) continue;
      if (a.name === "href" || a.name === "src") refs.push([tag.name.toLowerCase(), a.name, a.value.trim()]);
      else if (a.name === "srcset") {
        for (const c of a.value.split(",")) {
          const url = c.trim().split(/\s+/)[0];
          if (url) refs.push([tag.name.toLowerCase(), a.name, url]);
        }
      }
    }
  }
  return refs;
}

/** The workbench routes the site pages link (without the leading slash), so the caller can look up their variants. */
export function linkedWorkbenchRoutes(documents: ReadonlyMap<string, string>, pages: readonly string[], workbenchUrl: string): Set<string> {
  const routes = new Set<string>();
  for (const page of pages) {
    for (const [, , ref] of referencesOf(documents.get(page) ?? "")) {
      let rest: string | undefined;
      if (OTHER_HOST.test(workbenchUrl)) { if (ref.startsWith(workbenchUrl)) rest = ref.slice(workbenchUrl.length); }
      else if (!OTHER_HOST.test(ref)) {
        const path = new URL(ref, `http://site.invalid${page}`).pathname;
        if (path.startsWith(workbenchUrl)) rest = path.slice(workbenchUrl.length);
      }
      if (rest !== undefined) routes.add(decodeURIComponent(rest.split(/[?#]/)[0]!.replace(/\/$/, "")));
    }
  }
  return routes;
}

export function checkLinks(site: LinkSite): LinkCheck {
  const problems: string[] = [];
  const external = new Map<string, string[]>();
  const idCache = new Map<string, Set<string>>();
  const ids = (url: string): Set<string> | undefined => {
    const html = site.documents.get(url);
    if (html === undefined) return undefined;
    let found = idCache.get(url);
    if (!found) idCache.set(url, found = idsOf(html));
    return found;
  };
  /** The built URL a path names, or undefined. */
  const builtAs = (path: string): string | undefined => {
    if (site.built.has(path)) return path;
    if (!path.endsWith("/") && site.built.has(`${path}/`)) return `${path}/`;
    if (path.endsWith("/index.html")) {
      const folder = path.slice(0, -"index.html".length);
      if (site.built.has(folder)) return folder;
    }
    return undefined;
  };
  const wb = site.workbench;
  const workbenchProblem = (rest: string, hash: string): string | undefined => {
    const route = decodeURIComponent(rest.replace(/\/$/, ""));
    if (!wb!.routes.has(route)) return `the workbench has no ${route}`;
    if (hash && !(wb!.variants.get(route) ?? []).includes(decodeURIComponent(hash))) return `${route} has no variant "${hash}" in the workbench`;
    return undefined;
  };

  let references = 0;
  for (const page of site.pages) {
    const html = site.documents.get(page);
    if (html === undefined) continue;
    for (const [tag, attr, ref] of referencesOf(html)) {
      references++;
      if (ref === "" || SKIPPED.test(ref)) continue;
      const say = (why: string) => problems.push(`${page}: <${tag} ${attr}="${ref}">: ${why}`);
      // The workbench and the site's own address, absolute.
      if (wb && OTHER_HOST.test(wb.url) && ref.startsWith(wb.url)) {
        const [rest = "", hash = ""] = ref.slice(wb.url.length).split("#");
        const why = workbenchProblem(rest.split("?")[0]!, hash);
        if (why) say(why);
        continue;
      }
      let href = ref;
      if (site.siteUrl && ref.startsWith(site.siteUrl)) href = `/${ref.slice(site.siteUrl.length)}`;
      else if (OTHER_HOST.test(ref)) {
        if (site.pagesOnly) continue;
        const list = external.get(ref) ?? [];
        if (!list.includes(page)) list.push(page);
        external.set(ref, list);
        continue;
      }
      const url = new URL(href, `http://site.invalid${page}`);
      const path = decodeURIComponent(url.pathname);
      const hash = url.hash.slice(1);
      // A workbench on the site's own host, by its path.
      if (wb && wb.url.startsWith("/") && path.startsWith(wb.url)) {
        const why = workbenchProblem(path.slice(wb.url.length), hash);
        if (why) say(why);
        continue;
      }
      if (site.pagesOnly && /^\/(?:_pd|assets|preview)\//.test(path)) continue;
      const target = builtAs(path);
      if (target === undefined) { say(`no page or file is built at ${path}`); continue; }
      if (!hash) continue;
      const targetIds = ids(target);
      if (targetIds && !targetIds.has(decodeURIComponent(hash))) say(`${target} has no element with id "${decodeURIComponent(hash)}"`);
    }
  }
  return { problems, external, references };
}

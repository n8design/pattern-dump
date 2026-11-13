// What `pd build` writes for the storefront, found by crawling the headless server the same way a
// browser would load the site: the page list, every page, every preview a page embeds, and every
// stylesheet, script, font or image those reference (in markup, and in `url()` inside CSS).
//
// The whole crawl runs before anything is written. A page with problems, a missing preview, a reference
// that does not resolve — every one is collected, and any one stops the build before its first write,
// so a failed build leaves both output roots as they were.

import { request } from "node:http";
import { PD_ROUTES, type StorefrontPagesResponse } from "@pattern-dump/contracts";

/** fetch() for the storefront host: node:http with the Host header set (fetch() ignores an overridden Host). */
export function hostTransport(port: number, host: string): (liveUrl: string) => Promise<Response> {
  return liveUrl => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: liveUrl, headers: { host: `${host}:${port}` } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers.set(k, v);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers }));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const unescapeHtml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, `"`).replace(/&amp;/g, "&");

/** Root-relative references a document makes to files PD serves, and the page's link-preview image (an
 *  absolute URL on the site's own address, so its path is taken). Page routes are crawled from the page list. */
const markupRefs = (html: string): string[] => [
  ...[...html.matchAll(/(?:href|src)="(\/(?:_pd|assets|preview)\/[^"]+)"/g)].map(m => unescapeHtml(m[1])),
  // Each candidate of a srcset: its URL, before the width or density that describes it.
  ...[...html.matchAll(/srcset="([^"]+)"/g)].flatMap(m => unescapeHtml(m[1]).split(",").map(c => c.trim().split(/\s+/)[0] ?? ""))
    .filter(u => /^\/(?:_pd|assets)\//.test(u)),
  ...[...html.matchAll(/<meta property="og:image" content="https?:\/\/[^/"]+(\/assets\/[^"]+)">/g)].map(m => unescapeHtml(m[1])),
];
const cssRefs = (css: string): string[] =>
  [...css.matchAll(/url\(\s*(['"]?)(\/(?:_pd|assets)\/[^'")\s]+)\1\s*\)/g)].map(m => m[2]);

export interface StorefrontCrawl {
  /** Every URL to write, pages first, each once. */
  urls: string[];
  /** Every problem found; non-empty means nothing may be written. */
  problems: string[];
  /** The HTML of every document crawled, by its URL: the link check reads it (links.ts). */
  documents: Map<string, string>;
}

/** `files`: the root files to write besides the pages and what they reference (robots.txt, sitemap.xml). */
export async function crawlStorefront(get: (liveUrl: string) => Promise<Response>, files: readonly string[] = []): Promise<StorefrontCrawl> {
  const problems: string[] = [];
  const siteProblems = new Set<string>();
  const list = await get(PD_ROUTES.pages);
  if (list.status !== 200) {
    const body = await list.text();
    let error = body;
    try { error = (JSON.parse(body) as { error?: string }).error ?? body; } catch { /* not JSON */ }
    return { urls: [], problems: error.split("\n").filter(Boolean), documents: new Map() };
  }
  const { pages } = await list.json() as StorefrontPagesResponse;

  const urls: string[] = [];
  const documents = new Map<string, string>();
  const seen = new Set<string>();
  const queue: string[] = [];
  const add = (url: string): void => { if (!seen.has(url)) { seen.add(url); queue.push(url); } };
  for (const p of pages) add(p.route);
  // Each old route a page lists: the page that forwards from it.
  for (const p of pages) for (const old of p.redirectFrom ?? []) add(old);
  for (const f of files) add(f);

  while (queue.length) {
    const url = queue.shift()!;
    const res = await get(url);
    const type = res.headers.get("content-type") ?? "";
    // The 404 page answers with 404 when it is sound; anything else answers 200.
    if (res.status !== (url === PD_ROUTES.notFound ? 404 : 200)) {
      const body = await res.text();
      // A problem of the whole site (data-pd-site) is on every page: listed once, without a page's URL.
      const items = [...body.matchAll(/<li( data-pd-site)?>([\s\S]*?)<\/li>/g)].map(m => ({ site: !!m[1], text: unescapeHtml(m[2]) }));
      for (const i of items) {
        if (!i.site) problems.push(`${url}: ${i.text}`);
        else if (!siteProblems.has(i.text)) { siteProblems.add(i.text); problems.push(i.text); }
      }
      if (!items.length) problems.push(`${url}: ${res.status} ${body.split("\n")[0]?.slice(0, 160) ?? ""}`.trimEnd());
      continue;
    }
    urls.push(url);
    if (/text\/html/.test(type)) {
      const html = await res.text();
      documents.set(url, html);
      for (const ref of markupRefs(html)) add(ref);
    }
    else if (/text\/css/.test(type)) for (const ref of cssRefs(await res.text())) add(ref);
  }
  return { urls, problems, documents };
}

// Declared navigations: `storefront.site.navigations`, named lists of links a skin shows (a footer's, a
// sidebar's), beside the nav the storefront builds from the pages folder.
//
// The shape is Pattern Dump's, not the skin's. Each entry is exactly one of four forms, at any depth:
//   { page: "guides/setup.md", label? }    a page, by its path in the pages folder; labelled with its title
//   { page, label?, children }              a page that is a parent too: `children` is a list of entries, or
//                                           "folder" on a folder's index.md, its pages in navigation order
//   { href, label }                          an external link: http(s):, mailto:, or a path from the root
//   { label, children: [...] }               a group
// "folder" is one level deep, as the nav is: a subfolder is its index.md, a link with nothing below it. A page
// with nav: false is not listed; drafts are not either, in a build, since they are not pages there.
// The skin's schema only lists the names it uses: `partials/base` declares
// `site.properties.navigations.properties.<name>`, each an empty schema (a description at most), and
// `required` for the names it must have. A shape declared there is a skin error; a configured name the skin
// does not list, or a required one that is missing, is an error too. Every problem names where it is
// (`storefront.site.navigations.footer[1].children[0]`). They are the site's problems, not a page's: each
// is reported once (page.ts marks them, the build lists them once).
//
// Resolved per page: { label, route | href, current?, ancestor?, children? }, `current` on the entry of the
// page being rendered, `ancestor` on every entry with children above it. An external link is never current.

import { suggest } from "@pattern-dump/config";
import type { StorefrontNavEntry } from "@pattern-dump/config";
import type { PropertySchema } from "./declared-values.js";
import { listed as inNav, type PageModel } from "./pages.js";

export const NAVIGATIONS_KEY = "navigations";
const AT = "site.globals.navigations";
const KEYS = ["page", "href", "label", "children"];
/** `children: "folder"`: the folder's pages, on its index.md. */
const FOLDER = "folder";
const isIndex = (path: string): boolean => path === "index.md" || path.endsWith("/index.md");

/** One entry of a navigation as a layout gets it. */
export interface NavLink {
  label: string;
  route?: string;
  href?: string;
  current?: true;
  ancestor?: true;
  children?: NavLink[];
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown): string => typeof v === "string" ? `"${v}"` : JSON.stringify(v) ?? String(v);

/** An external link a page may carry: http(s):, mailto:, or a path from the site's root (not `//host`). */
export const isAllowedHref = (href: string): boolean => /^(https?:\/\/|mailto:)/i.test(href) || /^\/(?!\/)/.test(href);

export interface NavigationNames {
  /** The names the skin lists. */
  listed: string[];
  problems: string[];
}

/** What `partials/base` lists under site.navigations: names only, with no shape of their own. */
export function listedNavigations(declared: PropertySchema | undefined, owner: string): NavigationNames {
  if (!declared) return { listed: [], problems: [] };
  const problems: string[] = [];
  const names = declared.properties ?? {};
  for (const [name, schema] of Object.entries(names)) {
    const own = Object.keys(isObject(schema) ? schema : {}).filter(k => k !== "description" && k !== "title");
    if (own.length) {
      problems.push(`${owner} declares ${own.map(k => `"${k}"`).join(", ")} for site.navigations.${name}: the shape of a navigation is Pattern Dump's, so list the name only (a description at most)`);
    }
  }
  const extra = Object.keys(declared).filter(k => !["type", "description", "title", "properties", "required"].includes(k));
  if (extra.length || (declared.type !== undefined && declared.type !== "object")) {
    problems.push(`${owner} declares a shape for site.navigations: the shape of a navigation is Pattern Dump's, so list its names under properties only`);
  }
  return { listed: Object.keys(names), problems };
}

/** The navigations in the config, checked: their names against the skin's list, every entry at any depth. */
export function checkNavigations(
  value: unknown, declared: PropertySchema | undefined, owner: string, pagePaths: ReadonlySet<string>,
): { navigations: Record<string, StorefrontNavEntry[]>; listed: string[]; problems: string[] } {
  const names = listedNavigations(declared, owner);
  const problems = [...names.problems];
  const navigations: Record<string, StorefrontNavEntry[]> = {};
  if (value !== undefined && !isObject(value)) {
    problems.push(`${AT} must be an object of named navigations, such as { footer: [{ page: "about.md" }] } (got ${show(value)})`);
    return { navigations, listed: names.listed, problems };
  }
  const given = (value ?? {}) as Obj;
  for (const [name, entries] of Object.entries(given)) {
    if (!names.listed.includes(name)) {
      const near = suggest(name, names.listed);
      problems.push(names.listed.length
        ? `${AT}.${name} is not a navigation ${owner} lists (it lists ${names.listed.map(n => `"${n}"`).join(", ")})${near ? `: did you mean "${near}"?` : ""}`
        : `${AT}.${name} is set, but ${owner} lists no navigations, so no layout can show it`);
      continue;
    }
    if (!Array.isArray(entries)) { problems.push(`${AT}.${name} must be a list of entries (got ${show(entries)})`); continue; }
    problems.push(...checkEntries(entries, `${AT}.${name}`, pagePaths));
    navigations[name] = entries as StorefrontNavEntry[];
  }
  for (const name of declared?.required ?? []) {
    if (!Object.hasOwn(given, name)) problems.push(`${AT}.${name} is required by ${owner}`);
  }
  return { navigations, listed: names.listed, problems };
}

function checkEntries(entries: unknown[], at: string, pagePaths: ReadonlySet<string>): string[] {
  return entries.flatMap((entry, i) => checkEntry(entry, `${at}[${i}]`, pagePaths));
}

function checkEntry(entry: unknown, at: string, pagePaths: ReadonlySet<string>): string[] {
  const FORMS = `{ page }, { page, children }, { href, label } or { label, children }`;
  if (!isObject(entry)) return [`${at} must be an entry, one of ${FORMS} (got ${show(entry)})`];
  const problems: string[] = [];
  for (const key of Object.keys(entry)) {
    if (KEYS.includes(key)) continue;
    const near = suggest(key, KEYS);
    problems.push(`${at}: "${key}" is not a key of a navigation entry${near ? `: did you mean "${near}"?` : ""}`);
  }
  const has = (k: string) => Object.hasOwn(entry, k);
  if (has("href") && (has("page") || has("children"))) {
    const both = (["page", "href", "children"] as const).filter(has);
    problems.push(`${at} has ${both.map(k => `"${k}"`).join(" and ")}: an entry is one of ${FORMS}`);
    return problems;
  }
  if (!has("page") && !has("href") && !has("children")) {
    problems.push(`${at} needs "page", "href" or "children": an entry is one of ${FORMS}`);
    return problems;
  }
  const label = entry["label"];
  if (label !== undefined && typeof label !== "string") problems.push(`${at}.label must be text (got ${show(label)})`);
  const page = entry["page"];
  if (has("page")) {
    if (typeof page !== "string") problems.push(`${at}.page must be the path of a page in the pages folder, such as "about.md" (got ${show(page)})`);
    else if (!pagePaths.has(page)) {
      const near = suggest(page, [...pagePaths]);
      problems.push(`${at}: "${page}" is not a page in the pages folder${near ? `: did you mean "${near}"?` : ""}`);
    }
  } else if (label === undefined) problems.push(`${at} needs a "label"`);
  if (has("href")) {
    const href = entry["href"];
    if (typeof href !== "string") problems.push(`${at}.href must be text (got ${show(href)})`);
    else if (!isAllowedHref(href)) problems.push(`${at}.href ${show(href)} must start with https:, http: or mailto:, or be a path from the site's root (/…)`);
  }
  if (has("children")) {
    const children = entry["children"];
    if (children === FOLDER) {
      if (!has("page")) problems.push(`${at}.children is "folder", which lists a folder's pages: it needs the folder's index.md as "page", such as { page: "guides/index.md", children: "folder" }`);
      else if (typeof page === "string" && !isIndex(page)) problems.push(`${at}.children is "folder", which lists a folder's pages: it works only on a folder's index.md, and "${page}" is not one`);
    } else if (!Array.isArray(children)) problems.push(`${at}.children must be a list of entries, or "folder" on a folder's index.md (got ${show(children)})`);
    else problems.push(...checkEntries(children, `${at}.children`, pagePaths));
  }
  return problems;
}

/** Every listed navigation as the page at `route` shows it: null where the config sets none. */
export function resolveNavigations(
  navigations: Record<string, StorefrontNavEntry[]>, listed: string[], model: PageModel, route: string,
): Record<string, NavLink[] | null> {
  const byPath = new Map([...model.files.values()].map(f => [f.path, f.route]));
  const titleOf = new Map(model.pages.map(p => [p.route, p.title]));
  const pageLink = (r: string, label?: string): NavLink =>
    ({ label: label ?? titleOf.get(r) ?? r, route: r, ...(r === route ? { current: true as const } : {}) });
  // A folder's pages, in navigation order, without those nav: false leaves out; a subfolder is its index.md.
  const folderOf = (folder: string): NavLink[] => (model.folders.get(folder)?.children ?? [])
    .filter(r => { const f = model.files.get(r); return f !== undefined && inNav(f); })
    .map(r => pageLink(r));
  const withChildren = (link: NavLink, children: NavLink[]): NavLink =>
    ({ ...link, children, ...(children.some(c => c.current || c.ancestor) ? { ancestor: true as const } : {}) });
  const resolve = (entries: StorefrontNavEntry[]): NavLink[] => entries.map(e => {
    if ("page" in e) {
      const link = pageLink(byPath.get(e.page)!, e.label);
      if (!("children" in e)) return link;
      return withChildren(link, e.children === FOLDER ? folderOf(link.route!) : resolve(e.children));
    }
    if ("href" in e) return { label: e.label, href: e.href };
    return withChildren({ label: e.label }, resolve(e.children));
  });
  return Object.fromEntries(listed.map(name => [name, Object.hasOwn(navigations, name) ? resolve(navigations[name]!) : null]));
}

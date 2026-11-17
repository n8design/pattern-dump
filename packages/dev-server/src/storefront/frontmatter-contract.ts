// A storefront page's frontmatter, checked against the layout it uses.
//
// Fourteen keys belong to the build, not to a layout: `layout` (which layout; when absent, the `childLayout` of the
// nearest folder above the page whose index.md sets one, else `page`), `childLayout` (on a folder's index.md), `order`
// (where in the nav), the page's search and link-preview keys — `redirectFrom` (old routes that forward
// here), `index` (`false` keeps the page out of search engines and the sitemap) and `image` (its link-preview
// image, a raster file in the assets; checked against the files in page-image.ts) — and its listing keys
// (listing-keys.ts): `date`, `updated`, `tags`, `categories` (declared in storefront.categories), `draft`, and `sort` and `view` on a
// folder's index.md, and `toc` (the table of contents, toc.ts). A layout cannot declare any of the fourteen. Every other key must be declared by the chosen layout's schema — the
// `<stem>.schema.json` beside `layouts/<name>/<name>.hbs` — and is coerced to the type the schema
// declares. Nothing is inferred: a key the schema does not declare is an error, and a layout with no
// schema declares nothing. Four more keys are filled by the storefront itself (`body`, the rendered
// markdown; `nav`; `site`, from storefront.site; and `page`, what is derived for the page); a page cannot
// set them, and a layout requiring them is satisfied.
//
// Every problem is returned, each with the line it is on when it has one, and every problem is fatal to
// the caller (D7). The frontmatter's own grammar errors (readFrontmatterStrict) come first.

import type { DiscoveryMap } from "@pattern-dump/contracts";
import { suggest } from "@pattern-dump/config";
import { checkDeclared, readSchema, type PropertySchema } from "./declared-values.js";
import { DEFAULT_LAYOUT, type PageFile } from "./pages.js";
import type { FrontmatterValue } from "../frontmatter.js";
import { readChildLayout, readDate, readDraft, readSort, readTerms, readUpdated, readView, type Read, type SortBy } from "./listing-keys.js";
import { categoryIndex, termIndex, TERM_WORDS, type CategoryIndex, type TermIndex, type TermKind } from "./categories.js";
import { declaredQueries } from "./query.js";
import { checkChildDefaults, NOT_DEFAULTABLE, originOf, placeOf } from "./folder-defaults.js";
import { CHILD_DEFAULTS } from "../frontmatter.js";
import { designFiles } from "./design-files.js";

/** Keys the build owns: they are read by the storefront, never passed to the layout. */
export const RESERVED_KEYS = ["layout", "childLayout", "order", "redirectFrom", "index", "image", "date", "updated", "tags", "categories", "draft", "sort", "view", "toc"] as const;
/** Keys the storefront fills for every page: a page cannot set them. */
export const ASSEMBLY_KEYS = ["body", "nav", "site", "page"] as const;

export interface PageProblem {
  /** The page file, relative to the pages folder. */
  file: string;
  /** 1-based line, when the problem is on one. */
  line?: number;
  message: string;
}

/** The page's own search and link-preview keys, checked for their shape (the image file is checked later). */
export interface BuildKeys {
  /** Old routes that forward to this page, root-relative and slash-wrapped. */
  redirectFrom?: string[];
  /** false: noindex, and no sitemap entry. */
  index?: boolean;
  /** true: the table of contents in its region (toc.ts); false: none, whatever the layout says. */
  toc?: boolean;
  /** A /assets/… path. */
  image?: string;
  /** The page's date, YYYY-MM-DD. */
  date?: string;
  /** The page's last real change, YYYY-MM-DD: set by its author, never before `date`. */
  updated?: string;
  tags?: string[];
  /** Declared category keys, in the page's order (an old key resolved to its category). */
  categories?: string[];
  draft?: boolean;
  /** On a folder's index.md: how its pages are listed. */
  sort?: SortBy;
  /** On a folder's index.md: the view its listing is shown in (views.ts checks that it is one). */
  view?: string;
}

/** An old route: root-relative, slash-wrapped, plain segments only (no query, fragment, "." or ".."). */
const OLD_ROUTE = /^\/(?:(?!\.\.?\/)[^/?#\s]+\/)+$/;
/** The same rule as storefront.image in the config. */
const ASSET_PATH = /^\/assets\/[^?#]+[^/?#]$/;

function checkBuildKeys(values: Record<string, FrontmatterValue>, path: string, at: (key: string, message: string) => void,
  terms: { categories: CategoryIndex; tags: TermIndex }, renamed: (kind: TermKind, from: string, to: string) => void): BuildKeys {
  const out: BuildKeys = {};
  const redirect = values["redirectFrom"];
  if (redirect !== undefined) {
    const list = Array.isArray(redirect) ? redirect : [redirect];
    const bad = list.filter(r => typeof r !== "string" || !OLD_ROUTE.test(r));
    if (bad.length) {
      at("redirectFrom", `redirectFrom: ${bad.map(r => `"${String(r)}"`).join(", ")} ${bad.length === 1 ? "is" : "are"} not `
        + `a route: each old route starts and ends with "/", such as "/old/page/", with no query or fragment`);
    } else if (list.length) out.redirectFrom = list as string[];
  }
  const toc = values["toc"];
  if (toc !== undefined) {
    if (toc === "true" || toc === "false") out.toc = toc === "true";
    else at("toc", `toc must be true or false`);
  }
  const index = values["index"];
  if (index !== undefined) {
    if (index === "true" || index === "false") out.index = index === "true";
    else at("index", `index must be true or false`);
  }
  const image = values["image"];
  if (image !== undefined) {
    if (typeof image === "string" && ASSET_PATH.test(image)) out.image = image;
    else at("image", `image must be a path to a file in the assets, such as "/assets/images/share.png"`);
  }
  const take = <K extends "date" | "updated" | "draft" | "sort" | "view">(key: K, r: Read<NonNullable<BuildKeys[K]>> | undefined): void => {
    if (r === undefined) return;
    if (r.ok) out[key] = r.value;
    else at(key, r.message);
  };
  const v = (key: string) => values[key];
  take("date", v("date") === undefined ? undefined : readDate(v("date")!));
  take("updated", v("updated") === undefined ? undefined : readUpdated(v("updated")!, out.date));
  for (const [key, index] of [["tags", terms.tags], ["categories", terms.categories]] as const) {
    const r = v(key) === undefined ? undefined : readTerms(v(key)!, index);
    if (r?.ok) {
      out[key] = r.value.keys;
      for (const x of r.value.renamed) renamed(index.kind, x.from, x.to);
    } else if (r) at(key, r.message);
  }
  take("draft", v("draft") === undefined ? undefined : readDraft(v("draft")!));
  take("sort", v("sort") === undefined ? undefined : readSort(v("sort")!, path));
  take("view", v("view") === undefined ? undefined : readView(v("view")!, path));
  return out;
}

export interface CheckedPage {
  /** The layout component, e.g. "layouts/article". Set even when it does not exist. */
  layoutId: string;
  /** The frontmatter for the layout: declared keys only, coerced to their declared types. */
  values: Record<string, unknown>;
  /** The page's search and link-preview keys, for the build (never passed to the layout). */
  build: BuildKeys;
  problems: PageProblem[];
  /** Warnings that don't stop the page: an old category key it still names. One line each, with file and line. */
  notes: string[];
}

interface LayoutSchema { required?: string[]; properties?: Record<string, PropertySchema> }

/** The layouts a page can choose: base components directly under layouts/. */
export function layoutNames(discoveryMap: DiscoveryMap): string[] {
  return [...discoveryMap.keys()]
    .filter(id => /^layouts\/[^/~]+$/.test(id))
    .map(id => id.slice("layouts/".length))
    .sort();
}

/** `categories` and `tags`: the declared ones (the page model's); no categories and any tag when left out. */
export async function checkPageFrontmatter(page: PageFile, discoveryMap: DiscoveryMap, categories: CategoryIndex = categoryIndex(undefined),
  tags: TermIndex = termIndex("tag", undefined)): Promise<CheckedPage> {
  const { values, errors, lines } = page.frontmatter;
  const problems: PageProblem[] = errors.map(e => ({ file: page.path, line: e.line, message: e.message }));
  // A value a folder set (folder-defaults.ts) is named with the index.md and line it came from, in place of a line.
  const at = (key: string, message: string): void => {
    if (originOf(page, key)) { problems.push({ file: placeOf(page, key), message }); return; }
    problems.push({ file: page.path, ...(lines[key] !== undefined ? { line: lines[key] } : {}), message });
  };
  const notes: string[] = [];
  const where = (key: string) => placeOf(page, key);
  const renamed = (kind: TermKind, from: string, to: string): void => {
    const w = TERM_WORDS[kind];
    notes.push(`warning: ${where(w.many)}: ${w.one} "${from}" is now "${to}" (renamed in ${w.config}): write "${to}"`);
  };
  const buildKeys = () => checkBuildKeys(values, page.path, at, { categories, tags }, renamed);

  // ---- layout: its own, else its folder's childLayout (pages.ts), else the default ----
  const known = layoutNames(discoveryMap);
  const isLayout = (name: string) => /^[^/~]+$/.test(name) && discoveryMap.has(`layouts/${name}`);
  const notALayout = (subject: string) => known.length
    ? `${subject} is not a layout: the layouts are ${known.map(n => `"${n}"`).join(", ")}`
    : `${subject} is not a layout: the project has no layouts (components in a layouts/ folder of its patterns)`;
  // This index.md's childDefaults (folder-defaults.ts): keys that can't be defaulted, and the build keys' values,
  // checked once here, so a folder with no pages yet is checked too. The rest is checked on each page that takes it.
  const block = page.frontmatter.childDefaults;
  if (block) {
    for (const p of checkChildDefaults(page)) problems.push({ file: page.path, ...(p.line !== undefined ? { line: p.line } : {}), message: p.message });
    const defaultsAt = (key: string, message: string): void => {
      const line = lines[`${CHILD_DEFAULTS}.${key}`];
      problems.push({ file: page.path, ...(line !== undefined ? { line } : {}), message: `${CHILD_DEFAULTS}.${message}` });
    };
    const defaultable = Object.fromEntries(Object.entries(block.values).filter(([k]) => !(NOT_DEFAULTABLE as readonly string[]).includes(k)));
    checkBuildKeys(defaultable, page.path, defaultsAt, { categories, tags }, () => {});
    const childLayout = block.values["layout"];
    if (childLayout !== undefined) {
      const r = readChildLayout(childLayout, page.path);
      if (!r.ok) defaultsAt("layout", `layout: ${r.message.replace(/^childLayout/, "layout")}`);
      else if (!isLayout(r.value)) defaultsAt("layout", `layout: ${notALayout(`"${r.value}"`)}`);
    }
  }
  // The default layout this index.md gives its folder's pages: checked here, once, whether or not a page takes it.
  const rawChild = values["childLayout"];
  if (rawChild !== undefined) {
    const r = readChildLayout(rawChild, page.path);
    if (!r.ok) at("childLayout", r.message);
    else if (!isLayout(r.value)) at("childLayout", notALayout(`childLayout "${r.value}"`));
  }
  const rawLayout = values["layout"];
  const inherited = rawLayout === undefined ? page.inherited : undefined;
  let layout = inherited?.layout ?? DEFAULT_LAYOUT;
  if (Array.isArray(rawLayout)) at("layout", "layout must be one layout name, not a list");
  else if (rawLayout !== undefined) layout = rawLayout;
  const layoutId = `layouts/${layout}`;
  /** The layout as messages name it: with where it came from, when the page took it from its folder. */
  const named = `layout "${layout}"${inherited ? ` (the childLayout of ${inherited.from})` : ""}`;
  const entry = isLayout(layout) ? discoveryMap.get(layoutId) : undefined;
  if (!entry || Array.isArray(rawLayout)) {
    if (!Array.isArray(rawLayout)) {
      const problem = notALayout(named);
      if (inherited) problems.push({ file: page.path, message: problem });
      else at("layout", problem);
    }
    return { layoutId, values: {}, build: buildKeys(), problems, notes };
  }

  // ---- the layout's schema: what a page may set ----
  const read = await readSchema(entry.schemaPath, designFiles(discoveryMap));
  if (read.error !== undefined) {
    problems.push({ file: page.path, message: `the schema of ${named} cannot be read: ${read.error}` });
    return { layoutId, values: {}, build: buildKeys(), problems, notes };
  }
  const schema: LayoutSchema = read.schema ?? {};
  const hasSchema = read.schema !== undefined;
  const declared = schema.properties ?? {};
  // A key the build owns can't also be the layout's: a page would set one value for two readers.
  for (const key of RESERVED_KEYS) {
    if (Object.hasOwn(declared, key)) {
      problems.push({ file: page.path, message: `layout "${layout}" declares "${key}", which a page sets for the build, `
        + `not for its layout: rename it in the layout's schema` });
    }
  }
  const build = buildKeys();
  // The keys that set the layout's queries (query.ts reads and checks them): the build's, like the reserved keys.
  const forQueries = declaredQueries(read.schema).map(q => q.name);

  // ---- every key the page sets ----
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if ((RESERVED_KEYS as readonly string[]).includes(key) || forQueries.includes(key)) continue;
    if ((ASSEMBLY_KEYS as readonly string[]).includes(key)) { at(key, `"${key}" is filled by the storefront, not by a page`); continue; }
    const prop = Object.hasOwn(declared, key) ? declared[key] : undefined;
    if (!prop) {
      if (!hasSchema) { at(key, `"${key}" is not declared by ${named}, which has no schema`); continue; }
      const near = suggest(key, [...Object.keys(declared), ...RESERVED_KEYS, ...forQueries]);
      at(key, `"${key}" is not declared by ${named}${near ? `: did you mean "${near}"?` : ""}`);
      continue;
    }
    const r = checkDeclared(prop, value, "frontmatter");
    if (r.ok) out[key] = r.value;
    else at(key, `"${key}" ${r.message}`);
  }

  // ---- keys with options under them: only a query of the layout takes them ----
  for (const key of Object.keys(page.frontmatter.maps ?? {})) {
    if (forQueries.includes(key)) continue;
    const known = Object.hasOwn(declared, key) || (RESERVED_KEYS as readonly string[]).includes(key) || (ASSEMBLY_KEYS as readonly string[]).includes(key);
    if (known) { at(key, `"${key}" has keys indented under it, which only a query of the layout takes: write its value on the line`); continue; }
    const near = suggest(key, [...Object.keys(declared), ...RESERVED_KEYS, ...forQueries]);
    at(key, `"${key}" is not declared by ${named}${near ? `: did you mean "${near}"?` : ""}`);
  }

  // ---- what the layout requires ----
  for (const key of schema.required ?? []) {
    if ((ASSEMBLY_KEYS as readonly string[]).includes(key)) continue;
    if (!(key in values) && !(key in (page.frontmatter.maps ?? {}))) problems.push({ file: page.path, message: `"${key}" is required by ${named}` });
  }

  return { layoutId, values: out, build, problems, notes };
}

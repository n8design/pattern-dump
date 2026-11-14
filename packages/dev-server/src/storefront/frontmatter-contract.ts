// A storefront page's frontmatter, checked against the layout it uses.
//
// Nine keys belong to the build, not to a layout: `layout` (which layout; `page` when absent), `order`
// (where in the nav), the page's search and link-preview keys — `redirectFrom` (old routes that forward
// here), `index` (`false` keeps the page out of search engines and the sitemap) and `image` (its link-preview
// image, a raster file in the assets; checked against the files in page-image.ts) — and its listing keys
// (listing-keys.ts): `date`, `tags`, `draft`, and `sort` on a folder's index.md. A layout cannot declare
// any of the nine. Every other key must be declared by the chosen layout's schema — the
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
import { readDate, readDraft, readSort, readTags, type Read, type SortBy } from "./listing-keys.js";

/** Keys the build owns: they are read by the storefront, never passed to the layout. */
export const RESERVED_KEYS = ["layout", "order", "redirectFrom", "index", "image", "date", "tags", "draft", "sort"] as const;
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
  /** A /assets/… path. */
  image?: string;
  /** The page's date, YYYY-MM-DD. */
  date?: string;
  tags?: string[];
  draft?: boolean;
  /** On a folder's index.md: how its pages are listed. */
  sort?: SortBy;
}

/** An old route: root-relative, slash-wrapped, plain segments only (no query, fragment, "." or ".."). */
const OLD_ROUTE = /^\/(?:(?!\.\.?\/)[^/?#\s]+\/)+$/;
/** The same rule as storefront.image in the config. */
const ASSET_PATH = /^\/assets\/[^?#]+[^/?#]$/;

function checkBuildKeys(values: Record<string, FrontmatterValue>, path: string, at: (key: string, message: string) => void): BuildKeys {
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
  const take = <K extends "date" | "tags" | "draft" | "sort">(key: K, r: Read<NonNullable<BuildKeys[K]>> | undefined): void => {
    if (r === undefined) return;
    if (r.ok) out[key] = r.value;
    else at(key, r.message);
  };
  const v = (key: string) => values[key];
  take("date", v("date") === undefined ? undefined : readDate(v("date")!));
  take("tags", v("tags") === undefined ? undefined : readTags(v("tags")!));
  take("draft", v("draft") === undefined ? undefined : readDraft(v("draft")!));
  take("sort", v("sort") === undefined ? undefined : readSort(v("sort")!, path));
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
}

interface LayoutSchema { required?: string[]; properties?: Record<string, PropertySchema> }

/** The layouts a page can choose: base components directly under layouts/. */
export function layoutNames(discoveryMap: DiscoveryMap): string[] {
  return [...discoveryMap.keys()]
    .filter(id => /^layouts\/[^/~]+$/.test(id))
    .map(id => id.slice("layouts/".length))
    .sort();
}

export async function checkPageFrontmatter(page: PageFile, discoveryMap: DiscoveryMap): Promise<CheckedPage> {
  const { values, errors, lines } = page.frontmatter;
  const problems: PageProblem[] = errors.map(e => ({ file: page.path, line: e.line, message: e.message }));
  const at = (key: string, message: string): void => {
    problems.push({ file: page.path, ...(lines[key] !== undefined ? { line: lines[key] } : {}), message });
  };

  // ---- layout ----
  const rawLayout = values["layout"];
  let layout = DEFAULT_LAYOUT;
  if (Array.isArray(rawLayout)) at("layout", "layout must be one layout name, not a list");
  else if (rawLayout !== undefined) layout = rawLayout;
  const layoutId = `layouts/${layout}`;
  const known = layoutNames(discoveryMap);
  const entry = /^[^/~]+$/.test(layout) ? discoveryMap.get(layoutId) : undefined;
  if (!entry || Array.isArray(rawLayout)) {
    if (!Array.isArray(rawLayout)) {
      at("layout", known.length
        ? `layout "${layout}" is not a layout — the layouts are ${known.map(n => `"${n}"`).join(", ")}`
        : `layout "${layout}" is not a layout — the project has no layouts (components in a layouts/ folder of its patterns)`);
    }
    return { layoutId, values: {}, build: checkBuildKeys(values, page.path, at), problems };
  }

  // ---- the layout's schema: what a page may set ----
  const read = await readSchema(entry.schemaPath);
  if (read.error !== undefined) {
    problems.push({ file: page.path, message: `the schema of layout "${layout}" cannot be read: ${read.error}` });
    return { layoutId, values: {}, build: checkBuildKeys(values, page.path, at), problems };
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
  const build = checkBuildKeys(values, page.path, at);

  // ---- every key the page sets ----
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if ((RESERVED_KEYS as readonly string[]).includes(key)) continue;
    if ((ASSEMBLY_KEYS as readonly string[]).includes(key)) { at(key, `"${key}" is filled by the storefront, not by a page`); continue; }
    const prop = Object.hasOwn(declared, key) ? declared[key] : undefined;
    if (!prop) {
      if (!hasSchema) { at(key, `"${key}" is not declared by layout "${layout}", which has no schema`); continue; }
      const near = suggest(key, [...Object.keys(declared), ...RESERVED_KEYS]);
      at(key, `"${key}" is not declared by layout "${layout}"${near ? ` — did you mean "${near}"?` : ""}`);
      continue;
    }
    const r = checkDeclared(prop, value, "frontmatter");
    if (r.ok) out[key] = r.value;
    else at(key, `"${key}" ${r.message}`);
  }

  // ---- what the layout requires ----
  for (const key of schema.required ?? []) {
    if ((ASSEMBLY_KEYS as readonly string[]).includes(key)) continue;
    if (!(key in values)) problems.push({ file: page.path, message: `"${key}" is required by layout "${layout}"` });
  }

  return { layoutId, values: out, build, problems };
}

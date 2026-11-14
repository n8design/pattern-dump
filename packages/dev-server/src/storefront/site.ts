// The storefront's site values: `storefront.site` from the config, the values every page shares (the site's
// title, the line in its footer). Every layout gets them as `site`; a page cannot set them.
//
// What they may hold is declared, not inferred: the `site` property of `partials/base`'s schema — the
// frame every layout is built on — names the keys, their types and which are required. The values are
// checked against it with the same checker as page frontmatter, with coercion off: config values are
// already typed. The check looks inside objects and lists, at every level (checkJsonKeys). Every problem
// is fatal to the caller (D7), and every one is the whole site's: the caller reports each once.
//
// One key is not the skin's to shape: `navigations` (navigations.ts). The skin lists its names; Pattern
// Dump checks the entries, and resolves them per page.

import type { DiscoveryMap } from "@pattern-dump/contracts";
import type { StorefrontNavEntry } from "@pattern-dump/config";
import { checkJsonKeys, readSchema, type PropertySchema } from "./declared-values.js";
import { checkNavigations, NAVIGATIONS_KEY } from "./navigations.js";
import { checkCollections, COLLECTIONS_KEY } from "./collections.js";

/** The component whose schema declares `site`. */
export const SITE_SCHEMA_OWNER = "partials/base";

export interface CheckedSite {
  /** The site values, as declared types (unchanged: nothing is coerced), without `navigations`. Empty when
   *  there are problems. */
  values: Record<string, unknown>;
  /** The declared navigations, checked; resolved per page by resolveNavigations. */
  navigations: Record<string, StorefrontNavEntry[]>;
  /** The navigation names partials/base lists: the skin's, whatever problems the config has. */
  listed: string[];
  /** The collection names partials/base lists (collections.ts): folders' paths, filled per page. */
  collections: string[];
  problems: string[];
  /** Said once for the site: a listed collection with no folder (an empty list). */
  notes?: string[];
}

const none = (problems: string[] = [], collections: string[] = []): CheckedSite => ({ values: {}, navigations: {}, listed: [], collections, problems });

/** `pagePaths`: every page's path in the pages folder ("guides/setup.md"), which a navigation's `page` names.
 *  `folders`: every folder's path ("articles"), which a collection's name is; `leftOut`: the drafts a build leaves out. */
export async function checkSite(
  site: Record<string, unknown> | undefined, discoveryMap: DiscoveryMap, pagePaths: ReadonlySet<string> = new Set(),
  pages: { folders: ReadonlySet<string>; leftOut: readonly string[] } = { folders: new Set(), leftOut: [] },
): Promise<CheckedSite> {
  const problems: string[] = [];
  const entry = discoveryMap.get(SITE_SCHEMA_OWNER);
  if (!entry) {
    if (site !== undefined) problems.push(`storefront.site is set, but there is no ${SITE_SCHEMA_OWNER} to declare what it holds`);
    return none(problems);
  }

  const read = await readSchema(entry.schemaPath);
  if (read.error !== undefined) return none([`the schema of ${SITE_SCHEMA_OWNER} cannot be read: ${read.error}`]);
  const schema = read.schema ?? {};
  const declared = schema.properties?.site;
  if (!declared) {
    if (site !== undefined) problems.push(`storefront.site is set, but ${SITE_SCHEMA_OWNER} declares no site, so no layout can use it`);
    return none(problems);
  }
  const navDeclared = declared.properties?.[NAVIGATIONS_KEY];
  // Even with no storefront.site, a navigation the skin requires is missing, and a collection it lists is checked.
  const navs = checkNavigations(site?.[NAVIGATIONS_KEY], navDeclared, SITE_SCHEMA_OWNER, pagePaths);
  const cols = checkCollections(declared.properties?.[COLLECTIONS_KEY] as Record<string, unknown> | undefined, SITE_SCHEMA_OWNER,
    pages.folders, pages.leftOut, site);
  if (site === undefined) {
    if (schema.required?.includes("site")) problems.push(`storefront.site is required by ${SITE_SCHEMA_OWNER}`);
    problems.push(...navs.problems, ...cols.problems);
    return { ...none(problems, cols.listed), listed: navs.listed, notes: cols.notes };
  }

  // The rest of site, at every depth, against the skin's schema; navigations and collections are checked above.
  const own = (k: string) => k !== NAVIGATIONS_KEY && k !== COLLECTIONS_KEY;
  const rest = Object.fromEntries(Object.entries(site).filter(([k]) => own(k)));
  const restDeclared: PropertySchema = {
    ...declared,
    properties: Object.fromEntries(Object.entries(declared.properties ?? {}).filter(([k]) => own(k))),
    ...(declared.required ? { required: declared.required.filter(own) } : {}),
  };
  const checked = checkJsonKeys(restDeclared, rest, "storefront.site", SITE_SCHEMA_OWNER);
  problems.push(...checked.problems, ...navs.problems, ...cols.problems);
  if (declared.required?.includes(NAVIGATIONS_KEY) && !Object.hasOwn(site, NAVIGATIONS_KEY)) {
    problems.push(`storefront.site.${NAVIGATIONS_KEY} is required by ${SITE_SCHEMA_OWNER}`);
  }
  if (problems.length) return { ...none(problems, cols.listed), listed: navs.listed, notes: cols.notes };
  return { values: checked.value as Record<string, unknown>, navigations: navs.navigations, listed: navs.listed, collections: cols.listed, problems, notes: cols.notes };
}

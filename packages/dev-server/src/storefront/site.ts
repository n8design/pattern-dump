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
  problems: string[];
}

const none = (problems: string[] = []): CheckedSite => ({ values: {}, navigations: {}, listed: [], problems });

/** `pagePaths`: every page's path in the pages folder ("guides/setup.md"), which a navigation's `page` names. */
export async function checkSite(
  site: Record<string, unknown> | undefined, discoveryMap: DiscoveryMap, pagePaths: ReadonlySet<string> = new Set(),
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
  // Even with no storefront.site, a navigation the skin requires is missing.
  const navs = checkNavigations(site?.[NAVIGATIONS_KEY], navDeclared, SITE_SCHEMA_OWNER, pagePaths);
  if (site === undefined) {
    if (schema.required?.includes("site")) problems.push(`storefront.site is required by ${SITE_SCHEMA_OWNER}`);
    problems.push(...navs.problems);
    return { ...none(problems), listed: navs.listed };
  }

  // The rest of site, at every depth, against the skin's schema; navigations is checked above.
  const { [NAVIGATIONS_KEY]: _navigations, ...rest } = site;
  const restDeclared: PropertySchema = {
    ...declared,
    properties: Object.fromEntries(Object.entries(declared.properties ?? {}).filter(([k]) => k !== NAVIGATIONS_KEY)),
    ...(declared.required ? { required: declared.required.filter(k => k !== NAVIGATIONS_KEY) } : {}),
  };
  const checked = checkJsonKeys(restDeclared, rest, "storefront.site", SITE_SCHEMA_OWNER);
  problems.push(...checked.problems, ...navs.problems);
  if (declared.required?.includes(NAVIGATIONS_KEY) && !Object.hasOwn(site, NAVIGATIONS_KEY)) {
    problems.push(`storefront.site.${NAVIGATIONS_KEY} is required by ${SITE_SCHEMA_OWNER}`);
  }
  if (problems.length) return { ...none(problems), listed: navs.listed };
  return { values: checked.value as Record<string, unknown>, navigations: navs.navigations, listed: navs.listed, problems };
}

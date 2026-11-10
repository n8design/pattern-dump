// The storefront's site values: `storefront.site` from the config, the values every page shares (the site's
// title, the line in its footer). Every layout gets them as `site`; a page cannot set them.
//
// What they may hold is declared, not inferred: the `site` property of `partials/base`'s schema — the
// frame every layout is built on — names the keys, their types and which are required. The values are
// checked against it with the same checker as page frontmatter, with coercion off: config values are
// already typed. The check looks inside objects and lists, at every level (checkJsonKeys). Every problem
// is fatal to the caller (D7).

import type { DiscoveryMap } from "@pattern-dump/contracts";
import { checkJsonKeys, readSchema } from "./declared-values.js";

/** The component whose schema declares `site`. */
export const SITE_SCHEMA_OWNER = "partials/base";

export interface CheckedSite {
  /** The site values, as declared types (unchanged: nothing is coerced). Empty when there are problems. */
  values: Record<string, unknown>;
  problems: string[];
}

export async function checkSite(site: Record<string, unknown> | undefined, discoveryMap: DiscoveryMap): Promise<CheckedSite> {
  const problems: string[] = [];
  const entry = discoveryMap.get(SITE_SCHEMA_OWNER);
  if (!entry) {
    if (site !== undefined) problems.push(`storefront.site is set, but there is no ${SITE_SCHEMA_OWNER} to declare what it holds`);
    return { values: {}, problems };
  }

  const read = await readSchema(entry.schemaPath);
  if (read.error !== undefined) return { values: {}, problems: [`the schema of ${SITE_SCHEMA_OWNER} cannot be read: ${read.error}`] };
  const schema = read.schema ?? {};
  const declared = schema.properties?.site;
  if (!declared) {
    if (site !== undefined) problems.push(`storefront.site is set, but ${SITE_SCHEMA_OWNER} declares no site, so no layout can use it`);
    return { values: {}, problems };
  }
  if (site === undefined) {
    if (schema.required?.includes("site")) problems.push(`storefront.site is required by ${SITE_SCHEMA_OWNER}`);
    return { values: {}, problems };
  }

  const checked = checkJsonKeys(declared, site, "storefront.site", SITE_SCHEMA_OWNER);
  problems.push(...checked.problems);
  const out = checked.value;
  return { values: problems.length ? {} : out, problems };
}

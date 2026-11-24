// Social images: a link-preview image rendered from a component of the style guide, for each page that has no
// `image` of its own (site.socialImages.component names the component).
//
// - The component is an ordinary one: it shows in the workbench with its own sample data and has a schema, which
//   declares the fields it uses. It gets a fixed set (SOCIAL_FIELDS), the same for every page; a data-overlay variant's
//   data (`social-image~guide.json`) reaches it too, under those fields. A field it declares that neither gives is
//   the whole site's problem (checkSocialComponent), found when the site's pages are checked, as for partials/base.
// - Its variants are the designs: a folder picks one for its pages with `socialImage` in childDefaults, a page with
//   its own `socialImage`, nearest wins (folder-defaults.ts); `false` turns it off. Without it: the component itself.

import { basename } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { suggest } from "@pattern-dump/config";
import { readSchema } from "./declared-values.js";
import { designFiles } from "./design-files.js";
import type { Read } from "./listing-keys.js";

/** What every social image is rendered with, whatever the page: its title, its description, the title of its
 *  top-level folder, its date, and the site's globals. */
export const SOCIAL_FIELDS = ["title", "description", "section", "date", "site"] as const;

/** The social image component, and the names of its variants, sorted. */
export interface SocialChoice { component: string; variants: readonly string[] }

/** The names of `component`'s variants (discovery's `<component>~<name>` ids), sorted. */
export function socialVariants(component: string, discoveryMap: DiscoveryMap): string[] {
  const prefix = `${component}~`;
  return [...discoveryMap.keys()].filter(id => id.startsWith(prefix)).map(id => id.slice(prefix.length)).sort();
}

const quoted = (names: readonly string[]): string => names.map(n => `"${n}"`).join(", ");

/** A page's or folder's `socialImage`: a variant of the component, or `false` (frontmatter reads it as the text
 *  "false", so no variant can be called that). `social`: undefined when the site has no social images. */
export function readSocialImage(value: unknown, social: SocialChoice | undefined): Read<string | false> {
  if (!social) {
    return { ok: false, message: "socialImage is set, but site.socialImages is not, so there is no social image component: "
      + "set site.socialImages.component, or remove socialImage" };
  }
  if (value === "false") return { ok: true, value: false };
  const { component, variants } = social;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return { ok: false, message: `socialImage must be a variant of ${component}, such as "${variants[0] ?? "guide"}", or false` };
  }
  if (!variants.includes(value)) {
    return { ok: false, message: `socialImage "${value}" is not a variant of ${component}: `
      + (variants.length ? `its variants are ${quoted(variants)}` : "it has no variants") };
  }
  return { ok: true, value };
}

/**
 * The social image component's problems, each the whole site's: it exists, has a schema that can be read, and
 * declares only the fields it gets (SOCIAL_FIELDS, and what a variant's data gives).
 */
export async function checkSocialComponent(component: string, discoveryMap: DiscoveryMap): Promise<string[]> {
  const entry = discoveryMap.get(component);
  if (!entry) {
    const near = suggest(component, [...discoveryMap.keys()].filter(id => !id.includes("~")));
    return [`site.socialImages.component is "${component}", and there is no such component${near ? `: did you mean "${near}"?` : ""}`];
  }
  const stem = basename(component);
  if (!entry.schemaPath) {
    return [`site.socialImages.component: ${component} has no schema: a social image component declares the fields it uses `
      + `in ${stem}.schema.json, beside its template`];
  }
  const files = designFiles(discoveryMap);
  const read = await readSchema(entry.schemaPath, files);
  if (read.error !== undefined) return [`the schema of ${component} cannot be read: ${read.error}`];

  const problems: string[] = [];
  // What a variant's own data gives: its keys reach the card, under the fixed fields.
  const given = new Set<string>(SOCIAL_FIELDS);
  for (const name of socialVariants(component, discoveryMap)) {
    const jsonPath = discoveryMap.get(`${component}~${name}`)?.jsonPath;
    if (!jsonPath) continue;
    let data: unknown;
    try { data = await files.data(jsonPath); } catch (e) {
      problems.push(`the data of ${component}~${name} cannot be read: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
      continue;
    }
    if (data !== null && typeof data === "object" && !Array.isArray(data)) for (const k of Object.keys(data)) given.add(k);
  }
  for (const field of Object.keys(read.schema?.properties ?? {})) {
    if (given.has(field)) continue;
    problems.push(`${component} declares "${field}", which a social image doesn't get: it gets ${SOCIAL_FIELDS.slice(0, -1).join(", ")} `
      + `and ${SOCIAL_FIELDS.at(-1)}, and what a variant's data gives`);
  }
  return problems;
}

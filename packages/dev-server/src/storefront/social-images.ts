// Social images: a link-preview image rendered from a component of the style guide, for each page that has no
// `image` of its own (site.socialImages.component names the component).
//
// - The component is an ordinary one: it shows in the workbench with its own sample data and has a schema, which
//   declares the fields it uses. It gets a fixed set (SOCIAL_FIELDS), the same for every page; a data-overlay variant's
//   data (`social-image~guide.json`) reaches it too, under those fields. A field it declares that neither gives is
//   the whole site's problem (checkSocialComponent), found when the site's pages are checked, as for partials/base.
// - Its variants are the designs: a folder picks one for its pages with `socialImage` in childDefaults, a page with
//   its own `socialImage`, nearest wins (folder-defaults.ts); `false` turns it off. Without it: the component itself.

import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import { suggest } from "@pattern-dump/config";
import { readSchema } from "./declared-values.js";
import { designFiles } from "./design-files.js";
import type { Read } from "./listing-keys.js";
import type { PageModel } from "./pages.js";

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

// ---- A page's card ----
//
// Which card a page gets is decided as its head is written (page.ts): none for the 404 page, for a page with an
// `image` of its own (or from childDefaults), for `socialImage: false`, and without the site's address (no tag would
// carry it). Otherwise the variant `socialImage` names, else the component itself; tag and category pages take the
// component itself.
//
// The card's document is the variant rendered with the card's values, in the layers a page of the site has (the
// document base, the project's asset CSS and the variant's own closure; no theme layer). Its hash is taken over that
// document stamped as the site serves it (asset-stamps.ts), so it covers everything that decides the picture and
// nothing else: the template, its partials and helpers through what they render, the values, the variant's data,
// every stylesheet's bytes and every font and image they load through their stamps. With Pattern Dump's version and
// the render settings: a new version, or a new way of rendering, makes every card stale.

/** A card as a page's head worked it out: its page (as messages name it), the variant, its hash, its document as the
 *  site serves it (stamped; site paths), and where its bytes are, when they are anywhere yet. */
export interface SocialCard { route: string; page: string; variant: string; hash: string; document: string; file?: string }

/** The size of every card, in CSS pixels at 1x. */
export const CARD = { width: 1200, height: 630 } as const;
/** How a card is rendered (social-render.ts): part of every hash. Change it with the rendering. */
export const RENDER_SETTINGS = "png 1200x630 @1x; reduced motion; --font-render-hinting=none --disable-lcd-text --force-color-profile=srgb";

/** The section of the page at `route`: the title of its top-level folder's index.md. None for the home page, a
 *  top-level page, or a folder without an index.md or without a title. */
export function sectionOf(route: string, model: Pick<PageModel, "files">): string | undefined {
  const first = route.split("/").filter(Boolean)[0];
  if (first === undefined) return undefined;
  const top = model.files.get(`/${first}/`);
  if (!top || basename(top.path) !== "index.md") return undefined;
  const title = top.frontmatter.values["title"];
  return typeof title === "string" ? title : undefined;
}

/** The data of a variant (`<component>~<name>.json`), which reaches its card under the fixed fields; {} without one. */
export async function variantData(variantId: string, discoveryMap: DiscoveryMap): Promise<Record<string, unknown>> {
  const jsonPath = discoveryMap.get(variantId)?.jsonPath;
  if (!variantId.includes("~") || !jsonPath) return {};
  const data = await designFiles(discoveryMap).data(jsonPath);
  return data !== null && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
}

/** What a card is rendered with: the variant's data, then the page's fields over it (a field the page lacks is left
 *  out, not null). */
export function cardValues(fields: { title: string; description?: string | undefined; section?: string | undefined;
  date?: string | undefined; site: Record<string, unknown> }, data: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...data, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
}

/** The component's required fields a card's values lack, in the schema's order. */
export async function missingFields(component: string, values: Record<string, unknown>, discoveryMap: DiscoveryMap): Promise<string[]> {
  const schema = (await readSchema(discoveryMap.get(component)?.schemaPath, designFiles(discoveryMap))).schema;
  return (schema?.required ?? []).filter(f => !Object.hasOwn(values, f));
}

/** How a missing required field is named for a page: what to give it. */
export function missingFieldMessage(page: string, field: string, variantId: string, component: string): string {
  const fix = field === "section" ? "give its top-level folder an index.md with a title"
    : field === "site" ? "set site.globals"
    : `give the page a ${field}`;
  return `${page}: the social image needs "${field}", which ${variantId} requires (${basename(component)}.schema.json): `
    + `${fix}, or set socialImage: false`;
}

/** A card's document: the stylesheets `head` links, and the rendered variant. */
export function cardDocument(o: { lang: string; head: string; body: string }): string {
  return `<!doctype html>\n<html lang="${o.lang}">\n<head>\n<meta charset="utf-8">\n${o.head}\n</head>\n<body>\n${o.body}\n</body>\n</html>\n`;
}

/** A card's hash: over its document stamped as the site serves it, Pattern Dump's version and the render settings. */
export function cardHash(stampedDocument: string, version: string): string {
  return createHash("sha256").update(`${RENDER_SETTINGS}\n${version}\n${stampedDocument}`).digest("hex").slice(0, 10);
}

/** Where `pd social` writes the site's cards, to be committed: `social/` beside the pages folder. */
export function socialDir(pagesDir: string): string {
  return join(dirname(pagesDir), "social");
}

/** A committed card's file: its route as folders, then `card.<hash>.png` (the home page's at the folder's top). */
export function committedCardFile(dir: string, route: string, hash: string): string {
  return join(dir, ...route.split("/").filter(Boolean), `card.${hash}.png`);
}

/** Where a card's bytes are: the cache (`<hash>.png`), else the committed folder; undefined when neither has them. */
export async function cardFile(route: string, hash: string, dirs: { cache: string; committed: string }): Promise<string | undefined> {
  for (const file of [join(dirs.cache, `${hash}.png`), committedCardFile(dirs.committed, route, hash)]) {
    if (await access(file).then(() => true, () => false)) return file;
  }
  return undefined;
}

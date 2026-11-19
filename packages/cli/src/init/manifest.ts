// The `patternDump` field of a style guide's package.json: what makes it a pattern package a website can use. Written
// from the folders of its config, so the two can't disagree (a folder named in both must be the same in both:
// @pattern-dump/config's withOwnManifest). `pd init` writes it into a package.json it creates; `pd init --site` on a
// style guide without it prints this block to add.

import type { PackageManifest, ThemeSwitch } from "@pattern-dump/contracts";

/** The config's folders a manifest repeats, as a config writes them. */
export interface ManifestSource {
  patternsDir?: string;
  styles?: { dir?: string };
  documentBase?: string[];
  themes?: { dir?: string; default?: string; switch?: ThemeSwitch };
  scriptsDir?: string;
  assets?: { dir?: string | string[] };
}

/** A path as a manifest writes it: relative to the package, without the leading "./" or a trailing "/". */
const plain = (path: string): string => path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/\/+$/, "") || ".";

/** The manifest naming each folder the config names. */
export function manifestOf(config: ManifestSource): PackageManifest {
  const m: PackageManifest = {};
  if (config.patternsDir) m.patterns = plain(config.patternsDir);
  if (config.styles?.dir) {
    m.styles = { dir: plain(config.styles.dir) };
    if (config.documentBase?.length) m.styles.documentBase = [...config.documentBase];
  }
  if (config.themes?.dir) {
    m.themes = { dir: plain(config.themes.dir) };
    if (config.themes.default) m.themes.default = config.themes.default;
    if (config.themes.switch) m.themes.switch = config.themes.switch;
  }
  if (config.scriptsDir) m.scripts = plain(config.scriptsDir);
  const assets = config.assets?.dir;
  if (assets?.length) m.assets = (Array.isArray(assets) ? assets : [assets]).map(plain);
  return m;
}

/** The folders of the config `pd init` writes for a design system (templates/base/pattern-dump.config.ts). */
export const initManifestSource = (themeDefault: string): ManifestSource => ({
  patternsDir: "./src/patterns",
  styles: { dir: "./src/styles" },
  documentBase: ["base"],
  themes: { dir: "./themes", default: themeDefault, switch: "attribute" },
  scriptsDir: "./src/scripts",
  assets: { dir: "./assets" },
});

/** The field as a block to paste into a package.json, two-space indented as `pd init` writes one. */
export const manifestBlock = (manifest: PackageManifest): string =>
  `"patternDump": ${JSON.stringify(manifest, null, 2)}`;

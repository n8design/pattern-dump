// What changed between the config the server runs with and the config file as it is now. Only
// `storefront.site` can be taken live (the values every page shares); any other difference needs a restart,
// since folders, packages, ports and the rest are read once at start.

import type { PatternDumpConfig } from "@pattern-dump/config";

export type ConfigChange =
  /** Nothing the server reads differs (a comment, whitespace, key order). */
  | "none"
  /** Only storefront.site differs. */
  | "site"
  /** Something else differs, whether or not storefront.site does too. */
  | "other";

/** A value as text with object keys sorted, so key order is not a difference. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }) ?? "undefined";
}

/** The config without storefront.site. */
function withoutSite(config: PatternDumpConfig): unknown {
  if (!config.storefront) return config;
  const { site: _site, ...storefront } = config.storefront;
  return { ...config, storefront };
}

export function classifyConfigChange(running: PatternDumpConfig, next: PatternDumpConfig): ConfigChange {
  if (canonical(withoutSite(running)) !== canonical(withoutSite(next))) return "other";
  return canonical(running.storefront?.site) === canonical(next.storefront?.site) ? "none" : "site";
}

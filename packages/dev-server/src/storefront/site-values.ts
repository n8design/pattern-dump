// The storefront's site values (`storefront.site` from the config), as the running server holds them. Read
// once per page request; replaced by the watcher when the config file changes only them, so the next request
// renders with the new values. Every other config value is fixed for the life of the process.

export interface SiteValuesHandle {
  get(): Record<string, unknown> | undefined;
  replace(values: Record<string, unknown> | undefined): void;
}

export function createSiteValues(initial: Record<string, unknown> | undefined): SiteValuesHandle {
  let current = initial;
  return {
    get: () => current,
    replace: values => { current = values; },
  };
}

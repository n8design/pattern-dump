// The browser tab's title: the workbench's name (shell.brand.title, else "Pattern Dump"; the served page starts with
// it), with the component's title in front on a component route, so tabs and history entries can be told apart.
// Every other route (home, a folder, an unknown path) is the name alone.

/** The name the tab shows without a component: the config's shell.brand.title, else the default. */
export function brandTitle(title: string | undefined): string {
  return title ?? "Pattern Dump";
}

/** "<component> — <brand>" on a component route, else the brand. */
export function documentTitle(brand: string, component?: string): string {
  return component ? `${component} — ${brand}` : brand;
}

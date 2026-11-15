// The browser tab's title: the workbench's name (shell.brand.title, else "Pattern Dump"; the served page starts with
// it), with the title of the component or folder in front on its route, so tabs and history entries can be told
// apart. Home and an unknown path are the name alone.

/** The name the tab shows without a component: the config's shell.brand.title, else the default. */
export function brandTitle(title: string | undefined): string {
  return title ?? "Pattern Dump";
}

/** "<component or folder> · <brand>" on its route, else the brand. */
export function documentTitle(brand: string, shown?: string): string {
  return shown ? `${shown} · ${brand}` : brand;
}

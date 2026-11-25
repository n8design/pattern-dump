// How the site's pages are read for a server, a build or a command: one set of options, so pd dev, pd build and the
// commands that build the project graph without a server (graph/standalone.ts) read the same model. Live (pd dev)
// shows drafts and scheduled pages; otherwise they are left out, as if their files weren't there. pd social shows
// scheduled pages and leaves drafts out (`scheduled: "show"`), so a scheduled page's card is ready on its day.

import { sameHostWorkbenchPath } from "@pattern-dump/config";
import type { DiscoveryMap } from "@pattern-dump/contracts";
import type { ResolvedConfig } from "../server-config.js";
import { layoutIndex } from "./layout-index.js";
import { readPages } from "./pages.js";

type Site = NonNullable<ResolvedConfig["storefront"]>;

/** The cache key and the reading of the site's pages for `today`, with the skin's layouts by name (tag and category
 *  pages are generated through them, terms.ts). */
export async function sitePagesRead(sf: Site, o: { live: boolean; today: string; discoveryMap?: DiscoveryMap; scheduled?: "show" }): Promise<{
  key: string; read: () => ReturnType<typeof readPages>;
}> {
  const layouts = o.discoveryMap ? [...(await layoutIndex(o.discoveryMap)).names] : undefined;
  return {
    key: JSON.stringify([o.today, layouts ?? null]),
    read: () => readPages(sf.pagesDir, {
      workbenchPath: sameHostWorkbenchPath(sf), drafts: o.live ? "show" : "leave-out", scheduled: o.live || o.scheduled === "show" ? "show" : "leave-out",
      today: o.today, categories: sf.categories, tags: sf.tags, tagPages: sf.tagPages, categoryPages: sf.categoryPages,
      ...(layouts ? { layouts: new Set(layouts) } : {}),
    }),
  };
}

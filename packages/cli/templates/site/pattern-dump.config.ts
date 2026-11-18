import { defineConfig } from "__PD_PACKAGE__";

// A website, and nothing else: its components, styles, themes and skin (layouts/page, partials/base) all come
// from the style guide package below. Every path resolves against this project's root.
export default defineConfig({
  // Required by every config. A content-only site builds no workbench of its own (build.workbench below), so
  // nothing is written here.
  outDir: "./dist",

  // The style guide: installed as a devDependency, described by the "patternDump" field of its package.json.
  packages: [__PD_SITE_PACKAGE_JSON__],

  // The website: every markdown file in pages/ is a page. `npm run dev` prints its address,
  // http://live.localhost:4000/.
  storefront: {
    pagesDir: "./pages",
    outDir: "./site",
    // Where the style guide's own workbench is published: a page's examples link to their component there. A full
    // address for a workbench on a host of its own, or a path when it is published on this site's host.
    workbenchUrl: __PD_WORKBENCH_URL_JSON__,
    // The site's address, once you know it: canonical URLs, link previews and the sitemap are built from it.
    // url: "https://www.example.com/",
__PD_SEARCH_NOTE__
    site: { title: __PD_BRAND_JSON__, footer: "Made with Pattern Dump." },
  },

  // The style guide publishes its workbench itself, so pd build writes the website only (to site/).
  build: { workbench: false },
});

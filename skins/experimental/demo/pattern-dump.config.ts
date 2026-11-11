import { defineConfig } from "@pattern-dump/config";

// The experimental skin's demo: the storefront bench's pages and its one component, dressed by the skin,
// which this project uses the way any site would, as a pattern package named in `packages`.
export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./.out/workbench",
  styles: { strategy: "parallel", dir: "./src/styles" },
  assets: { dir: "./src/assets" },
  packages: ["@pattern-dump/skin-experimental"],
  storefront: {
    pagesDir: "./pages",
    outDir: "./.out/storefront",
    workbenchUrl: "https://workbench.example.test/",
    // The site's own address: canonical URLs, Open Graph, JSON-LD and the sitemap are built from it.
    url: "https://skin-experimental.example.test/",
    site: {
      title: "Storefront bench",
      tagline: "A website written in markdown",
      href: "/",
      year: "2026",
      footer: "Built with Pattern Dump from the storefront bench.",
    },
  },
});

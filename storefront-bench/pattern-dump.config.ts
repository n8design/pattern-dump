import { defineConfig } from "@pattern-dump/config";

// The storefront bench: a small website written as markdown pages, rendered with a wireframe skin that is
// plain on purpose, so the storefront's tests depend on no design. The skin (layouts/ and partials/) and
// the components the pages embed are ordinary patterns, so they also appear in this project's workbench.
// Designs are skins of their own, in skins/.
export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./.out/workbench",
  styles: { strategy: "parallel", dir: "./src/styles" },
  // The skin's document defaults: linked into every page and every preview.
  documentBase: ["site"],
  assets: { dir: "./src/assets" },
  storefront: {
    pagesDir: "./pages",
    outDir: "./.out/storefront",
    workbenchUrl: "https://workbench.example.test/",
    site: {
      title: "Storefront bench",
      tagline: "A website written in markdown",
      href: "/",
      year: "2026",
      footer: "Built with Pattern Dump from the storefront bench.",
    },
  },
});

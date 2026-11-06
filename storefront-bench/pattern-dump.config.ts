import { defineConfig } from "@pattern-dump/config";

// The storefront bench: a small website written as markdown pages, rendered with the skin's layouts.
// The skin (layouts/ and partials/) and the components the pages embed are ordinary patterns, so they
// also appear in this project's workbench.
export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./.out/workbench",
  styles: { strategy: "parallel", dir: "./src/styles" },
  storefront: {
    pagesDir: "./pages",
    outDir: "./.out/storefront",
    workbenchUrl: "https://workbench.example.test/",
  },
});

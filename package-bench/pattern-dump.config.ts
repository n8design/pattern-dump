import { defineConfig } from "@pattern-dump/config";

// The package bench: a site whose design system and skin are pattern packages in vendor/, the way a git
// submodule is consumed. package.json names them as relative file: dependencies, so npm links them into
// node_modules and their real folders stay outside it. The project's own patterns and styles are empty.
export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./.out/workbench",
  styles: { strategy: "parallel", dir: "./src/styles" },
  packages: ["pd-fixture-ds", "pd-fixture-skin"],
  // The workbench opens on the design system's card at its root (e2e/workbench-start.spec.ts).
  shell: { start: "molecules/card" },
  // The old names on purpose: `storefront`, with `site` for the values every page shares, as configs were written
  // before 0.8.0 (now `site` and `site.globals`). They still load, with a warning per key, until 1.0;
  // test/old-names.spec.ts asserts the warnings and that the bench loads as it would with the new names.
  storefront: {
    pagesDir: "./pages",
    outDir: "./.out/storefront",
    workbenchUrl: "https://workbench.example.test/",
    // The site's own address: canonical URLs, Open Graph, JSON-LD and the sitemap are built from it.
    url: "https://package-bench.example.test/",
    site: { title: "Package bench", footer: "Built from two linked pattern packages." },
  },
});

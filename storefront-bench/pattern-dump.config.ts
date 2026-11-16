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
  // Behaviour scripts (requireScript): two test fixtures, the header's and the slider's.
  scriptsDir: "./src/scripts",
  storefront: {
    pagesDir: "./pages",
    outDir: "./.out/storefront",
    workbenchUrl: "https://workbench.example.test/",
    // The site's own address: canonical URLs, Open Graph, JSON-LD and the sitemap are built from it.
    url: "https://bench.example.test/",
    // The categories a page can name (`categories:` in its frontmatter), independent of its folder.
    categories: {
      "design-systems": { label: "Design systems", description: "How a design system is built and kept", aliases: ["ds"] },
      guides: { label: "Guides" },
    },
    // The tags a page can have: declared, so a typo fails the build. "pictures" is an old key of "images".
    tags: {
      design: { label: "Design" },
      images: { label: "Images", description: "Pictures, and how pages show them", aliases: ["pictures"] },
      layout: { label: "Layout" },
    },
    // Search is left out (storefront.search): pd build indexes the site because the repository has Pagefind.
    // The link-preview image of every page that names none of its own.
    image: "/assets/images/share.png",
    site: {
      title: "Storefront bench",
      tagline: "A website written in markdown",
      href: "/",
      year: "2026",
      footer: "Built with Pattern Dump from the storefront bench.",
      // A declared navigation: a page, an external link and a group, in the footer of every page.
      navigations: {
        footer: [
          { page: "about.md" },
          { href: "https://example.test/source", label: "Source" },
          { label: "Guides", children: [{ page: "guides/setup.md" }, { page: "guides/index.md", label: "All guides" }] },
        ],
      },
    },
  },
});

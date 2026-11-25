import { defineConfig } from "@pattern-dump/config";

// A small site with three mounts beside it (README.md).
export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  site: {
    pagesDir: "./pages",
    outDir: "./.out/site",
    url: "https://mounts.example.test/",
    workbenchUrl: "https://workbench.mounts.example.test/",
    feeds: { author: { name: "The mounts bench" } },
    mounts: [
      { from: "../tool", to: "/tool/", sitemap: true },
      { from: "../other", to: "/other/" },
      { from: "../root", to: "/" },
    ],
  },
});

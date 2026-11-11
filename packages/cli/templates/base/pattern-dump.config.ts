import { defineConfig } from "__PD_PACKAGE__";

// Every path below resolves against this project's root (the folder this file lives in).
export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./dist",

  // Styles mirror the patterns tree: src/styles/atoms/button.scss belongs to atoms/button.
  styles: { strategy: "parallel", dir: "./src/styles" },
  // Shared, component-less rules (reset, document defaults) linked beneath every preview.
  documentBase: ["base"],

  themes: {
    dir: "./themes",
    default: "light",
    switch: "attribute",
    // Custom properties sampled for the swatch strip in the theme picker.
    swatch: { slots: ["--color-surface", "--color-primary", "--color-text"] },
  },

  assets: { strategy: "central", dir: "./assets" },

  // Behaviour scripts: src/scripts/<id>.ts, compiled on request. A component loads one with
  // `requireScript: [<id>]` in its .md frontmatter; ids listed here load into every preview.
  scriptsDir: "./src/scripts",
  // globalScripts: ["<id>"],

  // Pattern packages used alongside this project's own patterns — install them, then name them here.
  // Each package describes its patterns, styles and themes in its package.json ("patternDump").
  // packages: ["@n8d/htwoo-patterns"],

__PD_STOREFRONT__
  shell: {
    brand: { title: __PD_BRAND_JSON__ },
  },
});

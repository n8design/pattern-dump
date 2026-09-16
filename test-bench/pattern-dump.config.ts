import { defineConfig } from "@pattern-dump/config";

export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light", switch: "attribute" },
  assets: { strategy: "central", dir: "./assets" },
  scriptsDir: "./src/scripts",
  helpers: "./src/helpers",
  dataDir: "./src/_data",
  // A pattern package used alongside test-bench's own patterns (the E2E fixture for "Hide packages").
  packages: ["pd-fixture-ui"],
});

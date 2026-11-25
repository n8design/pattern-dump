import { defineConfig } from "@pattern-dump/config";
import bench from "./pattern-dump.config.js";

// The same site, published under a path: built with --config into a folder of its own (the E2E suite serves it).
export default defineConfig({
  ...bench,
  site: { ...bench.site!, url: "https://mounts.example.test/bench/", outDir: "./.out/site-base" },
});

import { defineConfig } from "@pattern-dump/config";
import bench from "./pattern-dump.config.js";

// test-bench with stylesheet theme switching, for the E2E suite's theme tests: only the active theme's sheet is linked.
export default defineConfig({ ...bench, themes: { ...bench.themes!, switch: "stylesheet" } });

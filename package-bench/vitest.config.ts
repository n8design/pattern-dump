import { defineConfig } from "vitest/config";

// The bench's own specs; e2e/ (Playwright) is not vitest's.
// A temporary cache folder for the run: the scratch folders of the projects the tests audit go there.
export default defineConfig({ test: { include: ["test/**/*.spec.ts"], globalSetup: ["../test-support/scratch-cache.ts"] } });

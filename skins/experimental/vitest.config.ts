import { defineConfig } from "vitest/config";

// The skin's unit specs only: e2e/ is Playwright's.
// A temporary cache folder for the run: the scratch folders of the projects the tests audit go there.
// FORCE_COLOR=0: plain text in every console line, though Nx sets FORCE_COLOR=true for each task.
export default defineConfig({ test: { include: ["test/**/*.spec.ts"], globalSetup: ["../../test-support/scratch-cache.ts"], env: { FORCE_COLOR: "0" } } });

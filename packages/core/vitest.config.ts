import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // A temporary cache folder for the run: the scratch folders of the projects the tests audit go there.
    globalSetup: ["../../test-support/scratch-cache.ts"],
  },
});

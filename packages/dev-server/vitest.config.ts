import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Plain text in every spied or spawned console line: Nx sets FORCE_COLOR=true for each task (and Node then
    // colours a pipe). Not NO_COLOR: FORCE_COLOR beats it, with a warning on stderr.
    env: { FORCE_COLOR: "0" },
    // A temporary cache folder for the run: the scratch folders of the projects the tests audit go there.
    globalSetup: ["../../test-support/scratch-cache.ts"],
  },
});

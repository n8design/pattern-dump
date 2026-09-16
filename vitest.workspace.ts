import { defineWorkspace } from "vitest/config";

// `apps/*` matters for a direct root `vitest` run only. `npm test` goes through
// `nx run-many -t test`, which already reaches apps/dev-ui via the `test` target nx infers from
// its package.json script — dev-ui's specs were never actually unreachable. Listing apps here
// keeps a bare `npx vitest run` consistent with what the nx path already covers.
export default defineWorkspace(["packages/*", "apps/*"]);

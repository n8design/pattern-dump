// The distributable's library entry — what a project's `pattern-dump.config.ts` imports:
//
//   import { defineConfig } from "pattern-dump";
//
// Only the config surface. Everything else the package contains is the `pd` binary.

export { defineConfig } from "@pattern-dump/config";
export type * from "@pattern-dump/config";

import { defineConfig } from "vitest/config";

// The skin's unit specs only: e2e/ is Playwright's.
export default defineConfig({ test: { include: ["test/**/*.spec.ts"] } });

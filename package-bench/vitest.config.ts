import { defineConfig } from "vitest/config";

// The bench's own specs; e2e/ (Playwright) is not vitest's.
export default defineConfig({ test: { include: ["test/**/*.spec.ts"] } });

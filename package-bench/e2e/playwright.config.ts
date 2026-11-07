import { defineConfig, devices } from "@playwright/test";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { guard } from "./guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bench = path.resolve(__dirname, "..");
const repo = path.resolve(bench, "..");

// The package bench on its own ports, so it never meets the other suites (dev-ui 4100/4200, storefront
// 4300/4400, skin 4600/4700) or your dev server (4000). One pd dev serves the storefront on live.localhost
// and the workbench on pd.localhost; the built storefront root is served as plain files.
const DEV_PORT = process.env["PB_DEV_PORT"] ?? "4800";
const WS_PORT = process.env["PB_WS_PORT"] ?? "4801";
const STATIC_PORT = process.env["PB_STATIC_PORT"] ?? "4900";
const WORKBENCH_OUT = path.join(os.tmpdir(), "pd-e2e-package-bench-workbench");

// Before any server starts: vendor/ and pages/ must be as committed (guard.ts).
guard();

export default defineConfig({
  testDir: ".",
  // Serial: the reload spec writes into the bench's vendor/ and pages/, and restores them.
  workers: 1,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: { trace: "on-first-retry", video: "retain-on-failure" },
  projects: [
    { name: "package", testMatch: /\breload\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "package-static", testMatch: /\bstatic\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${STATIC_PORT}` } },
  ],
  webServer: [{
    command: `node ${path.join(repo, "packages/cli/dist/index.js")} dev --port ${DEV_PORT} --ws-port ${WS_PORT}`,
    cwd: bench,
    url: `http://localhost:${DEV_PORT}/api/version`,
    reuseExistingServer: false,
    timeout: 60_000,
  }, {
    // Built before any spec writes into the bench, then served as plain files from /.
    command: `node ${path.join(repo, "packages/cli/dist/index.js")} build --out "${WORKBENCH_OUT}"`
      + ` && node ${path.join(repo, "apps/dev-ui/e2e/static-server.mjs")} --dir "${path.join(bench, ".out", "storefront")}" --base / --port ${STATIC_PORT}`,
    cwd: bench,
    url: `http://127.0.0.1:${STATIC_PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  }],
});

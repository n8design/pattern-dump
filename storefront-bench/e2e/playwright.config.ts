import { defineConfig, devices } from "@playwright/test";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bench = path.resolve(__dirname, "..");
const repo = path.resolve(bench, "..");

// The storefront bench on its own ports, so it never meets the dev-ui suite (4100/4200) or your dev
// server (4000). One pd dev serves both front ends: the storefront on live.localhost, the workbench on
// pd.localhost. The built storefront root is served by a plain static file server.
const DEV_PORT = process.env["SF_DEV_PORT"] ?? "4300";
const WS_PORT = process.env["SF_WS_PORT"] ?? "4301";
const STATIC_PORT = process.env["SF_STATIC_PORT"] ?? "4400";
const WORKBENCH_OUT = path.join(os.tmpdir(), "pd-e2e-storefront-workbench");

export default defineConfig({
  testDir: ".",
  // The commit in the report, but no diff: to make one on CI, Playwright fetches the pull request's base
  // with --depth=1, and that fetch turns the full clone shallow for every step after it (storefront
  // dates refuse to build from a shallow clone).
  captureGitInfo: { commit: true, diff: false },
  // Serial: the HMR specs write into the bench's pages and restore them, and the one dev server
  // broadcasts every reload to every page.
  workers: 1,
  retries: process.env["CI"] ? 2 : 0,
  // On CI a test that passes only on retry fails the run: retries keep the trace of the first failure,
  // they do not make a flaky test green.
  failOnFlakyTests: !!process.env["CI"],
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: { trace: "on-first-retry", video: "retain-on-failure" },
  projects: [
    // pd dev, on the storefront host. dom-parity also reads the static root.
    { name: "storefront", testMatch: /\b(pages|js-off|workbench-links|hmr|live-handshake|add-page|new-files|workbench|dom-parity|placed|config-reload|derived-page|headings|position|dates|navigations|seo|not-found|redirects|example-height)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://live.localhost:${DEV_PORT}` } },
    // The built storefront root, from a static host.
    { name: "storefront-static", testMatch: /\b(pages|js-off|workbench-links|static|placed|headings|position|dates|navigations|seo|not-found|redirects|example-height)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${STATIC_PORT}` } },
  ],
  webServer: [{
    command: `node ${path.join(repo, "packages/cli/dist/index.js")} dev --port ${DEV_PORT} --ws-port ${WS_PORT}`,
    cwd: bench,
    // The settle hook the specs' fixture calls before each test (fixtures.ts). Test-only: without this the
    // server has no such route.
    env: { PD_TEST_HOOKS: "1" },
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

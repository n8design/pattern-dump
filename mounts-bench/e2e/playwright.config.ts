import { defineConfig, devices } from "@playwright/test";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { writeImages } from "../make-images.js";

// Plain text in every console line of the servers and the workers: Playwright gives both FORCE_COLOR=1, and Node
// then colours a pipe. Set here, it reaches the servers (process.env comes after Playwright's default) and the
// workers (each loads this file again). Not NO_COLOR: FORCE_COLOR beats it, with a warning on stderr.
process.env["FORCE_COLOR"] = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bench = path.resolve(__dirname, "..");
const site = path.join(bench, "site");
const repo = path.resolve(bench, "..");
const cli = path.join(repo, "packages/cli/dist/index.js");
const server = path.join(repo, "apps/dev-ui/e2e/static-server.mjs");

// The mounts bench on its own ports, apart from the other suites (dev-ui 4100/4200, storefront 4300/4400, skin
// 4600/4700, package bench 4800/4900) and your dev server (4000). pd dev serves the site on live.localhost; the built
// site is served as plain files, once from / and once under /bench/.
const DEV_PORT = process.env["MB_DEV_PORT"] ?? "5200";
const WS_PORT = process.env["MB_WS_PORT"] ?? "5201";
const STATIC_PORT = process.env["MB_STATIC_PORT"] ?? "5300";
const BASE_PORT = process.env["MB_BASE_PORT"] ?? "5301";
const WORKBENCH_OUT = path.join(os.tmpdir(), "pd-e2e-mounts-bench-workbench");

// The bench's two images are drawn, never committed (README.md): before any server reads the folders.
await writeImages(bench);

export default defineConfig({
  testDir: ".",
  captureGitInfo: { commit: true, diff: false },
  workers: 1,
  retries: process.env["CI"] ? 2 : 0,
  failOnFlakyTests: !!process.env["CI"],
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: { trace: "on-first-retry", video: "retain-on-failure" },
  projects: [
    { name: "mounts-dev", use: { ...devices["Desktop Chrome"], baseURL: `http://live.localhost:${DEV_PORT}` } },
    { name: "mounts-static", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${STATIC_PORT}` } },
    { name: "mounts-static-base", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${BASE_PORT}/bench` } },
  ],
  webServer: [{
    command: `node ${cli} dev --port ${DEV_PORT} --ws-port ${WS_PORT}`,
    cwd: site,
    url: `http://localhost:${DEV_PORT}/api/version`,
    reuseExistingServer: false,
    timeout: 60_000,
  }, {
    command: `node ${cli} build --out "${WORKBENCH_OUT}" && node ${server} --dir "${path.join(site, ".out", "site")}" --base / --port ${STATIC_PORT}`,
    cwd: site,
    url: `http://127.0.0.1:${STATIC_PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  }, {
    command: `node ${cli} build --config pattern-dump.base.config.ts --out "${WORKBENCH_OUT}-base"`
      + ` && node ${server} --dir "${path.join(site, ".out", "site-base")}" --base /bench/ --port ${BASE_PORT}`,
    cwd: site,
    url: `http://127.0.0.1:${BASE_PORT}/bench/`,
    reuseExistingServer: false,
    timeout: 120_000,
  }],
});

import { defineConfig, devices } from "@playwright/test";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 4100, not 4000 — the E2E suite gets its own server on its own port.
//
// Two reasons, and the second is why the port moved rather than just flipping reuseExistingServer:
//   1. `reuseExistingServer` is now false, so Playwright always starts a fresh process. On 4000 that
//      would fail to bind whenever a dev server is open — turning a silent bug into a constant
//      obstruction, which is how a guard gets switched back off six weeks later.
//   2. On its own port the suite never touches your dev server at all, in either direction.
// wsPort derives as port+1 (server-config.ts), so 4101 — no WebSocket collision either.
const PD_PORT = process.env["PD_PORT"] ?? "4100";
// The static project: `pd build` of test-bench, served by a plain file server under a subpath, so the
// snapshot is tested the way a static host serves it — no Pattern Dump code running behind it.
const STATIC_PORT = process.env["PD_STATIC_PORT"] ?? "4200";
const STATIC_BASE = "/pd/";
const STATIC_SITE = path.join(os.tmpdir(), "pd-e2e-static-site");

export default defineConfig({
  testDir: ".",
  // Serial, and the reason is NOT filesystem races — that was the previous explanation here and it
  // would send you after the wrong fix. Per-spec fixture isolation would not help.
  //
  // The real coupling is the shared dev server. `webServer` below starts ONE server for the whole
  // run, and `hotreloader.push()` broadcasts to every connected socket with no targeting
  // (packages/hotreloader/src/index.ts). On the client, `tree-changed` and `css-link-swap` are
  // ungated — `tree-changed` runs a full `mountSidebar()` rebuild on EVERY connected page. So a
  // mutation by one worker lands in every other worker's page mid-test. `lastComponentId` is a
  // mutable server global those workers would also race.
  //
  // Only 4 of 22 specs mutate (hmr, css-external, nav-live-update, srcdoc-js-reload), but making
  // the other 18 parallel would need per-worker servers over per-worker test-bench copies, paying
  // N× cold start. Measured upside is ~60-90s: `fullyParallel` is false, so parallelism is
  // file-level only and region-borders.spec.ts alone (45 tests) stays on one worker regardless.
  // At ~470ms/test the suite is not the bottleneck it looks like.
  //
  // If this is ever revisited, do it for CORRECTNESS not speed: those 4 specs write into the
  // git-tracked test-bench/ and lean on retries:2/retries:3 to stay stable.
  workers: 1,
  // Without this, `retries` defaults to 0 — which made `trace: "on-first-retry"` dead config:
  // there was never a first retry, so no trace was ever written, and the CI job's
  // "Upload Playwright traces" step could only ever collect videos.
  // Local stays at 0 so a flake is visible while developing rather than silently absorbed.
  retries: process.env["CI"] ? 2 : 0,
  // On CI a test that passes only on retry fails the run: retries keep the trace of the first failure,
  // they do not make a flaky test green.
  failOnFlakyTests: !!process.env["CI"],
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PD_PORT}`,
    trace: "on-first-retry",
    video: "retain-on-failure",
    reducedMotion: "reduce", // skip View Transition animations in tests; keeps assertions instant
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "static/**" },
    {
      name: "static",
      testMatch: "static/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${STATIC_PORT}${STATIC_BASE}` },
    },
  ],
  webServer: [{
    command: "npm run dev",
    cwd: path.resolve(__dirname, "../../.."),
    url: `http://localhost:${PD_PORT}`,
    // Never reuse. Playwright's only freshness check is "does something answer this URL" — it does
    // not verify the responding process is the one `command` would have produced. So a dev server
    // started before a packages/* edit was silently reused and served the old code, and the failures
    // read exactly like a feature bug. (`pd dev` loads packages/*/dist through package exports with
    // no watch and no module-cache invalidation, so a rebuild alone never reaches a running server.)
    //
    // Note the old value was `!process.env["CI"]` — reuse disabled in CI, where a fresh runner has no
    // server to reuse anyway, and enabled locally, which is exactly where the hazard lives. The guard
    // was inverted relative to the risk.
    //
    // Cost: a measured 468ms cold start against a ~2.4-minute suite.
    reuseExistingServer: false,
    // The spawned `pd dev` reads PD_PORT (server-config.ts), so one value drives both the server and
    // baseURL above — they cannot drift apart.
    env: { PD_PORT },
    timeout: 60_000,
  }, {
    // Built at the start of the run, BEFORE any spec mutates test-bench, then served as plain files.
    command: `node packages/cli/dist/index.js build --root test-bench --out "${STATIC_SITE}" --base ${STATIC_BASE}` +
      ` && node apps/dev-ui/e2e/static-server.mjs --dir "${STATIC_SITE}" --base ${STATIC_BASE} --port ${STATIC_PORT}`,
    cwd: path.resolve(__dirname, "../../.."),
    url: `http://127.0.0.1:${STATIC_PORT}${STATIC_BASE}`,
    reuseExistingServer: false,
    timeout: 120_000,
  }],
});

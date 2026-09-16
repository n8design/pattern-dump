#!/usr/bin/env node
// Is the dev server answering me running the code I have on disk?
//
// This exists because the failure it detects is invisible and misdiagnoses as a feature bug. The
// two halves of the tool behave differently, and that asymmetry is the whole trap:
//
//   apps/dev-ui/dist/main.js  — readFile'd per request (routes.ts), so a rebuild is picked up by a
//                               page reload. No restart needed.
//   packages/*/dist           — loaded once through package exports at startup, with no watch and no
//                               module-cache invalidation. A rebuild NEVER reaches a running process.
//
// So the habit you build doing dev-ui work ("rebuild, reload, done") is silently wrong the moment an
// edit crosses into packages/. This script says which case you are in, and what to do about it.
//
// Usage:  npm run dev:check            (defaults to port 4000)
//         PD_PORT=4100 npm run dev:check

import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PD_PORT ?? "4000";
const base = `http://localhost:${port}`;

const SERVER_BUNDLE = join(repoRoot, "packages/dev-server/dist/index.js");
const DEV_UI_BUNDLE = join(repoRoot, "apps/dev-ui/dist/main.js");

const mtime = (p) => stat(p).then(s => s.mtimeMs).catch(() => null);
const fmt = (ms) => new Date(ms).toLocaleTimeString();

let info;
try {
  const res = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  info = await res.json();
} catch (e) {
  // An older server predates /api/version — that is itself proof it is stale.
  const reachable = await fetch(base, { signal: AbortSignal.timeout(3000) }).then(() => true).catch(() => false);
  if (reachable) {
    console.error(`✗ The server on :${port} has no /api/version.`);
    console.error(`  It predates this endpoint, which means it is running an older bundle.`);
    console.error(`  → RESTART it.`);
    process.exit(1);
  }
  console.log(`· No dev server on :${port}. Nothing to be stale.`);
  process.exit(0);
}

const [serverNow, devUiNow] = await Promise.all([mtime(SERVER_BUNDLE), mtime(DEV_UI_BUNDLE)]);
const startedAtMs = Date.parse(info.startedAt);
const problems = [];

// The server bundle: compare what it loaded at boot against what is on disk now.
if (serverNow !== null && info.serverBundleMtime !== null && serverNow > info.serverBundleMtime) {
  problems.push(
    `✗ packages/dev-server/dist is NEWER than the running server.\n` +
    `    loaded at boot: ${fmt(info.serverBundleMtime)}   on disk now: ${fmt(serverNow)}\n` +
    `    → RESTART the server. Node cached the old bundle; a rebuild alone cannot reach it.`,
  );
}

// The dev-ui bundle: served per request, so a rebuild after startup only needs a page reload.
if (devUiNow !== null && devUiNow > startedAtMs) {
  problems.push(
    `· apps/dev-ui/dist/main.js was rebuilt after the server started (${fmt(devUiNow)}).\n` +
    `    → Just RELOAD the page. It is read from disk per request; no restart needed.`,
  );
}

if (problems.length === 0) {
  console.log(`✓ Server on :${port} is current (up since ${fmt(startedAtMs)}, protocol v${info.protocol ?? "?"}).`);
  process.exit(0);
}

console.error(problems.join("\n"));
// Only a stale SERVER bundle is an error — the dev-ui case is advisory, since a reload fixes it.
process.exit(problems.some(p => p.startsWith("✗")) ? 1 : 0);

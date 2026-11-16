// A worker of the page check (page-pool.ts): jsdom and axe are loaded once for the thread; each page it is sent is
// checked in a window of its own (runPageA11y), and its findings, or why it failed, are sent back with its index.
import { parentPort } from "node:worker_threads";
import { runPageA11y } from "./page.js";

const port = parentPort;
if (!port) throw new Error("page-worker.js runs as a worker thread of the accessibility check");
port.on("message", async ({ i, html }: { i: number; html: string }) => {
  try {
    port.postMessage({ i, findings: await runPageA11y(html) });
  } catch (e) {
    port.postMessage({ i, error: e instanceof Error ? e.message : String(e) });
  }
});

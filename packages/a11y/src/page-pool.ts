// The page check (page.ts) over many pages, spread over worker threads: each worker loads jsdom and axe once and
// checks the pages it is sent, one at a time, each in a window of its own as before. The results come back in the
// order of the pages given, whatever order the workers finish in, so a report built from them is the same on every
// run. One worker (or one page) checks in this thread, exactly as page.ts alone does.
//
// A worker costs about 300 MB, and past 8 there was no gain (measured on 16 cores, PLAN-PERF-a11y.md), so the
// default is the cores less one, at most 8, and no more than a quarter of the memory allows.
import { existsSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { runPageA11y, type PageA11yFinding } from "./page.js";

/** Past this many workers the check got no faster, only bigger. */
export const MOST_CHECK_WORKERS = 8;
/** Pages a worker checks before a fresh one takes over. On the 500-page benchmark site, 8 workers: never replaced,
 *  4.4 GB at the peak; every 16 pages, 2.8 GB (the main process alone holds about 2.7 GB) for 1.6 s more. */
export const PAGES_PER_WORKER = 16;
/** What one worker is allowed in the memory cap, in bytes. */
const WORKER_BYTES = 350 * 1024 * 1024;

/** How many workers check pages unless told otherwise: cores less one, at most 8, within a quarter of the memory. */
export function defaultCheckWorkers(cores = availableParallelism(), memory = totalmem()): number {
  return Math.max(1, Math.min(cores - 1, MOST_CHECK_WORKERS, Math.floor(memory / 4 / WORKER_BYTES)));
}

/** A page whose check failed: which one (its index in the pages given), and why. */
export class PageCheckError extends Error {
  override readonly name = "PageCheckError";
  constructor(readonly index: number, message: string) { super(message); }
}

/** The worker's file: beside this module (the a11y build), or one folder up (this module in a chunk of pd's bundle). */
function workerFile(): URL {
  for (const rel of ["./page-worker.js", "../page-worker.js"]) {
    const url = new URL(rel, import.meta.url);
    if (existsSync(fileURLToPath(url))) return url;
  }
  throw new Error(`the accessibility check's worker (page-worker.js) is missing beside ${fileURLToPath(import.meta.url)}`);
}

/** A message from a worker: a page's findings, or why its check failed. */
type Reply = { i: number; findings: PageA11yFinding[] } | { i: number; error: string };

/** Every page's findings (runPageA11y), in the order of `pages`, checked by up to `workers` threads. */
export async function runPagesA11y(
  pages: readonly string[], opts: { workers?: number; pagesPerWorker?: number } = {},
): Promise<PageA11yFinding[][]> {
  const count = Math.min(opts.workers ?? defaultCheckWorkers(), pages.length);
  const results: PageA11yFinding[][] = new Array(pages.length);
  if (count <= 1) {
    for (let i = 0; i < pages.length; i++) {
      try { results[i] = await runPageA11y(pages[i]!); } catch (e) { throw new PageCheckError(i, e instanceof Error ? e.message : String(e)); }
    }
    return results;
  }
  const file = workerFile();
  // A worker is replaced after `perWorker` pages: V8 lets a busy thread's heap grow with the garbage of every window
  // it has closed, and a fresh one starts small, so the pool's memory stays near count times a worker's own.
  const perWorker = opts.pagesPerWorker ?? PAGES_PER_WORKER;
  const live = new Set<Worker>();
  let next = 0;
  let stopped = false;
  const lane = async (): Promise<void> => {
    while (!stopped && next < pages.length) {
      const worker = new Worker(file);
      live.add(worker);
      try {
        await new Promise<void>((resolve, reject) => {
          let checked = 0;
          const feed = (): void => {
            if (stopped || next >= pages.length || checked >= perWorker) { resolve(); return; }
            const i = next++;
            worker.postMessage({ i, html: pages[i] });
          };
          worker.on("message", (m: Reply) => {
            if ("error" in m) { reject(new PageCheckError(m.i, m.error)); return; }
            results[m.i] = m.findings;
            checked++;
            feed();
          });
          worker.on("error", reject);
          worker.on("exit", code => { reject(new Error(`an accessibility check worker stopped (exit code ${code})`)); });
          feed();
        });
      } finally {
        live.delete(worker);
        await worker.terminate();
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: count }, lane));
  } catch (e) {
    stopped = true;
    await Promise.all([...live].map(w => w.terminate()));
    throw e;
  }
  return results;
}

// The file watcher and the HMR broadcast path.
//
// The other half of the closure split: routes read and serve, this watches and broadcasts. It is
// the sole consumer of `hotreloader` — the routes never push a message — which is the clearest
// evidence the two really are separate concerns rather than a convenient cut.
//
// It is also the READER of the request->watcher back-channel: `state.lastComponentId`, written by
// GET /api/component/:id, decides which component a theme or script edit should refresh. See
// server-state.ts. That is why a second concurrent client silently redirects the first client's
// HMR, and part of why the Playwright suite runs workers:1.
//
// INCREMENTAL BY DESIGN, and there is a tripwire on it: a .hbs/.json edit re-audits exactly that
// one component; a .scss edit re-audits NOTHING, because every engine currently covered is
// CSS-invariant. Adding a CSS-sensitive rule must break diagnostics-graph.spec's asymmetry test —
// that failure is the signal to revisit this, not a flake.
//
// Guarded by test/watcher.spec.ts, which asserts both the durable HTTP effects and the broadcasts
// themselves over a real socket.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { appendFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { componentCssUrl, type DiscoveryResult, type HmrMessage } from "@pattern-dump/contracts";
import { compileSassFile } from "@pattern-dump/build";
import { dryRunHelperRegistrar } from "@pattern-dump/renderer";
import type { HotReloader } from "@pattern-dump/hotreloader";

import type { ResolvedConfig } from "./server-config.js";
import {
  applyStyleData, cachedDiscovery, compositionFor, currentDiscovery, invalidateDiscovery, rebuildDiscovery, scriptFor, type ServerState,
} from "./server-state.js";
import { baseComponentIds, resolveComponentForFile } from "./discovery-index.js";
import {
  computeCssClosure, linkableClosure, recomputeComponentCss, withRenderedClassOwners,
} from "./css-closure.js";
import { buildAllStyleData, patchClassOwnerIndex } from "./style-index.js";
import { rootMatchers, watchedRoots, within, type WatchedRoots } from "./watch-roots.js";
import { auditWithHash, globalDataDigest } from "./diagnostics.js";
import { extractThemeTokens } from "./themes.js";
import { surfaceCollisions, surfaceFlattening } from "./surfacing.js";
import { verboseTiming } from "./timing.js";
import type { PatternDumpConfig } from "@pattern-dump/config";
import { classifyConfigChange } from "./config-change.js";
import type { SiteValuesHandle } from "./storefront/site-values.js";
import type { GitDates } from "./storefront/git-dates.js";
import { NOT_FOUND_FILE, readPages, routeFor } from "./storefront/pages.js";
import { readGlobalData, readHelperRegistrars, type LoadProblem } from "./project-loaders.js";
import { createDisplayPath } from "./display-path.js";
import type { HelperRegistrar, RenderingHandle } from "./rendering.js";

/** Everything the watcher needs, handed in explicitly rather than captured from a closure. */
export interface WatchContext {
  readonly cfg: ResolvedConfig;
  readonly state: ServerState;
  readonly render: ReturnType<typeof import("@pattern-dump/renderer").createRenderer>;
  /** The renderer, global data and helpers in use, replaced together when data or a helper reloads. */
  readonly rendering: RenderingHandle;
  readonly tracker: Awaited<ReturnType<typeof import("@pattern-dump/build").createSassDependencyTracker>>;
  readonly hotreloader: HotReloader;
  /** storefront.site as the server holds it: replaced when the config file changes only it. */
  readonly site: SiteValuesHandle;
  /** The storefront pages' dates from git, when there is a storefront: a page change re-reads git status. */
  readonly dates?: GitDates;
  /** The config the server was started with. */
  readonly config: PatternDumpConfig;
  /** `pd dev`: the config file, and how to load it again. Absent, the config file is not watched. */
  readonly configFile?: { readonly path: string; readonly reload: () => Promise<PatternDumpConfig> };
}

/**
 * How long after a change is handled the file is looked at again. chokidar drops a `change` to a path
 * that comes within 50 ms of the previous one and never reports it later (`_throttle(EV_CHANGE, path,
 * 50)` in its `_emit`). On Linux, where events arrive within a few milliseconds, a quick second save
 * is lost that way, and the page keeps the first one. So after each change is handled the file's
 * modification time and size, and its content, are compared with what they were when the handler read
 * the file, past that window, and a difference is handled as one more change, again until they hold
 * still. Must stay above chokidar's window: test/watcher-chokidar.spec.ts pins it.
 */
export const CHANGE_RECHECK_MS = 60;

/**
 * A new folder, with chokidar 3.6's own watcher (nodefs-handler.js, `_handleDir`; Linux, Windows, and macOS
 * without fsevents): it reports the folder's `addDir` (551), reads it once (563) and only then watches it
 * (567). A file that lands after that read and before the watch is in no read and causes no event, so it is
 * never reported: `git checkout`, `git pull` and `mv` do exactly that, and under load the gap is seconds
 * wide. So a new folder's `addDir`, when handled, starts a rescan cycle: the folder is scanned at once and
 * every CHANGE_RECHECK_MS until chokidar watches it and every folder reported in it, read from chokidar's
 * private `_closers` (`chokidarWatches`), and then once more: the closing scan, for a write that landed
 * between the last scan and the watch. Each scan queues every folder as an `addDir`, and every file not as
 * last handled as an `add`, or as a `change` when the file was already reported in the cycle (by a scan or by
 * chokidar, which reports it a few ms after the scan does: its `add`, waiting behind the scan's, would read a
 * file written since, and be a second add). After NEW_FOLDER_CAP_MS the cycle stops, closing scans
 * included, and the terminal says so. With fsevents (`chokidarBackend`) the whole tree is one stream, there
 * is no gap, and nothing is rescanned.
 */
export const NEW_FOLDER_CAP_MS = 2_000;
/** When `_closers` cannot be read as expected (another chokidar): the times a new folder is scanned after its
 *  `addDir` is handled, with no way to tell when its watch is there. */
export const NEW_FOLDER_FALLBACK_MS: readonly number[] = [0, CHANGE_RECHECK_MS, 1_000];

/**
 * The paths chokidar has a watch on, from its private `_closers` (`_addPathCloser` records a folder's watch
 * once `_handleDir` has returned, nodefs-handler.js 617-640), or null when that is not there as expected: a
 * Map, holding every folder in `roots` that exists. test/watcher-chokidar.spec.ts pins what this relies on.
 */
export function chokidarWatches(watcher: FSWatcher, roots: readonly string[]): ReadonlyMap<string, unknown> | null {
  const closers = (watcher as unknown as { _closers?: unknown })._closers;
  if (!(closers instanceof Map)) return null;
  return roots.filter(r => existsSync(r)).every(r => closers.has(r)) ? closers : null;
}

/**
 * Which of its watchers chokidar uses, from its own flag (`options.useFsEvents`) and the handler it built from
 * it (`_fsEventsHandler` or `_nodeFsHandler`, index.js 389-393); null when the two do not agree, as they do
 * in chokidar 3.6. test/watcher-chokidar.spec.ts pins it.
 */
export function chokidarBackend(watcher: FSWatcher): "fsevents" | "nodefs" | null {
  const w = watcher as unknown as { options?: { useFsEvents?: boolean }; _fsEventsHandler?: unknown; _nodeFsHandler?: unknown };
  if (w.options?.useFsEvents === true && w._fsEventsHandler && !w._nodeFsHandler) return "fsevents";
  if (w.options?.useFsEvents === false && w._nodeFsHandler && !w._fsEventsHandler) return "nodefs";
  return null;
}

/** Every template, data file and schema a discovery has, by absolute path. */
function componentFilesOf(dr: DiscoveryResult): Set<string> {
  const files = new Set<string>(dr.hbsPathToId.keys());
  for (const entry of dr.discoveryMap.values()) {
    if (entry.jsonPath) files.add(resolve(entry.jsonPath));
    if (entry.schemaPath) files.add(resolve(entry.schemaPath));
  }
  return files;
}

/** The file watcher could not start (an inotify limit, a folder it may not read): pd dev cannot run. */
export class WatchStartError extends Error {
  override name = "WatchStartError";
}

/** What a chokidar error says, named for the terminal: what failed, and for a known cause, what to do. */
export function describeWatchError(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  const what = `file watching failed${err?.path ? ` on ${err.path}` : ""}: ${err?.message ?? String(e)}`;
  if (err?.code === "ENOSPC") return `${what} — the system's limit on watched files is reached (on Linux, raise fs.inotify.max_user_watches)`;
  if (err?.code === "EMFILE") return `${what} — too many open files (raise the open-file limit, ulimit -n)`;
  return what;
}

/**
 * How long `close` waits for the handler running and the events waiting before it closes anyway, saying
 * which handler it left. Long enough for any handler on a large corpus (a full restyle is well under a
 * second there), short enough that a handler that never settles cannot hold pd dev open.
 */
export const CLOSE_DRAIN_MS = 3_000;

/** A running watcher. `close` lets the handlers already queued finish (up to CLOSE_DRAIN_MS), then stops it
 *  and every recheck still pending. */
export interface WatchHandle {
  close(): Promise<void>;
  /** TEST ONLY (PD_TEST_HOOKS=1, see settle below): resolves once every change made before it is handled. */
  settle(): Promise<void>;
}

/** A file as a change is judged by: its stamp (inode, change and modification times, size) and a hash of its content. */
interface Seen { readonly stamp: string; readonly hash: string; readonly real: string }

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_watchStamp`, a file's stamp is what
// it returns, given the real one, so a test can give two different writes the same stamp, as a file system
// with coarse timestamps does. Not exported, not part of any contract.
type TestOnlyWatchStamp = (path: string, stamp: string) => string;

/** The file as it is now, or null when it is gone. */
function seenNow(path: string): Seen | null {
  try {
    const s = statSync(path);
    const stamp = `${s.ino}:${s.ctimeMs}:${s.mtimeMs}:${s.size}`;
    const forced = (globalThis as { __testOnly_watchStamp?: TestOnlyWatchStamp }).__testOnly_watchStamp;
    return { stamp: forced ? forced(path, stamp) : stamp, real: stamp, hash: createHash("sha1").update(readFileSync(path)).digest("hex") };
  } catch {
    return null;
  }
}

/** Unchanged: the same stamp and the same content. Either alone is not enough: with timestamps a second
 *  or two coarse (FAT, some network mounts) a real same-size edit keeps its stamp, and a rewrite of the
 *  same content (a save with no edit) gets a new one. */
const unchanged = (now: Seen | null, before: Seen | undefined): boolean =>
  now !== null && before !== undefined && now.stamp === before.stamp && now.hash === before.hash;

/**
 * Start watching the project. Resolves once chokidar has finished its initial scan (until then a file
 * written into a folder it has not reached produces no event), and rejects with a WatchStartError when
 * chokidar reports an error before that. An error later is a problem in the terminal and on the
 * Console, never silent.
 */
export async function startWatching(ctx: WatchContext): Promise<WatchHandle> {
  const { cfg, state, render, rendering, tracker, hotreloader, site, configFile, dates } = ctx;
  // Destructured so the body below reads exactly as it did inside startDevServer.
  const { patternsDir, styleRoots, patternRoots, patternDirs, swatchSlots, cwd } = cfg;
  // The source roots watched, by kind: the project's, and every linked package's (watch-roots.ts). Each
  // handler works from the root a file is in (its folder, and for stylesheets the root's own base
  // layer), never from the project's folders by name.
  const watched: WatchedRoots = watchedRoots(cfg);
  const { patternRootOf, styleRootOf, themeDirOf, scriptDirOf, dataDirOf, assetRootOf, helperOf, inBase, componentOfScss } = rootMatchers(watched);
  /** A file as messages name it: never an absolute path. */
  const shown = createDisplayPath(cwd, cfg.packages);
  // The component files (templates, data, schemas) of the discovery the tree was last told about: the one
  // pd dev starts with, then each rebuildAndSignalTree's. A change to a file not in it is a file the tree does
  // not have: chokidar reports a file that comes back to a path it knew (a folder removed and restored) as a
  // change, not an add. The cached discovery cannot tell: any edit drops it, and the next one is built from
  // disk, file and all, without the tree being told.
  let treeFiles = componentFilesOf(await currentDiscovery(state, patternRoots));

// The storefront's pages folder (a folder of its own, outside patternsDir — config guarantees it).
const pagesDir = cfg.storefront?.pagesDir ?? null;
// What every page shows of the others (handlePages): read before the watcher starts, then after each event
// in the pages folder.
let pagesPrint = await pagesFingerprint();
const watchDirs = [
  ...watched.patterns, ...watched.styles.map(r => r.dir), ...watched.themes, ...watched.scripts,
  ...watched.data, ...watched.assets, ...watched.helpers.map(h => h.scope), ...(pagesDir ? [pagesDir] : []),
];
const watcher   = chokidar.watch(watchDirs, { ignoreInitial: true, persistent: true });

// TEST ONLY, not a feature: settle, behind PD_TEST_HOOKS=1 (routes.ts serves it as POST /_pd/__test/settle;
// documented in packages/dev-server/test/watch-harness.ts). It appends to `.__testOnly_barrier` in every
// watched folder, as the watch harness does, and resolves once each of those writes is handled and nothing
// is left: no event queued or running, no recheck pending, no new folder's rescan open. chokidar reports the
// changes in one folder in order and the queue handles events in order, so by then every change made in a
// watched folder before settle was called is handled, and its reload messages are sent. A barrier is
// reported but never handled (it sends nothing, so it reloads no page); the files are left in place,
// ignored by git, and never copied into pd build output.
const BARRIER = ".__testOnly_barrier";
/** Waiting for barrier writes to be handled, each told the barrier's path. */
const barrierWaiters = new Set<(path: string) => void>();
/** How long settle waits for its barriers, and then for the queue to empty, before it gives up, named. */
const SETTLE_MS = 10_000;
async function settle(): Promise<void> {
  const files = [...new Set(watchDirs)].filter(d => existsSync(d)).map(d => join(d, BARRIER));
  const waiting = new Set(files);
  const handled = new Promise<void>((resolve, reject) => {
    if (!waiting.size) { resolve(); return; }
    const seen = (path: string): void => {
      waiting.delete(path);
      if (waiting.size) return;
      clearTimeout(timer);
      barrierWaiters.delete(seen);
      resolve();
    };
    const timer = setTimeout(() => {
      barrierWaiters.delete(seen);
      reject(new Error(`settle: barriers not handled within ${SETTLE_MS} ms: ${[...waiting].map(shown).join(", ")}`));
    }, SETTLE_MS);
    barrierWaiters.add(seen);
  });
  for (const file of files) await appendFile(file, ".");
  await handled;
  const idle = (): boolean => current === null && queue.length === 0 && rechecks.size === 0 && cycles.size === 0;
  const deadline = Date.now() + SETTLE_MS;
  while (!idle()) {
    if (Date.now() > deadline) throw new Error(`settle: the watcher did not go idle within ${SETTLE_MS} ms`);
    await new Promise(r => setTimeout(r, 10));
  }
}
// The config file (handleConfig), by a watcher of its own, without fsevents: chokidar watches a file with
// fsevents through a stream on its whole folder, here the project's root, which would carry every write under
// it (build output, test traces) into the watcher's callbacks. Its events join the one queue below.
const configWatcher = configFile
  ? chokidar.watch(configFile.path, { ignoreInitial: true, persistent: true, useFsEvents: false })
  : null;
// Listened for at once: its ready can come before the main watcher's.
const configReady = configWatcher ? new Promise<void>(resolve => configWatcher.once("ready", () => resolve())) : Promise.resolve();
// The config file's events, through the dispatchers of `on` below (handleConfig is first in change and add).
configWatcher?.on("change", path => dispatchers.change?.(path));
configWatcher?.on("add", path => dispatchers.add?.(path));
configWatcher?.on("error", (e: unknown) => {
  const message = describeWatchError(e);
  hmr.push({ type: "error", scope: "build", message });
  console.error(`[dev-server] ${message}`);
});

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_onWatchStarted`, it is called once
// the watcher is ready, with a function that delivers an event to the handlers below as chokidar would (a
// test uses it to deliver one chokidar sends twice). Not exported, not part of any contract.
// The second argument makes chokidar forget a file (its `unwatch`): it no longer reports anything of it, as for a
// file that landed in a new folder before chokidar watched it.
type TestOnlyWatchStarted = (deliver: (event: "change" | "add", path: string) => void, forget: (path: string) => void) => void;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_failHandler`, it is asked before each
// handler runs; "reject" or "throw" makes that handler fail that way instead of running, so a test can see
// what a failing handler does to the server. Not exported, not part of any contract.
type TestOnlyFailHandler = (event: string, path: string) => "reject" | "throw" | undefined;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_onReaudit`, the watcher's surgical
// re-audit of a component awaits it first; a promise it returns holds the re-audit, a rejected one fails
// it. Not exported, not part of any contract.
type TestOnlyOnReaudit = (componentId: string) => Promise<void> | undefined;
const testOnlyReaudit = (): TestOnlyOnReaudit | undefined =>
  (globalThis as { __testOnly_onReaudit?: TestOnlyOnReaudit }).__testOnly_onReaudit;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_handler`, it is offered each event
// first; a promise it returns is that event's handler instead of the real one, given the watcher's push and
// the state, so a test can write a handler that pushes and changes state in an order of its choosing. Not
// exported, not part of any contract.
type TestOnlyHandler = (
  event: string, path: string, api: { push(message: HmrMessage): void; state: ServerState },
) => Promise<void> | undefined;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_holdHandler`, it is called as each
// handler's turn comes; a promise it returns holds that handler until it settles, so a test can see what
// waits behind it. Not exported, not part of any contract.
type TestOnlyHoldHandler = (event: string, path: string) => Promise<void> | undefined;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_onEventHandled`, it is called
// after each watcher event's handler has finished, with the number of events still waiting, and the stamp
// (inode, change and modification times, size) of the file as the handler read it: null for a removal and
// for a folder. A step that must not return before the last write of a file is handled compares it with
// the file's stamp on disk. Tests
// use it as a barrier ("every event so far has been handled") instead of waiting for quiet; a file named
// `.__testOnly_barrier`, which a test puts in every watched folder, is reported but never handled. Unset,
// it costs a counter and a name check. Not exported, not part of any contract.
type TestOnlyEventHandled = (event: string, path: string, stillRunning: number, stamp: string | null) => void;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_hideChokidarWatches` to true before the
// watcher is ready, chokidar's `_closers` is treated as not readable, so a test can see the fallback for new
// folders (NEW_FOLDER_FALLBACK_MS) and its warning. Not exported, not part of any contract.

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_dropEvent`, it is asked about each event
// chokidar reports; true drops it, as chokidar sometimes misses one (an unlinkDir of a folder moved away). Not
// exported, not part of any contract.
type TestOnlyDropEvent = (event: string, path: string) => boolean;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_onCycleEnded`, it is called when a new
// folder's rescan cycle ends, with the folder and why: its watches attached, the folder gone, the fallback's
// last scan done, or the cap reached. A test waits for it instead of for the cycle's time. Not exported, not
// part of any contract.
type TestOnlyOnCycleEnded = (dir: string, why: "watched" | "gone" | "fallback-done" | "cap") => void;

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_cycleTick`, it is called before each
// scan of a new folder's rescan cycle, with the folder and whether `_closers` shows its watches; the cycle
// goes on as if they were shown when it returns true, and waits for it when it returns a promise. A test
// holds a cycle open (the cap, a late duplicate) or writes between the last scan and the closing scan with
// it. Not exported, not part of any contract.
type TestOnlyCycleTick = (dir: string, watching: boolean) => boolean | Promise<boolean>;
let closed = false;
// One pending recheck per changed file (CHANGE_RECHECK_MS), by its timer.
const rechecks = new Map<string, ReturnType<typeof setTimeout>>();
// Each changed or added file as its last handling saw it. chokidar can report one write twice: its own event for
// a write a recheck already handled (macOS reports writes about 100 ms late, after the recheck), and on
// macOS under load one writeFile as two events about 100 ms apart, past its own 50 ms window (fsevents
// sees the truncate and the write separately). A change to a file that is as it was then is not handled
// again.
const lastHandled = new Map<string, Seen>();
// The rescan cycles running (NEW_FOLDER_CAP_MS), by the new folder each is for: the timer of its next scan
// (null while one runs), and the folders and files inside it reported during the cycle, by its scans or by
// chokidar. Each is reported by both; the second report within the cycle is dropped, and a scan that finds a
// reported file other than last handled queues a `change` for it, not a second `add` (the content written
// between the two reports is then the change it is). Once the cycle ends (its watches attached and the
// closing scan done, the cap, or the fallback's last scan), every `addDir` and `add` is handled again,
// whether or not an unlink came: chokidar can miss one. A handled `unlink` of a file drops it from `files`.
interface Cycle { timer: ReturnType<typeof setTimeout> | null; readonly reported: Set<string>; readonly files: Set<string> }
const cycles = new Map<string, Cycle>();
// Each `addDir` queued while new folders are rescanned, chokidar's or a rescan's, by the order it was queued
// in, until its own cycle starts. A folder inside a new one can be queued before the new one's cycle starts
// (its `addDir` is handled, then the next event, while the cycle's first scan is still reading): the cycle
// starts with those queued after its own `addDir`, so its scans do not report them again.
const queuedDirs = new Map<string, number>();
let dirOrder = 0;
// How new folders are rescanned, settled once chokidar is ready: not at all with fsevents (no gap), until
// `_closers` has the folder's watch, or at NEW_FOLDER_FALLBACK_MS when `_closers` cannot be read.
let newFolders: { readonly mode: "none" } | { readonly mode: "closers"; readonly watches: ReadonlyMap<string, unknown> } | { readonly mode: "timed" } = { mode: "none" };
// How the rescans queue what they find, and what has left: the `add`, `addDir`, `change` and `unlink` of `on` below,
// as chokidar's would be.
const dispatchers: { add?: (path: string) => void; addDir?: (path: string) => void; change?: (path: string) => void; unlink?: (path: string) => void } = {};

// Every event goes through one queue and is handled when the ones before it have finished, in the order
// they arrived. Handlers used to start at once and interleave at their awaits, so one could work from state
// another was halfway through changing (a restyle installing a style index a component save was patching),
// and messages went out in the order handlers finished, not the order files changed: a link list computed
// by an older handler could arrive last and remove a link a newer one had added. An event identical to one
// still waiting (same event, same file) is not queued again: the waiting one reads the file when it starts.
// The cost is the wait: an event waits for the handler ahead of it, at worst a full restyle.
interface Job { readonly event: string; readonly path: string; readonly start: () => Promise<void> }

// The reload messages of the handler running, sent together, with one bump of the generation, when it
// finishes: so every state it changed is in place before any of its messages leaves, whatever order its
// pushes are in. Error and collision messages are not held: they go out at once.
let outbox: HmrMessage[] | null = null;
const isReload = (m: HmrMessage): boolean =>
  m.type === "content-swap" || m.type === "css-link-swap" || m.type === "tree-changed" || m.type === "page-changed";
const hmr = {
  push(message: HmrMessage): void {
    if (outbox && isReload(message)) outbox.push(message);
    else hotreloader.push(message);
  },
};
const queue: Job[] = [];
let current: Job | null = null;
// Waiting for the queue to empty (close).
let drainWaiters: Array<() => void> = [];
function pump(): void {
  if (current) return;
  const next = queue.shift();
  if (!next) { const waiters = drainWaiters; drainWaiters = []; waiters.forEach(w => w()); return; }
  current = next;
  void next.start().finally(() => { current = null; pump(); });
}
function enqueue(job: Job): void {
  // Closing: nothing new starts (an event chokidar flushes while it closes is dropped).
  if (closed) return;
  if (queue.some(q => q.event === job.event && q.path === job.path)) return;
  queue.push(job);
  pump();
}

/**
 * A watcher handler that failed, or a step of one (`step`, e.g. "its audit"), as a problem in the terminal
 * and on the open pages. The one place handler failures are worded.
 */
function reportHandlerFailure(event: string, path: string, e: unknown, step?: string): void {
  const reason = e instanceof Error ? e.message : String(e);
  const message = step ? `${shown(path)} (${event}): ${step} failed: ${reason}` : `${shown(path)} (${event}) was not handled: ${reason}`;
  hmr.push({ type: "error", scope: "build", message });
  console.error(`[dev-server] ${message}`);
}

function on(event: "add" | "addDir" | "change" | "unlink" | "unlinkDir", handler: (path: string) => unknown): void {
  // The event's turn: resolves once its handler has finished (or it was skipped).
  const start = (path: string, fromRecheck: boolean): Promise<void> => new Promise<void>(finish => {
    // A change: the file as the handler is about to read it. A newer event for the same file replaces
    // the pending recheck, since it is handled with whatever the file holds by then.
    let seen: Seen | null = null;
    // The stamp the hook reports: the file as this handling read it.
    let readStamp: string | null = null;
    if (event === "change") {
      seen = seenNow(path);
      if (!fromRecheck && unchanged(seen, lastHandled.get(path))) { finish(); return; }
      if (seen) lastHandled.set(path, seen); else lastHandled.delete(path);
      readStamp = seen?.real ?? null;
      clearTimeout(rechecks.get(path));
      rechecks.delete(path);
    } else if (event === "add") {
      // A new file, as its handler reads it: a change chokidar reports after the add for the same content
      // (fsevents can report a file moved into place as an add and then a change) is not a second change.
      // A file a new folder's rescan has already handled, then reported by chokidar too, is as that handling
      // saw it: not handled again. An unlink clears `lastHandled`, and so does a handled `addDir` of a folder
      // it is in (chokidar can miss the unlinks of a folder moved away and back), so an add of the same
      // content after either is handled.
      const added = seenNow(path);
      if (unchanged(added, lastHandled.get(path))) { finish(); return; }
      if (added) lastHandled.set(path, added); else lastHandled.delete(path);
      readStamp = added?.real ?? null;
    } else if (event === "unlink") {
      clearTimeout(rechecks.get(path));
      rechecks.delete(path);
      lastHandled.delete(path);
      for (const c of cycles.values()) c.files.delete(path);
    } else if (event === "addDir") {
      // A folder that is there now: whatever was handled at its paths before is not what it holds.
      forgetInside(path);
      startCycle(path);
    } else if (event === "unlinkDir") {
      forgetInside(path);
    }
    const done = () => {
      const sending = outbox;
      outbox = null;
      if (sending && sending.length > 0) hotreloader.pushChange(sending);
      // Still to finish after this one: the ones waiting.
      (globalThis as { __testOnly_onEventHandled?: TestOnlyEventHandled }).__testOnly_onEventHandled?.(event, path, queue.length, readStamp);
      finish();
      if (event !== "change" || closed || seen === null) return;
      rechecks.set(path, setTimeout(() => {
        rechecks.delete(path);
        if (closed) return;
        const now = seenNow(path);
        // Still as the handler read it: done. Gone: its unlink is on its way. Otherwise a write chokidar
        // dropped, handled as a change (which looks again after it).
        if (now !== null && !unchanged(now, seen ?? undefined)) dispatch(path, true);
      }, CHANGE_RECHECK_MS));
    };
    if (basename(path) === BARRIER) { barrierWaiters.forEach(w => w(path)); done(); return; }
    outbox = [];
    // A handler that fails (a file it cannot read, a folder gone mid-walk) is a problem in the terminal and
    // on the open pages, like any other, and pd dev keeps running: nothing is left to reject unhandled.
    const failed = (e: unknown): void => { reportHandlerFailure(event, path, e); };
    const run = (): void => {
      let result: unknown;
      try {
        const fail = (globalThis as { __testOnly_failHandler?: TestOnlyFailHandler }).__testOnly_failHandler?.(event, path);
        if (fail === "throw") throw new Error("failed for a test");
        const replaced = (globalThis as { __testOnly_handler?: TestOnlyHandler }).__testOnly_handler?.(event, path, { push: m => hmr.push(m), state });
        result = fail === "reject" ? Promise.reject(new Error("failed for a test")) : replaced ?? handler(path);
      } catch (e) {
        failed(e);
        done();
        return;
      }
      void Promise.resolve(result).catch(failed).finally(done);
    };
    const held = (globalThis as { __testOnly_holdHandler?: TestOnlyHoldHandler }).__testOnly_holdHandler?.(event, path);
    if (held) void held.then(run, run); else run();
  });
  const dispatch = (path: string, fromRecheck = false): void => {
    enqueue({ event, path, start: () => start(path, fromRecheck) });
  };
  if (event === "add" || event === "addDir" || event === "change" || event === "unlink") dispatchers[event] = path => dispatch(path);
  watcher.on(event, (path: string) => {
    if ((globalThis as { __testOnly_dropEvent?: TestOnlyDropEvent }).__testOnly_dropEvent?.(event, path)) return;
    if (event === "addDir" && !firstReport(path)) return;
    if (event === "add" && !firstFileReport(path)) return;
    dispatch(path);
  });
}

/** The rescan cycles of the folders `path` is in. */
const cyclesOver = (path: string): Cycle[] =>
  [...cycles].filter(([folder]) => path.startsWith(folder + sep)).map(([, c]) => c);

/**
 * Whether a folder's `addDir`, from chokidar or a rescan, is to be queued: not when a rescan cycle of a folder
 * it is in has already had it reported (Cycle). Recorded in each such cycle.
 */
function firstReport(dir: string): boolean {
  const owners = cyclesOver(dir);
  if (owners.some(c => c.reported.has(dir))) return false;
  for (const c of owners) c.reported.add(dir);
  if (newFolders.mode !== "none") queuedDirs.set(dir, ++dirOrder);
  return true;
}

/**
 * Whether a file's `add`, from chokidar or a rescan, is to be queued: not when a rescan cycle of a folder it
 * is in has already had it reported (Cycle). Recorded in each such cycle.
 */
function firstFileReport(file: string): boolean {
  const owners = cyclesOver(file);
  if (owners.some(c => c.files.has(file))) return false;
  for (const c of owners) c.files.add(file);
  return true;
}

/**
 * A new folder's rescan cycle (NEW_FOLDER_CAP_MS says why): scanned at once, then every CHANGE_RECHECK_MS
 * until chokidar watches it and every folder reported in it (or one is gone), and once more after
 * that, the closing scan; it ends when a closing scan reports nothing new. Each scan queues every file in it,
 * at any depth, that is not as last handled, as an `add` (a `change` when the cycle has had it reported), and
 * every folder as an `addDir` (which starts its own cycle). The last scan also queues an `unlink` for each file the
 * cycle reported that is gone: removed before chokidar watched the folder, it would never be reported. Each one that
 * is there is handed to chokidar (`add`), so a later removal of a file chokidar never saw is reported too. Links are left to chokidar, which follows them itself.
 */
function startCycle(dir: string): void {
  const queuedAt = queuedDirs.get(dir) ?? 0;
  queuedDirs.delete(dir);
  if (newFolders.mode === "none" || closed || cycles.has(dir)) return;
  const cycle: Cycle = { timer: null, reported: new Set(), files: new Set() };
  for (const [p, at] of queuedDirs) if (at > queuedAt && p.startsWith(dir + sep)) cycle.reported.add(p);
  // The files in it already queued (after its `addDir`, while it waited its turn): reported once.
  for (const q of queue) if (q.event === "add" && q.path.startsWith(dir + sep)) cycle.files.add(q.path);
  cycles.set(dir, cycle);
  const began = Date.now();
  let step = 0;
  const live = (): boolean => !closed && cycles.get(dir) === cycle;
  const watched = (watches: ReadonlyMap<string, unknown>): boolean =>
    [dir, ...cycle.reported].every(p => watches.has(p) || !existsSync(p));
  const tick = async (): Promise<void> => {
    if (!live()) return;
    // Read before the scan: when every watch is there, this scan is the closing one, and a write that landed
    // between the last scan and the watches is in it.
    let watching = newFolders.mode === "closers" && watched(newFolders.watches);
    const hook = (globalThis as { __testOnly_cycleTick?: TestOnlyCycleTick }).__testOnly_cycleTick;
    if (hook) {
      watching = await hook(dir, watching);
      if (!live()) return;
    }
    const known = cycle.reported.size + cycle.files.size;
    const there = await scanFolder(dir);
    if (!live()) return;
    // A closing scan that reported something new is not the last: a new folder's watch is waited for too.
    if (cycle.reported.size + cycle.files.size > known) watching = false;
    let next: number | null = null;
    let why: Parameters<TestOnlyOnCycleEnded>[1] = "watched";
    if (!there) why = "gone";
    else if (watching) why = "watched";
    else if (newFolders.mode === "timed") {
      step += 1;
      if (step < NEW_FOLDER_FALLBACK_MS.length) next = NEW_FOLDER_FALLBACK_MS[step]! - NEW_FOLDER_FALLBACK_MS[step - 1]!;
      else why = "fallback-done";
    } else if (Date.now() - began >= NEW_FOLDER_CAP_MS) {
      why = "cap";
      console.warn(`[dev-server] New folder ${shown(dir)} is still not watched after ${NEW_FOLDER_CAP_MS / 1000} s; `
        + "a file saved into it from now on may go unseen until pd dev restarts.");
    } else next = CHANGE_RECHECK_MS;
    if (next === null) {
      // The last scan also looks for what has left: a file the cycle reported that is gone from disk now was
      // removed before chokidar watched its folder, so chokidar never reports its unlink. Handled as one, unless
      // chokidar's is already waiting.
      // And each file it reported that is there is handed to chokidar: one that landed between chokidar's read of
      // the folder and its watch is a file chokidar does not know, and chokidar reports the removal of a file it
      // knows only. For a file it knows already this does nothing; for one it does not, it adds the one watch a
      // file has, as chokidar would have.
      if (there) {
        for (const file of [...cycle.files]) {
          if (existsSync(file)) { if (!closed) watcher.add(file); continue; }
          if (queue.some(q => q.path === file && q.event === "unlink")) continue;
          cycle.files.delete(file);
          dispatchers.unlink?.(file);
        }
      }
      cycles.delete(dir);
      (globalThis as { __testOnly_onCycleEnded?: TestOnlyOnCycleEnded }).__testOnly_onCycleEnded?.(dir, why);
      return;
    }
    cycle.timer = setTimeout(run, next);
  };
  function run(): void {
    cycle.timer = null;
    void tick().catch((e: unknown) => {
      if (cycles.get(dir) === cycle) cycles.delete(dir);
      reportHandlerFailure("addDir", dir, e, "its rescan");
    });
  }
  run();
}

/** Queue what a new folder holds (startCycle). False when the folder is gone. */
async function scanFolder(dir: string): Promise<boolean> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (closed) return true;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (firstReport(path)) dispatchers.addDir?.(path);
      await scanFolder(path);
    } else if (entry.isFile()) {
      // As last handled, or an `add` or `change` of it still waiting (it reads the file when it starts): nothing to queue.
      if (unchanged(seenNow(path), lastHandled.get(path))
        || queue.some(q => q.path === path && (q.event === "add" || q.event === "change"))) continue;
      if (firstFileReport(path)) dispatchers.add?.(path);
      else dispatchers.change?.(path);
    }
  }
  return true;
}

/** A folder there anew or gone: nothing at or in it as handled before, and no cycle of a folder in it left. */
function forgetInside(dir: string): void {
  const inside = (p: string): boolean => p.startsWith(dir + sep);
  for (const p of [...lastHandled.keys()]) if (inside(p)) lastHandled.delete(p);
  for (const [p, c] of [...cycles]) if (p === dir || inside(p)) { clearTimeout(c.timer ?? undefined); cycles.delete(p); }
}

// chokidar's errors: before "ready" the watcher cannot start, and startWatching rejects; after it, each is
// a named problem in the terminal and on the Console. Without a listener chokidar's error would throw.
let ready = false;
const started = new Promise<void>((resolve, reject) => {
  watcher.once("ready", () => {
    ready = true;
    // fsevents: one stream for the whole tree, no gap. Any other (chokidar's own, or one this code does not know): rescan.
    if (chokidarBackend(watcher) !== "fsevents") {
      const hidden = (globalThis as { __testOnly_hideChokidarWatches?: boolean }).__testOnly_hideChokidarWatches === true;
      const watches = hidden ? null : chokidarWatches(watcher, watchDirs);
      if (watches) newFolders = { mode: "closers", watches };
      else {
        newFolders = { mode: "timed" };
        console.warn("[dev-server] New-folder detection is degraded: this chokidar does not show which folders it watches, "
          + `so a new folder is scanned at ${NEW_FOLDER_FALLBACK_MS.join(", ")} ms only, and a file saved into it later may go unseen.`);
      }
    }
    resolve();
  });
  watcher.on("error", (e: unknown) => {
    const message = describeWatchError(e);
    if (!ready) { reject(new WatchStartError(message)); return; }
    hmr.push({ type: "error", scope: "build", message });
    console.error(`[dev-server] ${message}`);
  });
});
const close = async (): Promise<void> => {
  closed = true;
  for (const timer of rechecks.values()) clearTimeout(timer);
  rechecks.clear();
  for (const c of cycles.values()) clearTimeout(c.timer ?? undefined);
  cycles.clear();
  queuedDirs.clear();
  // Let the handler running and the events already waiting finish, before the socket and the HTTP server
  // close after this: a handler that finished later would write its scratch files (conflicts, flattening,
  // the diagnostics artifact) after the next server for the same folder had started.
  if (current || queue.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      new Promise<true>(resolve => { drainWaiters.push(() => resolve(true)); }),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), CLOSE_DRAIN_MS); }),
    ]);
    clearTimeout(timer);
    if (!finished && current) {
      const left = queue.length;
      console.error(`[dev-server] Closing with a handler still running after ${CLOSE_DRAIN_MS / 1000} s: ${shown(current.path)} (${current.event})`
        + `${left > 0 ? `, and ${left} more event(s) not handled` : ""}; closing anyway.`);
    }
  }
  lastHandled.clear();
  await watcher.close();
  await configWatcher?.close();
};

// Single source of truth for link-set membership: a component is linkable iff it has
// non-empty compiled CSS. Applied identically by the render path and the HMR reconcile
// so the preview head's link set is always computed by one rule. No CSS = no <link>.
// Shared handler for component/base SCSS file creation ("add") and edits ("change").
// Accumulates css-link-swap messages, then attaches orderedHrefs for state.lastComponentId
// computed AFTER all cache updates — so a newly-populated entry is visible in the closure.
async function handleComponentScss(filePath: string): Promise<void> {
  // From here until the save is written into the style data, no full build is installed or started: one
  // in flight was built before the save (server-state.ts, hazard 5). Released stale unless a full restyle
  // below stored a complete build itself, so the next request's full build starts after this save.
  const release = state.style.fence();
  let stale = true;
  try {
    stale = !(await patchStyles(filePath));
  } finally {
    release({ stale });
  }
}

/** The save's patch, or a full restyle; true when it stored a complete full build. */
async function patchStyles(filePath: string): Promise<boolean> {
  let recompiledFiles: string[];
  let compileErrors: Array<{ file: string; message: string }>;
  try {
    ({ recompiledFiles, errors: compileErrors } = await tracker.update(filePath));
  } catch (e) {
    // Reserved for a tracker-level failure (I/O, a bad dir). A per-file SCSS *syntax* error does NOT
    // land here — the tracker keeps going so one broken file cannot stop every other file's CSS
    // reaching the preview. Those arrive in `errors` and are pushed below.
    hmr.push({ type: "error", scope: "build", message: `SCSS error: ${String(e)}` });
    console.error("[dev-server] SCSS error:", e);
    return false;
  }

  // Per-file compile failures. Until now these were only console.warn'ed inside the tracker, so a
  // broken .scss produced NOTHING in the workbench — the one place a design-system author looks.
  // Non-fatal by design, so report and carry on rather than returning early.
  for (const { file, message } of compileErrors) {
    hmr.push({
      type: "error",
      scope: "build",
      message: `SCSS ${basename(file)} — ${message.split("\n")[0]}`,
    });
  }
  const discovery = await currentDiscovery(state, patternRoots);
  const allIds = baseComponentIds(discovery);
  const timestamp = Date.now();

  // If tracker returned no files (new file not yet registered in perFileCss),
  // treat the changed file itself as the entry point so "add" events work.
  const effectiveFiles = recompiledFiles.length > 0 ? recompiledFiles : [resolve(filePath)];

  // A recompiled file that maps to no component (a `styles.entry` bundle, or the file importing an
  // edited base partial) can change any component's CSS and the base layer, which the per-component
  // recompute below cannot see. So can an edit to a file documentBase lists, whose rules are base-layer
  // CSS even when it belongs to a component. Rebuild all style data instead and broadcast what changed.
  if (inBase(resolve(filePath)) ||
      effectiveFiles.some(f => inBase(resolve(f)) || !componentOfScss(resolve(f), allIds))) {
    return restyleAll(discovery, timestamp, effectiveFiles, compileErrors.length > 0);
  }

  const pending: Array<{ type: "css-link-swap"; componentId: string; href: string; cssBecameNonEmpty?: true }> = [];
  for (const recompiledFile of effectiveFiles) {
    const compId = componentOfScss(resolve(recompiledFile), allIds);
    const root = styleRootOf(resolve(recompiledFile));
    if (compId && root) {
      // Recompile with source map to get updated per-origin CSS for this component.
      const newCss = await recomputeComponentCss(recompiledFile, compId, root.dir, allIds, root.inBase);
      if (newCss !== null) {
        const wasEmpty = (state.perComponentCss.get(compId) ?? "") === "";
        state.perComponentCss.set(compId, newCss);
        pending.push({
          type: "css-link-swap",
          componentId: compId,
          href: componentCssUrl(compId, timestamp),
          ...(wasEmpty && newCss !== "" ? { cssBecameNonEmpty: true as const } : {}),
        });
      }
    }
  }

  // Patch state.classOwnerIndex for each recompiled file so the upcoming computeCssClosure
  // sees fresh styleUses edges in the same save — avoids the navigation lag that previously
  // required a page reload to surface a new cross-component class-borrowing edge.
  // See patchClassOwnerIndex for the documented dual-ownership drift case.
  if (state.classOwnerIndex) {
    if (verboseTiming) console.time("[dev-server:timing] classOwnerIndex patch");
    for (const recompiledFile of effectiveFiles) {
      const compId = componentOfScss(resolve(recompiledFile), allIds);
      const root = styleRootOf(resolve(recompiledFile));
      if (compId && root) {
        await patchClassOwnerIndex(
          resolve(recompiledFile), compId, root.dir, allIds, state.classOwnerIndex
        );
      }
    }
    if (verboseTiming) console.timeEnd("[dev-server:timing] classOwnerIndex patch");
  }

  const orderedHrefs = await closureHrefs(discovery, timestamp);
  for (const m of pending) hmr.push({ ...m, orderedHrefs });
  console.log(`[dev-server] CSS updated (recompiled: ${effectiveFiles.map(f => basename(f)).join(", ")})`);
  return false;
}

// The full-restyle path: the same buildAllStyleData pass as boot and the routes' lazy rebuild, then
// a css-link-swap per component whose CSS changed. A changed base layer has no per-component link to
// bump, so the preview document is reloaded instead (content-swap, as theme edits do); it comes back
// with the base link at its new ?v= (state.baseCssVersion).
async function restyleAll(
  discovery: DiscoveryResult, timestamp: number, files: string[], hadCompileErrors: boolean,
): Promise<boolean> {
  const allIds = baseComponentIds(discovery);
  const names = files.map(f => basename(f)).join(", ");
  // A file that failed to compile is skipped by buildAllStyleData, which with one entry bundle would
  // empty every component's CSS. Keep the last good CSS on screen; the error is already on the Console.
  if (hadCompileErrors) {
    console.warn(`[dev-server] CSS not updated — compile errors (recompiled: ${names})`);
    return false;
  }
  // A request's full build in flight started before this change: it is never installed over this one.
  state.style.invalidate();
  const data = await buildAllStyleData(styleRoots, allIds);
  // The map before: applyStyleData installs a new one.
  const before = state.perComponentCss;
  const changes = applyStyleData(state, data);
  state.style.set(data);
  const orderedHrefs = await closureHrefs(discovery, timestamp);
  for (const componentId of changes.changedComponents) {
    const cssBecameNonEmpty = (before.get(componentId) ?? "") === "" && (data.componentCssMap.get(componentId) ?? "") !== "";
    hmr.push({
      type: "css-link-swap", componentId, href: componentCssUrl(componentId, timestamp), orderedHrefs,
      ...(cssBecameNonEmpty ? { cssBecameNonEmpty: true as const } : {}),
    });
  }
  if (changes.baseChanged && state.lastComponentId) {
    hmr.push({ type: "content-swap", componentId: state.lastComponentId });
  }
  // Every storefront page links the base layer, so every page changed. Said page by page: the
  // workbench's reload above names the component on screen, and there may be none.
  if (changes.baseChanged) await everyPageChanged();
  const what = [
    `${changes.changedComponents.length} component(s)`,
    ...(changes.baseChanged ? ["base layer"] : []),
  ].join(" + ");
  console.log(`[dev-server] CSS updated: ${what} (recompiled: ${names})`);
  return true;
}

// The ordered link set for the component on screen, computed after all cache updates so a
// newly-populated entry is included. Filtered to non-empty CSS: the preview head never links
// zero-CSS components.
async function closureHrefs(discovery: DiscoveryResult, timestamp: number): Promise<string[] | undefined> {
  if (!state.lastComponentId) return undefined;
  // The caller's discovery, current when its handler took it, and its registry, built when an edit has just
  // dropped it: without the list the preview could only update links it already has, never add one.
  const registry = await compositionFor(state, discovery, patternDirs);
  // Must match the render path, rendered-class owners included — this list REPLACES the preview's
  // links, so anything the render path added and this one lacked would be stripped on every save.
  const staticClosure = await computeCssClosure(
    state.lastComponentId, registry, patternDirs, state.classOwnerIndex ?? new Map(), discovery.discoveryMap
  );
  const renderedHtml = await render({ component: state.lastComponentId }).then(r => r.html, () => "");
  const closureIds = withRenderedClassOwners(staticClosure, renderedHtml, state.classOwnerIndex ?? new Map());
  return linkableClosure(closureIds, state.perComponentCss).map(id => componentCssUrl(id, timestamp));
}

// Markdown: component docs and folder index.md. Nothing caches them server-side — the tree, detail
// and preview routes re-read them per request — so a save only has to tell the workbench what to
// refetch. A .md's frontmatter feeds the TREE (title, status, visibility, order, a folder's
// overview:), so every edit signals tree-changed; its body and requireScript feed the component,
// so the owner gets a content-swap. A folder index.md also sets `preview:` layout for everything
// beneath it, hence the swap for the component on screen too. Adding or removing a component .md
// changes discovery (mdPath), so those rebuild it first.
async function handleMarkdown(filePath: string, event: "change" | "add" | "unlink"): Promise<void> {
  const abs = resolve(filePath);
  /** The base component documented by this file, if any — looked up by discovery's mdPath. */
  const ownerIn = (dr: DiscoveryResult | null): string | undefined => {
    for (const [id, entry] of dr?.discoveryMap ?? []) {
      if (entry.mdPath && resolve(entry.mdPath) === abs) return id.split("~")[0];
    }
    return undefined;
  };
  const rel = relative(patternRootOf(filePath) ?? patternsDir, filePath);
  // An .hbs/.json edit drops the cached discovery (routes rebuild it lazily); the owner lookup needs one.
  // An unlinked file is only in the map from BEFORE the rebuild; an added one only in the map after.
  let owner = ownerIn(event === "change" ? await currentDiscovery(state, patternRoots) : await cachedDiscovery(state));
  if (event === "change") {
    hmr.push({ type: "tree-changed" });
    console.log(`[dev-server] Docs changed: ${rel} → tree-changed`);
  } else {
    await rebuildAndSignalTree(`Docs ${event === "add" ? "added" : "removed"}: ${rel}`);
    owner ??= ownerIn(await cachedDiscovery(state));
  }
  for (const componentId of new Set([owner, state.lastComponentId])) {
    if (componentId) hmr.push({ type: "content-swap", componentId });
  }
}

// Global data, helpers and assets. Data and helpers are part of what pd dev renders with: a change reloads
// them and replaces the renderer (rendering.ts), all at once, then reloads what is open. A reload that fails
// (a file that does not parse, a helper module that throws) keeps the last good ones, and says so in the
// terminal and on the open pages (the `error` message); the next good save recovers. A helper's own
// imports are not reloaded (Node keeps modules once imported), so a change to any other file in a helper's
// folder asks for a restart instead. Assets are served from disk per request: a change only reloads.
let reloads = 0;

async function reloadedOpenPages(label: string): Promise<void> {
  if (state.lastComponentId) hmr.push({ type: "content-swap", componentId: state.lastComponentId });
  await everyPageChanged();
  console.log(`[dev-server] ${label} → reloaded`);
}

function reloadFailed(filePath: string, what: string, problems: LoadProblem[]): void {
  const message = `${shown(filePath)}: ${what} not reloaded, the last good ones are still in use: `
    + problems.map(p => `${shown(p.file)}: ${p.message}`).join("; ");
  hmr.push({ type: "error", scope: "build", message });
  console.error(`[dev-server] ${message}`);
}

async function reloadData(filePath: string): Promise<void> {
  const { data, problems } = await readGlobalData(cfg.dataDirs);
  const failed = problems.filter(p => !p.missing);
  if (failed.length) { reloadFailed(filePath, "global data", failed); return; }
  rendering.replace({ globalData: cfg.dataDirs.length ? data : undefined });
  await reloadedOpenPages(`Global data changed: ${shown(filePath)}`);
}

async function reloadHelpers(filePath: string): Promise<void> {
  const bust = ++reloads;
  const registrars: HelperRegistrar[] = [];
  const failed: LoadProblem[] = [];
  for (const path of cfg.helperPaths) {
    const r = await readHelperRegistrars(path, { bust });
    registrars.push(...r.registrars);
    failed.push(...r.problems.filter(p => !p.missing));
    // A module that imports cleanly can still throw when it registers: run each once on a fresh
    // environment, as a render would, before any page renders with it.
    r.registrars.forEach((register, i) => {
      const message = dryRunHelperRegistrar(register);
      if (message !== null) failed.push({ file: r.files[i], message });
    });
  }
  if (failed.length) { reloadFailed(filePath, "helpers", failed); return; }
  rendering.replace({ registrars });
  await reloadedOpenPages(`Helper changed: ${shown(filePath)}`);
}

/** Data, helper and asset files; true when the file was one of them. */
async function handleReloadable(filePath: string, event: "change" | "add" | "unlink"): Promise<boolean> {
  const helper = helperOf(filePath);
  if (helper === "entry") { await reloadHelpers(filePath); return true; }
  if (helper === "other") {
    const message = `${shown(filePath)} changed: restart pd dev to load it (a helper's own imports are not reloaded)`;
    hmr.push({ type: "error", scope: "build", message });
    console.error(`[dev-server] ${message}`);
    return true;
  }
  if (dataDirOf(filePath)) {
    if (extname(filePath) === ".json") await reloadData(filePath);
    return true;
  }
  if (assetRootOf(filePath)) { await reloadedOpenPages(`Asset ${event === "change" ? "changed" : event === "add" ? "added" : "removed"}: ${shown(filePath)}`); return true; }
  return false;
}

// The config file. The config the server runs with is read once, at start, except `storefront.site`: a
// change to it alone is taken live (the site values are replaced, then every page reloads), since every page
// reads them per request. Any other change needs a restart, and says so; nothing of it is taken, so the
// server keeps running as it is. A config that does not load (a syntax error, an invalid value) is an error
// notice, and the running values stay. Only the file is watched: a module it imports is not.
let runningConfig = ctx.config;
const isConfigFile = (p: string): boolean => configFile !== undefined && resolve(p) === resolve(configFile.path);
async function handleConfig(filePath: string): Promise<boolean> {
  if (!isConfigFile(filePath)) return false;
  const name = shown(filePath);
  let next: PatternDumpConfig;
  try {
    next = await configFile!.reload();
  } catch (e) {
    const message = `${name} cannot be loaded, so pd dev keeps running with the config it has: ${e instanceof Error ? e.message : String(e)}`;
    hmr.push({ type: "error", scope: "build", message });
    console.error(`[dev-server] ${message}`);
    return true;
  }
  const change = classifyConfigChange(runningConfig, next);
  if (change === "none") { console.log(`[dev-server] Config saved: ${name}, nothing pd dev reads changed`); return true; }
  if (change === "other") {
    const message = `${name} changed: restart pd dev to load it (only storefront.site is taken without a restart)`;
    hmr.push({ type: "error", scope: "build", message });
    console.error(`[dev-server] ${message}`);
    return true;
  }
  runningConfig = next;
  site.replace(next.storefront?.site);
  hmr.push({ type: "page-changed", route: null });
  console.log(`[dev-server] Config changed: ${name}, storefront.site → page-changed (every page)`);
  return true;
}

// Storefront pages. Nothing is cached server-side — every page request reads the folder — so all a
// change needs is a reload of the pages it touches. An edited page reloads itself, unless the edit changed
// what other pages show of it: its title, description or order is in every page's nav, so then every page
// reloads. A file or folder added or removed can change the nav (or the folder's problems), so every page
// reloads. Dotfiles are not pages and change nothing. Checked first, with a folder boundary, because the
// other handlers match on a path prefix.
const inPages = (p: string): boolean => pagesDir !== null && within(pagesDir, p);

/** What every page shows of the others: the nav, and each page's route, title and layout. Null without a
 *  storefront. Compared, never parsed. */
async function pagesFingerprint(): Promise<string | null> {
  if (!pagesDir) return null;
  const model = await readPages(pagesDir);
  return JSON.stringify({ nav: model.nav, pages: model.pages, problems: model.problems });
}

async function handlePages(filePath: string, event: "change" | "add" | "unlink" | "addDir" | "unlinkDir"): Promise<boolean> {
  if (!inPages(filePath)) return false;
  const rel = relative(pagesDir!, filePath).split(sep).join("/");
  if (rel.split("/").some(seg => seg.startsWith("."))) return true;
  const before = pagesPrint;
  pagesPrint = await pagesFingerprint();
  // A page saved, added or removed can change what git status says of it (committed, changed, untracked).
  dates?.statusChanged();
  // The 404 page has no route of its own: it is shown at every address with no page, so any open page may be it.
  const notFound = rel === NOT_FOUND_FILE;
  const own = event === "change" && rel.endsWith(".md") && !notFound ? routeFor(rel) : null;
  const route = own !== null && pagesPrint === before ? own : null;
  hmr.push({ type: "page-changed", route });
  const why = notFound ? " (the 404 page, shown at every address with no page)"
    : own !== null && route === null ? " (it changed what other pages show of it)" : "";
  console.log(`[dev-server] Page ${event}: ${rel || "."} → page-changed ${route ?? "(every page)"}${why}`);
  return true;
}

on("addDir", async (dirPath) => { await handlePages(dirPath, "addDir"); });

on("change", async (filePath) => {
  if (await handleConfig(filePath)) return;
  if (await handlePages(filePath, "change")) return;
  if (await handleReloadable(filePath, "change")) return;
  const ext = extname(filePath);

  if (ext === ".md" && patternRootOf(filePath)) {
    await handleMarkdown(filePath, "change");
    return;
  }

  const themesDir = themeDirOf(filePath);
  if (ext === ".scss") {
    if (themesDir) {
      // Theme SCSS changed → recompile theme, push content-swap so iframe picks up new link.
      const themeName = basename(filePath, ".theme.scss");
      try {
        const css = await compileSassFile(filePath);
        state.themeCss.set(themeName, css);
        state.themeTokens.set(themeName, await extractThemeTokens(themeName, css, swatchSlots, themesDir));
        hmr.push({ type: "content-swap", componentId: state.lastComponentId });
        console.log(`[dev-server] Theme CSS updated: ${themeName}`);
      } catch (e) {
        hmr.push({ type: "error", scope: "build", message: `SCSS error: ${String(e)}` });
      }
    } else {
      await handleComponentScss(filePath);
      // TRIPWIRE — diagnostics graph does NOT re-audit on an SCSS edit, ON PURPOSE. Every engine in
      // the sweep (structural axe on a CSS-less jsdom, html-validate, schema, render) is CSS-invariant,
      // so no style change can alter a static finding. Re-auditing here would be pure waste.
      // >>> If a CSS-DEPENDENT engine ever enters the sweep (the rendered-contrast / needsRendering
      // >>> tier — contrast, aria-hidden-focus, duplicate-id-aria), this assumption breaks: restore an
      // >>> SCSS→affected-set re-audit here (reverseDeps + resolveScssToComponent, as handleComponentScss
      // >>> already uses at ~575). Until then, omission is correct, not a miss.
    }

  } else if (ext === ".hbs" || ext === ".json") {
    // A file the tree does not have (treeFiles): handled as the add it is.
    const patternRoot = patternRootOf(filePath);
    if (patternRoot && !treeFiles.has(resolve(filePath))) {
      if (ext === ".hbs") await rebuildAndSignalTree(`Pattern added: ${relative(patternRoot, filePath)}`);
      else await handleComponentJson(filePath, "add");
      return;
    }
    // Resolve using the current map BEFORE clearing it (file was in the previous discovery pass). A
    // second edit before any request has rebuilt it (a quick second save) finds none: build it, as the
    // SCSS path does, or that edit would reload nothing.
    const discovery = await currentDiscovery(state, patternRoots);
    const componentId = resolveComponentForFile(filePath, discovery);
    // Invalidate caches so next request rebuilds with the new file state.
    invalidateDiscovery(state);
    if (!componentId) {
      console.warn(`[dev-server] Could not resolve component for: ${filePath}`);
      return;
    }
    let rendered = false;
    try {
      await render({ component: componentId });
      rendered = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      hmr.push({ type: "error", scope: "render", componentId, message: msg });
      console.error(`[dev-server] Render error [${componentId}]:`, msg);
    }
    // Diagnostics graph: SURGICAL re-audit of exactly this one component (template/data changed →
    // its static findings may have changed). No full re-hash, no other component touched. A base id
    // from resolveComponentForFile keys straight into the slice map. quarantineEntry is undefined —
    // a live-edited component that renders is not quarantined (collisions come via add/rebuild).
    // The reload is sent after it, as every reload is sent after the state it reflects (the audit facet
    // refetches on it), and sent even when the audit fails: a failing audit must not swallow the reload.
    try {
      if (state.auditSeeding) {
        // A seed is running: it audits this component again before it is stored (routes.ts).
        state.auditSeeding.add(componentId);
      } else {
        const slices = await state.audit.peek();
        if (slices) {
          await testOnlyReaudit()?.(componentId);
          slices.set(componentId, await auditWithHash(
            componentId, render, undefined, discovery.discoveryMap, globalDataDigest(rendering.current.globalData),
          ));
          state.liveReauditCount += 1;
          if (verboseTiming) console.log(`[dev-server:timing] diagnostics: live re-audit ${componentId} (1 component; total ${state.liveReauditCount})`);
        }
      }
    } catch (e) {
      reportHandlerFailure("change", filePath, e, "its audit");
    } finally {
      if (rendered) {
        hmr.push({ type: "content-swap", componentId });
        console.log(`[dev-server] Component changed: ${componentId}`);
      }
    }

  } else if (ext === ".ts" && scriptDirOf(filePath)) {
    // Script changed → invalidate cache + dispatch content-swap so the client re-renders
    // the srcdoc with a fresh ?v=<mtime> on the script src (busting the browser cache).
    const scriptId = basename(filePath, ".ts");
    scriptFor(state, scriptId).invalidate();
    if (state.lastComponentId) {
      hmr.push({ type: "content-swap", componentId: state.lastComponentId });
    }
    // Storefront pages load scripts (their own, and their embedded previews'), whether or not a workbench
    // has a component open: each page is told, as for a base-layer change.
    await everyPageChanged();
    console.log(`[dev-server] Script changed: ${scriptId} → srcdoc reload dispatched`);
  }
});

// New SCSS files fire "add" (not "change"). ignoreInitial: true prevents existing files
// from firing at startup. Theme additions are ignored here (rare; handled on next nav).
// Helper: rebuild discovery, surface any collisions, then push tree-changed.
async function rebuildAndSignalTree(label: string): Promise<void> {
  const previous = await cachedDiscovery(state);
  const before = previous ? baseComponentIds(previous) : null;
  // A discovery built after this change; one that a later change overtakes is never stored (lazy.ts).
  const dr = await rebuildDiscovery(state, patternRoots);
  treeFiles = componentFilesOf(dr);
  // A component that arrived (or left) changes who owns which stylesheet: a stylesheet saved before its
  // template was filed under the base layer, and now belongs to the component. Restyle against the new
  // set, so its CSS moves without a restart.
  const after = baseComponentIds(dr);
  if (!before || before.size !== after.size || [...after].some(id => !before.has(id))) {
    await restyleAll(dr, Date.now(), [], false);
  }
  // Structural change (component added / removed) → the corpus node set changed; drop the diagnostics
  // slice cache so the next /api/audit re-seeds (still a hash-delta vs disk — only genuinely-changed
  // components re-audit). Not surgical, but adds/removes are rare and reshape the graph.
  state.audit.invalidate();
  await surfaceCollisions(dr.collisions, cwd, hotreloader);
  // Re-derive the flattening artifact — the node set changed — from the new discovery's registry, which
  // the next request then reuses.
  await surfaceFlattening(dr.discoveryMap, await compositionFor(state, dr, patternDirs), cwd);
  hmr.push({ type: "tree-changed" });
  // A storefront page may embed the component that arrived or left: every page reloads and is checked again.
  await everyPageChanged();
  console.log(`[dev-server] ${label} → tree-changed`);
}

// A .json in a pattern root, added or removed. Discovery reads three kinds, each by name, once per build:
// `<stem>.schema.json` is a component's schema (its schemaPath: what the Inspector shows, and what a
// storefront page's frontmatter is checked against), `<stem>.json` is a component's data (its jsonPath:
// the defaults it renders with), and `<base>~<variant>.json` is a variant of its own (a data-overlay
// variant, a node in the tree; beside a `<base>~<variant>.hbs` it is that variant's data). A file that
// arrives or leaves after the build is none of these until discovery is built again, so every .json in a
// pattern root rebuilds it: matching the three by name here would repeat discovery's rules, and any other
// .json rebuilds a discovery that comes out the same. Then the component it belongs to reloads, found in
// the discovery that has the file (the new one for an add, the one before for a removal).
async function handleComponentJson(filePath: string, event: "add" | "unlink"): Promise<void> {
  const abs = resolve(filePath);
  const ownerIn = (dr: DiscoveryResult | null): string | undefined => {
    for (const [id, entry] of dr?.discoveryMap ?? []) {
      if (entry.jsonPath === abs || entry.schemaPath === abs) return id.split("~")[0];
    }
    return undefined;
  };
  const rel = relative(patternRootOf(filePath) ?? patternsDir, filePath);
  let owner = event === "unlink" ? ownerIn(await cachedDiscovery(state)) : undefined;
  await rebuildAndSignalTree(`Data ${event === "add" ? "added" : "removed"}: ${rel}`);
  owner ??= ownerIn(await cachedDiscovery(state));
  if (owner) hmr.push({ type: "content-swap", componentId: owner });
}

/** Every storefront page changed: one page-changed per page (none without a storefront). */
async function everyPageChanged(): Promise<void> {
  if (pagesDir) for (const { route } of (await readPages(pagesDir)).pages) hmr.push({ type: "page-changed", route });
}

on("add", async (filePath) => {
  if (await handleConfig(filePath)) return; // an editor's save by rename comes back as an add
  if (await handlePages(filePath, "add")) return;
  if (await handleReloadable(filePath, "add")) return;
  const ext = extname(filePath);
  const patternRoot = patternRootOf(filePath);
  if (ext === ".scss" && !themeDirOf(filePath)) {
    await handleComponentScss(filePath);
  } else if (ext === ".hbs" && patternRoot) {
    await rebuildAndSignalTree(`Pattern added: ${relative(patternRoot, filePath)}`);
  } else if (ext === ".md" && patternRoot) {
    await handleMarkdown(filePath, "add");
  } else if (ext === ".json" && patternRoot) {
    await handleComponentJson(filePath, "add");
  }
});

// A component's file removed — rebuild discovery and signal nav rebuild.
on("unlink", async (filePath) => {
  if (isConfigFile(filePath)) return; // mid-save by rename: its add follows
  if (await handlePages(filePath, "unlink")) return;
  if (await handleReloadable(filePath, "unlink")) return;
  const patternRoot = patternRootOf(filePath);
  if (extname(filePath) === ".hbs" && patternRoot) {
    await rebuildAndSignalTree(`Pattern removed: ${relative(patternRoot, filePath)}`);
  } else if (extname(filePath) === ".md" && patternRoot) {
    await handleMarkdown(filePath, "unlink");
  } else if (extname(filePath) === ".json" && patternRoot) {
    await handleComponentJson(filePath, "unlink");
  }
});

// Component directory removed — covers the case where the entire component folder is deleted.
on("unlinkDir", async (dirPath) => {
  if (await handlePages(dirPath, "unlinkDir")) return;
  const patternRoot = patternRootOf(dirPath);
  if (patternRoot && dirPath !== patternRoot) {
    await rebuildAndSignalTree(`Pattern dir removed: ${relative(patternRoot, dirPath)}`);
  }
});

  try {
    await started;
    await configReady;
  } catch (e) {
    await close();
    throw e;
  }
  (globalThis as { __testOnly_onWatchStarted?: TestOnlyWatchStarted }).__testOnly_onWatchStarted?.(
    (event, path) => { watcher.emit(event, path); },
    path => { watcher.unwatch(path); },
  );
  return { close, settle };
}

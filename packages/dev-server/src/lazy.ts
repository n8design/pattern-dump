// One cached value that is built on demand and invalidated by the watcher: the shape every lazy cache in
// the server shares (discovery, style data, the audit seed, compiled scripts).
//
// The rule it keeps: a build that finishes after an invalidation is never stored, and a caller is only
// ever handed a value that was current when its build finished. Without it, a request that started a build
// before a save would store (and serve) the state from before the save, after the watcher had dropped it.
//
// - Callers that arrive while a build runs share it: N requests after a save build once.
// - `invalidate()` bumps a generation and drops the stored value and the build in flight. Callers waiting
//   on that build wait for the current one instead (started by whoever needs it first). The wait repeats
//   only while new invalidations land during builds, so it is bounded by how fast files change; there is
//   no cap, since a cap could only hand out a value known to be stale. A wait longer than `slow.afterMs`
//   is said in the terminal, with its reason, so it does not look like a hang (a git checkout does this).
// - A build that fails is dropped while it is still the current one, so the next caller tries again;
//   its callers get the failure.
// - `peek()` never starts a build.
//
// Deviation, documented where it is used: the audit seed (routes.ts) stores a seed that an invalidation
// overtook, after re-auditing the components invalidated during it, instead of discarding the whole seed.
// See `invalidated` there.

export interface Lazy<T> {
  /** The current value: the stored one, the build in flight, or a new `build()`. */
  get(build: () => Promise<T>): Promise<T>;
  /** The stored value, or the result of the build in flight; null when there is neither, or it failed. */
  peek(): Promise<T | null>;
  /** Store `value` as current (startup, or a rebuild that already has its result). */
  set(value: T): void;
  /** Drop the stored value and the build in flight: the next caller builds anew. */
  invalidate(): void;
}

export interface LazyOptions {
  /** Say in the terminal when a caller has waited longer than `afterMs`; `what` names the value. */
  readonly slow?: { readonly afterMs: number; readonly what: string; readonly log?: (line: string) => void };
}

// TEST ONLY, not a feature: when a test has set `globalThis.__testOnly_onLazy`, it is called with the
// cache's name at two moments, with a function that invalidates that cache as the watcher does. "built": a
// build finished, before it is stored. "taken": a caller has its value and goes on with it. Tests use it
// to invalidate at exactly those points. Not exported, not part of any contract.
type TestOnlyOnLazy = (name: string, phase: "built" | "taken", invalidate: () => void) => void | Promise<void>;
/** The test-only hook, for a value derived from a lazy one (the composition registry). */
export const testHook = (): TestOnlyOnLazy | undefined => (globalThis as { __testOnly_onLazy?: TestOnlyOnLazy }).__testOnly_onLazy;

export function createLazy<T>(name: string, options: LazyOptions = {}): Lazy<T> {
  let generation = 0;
  let stored: { value: T } | null = null;
  let inflight: { readonly promise: Promise<T>; readonly at: number } | null = null;

  const invalidate = (): void => {
    generation++;
    stored = null;
    inflight = null;
  };

  const start = (build: () => Promise<T>): { readonly promise: Promise<T>; readonly at: number } => {
    const at = generation;
    const promise = build().then(async value => {
      await testHook()?.(name, "built", invalidate);
      return value;
    });
    const entry = { promise, at };
    inflight = entry;
    // Registered before any caller awaits it, so the value is stored before a caller resumes.
    promise.then(value => {
      if (inflight === entry) inflight = null;
      if (generation === at) stored = { value };
    }, () => {
      if (inflight === entry) inflight = null;
    });
    return entry;
  };

  return {
    async get(build) {
      const started = Date.now();
      let overtaken = 0;
      const slow = options.slow;
      const timer = slow && setTimeout(() => {
        const s = Math.round((Date.now() - started) / 1000);
        const why = overtaken > 0
          ? `built again ${overtaken} time(s), because files changed while it was built (a git checkout or a bulk copy does this); it is used as soon as one build finishes with no change during it`
          : "its build is still running (a large or slow folder)";
        (slow.log ?? console.log)(`[dev-server] A request has waited ${s} s for ${slow.what}: ${why}.`);
      }, slow.afterMs);
      try {
        for (;;) {
          if (stored) {
            const { value } = stored;
            await testHook()?.(name, "taken", invalidate);
            return value;
          }
          const entry = inflight ?? start(build);
          const value = await entry.promise;
          if (generation === entry.at) {
            await testHook()?.(name, "taken", invalidate);
            return value;
          }
          overtaken++;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async peek() {
      if (stored) return stored.value;
      return inflight ? inflight.promise.catch(() => null) : null;
    },
    set(value) {
      generation++;
      inflight = null;
      stored = { value };
    },
    invalidate,
  };
}

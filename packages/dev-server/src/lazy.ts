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
// One deviation, documented where it is used: the audit seed (the audit route in routes.ts). Edits during
// a seed do not invalidate it; they are recorded (`editedDuringSeed`) and those components are audited
// again before the seed is stored, instead of the whole seed being discarded and run again.

export interface Lazy<T> {
  /** The current value: the stored one, the build in flight, or a new `build()`. */
  get(build: () => Promise<T>): Promise<T>;
  /** The stored value, or the result of the build in flight; null when there is neither, or it failed. */
  peek(): Promise<T | null>;
  /** Store `value` as current (startup, or a rebuild that already has its result). */
  set(value: T): void;
  /** Drop the stored value and the build in flight: the next caller builds anew. */
  invalidate(): void;
  /**
   * Hold off builds while the value is written in place (a patch). The build in flight is overtaken, and
   * no build starts until every fence is released; callers wait. Release with `stale: true` when the patch
   * leaves the stored value incomplete (the next caller then builds, after the patch), `false` when the
   * holder stored a complete value itself.
   */
  fence(): (release: { stale: boolean }) => void;
}

export interface LazyOptions<T> {
  /** Called when a build's value is stored (never for an overtaken build, nor for `set`): for a value that
   *  is installed somewhere when it becomes current. */
  readonly onStore?: (value: T) => void;
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

export function createLazy<T>(name: string, options: LazyOptions<T> = {}): Lazy<T> {
  let generation = 0;
  let stored: { value: T } | null = null;
  let inflight: { readonly promise: Promise<T>; readonly at: number } | null = null;
  let fences = 0;
  let unfenced: { readonly promise: Promise<void>; readonly open: () => void } | null = null;

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
      if (generation === at) {
        stored = { value };
        options.onStore?.(value);
      }
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
          if (unfenced) { await unfenced.promise; continue; }
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
    fence() {
      invalidate();
      if (fences++ === 0) {
        let open = (): void => {};
        const promise = new Promise<void>(resolve => { open = resolve; });
        unfenced = { promise, open };
      }
      let released = false;
      return ({ stale }) => {
        if (released) return;
        released = true;
        if (stale) invalidate();
        if (--fences === 0) {
          const fence = unfenced;
          unfenced = null;
          fence?.open();
        }
      };
    },
  };
}

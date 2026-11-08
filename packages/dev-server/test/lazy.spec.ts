// The lazy cache every invalidated value in the server goes through (lazy.ts): one shared build, a build
// overtaken by an invalidation is never stored and its callers wait for the current one, a failed build is
// dropped only while current, and a long wait is said in the terminal. Builds are promises the test
// settles itself, so nothing depends on timing.
import { describe, expect, it, vi } from "vitest";
import { createLazy } from "../src/lazy.js";

/** A build the test settles: each call records one pending build. */
function builds<T>() {
  const pending: Array<{ resolve: (v: T) => void; reject: (e: unknown) => void }> = [];
  const build = () => new Promise<T>((resolve, reject) => { pending.push({ resolve, reject }); });
  return { pending, build };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("a lazy cache", () => {
  it("builds once for every caller that arrives while it builds, and keeps the value", async () => {
    const lazy = createLazy<number>("t");
    const { pending, build } = builds<number>();
    const a = lazy.get(build), b = lazy.get(build), c = lazy.get(build);
    expect(pending).toHaveLength(1);
    pending[0].resolve(1);
    expect(await Promise.all([a, b, c])).toEqual([1, 1, 1]);
    expect(await lazy.get(build)).toBe(1);
    expect(pending).toHaveLength(1);
  });

  it("never stores a build that an invalidation overtook: its callers get the build after it", async () => {
    const lazy = createLazy<string>("t");
    const { pending, build } = builds<string>();
    const caller = lazy.get(build);
    lazy.invalidate();
    pending[0].resolve("before the change");
    await settle();
    // The overtaken build is not handed out: its caller started the next one and waits for it.
    expect(pending).toHaveLength(2);
    pending[1].resolve("after the change");
    expect(await caller).toBe("after the change");
    expect(await lazy.peek()).toBe("after the change");
  });

  it("drops a failed build, so the next caller builds again; its callers get the failure", async () => {
    const lazy = createLazy<number>("t");
    const { pending, build } = builds<number>();
    const first = lazy.get(build);
    pending[0].reject(new Error("unreadable"));
    await expect(first).rejects.toThrow("unreadable");
    await settle();
    expect(await lazy.peek()).toBeNull();
    const second = lazy.get(build);
    expect(pending).toHaveLength(2);
    pending[1].resolve(2);
    expect(await second).toBe(2);
  });

  it("drops a failed build only while it is current: a newer build that replaced it stays", async () => {
    const lazy = createLazy<number>("t");
    const { pending, build } = builds<number>();
    const old = lazy.get(build);
    lazy.invalidate();
    const newer = lazy.get(build);
    pending[0].reject(new Error("unreadable"));
    await expect(old).rejects.toThrow("unreadable");
    await settle();
    // A caller arriving now joins the newer build, still in flight; it does not start another.
    const later = lazy.get(build);
    expect(pending).toHaveLength(2);
    pending[1].resolve(3);
    expect(await newer).toBe(3);
    expect(await later).toBe(3);
  });

  it("set() wins over a build in flight", async () => {
    const lazy = createLazy<string>("t");
    const { pending, build } = builds<string>();
    void lazy.get(build);
    lazy.set("given");
    pending[0].resolve("built before it was given");
    await settle();
    expect(await lazy.peek()).toBe("given");
  });

  it("fence: a build in flight is never stored, and none starts until the fence is released", async () => {
    const stores: number[] = [];
    const lazy = createLazy<number>("t", { onStore: v => stores.push(v) });
    const { pending, build } = builds<number>();
    const caller = lazy.get(build);
    const release = lazy.fence();
    pending[0].resolve(1);
    await settle();
    // Overtaken by the fence: not stored, and its caller does not start another build while fenced.
    expect(stores).toEqual([]);
    expect(pending).toHaveLength(1);
    const during = lazy.get(build);
    await settle();
    expect(pending).toHaveLength(1);

    release({ stale: true });
    await settle();
    // Released stale: one build, started after the fence, serves both callers and is stored.
    expect(pending).toHaveLength(2);
    pending[1].resolve(2);
    expect(await caller).toBe(2);
    expect(await during).toBe(2);
    expect(stores).toEqual([2]);
  });

  it("fence released not stale keeps what its holder stored", async () => {
    const lazy = createLazy<number>("t");
    const { pending, build } = builds<number>();
    const release = lazy.fence();
    const caller = lazy.get(build);
    lazy.set(7);
    release({ stale: false });
    expect(await caller).toBe(7);
    expect(pending).toHaveLength(0);
  });

  it("says in the terminal, with its reason, when a caller has waited long", async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const lazy = createLazy<number>("t", { slow: { afterMs: 5_000, what: "the component index", log: l => lines.push(l) } });
      const { pending, build } = builds<number>();
      const caller = lazy.get(build);
      // Overtaken once: files changed while it was built.
      lazy.invalidate();
      pending[0].resolve(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(pending).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(lines).toEqual([
        "[dev-server] A request has waited 5 s for the component index: built again 1 time(s), because files changed while it was built (a git checkout or a bulk copy does this); it is used as soon as one build finishes with no change during it.",
      ]);
      pending[1].resolve(1);
      expect(await caller).toBe(1);
      // A quick get says nothing.
      expect(await lazy.get(build)).toBe(1);
      expect(lines).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a slow first build when nothing overtook it", async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const lazy = createLazy<number>("t", { slow: { afterMs: 5_000, what: "the component index", log: l => lines.push(l) } });
      const { pending, build } = builds<number>();
      const caller = lazy.get(build);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(lines).toEqual(["[dev-server] A request has waited 5 s for the component index: its build is still running (a large or slow folder)."]);
      pending[0].resolve(1);
      expect(await caller).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The discovery's wiring onto the lazy cache (server-state.ts, lazy.ts): a failed build is not kept, a
// newer build that replaced a failed one stays current, and rebuildDiscovery hands out a build started
// after it was called. The builds are promises the test settles itself.
import { describe, expect, it, vi } from "vitest";
import type { DiscoveryResult } from "@pattern-dump/contracts";

const builds = vi.hoisted(() => [] as Array<{ resolve: (d: unknown) => void; reject: (e: unknown) => void }>);
vi.mock("@pattern-dump/discovery", () => ({
  buildDiscoveryMap: () => new Promise((resolve, reject) => { builds.push({ resolve, reject }); }),
}));

const { createServerState, cachedDiscovery, currentDiscovery, invalidateDiscovery, rebuildDiscovery, setDiscovery } =
  await import("../src/server-state.js");
const result = (n: number) => ({ n }) as unknown as DiscoveryResult;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("the discovery", () => {
  it("is not kept when its build fails: the next caller builds again", async () => {
    builds.length = 0;
    const state = createServerState();
    const first = currentDiscovery(state, "/patterns");
    builds[0].reject(new Error("unreadable"));
    await expect(first).rejects.toThrow("unreadable");
    await settle();
    expect(await cachedDiscovery(state)).toBeNull();

    const second = currentDiscovery(state, "/patterns");
    expect(builds).toHaveLength(2);
    builds[1].resolve(result(2));
    await expect(second).resolves.toEqual(result(2));
  });

  it("drops a failed build only while it is current: a newer build that replaced it stays", async () => {
    builds.length = 0;
    const state = createServerState();
    const old = currentDiscovery(state, "/patterns");
    invalidateDiscovery(state);
    const newer = currentDiscovery(state, "/patterns");
    builds[0].reject(new Error("unreadable"));
    await expect(old).rejects.toThrow("unreadable");
    await settle();
    // A request arriving now joins the newer build, still in flight; it does not start another.
    const later = currentDiscovery(state, "/patterns");
    expect(builds).toHaveLength(2);
    builds[1].resolve(result(3));
    await expect(newer).resolves.toEqual(result(3));
    await expect(later).resolves.toEqual(result(3));
  });

  it("is rebuilt by rebuildDiscovery even when one is stored: the result is a build started after the call", async () => {
    builds.length = 0;
    const state = createServerState();
    setDiscovery(state, result(1));
    const rebuilt = rebuildDiscovery(state, "/patterns");
    expect(builds).toHaveLength(1);
    builds[0].resolve(result(4));
    await expect(rebuilt).resolves.toEqual(result(4));
  });
});

// A discovery build that fails is not kept: the next caller builds again. Only the current build is
// dropped, never a newer one that replaced it. The builds are promises the test settles itself.
import { describe, expect, it, vi } from "vitest";
import type { DiscoveryResult } from "@pattern-dump/contracts";

const builds = vi.hoisted(() => [] as Array<{ resolve: (d: unknown) => void; reject: (e: unknown) => void }>);
vi.mock("@pattern-dump/discovery", () => ({
  buildDiscoveryMap: () => new Promise((resolve, reject) => { builds.push({ resolve, reject }); }),
}));

const { createServerState, currentDiscovery, invalidateDiscovery, startDiscovery } = await import("../src/server-state.js");
const result = (n: number) => ({ n }) as unknown as DiscoveryResult;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("a discovery build that fails", () => {
  it("is not kept: the next caller builds again", async () => {
    builds.length = 0;
    const state = createServerState();
    const first = currentDiscovery(state, "/patterns");
    builds[0].reject(new Error("unreadable"));
    await expect(first).rejects.toThrow("unreadable");
    await settle();
    expect(state.discoveryPromise).toBeNull();

    const second = currentDiscovery(state, "/patterns");
    expect(builds).toHaveLength(2);
    builds[1].resolve(result(2));
    await expect(second).resolves.toEqual(result(2));
  });

  it("drops only itself: a newer build that replaced it stays current", async () => {
    builds.length = 0;
    const state = createServerState();
    const old = startDiscovery(state, "/patterns");
    invalidateDiscovery(state);
    const newer = startDiscovery(state, "/patterns");
    builds[0].reject(new Error("unreadable"));
    await expect(old).rejects.toThrow("unreadable");
    await settle();
    expect(state.discoveryPromise).toBe(newer);
    builds[1].resolve(result(3));
    await expect(currentDiscovery(state, "/patterns")).resolves.toEqual(result(3));
  });
});

// The dev server's mutable state, in one place.
//
// These fourteen cells were `let` bindings inside `startDevServer`'s closure. Sharing them by
// lexical scope worked while everything lived in one function, but it made the route handlers and
// the file watcher inseparable — neither could move without the other. Passing one object by
// reference gives the same sharing with an explicit, typed seam.
//
// WHY THIS IS A STATE BAG AND NOT A CLASS: every field is genuinely shared mutable state written
// from two directions — HTTP requests and filesystem events. Wrapping it in methods would imply an
// invariant the code does not have. The honest shape is a record whose hazards are documented.
//
// THREE HAZARDS, each of which has a real failure mode:
//
//  1. `lastComponentId` is a request→watcher BACK-CHANNEL. A GET handler writes it; the watcher
//     reads it to decide which component a theme or script edit should refresh. It is why the
//     server is not safe to drive from two concurrent clients — the second client's navigation
//     silently redirects the first client's HMR. (This is also why the Playwright suite runs
//     workers:1; see apps/dev-ui/e2e/playwright.config.ts.)
//
//  2. `classOwnerIndex` is MUTATED IN PLACE by `patchClassOwnerIndex` on the per-save HMR path.
//     Copying it instead of sharing the reference would silently break class-borrowing freshness:
//     the patch would land on a copy and the served index would keep the stale attribution.
//
//  3. `perComponentCss` is REASSIGNED (not merely mutated) by the initial index build — it takes
//     the map that `buildAllStyleData` returns. Anything that captured the pre-build reference
//     would hold the wrong map forever. Every full re-index (boot, the lazy rebuild in the
//     component route, the watcher's full restyle) goes through `applyStyleData`, so nothing
//     else may hold on to the map.
//
//  4. `discovery` is INVALIDATED by the watcher while requests are using it. A request takes it once,
//     `const discovery = await currentDiscovery(state, roots)`, and from then on uses only its local
//     `discovery`, never the state again: across any later await the watcher may have cleared it. It is
//     a lazy cache (lazy.ts): a build that an invalidation overtook is never stored, and its callers wait
//     for the current one. Always go through currentDiscovery / cachedDiscovery / setDiscovery /
//     invalidateDiscovery / rebuildDiscovery below.
//
// `themeCss`, `themeTokens` and `scripts` are `readonly` because they are only ever mutated,
// never replaced — the type records that difference rather than leaving it to convention.

import type { DiscoveryResult } from "@pattern-dump/contracts";
import { buildDiscoveryMap, type PatternRoot } from "@pattern-dump/discovery";
import { createLazy, testHook, type Lazy } from "./lazy.js";
import { buildCompositionRegistry, type CompositionRegistry } from "./composition.js";
import type { AuditedSlice } from "./diagnostics.js";
import type {
  AllStyleData, ScssModuleGraph, ClassOwnerIndex, BaseProvenanceIndex,
} from "./style-index.js";

export interface ServerState {
  /** Last component fetched over HTTP. Request→watcher back-channel — see hazard 1. */
  lastComponentId: string;

  scssModuleGraph: ScssModuleGraph | null;
  /** Mutated in place by patchClassOwnerIndex on the HMR path — see hazard 2. */
  classOwnerIndex: ClassOwnerIndex | null;
  /** Base-class provenance: className → shared module that authored it. Same lifecycle as the
   *  module graph — rebuilt on the next full pass (navigation-lag MVP). */
  baseProvenance: BaseProvenanceIndex | null;
  scssGraphDirty: boolean;

  /** Per-component own-origin CSS: ComponentId → CSS text (origin-bucketed).
   *  Reassigned by the initial index build — see hazard 3. */
  perComponentCss: Map<string, string>;
  /** Base-origin CSS: reset + font-face rules, no component rules. */
  baseCss: string;
  /** Bumped each time `baseCss` changes after the first index build. Stamped on the preview's base
   *  `<link>` as `?v=`, so a reloaded preview never reuses a stale base sheet. 0 = never changed. */
  baseCssVersion: number;

  /** The current discovery, built on demand. See hazard 4. */
  readonly discovery: Lazy<DiscoveryResult>;

  /** In-memory per-component audit slices, each with the hash it was audited at, as a lazy cache.
   *  Seeded on the first /api/audit (hash-delta vs disk), then patched surgically by the watcher:
   *  a .hbs/.json edit re-audits exactly that component; a .scss edit re-audits NOTHING (the
   *  covered engines are CSS-invariant — there is a tripwire test on that asymmetry); an
   *  add/unlink invalidates it to re-seed. `_data` edits aren't watched, so a cold re-seed
   *  re-audits all. */
  readonly audit: Lazy<Map<string, AuditedSlice>>;
  /** While a seed runs: the components edited during it, re-audited before the seed is stored. */
  auditSeeding: Set<string> | null;
  /** Total components re-audited via the surgical HMR path. The incremental proof reads this:
   *  surgical means +1 per .hbs edit, +0 per .scss edit. */
  liveReauditCount: number;

  /** themeName → compiled CSS. Mutated, never replaced. */
  readonly themeCss: Map<string, string>;
  /** themeName → { "--slot": value | null }. Populated at startup and on HMR recompile. */
  readonly themeTokens: Map<string, Record<string, string | null>>;
  /** scriptId → its compiled JS, a lazy cache per script (lazy.ts): compiled on first request,
   *  invalidated by the watcher on a change. Through `scriptFor` only. */
  readonly scripts: Map<string, Lazy<string>>;
}

/** A ServerState with empty caches and nothing indexed yet. The initial index build fills it. */
export function createServerState(): ServerState {
  return {
    lastComponentId: "",
    scssModuleGraph: null,
    classOwnerIndex: null,
    baseProvenance: null,
    scssGraphDirty: true,
    perComponentCss: new Map<string, string>(),
    baseCss: "",
    baseCssVersion: 0,
    discovery: createLazy<DiscoveryResult>("discovery", { slow: { afterMs: DISCOVERY_SLOW_MS, what: "the component index" } }),
    audit: createLazy<Map<string, AuditedSlice>>("audit"),
    auditSeeding: null,
    liveReauditCount: 0,
    themeCss: new Map<string, string>(),
    themeTokens: new Map<string, Record<string, string | null>>(),
    scripts: new Map<string, Lazy<string>>(),
  };
}

/** What a full re-index changed, for the HMR path to broadcast. */
export interface StyleDataChanges {
  /** Components whose own-origin CSS differs from before (added, changed or emptied). */
  changedComponents: string[];
  /** True when the base layer's CSS differs from before. */
  baseChanged: boolean;
}

/** Install a full style build into the state and report what changed. The single place that
 *  reassigns `perComponentCss` (hazard 3). The first build is not a change: nothing is on screen yet. */
export function applyStyleData(state: ServerState, data: AllStyleData): StyleDataChanges {
  const firstBuild = state.classOwnerIndex === null;
  const before = state.perComponentCss;
  const changedComponents: string[] = [];
  if (!firstBuild) {
    for (const id of new Set([...before.keys(), ...data.componentCssMap.keys()])) {
      if ((before.get(id) ?? "") !== (data.componentCssMap.get(id) ?? "")) changedComponents.push(id);
    }
  }
  const baseChanged = !firstBuild && state.baseCss !== data.baseCss;
  if (baseChanged) state.baseCssVersion += 1;

  state.scssModuleGraph = data.scssModuleGraph;
  state.classOwnerIndex = data.classOwnerIndex;
  state.baseProvenance = data.baseProvenance;
  state.perComponentCss = data.componentCssMap;
  state.baseCss = data.baseCss;
  state.scssGraphDirty = false;
  return { changedComponents: changedComponents.sort(), baseChanged };
}

/** The compiled script `scriptId`, as a lazy cache: a compile that a save overtook is never stored. */
export function scriptFor(state: ServerState, scriptId: string): Lazy<string> {
  let script = state.scripts.get(scriptId);
  if (!script) {
    script = createLazy<string>(`script:${scriptId}`);
    state.scripts.set(scriptId, script);
  }
  return script;
}

/** How long a request waits for discovery before the terminal says why. */
export const DISCOVERY_SLOW_MS = 5_000;

/** Drop the discovery (and with it the composition registry derived from it): the next caller builds anew. */
export function invalidateDiscovery(state: ServerState): void {
  state.discovery.invalidate();
}

// Each discovery's composition registry, built once for it. The registry is derived from a discovery's
// templates, so it is keyed by the discovery object: a request's registry always matches the discovery it
// took, and an .hbs or .json edit, which invalidates the discovery, gets a new one with the next discovery.
// Nothing stores a registry in the state, so none can outlive its discovery.
const registries = new WeakMap<DiscoveryResult, Promise<CompositionRegistry>>();

/** The composition registry of `discovery`, built on first use. A build that fails is dropped. */
export function compositionFor(
  state: ServerState, discovery: DiscoveryResult, patternDirs: string | readonly string[],
): Promise<CompositionRegistry> {
  let registry = registries.get(discovery);
  if (!registry) {
    const built = buildCompositionRegistry(patternDirs, discovery.handleMap, discovery.discoveryMap).then(async r => {
      await testHook()?.("composition", "built", () => invalidateDiscovery(state));
      return r;
    });
    registry = built;
    registries.set(discovery, built);
    built.catch(() => { if (registries.get(discovery) === built) registries.delete(discovery); });
  }
  return registry;
}

/** Make `dr` the current discovery (startup, a full rebuild that has its result already). */
export function setDiscovery(state: ServerState, dr: DiscoveryResult): void {
  state.discovery.set(dr);
}

/** Drop the discovery and take a new one, built after this call: a structural change (a file added or
 *  removed) needs one that has seen it. */
export function rebuildDiscovery(state: ServerState, roots: string | PatternRoot[]): Promise<DiscoveryResult> {
  invalidateDiscovery(state);
  return currentDiscovery(state, roots);
}

/** The current discovery, building it when there is none. Take it once and use the result. */
export function currentDiscovery(state: ServerState, roots: string | PatternRoot[]): Promise<DiscoveryResult> {
  return state.discovery.get(() => buildDiscoveryMap(roots));
}

/** The current discovery if there is one (built or building), never starting a build; null otherwise,
 *  or when that build failed. */
export function cachedDiscovery(state: ServerState): Promise<DiscoveryResult | null> {
  return state.discovery.peek();
}

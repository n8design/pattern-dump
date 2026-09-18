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
// `themeCss`, `themeTokens` and `scriptCache` are `readonly` because they are only ever mutated,
// never replaced — the type records that difference rather than leaving it to convention.

import type { DiscoveryResult } from "@pattern-dump/contracts";
import type { CompositionRegistry } from "./composition.js";
import type { ComponentAudit } from "./diagnostics.js";
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

  /** Rebuilt on HBS/JSON changes. */
  compositionRegistry: CompositionRegistry | null;
  /** Rebuilt alongside the composition registry. */
  discoveryResult: DiscoveryResult | null;

  /** In-memory per-component audit slices.
   *  Seeded on the first /api/audit (hash-delta vs disk), then patched surgically by the watcher:
   *  a .hbs/.json edit re-audits exactly that component; a .scss edit re-audits NOTHING (the
   *  covered engines are CSS-invariant — there is a tripwire test on that asymmetry); an
   *  add/unlink drops the cache to re-seed. `_data` edits aren't watched, so a cold re-seed
   *  re-audits all. */
  auditSlices: Map<string, ComponentAudit> | null;
  /** Total components re-audited via the surgical HMR path. The incremental proof reads this:
   *  surgical means +1 per .hbs edit, +0 per .scss edit. */
  liveReauditCount: number;

  /** themeName → compiled CSS. Mutated, never replaced. */
  readonly themeCss: Map<string, string>;
  /** themeName → { "--slot": value | null }. Populated at startup and on HMR recompile. */
  readonly themeTokens: Map<string, Record<string, string | null>>;
  /** scriptId → compiled JS. Invalidated on change, compiled on first request. */
  readonly scriptCache: Map<string, string>;
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
    compositionRegistry: null,
    discoveryResult: null,
    auditSlices: null,
    liveReauditCount: 0,
    themeCss: new Map<string, string>(),
    themeTokens: new Map<string, Record<string, string | null>>(),
    scriptCache: new Map<string, string>(),
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

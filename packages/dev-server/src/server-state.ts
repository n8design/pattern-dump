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
//     would hold the wrong map forever. Only the initial build reassigns it today; a future
//     re-index would need the same care.
//
// `themeCss`, `themeTokens` and `scriptCache` are `readonly` because they are only ever mutated,
// never replaced — the type records that difference rather than leaving it to convention.

import type { DiscoveryResult } from "@pattern-dump/contracts";
import type { CompositionRegistry } from "./composition.js";
import type { ComponentAudit } from "./diagnostics.js";
import type {
  ScssModuleGraph, ClassOwnerIndex, BaseProvenanceIndex,
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
    compositionRegistry: null,
    discoveryResult: null,
    auditSlices: null,
    liveReauditCount: 0,
    themeCss: new Map<string, string>(),
    themeTokens: new Map<string, Record<string, string | null>>(),
    scriptCache: new Map<string, string>(),
  };
}

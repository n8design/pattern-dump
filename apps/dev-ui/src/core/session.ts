// The shell's ephemeral runtime state, in one place.
//
// These bindings were module-level `let`s in main.ts. Sharing them by module scope worked while
// everything lived in one file, but it is exactly what makes the regions inseparable — no region can
// move while it reads a binding only main.ts declares. One object shared by reference gives the same
// sharing through an explicit, typed seam.
//
// THE SPLIT AGAINST store.ts — state this rule, or it rots:
//
//   store.ts   owns state that SURVIVES A RELOAD — URL + localStorage: theme, dock tab, panel tab,
//              nav filters, nav open paths, splitter dims, viewport mode, CVD. It round-trips
//              through toJSON/fromJSON and has 30 tests pinning that.
//   session.ts owns state that DIES WITH THE PAGE — the loaded corpus, the current selection, and
//              the caches derived from them. None of it is serialised, and none of it should be:
//              `current` alone is a whole ComponentDetail payload.
//
// WHAT DELIBERATELY IS NOT HERE: state used by exactly one region stays private to that region, so
// this bag does not become a dumping ground.
//   - `scanGen` — a generation counter read only by runRenderedA11yScan. It and its scan MUST stay
//     in one module: the counter is how superseded scans are discarded, and splitting them would
//     silently let a stale scan write its results.
//   - `auditState` / `auditRollup` — only the audit facet touches them.
//   - `vpDisco*` — only the viewport sweep.
//   - `fpIdleTimer` / `fullpageUnsubscribe` — only the full-page dialog. The latter holds a
//     store.subscribe() disposer, so mis-moving it leaks a subscription.
//
// A RECORD, NOT A CLASS: every field is genuinely shared mutable state written from several
// directions (navigation, HMR, user input). Methods would imply invariants this code does not have.
//
// NARROWING: `if (!session.current) return;` narrows correctly, including across `await`. That was
// verified rather than assumed — the whole rewrite was simulated against an imported probe object
// before it was made, and the typechecker reported zero narrowing failures.

import type {
  A11yDiagnostic, ComponentDetail, ComponentTree, ThemeSummary, ThemeSwitch,
} from "@pattern-dump/contracts";

interface ComponentMeta {
  title: string;
  category: string;
  visibility?: "public" | "private";
  /** The pattern package the component comes from; absent for the project's own. */
  source?: string;
  origin?: "local" | { namespace: string };
}

export interface Session {
  // ---- Corpus: loaded at boot, replaced on a tree-changed HMR broadcast ----
  tree: ComponentTree;
  /** id -> metadata. MUTATED IN PLACE (cleared and refilled), never reassigned — hence readonly.
   *  Copying it instead of sharing the reference would leave regions reading a stale corpus. */
  readonly componentRegistry: Map<string, ComponentMeta>;
  navCategoryOrder: Map<string, number>;
  themes: ThemeSummary[];

  // ---- Server-declared config, read once from /api/config and never changed after ----
  themeSwitch: ThemeSwitch;
  /** The project's configured default theme. The preview falls back to it whenever no explicit
   *  theme is chosen, so this is what the shell must REPORT even though store.local.theme is "". */
  serverDefaultTheme: string;
  /** Rule ids whose verdict needs a rendered scan; from /_pd/rule-tiers.json. */
  needsRenderingRules: string[];

  // ---- Selection ----
  current: ComponentDetail | null;
  currentVariant: string | null;
  stageMode: "single" | "variants";
  /** Deliberately NOT persisted — see view-state-store.spec.ts, which pins that a search does not
   *  survive a reload. It lives here precisely so it cannot drift into store.ts. */
  searchQuery: string;

  // ---- Per-selection source caches, invalidated together on every selection change ----
  renderedHtmlCache: string | null;
  rawRenderedHtml: string | null;
  dataCache: string | null;
  dataRaw: string | null;

  // ---- Rendered a11y tier ----
  renderedA11y: A11yDiagnostic[];
  /** True while a scan is in flight. Lives here, unlike scanGen, because refreshDiagnostics reads
   *  it from a different region than the one that runs the scan. */
  scanPending: boolean;

  // ---- Preview measurement ----
}

/** The single shell session. One page, one object. */
export const session: Session = {
  tree: { roots: [] },
  componentRegistry: new Map<string, ComponentMeta>(),
  navCategoryOrder: new Map<string, number>(),
  themes: [],
  themeSwitch: "attribute",
  serverDefaultTheme: "",
  needsRenderingRules: [],
  current: null,
  currentVariant: null,
  stageMode: "single",
  searchQuery: "",
  renderedHtmlCache: null,
  rawRenderedHtml: null,
  dataCache: null,
  dataRaw: null,
  renderedA11y: [],
  scanPending: false,
};

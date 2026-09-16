// @pattern-dump/dev-ui — view-state store (M7)
// Internal dev-ui shape only — NOT a @pattern-dump/contracts protocol. No external consumers.
//
// Two tiers, no session tier:
//   localStorage — personal preferences (theme, dims, tabs, nav state)
//   URL          — view-driving, shareable state (pattern, variant, viewport, cvd)
//
// One reconciliation rule (principle 6):
//   A persisted child that no longer resolves against its current parent falls back to default.
//   All five cases flow through reconcile() — not per-key guards.

// ─── URL-canonical types ──────────────────────────────────────────────────

import { routeFromPathname } from "./runtime.js";

/** Known ?vp= tokens. Absent or unrecognised → "fit". "fullscreen" opens the full-page dialog. */
export type VpMode = "fit" | "content" | "mobile" | "tablet" | "desktop" | "fullscreen";

export const KNOWN_VP_MODES = new Set<string>(["fit", "content", "mobile", "tablet", "desktop", "fullscreen"]);

/** Colour-vision deficiency type. "none" = no filter. */
export type CvdType = "none" | "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

export const KNOWN_CVD_TYPES = new Set<string>(
  ["none", "protanopia", "deuteranopia", "tritanopia", "achromatopsia"]
);

/**
 * CVD simulator state — session + URL only, never localStorage.
 * URL serialisation: ?cvd=type:severity (omitted when type is "none").
 * Severity 0–1; ignored (and slider hidden) when type is "none".
 */
export interface CvdState {
  readonly type:     CvdType;
  readonly severity: number;
}

export const DEFAULT_CVD_STATE: CvdState = { type: "none", severity: 0 };

/**
 * Everything the URL carries that drives the view.
 * themeOverride is NOT here — it is a hydrate-time input to reconcile(), never a settled field.
 */
export interface UrlState {
  /** pathname sans leading /, e.g. "atoms/button". null = root / nothing selected. */
  readonly pattern: string | null;
  /**
   * location.hash sans #, e.g. "ghost". null = default variant.
   * Reconcile rule 1: if variant ∉ availableVariants → null (clear hash).
   */
  readonly variant: string | null;
  /** ?vp= token. Absent or unrecognised → "fit" (reconcile rule 3). */
  readonly viewport: VpMode;
  /** ?cvd=type:severity. Session only — never written to localStorage. */
  readonly cvd: CvdState;
}

// ─── localStorage-canonical types ────────────────────────────────────────

/**
 * Dock-tab state encodes the parent→child invariant STRUCTURALLY.
 * sourceFacet is only legal when dockTab === "source".
 * The union prevents invalid combinations at the type level;
 * deserializeLocalState normalises raw stored JSON into this type.
 */
export type DockState =
  | { readonly dockTab: "source"; readonly sourceFacet: "hbs" | "data" | "schema" }
  | { readonly dockTab: "html" | "diagnostics" | "console"; readonly sourceFacet?: never };

/**
 * Layout dimensions as CSS vw/vh strings (e.g. "20.00vw").
 * "" = not set (no custom property applied; natural size governs).
 * pd-sidebar-w / pd-panel-w / pd-dock-h (the console dock height — NOT viewport height).
 */
export interface LayoutDims {
  readonly sidebarW: string;
  readonly panelW:   string;
  readonly dockH:    string;
}

/**
 * Open/closed state for the two independently-toggleable docks.
 * Right panel: existing .panel-toggle + mainEl.dataset.panelOpen — not yet persisted.
 * Console dock: new toggle added in the dock-visibility commit.
 */
export interface DockVisibility {
  readonly rightPanelOpen:  boolean;
  readonly consoleDockOpen: boolean;
}

/**
 * Nav content filters. Extensible record — new filters are added fields, not a type reshape.
 * Unknown fields from older stored state are dropped by deserializeLocalState (not spread).
 */
export interface NavFilters {
  readonly showPrivate: boolean;
  /** Hide components that come from pattern packages (they stay usable in compositions). */
  readonly hidePackages: boolean;
  // EXTENSION POINT — future: showStyleGuideOnly?: boolean;
}

/**
 * Everything that lives in localStorage.
 * navOpenPaths is ReadonlySet<string> at runtime; string[] on disk (see SerializedLocalState).
 */
export interface LocalState {
  /** "pd-theme" sessionStorage → localStorage. "" = no theme. */
  readonly theme:          string;
  /** pd-sidebar-w / pd-panel-w / pd-dock-h (sessionStorage → localStorage). */
  readonly dims:           LayoutDims;
  readonly dockVisibility: DockVisibility;
  /** activeTab. "audit" = the corpus diagnostics facet (selection-independent; Phase 2). */
  readonly panelTab:       "docs" | "relationships" | "audit";
  /** dockTab + sourceFacet — structural union (see DockState). */
  readonly dock:           DockState;
  /**
   * Full-depth set of expanded organisational folder node-paths.
   * Keyed by folder path (e.g. "atoms", "molecules/forms") — not pattern handles.
   * Runtime: Set<string>. Stored: string[] (see SerializedLocalState).
   */
  readonly navOpenPaths:   ReadonlySet<string>;
  readonly navFilters:     NavFilters;
}

// ─── Serialized shape (localStorage JSON round-trip) ─────────────────────

/**
 * What is written to localStorage. Differs from LocalState ONLY in navOpenPaths type:
 * Set<string> cannot survive JSON.stringify (serialises to {}).
 * The store's toJSON/fromJSON are the ONLY conversion points — callers always work with LocalState.
 */
export interface SerializedLocalState {
  readonly theme:          string;
  readonly dims:           LayoutDims;
  readonly dockVisibility: { readonly rightPanelOpen?: unknown; readonly consoleDockOpen?: unknown };
  readonly panelTab:       unknown;
  readonly dock:           { readonly dockTab?: unknown; readonly sourceFacet?: unknown };
  readonly navOpenPaths:   unknown;  // string[] on disk; validated on read
  readonly navFilters:     { readonly showPrivate?: unknown; readonly hidePackages?: unknown };
}

// ─── Reconcile context ────────────────────────────────────────────────────

/**
 * Runtime context needed to validate stored values against the current corpus state.
 * availableVariants: null = not yet known (skip variant reconcile — used during initial hydrate
 * before any component is loaded). [] = component has no variants (clear any stored variant).
 */
export interface ReconcileContext {
  readonly availableVariants: readonly string[] | null;
  readonly knownFolderPaths:  ReadonlySet<string>;
  readonly knownThemes:       ReadonlySet<string>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_URL_STATE: UrlState = {
  pattern:  null,
  variant:  null,
  viewport: "fit",
  cvd:      DEFAULT_CVD_STATE,
};

export const DEFAULT_LOCAL_STATE: LocalState = {
  theme:          "",
  dims:           { sidebarW: "", panelW: "", dockH: "" },
  dockVisibility: { rightPanelOpen: false, consoleDockOpen: true },
  panelTab:       "docs",
  dock:           { dockTab: "source", sourceFacet: "hbs" },
  navOpenPaths:   new Set(),
  navFilters:     { showPrivate: false, hidePackages: false },
};

// ─── Storage key ──────────────────────────────────────────────────────────

export const STORAGE_KEY = "pd-view-state";

// ─── Serialization (exported for unit tests) ─────────────────────────────

export function toJSON(local: LocalState): string {
  return JSON.stringify({
    theme:          local.theme,
    dims:           local.dims,
    dockVisibility: local.dockVisibility,
    panelTab:       local.panelTab,
    dock:           local.dock,
    navOpenPaths:   [...local.navOpenPaths],  // Set → Array (sole conversion point)
    navFilters:     local.navFilters,
  });
}

function deserializeLocalState(raw: Partial<SerializedLocalState>): LocalState {
  const theme = typeof raw.theme === "string" ? raw.theme : DEFAULT_LOCAL_STATE.theme;

  const rawDims = raw.dims as Record<string, unknown> | undefined;
  const dims: LayoutDims = {
    sidebarW: typeof rawDims?.sidebarW === "string" ? rawDims.sidebarW : DEFAULT_LOCAL_STATE.dims.sidebarW,
    panelW:   typeof rawDims?.panelW   === "string" ? rawDims.panelW   : DEFAULT_LOCAL_STATE.dims.panelW,
    dockH:    typeof rawDims?.dockH    === "string" ? rawDims.dockH    : DEFAULT_LOCAL_STATE.dims.dockH,
  };

  const rawVis = raw.dockVisibility;
  const dockVisibility: DockVisibility = {
    rightPanelOpen:  typeof rawVis?.rightPanelOpen  === "boolean" ? rawVis.rightPanelOpen  : DEFAULT_LOCAL_STATE.dockVisibility.rightPanelOpen,
    consoleDockOpen: typeof rawVis?.consoleDockOpen === "boolean" ? rawVis.consoleDockOpen : DEFAULT_LOCAL_STATE.dockVisibility.consoleDockOpen,
  };

  const panelTab: "docs" | "relationships" | "audit" =
    raw.panelTab === "docs" || raw.panelTab === "relationships" || raw.panelTab === "audit"
      ? raw.panelTab
      : DEFAULT_LOCAL_STATE.panelTab;

  // DockState structural union — sourceFacet only when dockTab === "source"
  const rawDock = raw.dock;
  let dock: DockState;
  if (rawDock?.dockTab === "source") {
    const sf = rawDock.sourceFacet;
    dock = {
      dockTab:     "source",
      sourceFacet: (sf === "hbs" || sf === "data" || sf === "schema") ? sf : "hbs",
    };
  } else if (
    rawDock?.dockTab === "html" ||
    rawDock?.dockTab === "diagnostics" ||
    rawDock?.dockTab === "console"
  ) {
    dock = { dockTab: rawDock.dockTab };
  } else {
    dock = DEFAULT_LOCAL_STATE.dock;
  }

  // navOpenPaths: Array → Set (sole conversion point); non-string entries dropped
  const rawPaths = raw.navOpenPaths;
  const navOpenPaths: Set<string> = Array.isArray(rawPaths)
    ? new Set((rawPaths as unknown[]).filter((p): p is string => typeof p === "string"))
    : new Set<string>();

  // navFilters: only known keys copied; unknown fields from older stored state are dropped
  const rawFilters = raw.navFilters;
  const navFilters: NavFilters = {
    showPrivate: typeof rawFilters?.showPrivate === "boolean"
      ? rawFilters.showPrivate
      : DEFAULT_LOCAL_STATE.navFilters.showPrivate,
    hidePackages: typeof rawFilters?.hidePackages === "boolean"
      ? rawFilters.hidePackages
      : DEFAULT_LOCAL_STATE.navFilters.hidePackages,
  };

  return { theme, dims, dockVisibility, panelTab, dock, navOpenPaths, navFilters };
}

export function fromJSON(json: string): LocalState | null {
  try {
    return deserializeLocalState(JSON.parse(json) as Partial<SerializedLocalState>);
  } catch {
    return null;
  }
}

// ─── URL parsing ──────────────────────────────────────────────────────────

/** Parse ?cvd=type:severity into a CvdState. Returns DEFAULT_CVD_STATE for absent or invalid input. */
export function parseCvd(raw: string | null): CvdState {
  if (!raw) return DEFAULT_CVD_STATE;
  const colon = raw.indexOf(":");
  const typeRaw = colon === -1 ? raw : raw.slice(0, colon);
  const sevRaw  = colon === -1 ? ""  : raw.slice(colon + 1);
  const type    = KNOWN_CVD_TYPES.has(typeRaw) ? (typeRaw as CvdType) : "none";
  const severity = Math.min(1, Math.max(0, parseFloat(sevRaw) || 0));
  return { type, severity };
}

/** Parse window.location into a UrlState. Does not read themeOverride — that is hydrate-only. */
export function parseUrlState(location: Pick<Location, "pathname" | "hash" | "search">): UrlState {
  const raw = routeFromPathname(location.pathname).slice(1);
  const pattern = raw || null;
  const hash = location.hash.slice(1);
  const variant = hash || null;
  const params  = new URLSearchParams(location.search);
  const vpRaw   = params.get("vp");
  const viewport: VpMode = (vpRaw !== null && KNOWN_VP_MODES.has(vpRaw)) ? (vpRaw as VpMode) : "fit";
  const cvd = parseCvd(params.get("cvd"));
  return { pattern, variant, viewport, cvd };
}

// ─── Reconcile — THE SINGLE RULE ─────────────────────────────────────────

/**
 * Applies the single reconciliation rule uniformly:
 *   "A persisted child that no longer resolves against its current parent falls back to default."
 *
 * Cases:
 *   1. variant ∉ availableVariants → null  (skipped when availableVariants is null = unknown)
 *   2. sourceFacet ⊂ dockTab — enforced structurally by DockState union in deserializeLocalState;
 *      no runtime check needed here.
 *   3. unknown ?vp= → "fit"  (also: fullscreen without a pattern → "fit")
 *   4. vanished navOpenPaths → dropped
 *   5. unknown navFilter flags → off  (handled by deserializeLocalState; not re-checked here)
 *
 * themeOverride is a hydrate-time input (from ?theme= on the SPA URL), never part of UrlState.
 * If present and valid: written through to local.theme; stripThemeParam signals the caller to
 * history.replaceState stripping ?theme= from the SPA URL.
 */
export function reconcile(
  url:           UrlState,
  local:         LocalState,
  ctx:           ReconcileContext,
  themeOverride: string | null = null,
): { url: UrlState; local: LocalState; stripThemeParam: boolean } {
  // Rule 1: variant ∉ availableVariants → null
  let variant = url.variant;
  if (variant !== null && ctx.availableVariants !== null) {
    if (!ctx.availableVariants.includes(variant)) variant = null;
  }

  // Rule 3: unknown ?vp= → "fit"; fullscreen without pattern → "fit"
  let viewport: VpMode = KNOWN_VP_MODES.has(url.viewport) ? url.viewport : "fit";
  if (viewport === "fullscreen" && url.pattern === null) viewport = "fit";

  // Rule 4: vanished navOpenPaths → dropped
  const navOpenPaths = new Set<string>(
    [...local.navOpenPaths].filter(p => ctx.knownFolderPaths.has(p))
  );

  // themeOverride one-shot: write through to theme, signal caller to strip param
  let theme = local.theme;
  let stripThemeParam = false;
  if (themeOverride !== null && ctx.knownThemes.has(themeOverride)) {
    theme = themeOverride;
    stripThemeParam = true;
  }

  return {
    url:   { ...url, variant, viewport },
    local: { ...local, theme, navOpenPaths },
    stripThemeParam,
  };
}

// ─── Store interface ───────────────────────────────────────────────────────

export interface ViewStateStore {
  readonly local: LocalState;
  /** Parsed view of the current URL. Updated by setUrl() and hydrate(); never written to localStorage. */
  readonly url: UrlState;
  /**
   * Update a subset of localStorage state. Merges at the top level; callers must spread nested
   * objects when updating a single nested field:
   *   store.setLocal({ dims: { ...store.local.dims, sidebarW: val } })
   * Serializes and persists to localStorage; notifies all subscribers.
   */
  setLocal(patch: Partial<LocalState>): void;
  /**
   * Update the in-memory parsed URL state and notify subscribers.
   * Does NOT touch window.location — callers manage history.pushState/replaceState themselves.
   */
  setUrl(patch: Partial<UrlState>): void;
  /** Subscribe to all state changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
  /**
   * Read window.location + localStorage, run reconcile, apply, persist, notify.
   * Also reads ?theme= from the SPA URL as themeOverride (hydrate-time input to reconcile).
   * Returns true if a ?theme= param was present and valid — caller should replaceState to strip it.
   * Pass availableVariants: null on initial load (component not yet fetched); pass the real list
   * after navigation to reconcile the variant against the loaded component's actual variants.
   */
  hydrate(ctx: ReconcileContext): boolean;
}

// ─── createStore ──────────────────────────────────────────────────────────

export function createStore(): ViewStateStore {
  let local: LocalState = { ...DEFAULT_LOCAL_STATE, navOpenPaths: new Set() };
  let url: UrlState = { ...DEFAULT_URL_STATE };
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const fn of listeners) fn();
  }

  function persist(state: LocalState): void {
    try {
      localStorage.setItem(STORAGE_KEY, toJSON(state));
    } catch {
      // localStorage unavailable or quota exceeded — state is still live in memory
    }
  }

  const storeObj: ViewStateStore = {
    get local() { return local; },
    get url()   { return url; },

    setLocal(patch) {
      local = { ...local, ...patch };
      persist(local);
      notify();
    },

    setUrl(patch) {
      url = { ...url, ...patch };
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    hydrate(ctx) {
      const parsedUrl = parseUrlState(window.location);
      const themeOverride = new URLSearchParams(window.location.search).get("theme");

      const stored = localStorage.getItem(STORAGE_KEY);
      const storedLocal = stored !== null ? (fromJSON(stored) ?? { ...DEFAULT_LOCAL_STATE, navOpenPaths: new Set<string>() }) : { ...DEFAULT_LOCAL_STATE, navOpenPaths: new Set<string>() };

      const { url: reconciledUrl, local: reconciledLocal, stripThemeParam } =
        reconcile(parsedUrl, storedLocal, ctx, themeOverride);

      url = reconciledUrl;
      local = reconciledLocal;
      persist(local);
      notify();

      return stripThemeParam;
    },
  };

  return storeObj;
}

/** Singleton store — imported by main.ts. */
export const store: ViewStateStore = createStore();

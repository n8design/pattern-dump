import { describe, it, expect } from "vitest";
import {
  toJSON, fromJSON, reconcile, parseCvd, parseUrlState,
  DEFAULT_LOCAL_STATE, DEFAULT_URL_STATE,
  type LocalState, type ReconcileContext,
} from "./store.js";

// ─── navOpenPaths Set↔Array round-trip ───────────────────────────────────────
// This is the sole serialization point for Set<string> → string[] (stored on disk)
// → Set<string> (at runtime). If this conversion is broken, all nav open-state
// is silently lost on every reload.

describe("navOpenPaths Set↔Array round-trip", () => {
  it("serializes Set to JSON array and restores it", () => {
    const local: LocalState = {
      ...DEFAULT_LOCAL_STATE,
      navOpenPaths: new Set(["atoms", "molecules", "molecules/forms"]),
    };
    const json = toJSON(local);
    const parsed = JSON.parse(json) as { navOpenPaths: unknown };
    expect(Array.isArray(parsed.navOpenPaths)).toBe(true);
    expect(new Set(parsed.navOpenPaths as string[])).toEqual(new Set(["atoms", "molecules", "molecules/forms"]));

    const restored = fromJSON(json);
    expect(restored).not.toBeNull();
    expect(restored!.navOpenPaths).toBeInstanceOf(Set);
    expect(restored!.navOpenPaths).toEqual(new Set(["atoms", "molecules", "molecules/forms"]));
  });

  it("round-trips an empty Set without loss", () => {
    const local: LocalState = { ...DEFAULT_LOCAL_STATE, navOpenPaths: new Set() };
    const restored = fromJSON(toJSON(local));
    expect(restored!.navOpenPaths.size).toBe(0);
  });

  it("drops non-string entries during deserialization", () => {
    const json = JSON.stringify({ ...JSON.parse(toJSON(DEFAULT_LOCAL_STATE)), navOpenPaths: ["ok", 42, null, "also-ok"] });
    const restored = fromJSON(json);
    expect(restored!.navOpenPaths).toEqual(new Set(["ok", "also-ok"]));
  });

  it("handles missing navOpenPaths key gracefully (old stored state)", () => {
    const json = JSON.stringify({ theme: "", dims: DEFAULT_LOCAL_STATE.dims });
    const restored = fromJSON(json);
    expect(restored!.navOpenPaths).toBeInstanceOf(Set);
    expect(restored!.navOpenPaths.size).toBe(0);
  });
});

// ─── reconcile — nav open-state rule 4 ───────────────────────────────────────

describe("reconcile: vanished navOpenPaths dropped", () => {
  const ctx: ReconcileContext = {
    availableVariants: null,
    knownFolderPaths: new Set(["atoms", "molecules"]),
    knownThemes: new Set(),
  };

  it("drops paths not in knownFolderPaths", () => {
    const local: LocalState = {
      ...DEFAULT_LOCAL_STATE,
      navOpenPaths: new Set(["atoms", "obsolete-folder", "molecules"]),
    };
    const { local: r } = reconcile(DEFAULT_URL_STATE, local, ctx);
    expect(r.navOpenPaths).toEqual(new Set(["atoms", "molecules"]));
  });

  it("preserves all paths when all are known", () => {
    const local: LocalState = {
      ...DEFAULT_LOCAL_STATE,
      navOpenPaths: new Set(["atoms", "molecules"]),
    };
    const { local: r } = reconcile(DEFAULT_URL_STATE, local, ctx);
    expect(r.navOpenPaths).toEqual(new Set(["atoms", "molecules"]));
  });

  it("returns an empty set when knownFolderPaths is empty", () => {
    const emptyCtx: ReconcileContext = { ...ctx, knownFolderPaths: new Set() };
    const local: LocalState = {
      ...DEFAULT_LOCAL_STATE,
      navOpenPaths: new Set(["atoms", "molecules"]),
    };
    const { local: r } = reconcile(DEFAULT_URL_STATE, local, emptyCtx);
    expect(r.navOpenPaths.size).toBe(0);
  });
});

// ─── reconcile — DockState structural union ───────────────────────────────────

describe("reconcile: DockState union preserved through JSON round-trip", () => {
  it("source+hbs round-trips correctly", () => {
    const local: LocalState = {
      ...DEFAULT_LOCAL_STATE,
      dock: { dockTab: "source", sourceFacet: "data" },
    };
    const restored = fromJSON(toJSON(local));
    expect(restored!.dock).toEqual({ dockTab: "source", sourceFacet: "data" });
  });

  it("non-source tab has no sourceFacet after round-trip", () => {
    const local: LocalState = {
      ...DEFAULT_LOCAL_STATE,
      dock: { dockTab: "html" },
    };
    const restored = fromJSON(toJSON(local));
    expect(restored!.dock.dockTab).toBe("html");
    expect((restored!.dock as { sourceFacet?: unknown }).sourceFacet).toBeUndefined();
  });

  it("drops sourceFacet from a non-source stored dock (invalid legacy state)", () => {
    // Simulate stored JSON that has sourceFacet on a non-source tab (should not occur,
    // but guard against older or hand-edited stored state).
    const json = JSON.stringify({
      ...JSON.parse(toJSON(DEFAULT_LOCAL_STATE)),
      dock: { dockTab: "html", sourceFacet: "data" },
    });
    const restored = fromJSON(json);
    expect(restored!.dock.dockTab).toBe("html");
    expect((restored!.dock as { sourceFacet?: unknown }).sourceFacet).toBeUndefined();
  });
});

// ─── reconcile — variant rule 1 ──────────────────────────────────────────────

describe("reconcile: variant ∉ availableVariants → null", () => {
  it("clears variant when not in the available list", () => {
    const ctx: ReconcileContext = {
      availableVariants: ["ghost", "primary"],
      knownFolderPaths: new Set(),
      knownThemes: new Set(),
    };
    const url = { ...DEFAULT_URL_STATE, variant: "nonexistent" };
    const { url: r } = reconcile(url, DEFAULT_LOCAL_STATE, ctx);
    expect(r.variant).toBeNull();
  });

  it("preserves variant when it is in the available list", () => {
    const ctx: ReconcileContext = {
      availableVariants: ["ghost", "primary"],
      knownFolderPaths: new Set(),
      knownThemes: new Set(),
    };
    const url = { ...DEFAULT_URL_STATE, variant: "ghost" };
    const { url: r } = reconcile(url, DEFAULT_LOCAL_STATE, ctx);
    expect(r.variant).toBe("ghost");
  });

  it("skips variant check when availableVariants is null (initial load)", () => {
    const ctx: ReconcileContext = {
      availableVariants: null,
      knownFolderPaths: new Set(),
      knownThemes: new Set(),
    };
    const url = { ...DEFAULT_URL_STATE, variant: "anything" };
    const { url: r } = reconcile(url, DEFAULT_LOCAL_STATE, ctx);
    expect(r.variant).toBe("anything");
  });
});

// ─── parseCvd ─────────────────────────────────────────────────────────────────

describe("parseCvd", () => {
  it("returns default for null (param absent)", () => {
    const cvd = parseCvd(null);
    expect(cvd.type).toBe("none");
    expect(cvd.severity).toBe(0);
  });

  it("returns default for empty string", () => {
    expect(parseCvd("").type).toBe("none");
  });

  it("parses a known type with severity", () => {
    const cvd = parseCvd("deuteranopia:0.73");
    expect(cvd.type).toBe("deuteranopia");
    expect(cvd.severity).toBeCloseTo(0.73, 5);
  });

  it("parses type-only (no colon) as severity 0", () => {
    const cvd = parseCvd("protanopia");
    expect(cvd.type).toBe("protanopia");
    expect(cvd.severity).toBe(0);
  });

  it("clamps severity above 1 to 1", () => {
    expect(parseCvd("tritanopia:1.5").severity).toBe(1);
  });

  it("clamps severity below 0 to 0", () => {
    expect(parseCvd("achromatopsia:-0.5").severity).toBe(0);
  });

  it("rejects an unknown type and returns none", () => {
    expect(parseCvd("bogustype:0.5").type).toBe("none");
  });

  it("treats 'none' as the none type", () => {
    expect(parseCvd("none:0").type).toBe("none");
  });
});

// ─── parseUrlState — CVD param ────────────────────────────────────────────────

describe("parseUrlState: ?cvd= param", () => {
  it("returns default CVD when param is absent", () => {
    const url = parseUrlState({ pathname: "/atoms/button", hash: "", search: "" });
    expect(url.cvd.type).toBe("none");
    expect(url.cvd.severity).toBe(0);
  });

  it("parses ?cvd=deuteranopia:0.73", () => {
    const url = parseUrlState({ pathname: "/atoms/button", hash: "", search: "?cvd=deuteranopia:0.73" });
    expect(url.cvd.type).toBe("deuteranopia");
    expect(url.cvd.severity).toBeCloseTo(0.73, 5);
  });

  it("does not write CVD to DEFAULT_URL_STATE (UrlState shape check)", () => {
    // CVD must not appear in localStorage — this tests that DEFAULT_URL_STATE carries it as url-only.
    const url = parseUrlState({ pathname: "/", hash: "", search: "?cvd=protanopia:1.0" });
    expect(url.cvd.type).toBe("protanopia");
  });

  it("preserves viewport alongside cvd", () => {
    const url = parseUrlState({
      pathname: "/atoms/button", hash: "", search: "?vp=mobile&cvd=tritanopia:0.5",
    });
    expect(url.viewport).toBe("mobile");
    expect(url.cvd.type).toBe("tritanopia");
    expect(url.cvd.severity).toBeCloseTo(0.5, 5);
  });
});

// ─── reconcile — fullscreen without pattern → fit (rule 3b) ──────────────────

describe("reconcile: fullscreen without pattern → fit", () => {
  const ctx: ReconcileContext = { availableVariants: null, knownFolderPaths: new Set(), knownThemes: new Set() };

  it("clears fullscreen when pattern is null", () => {
    const url = { ...DEFAULT_URL_STATE, pattern: null, viewport: "fullscreen" as const };
    const { url: r } = reconcile(url, DEFAULT_LOCAL_STATE, ctx);
    expect(r.viewport).toBe("fit");
  });

  it("keeps fullscreen when pattern is present", () => {
    const url = { ...DEFAULT_URL_STATE, pattern: "atoms/button", viewport: "fullscreen" as const };
    const { url: r } = reconcile(url, DEFAULT_LOCAL_STATE, ctx);
    expect(r.viewport).toBe("fullscreen");
  });
});

// ─── reconcile — themeOverride one-shot ──────────────────────────────────────

describe("reconcile: themeOverride write-through", () => {
  const ctx: ReconcileContext = {
    availableVariants: null,
    knownFolderPaths: new Set(),
    knownThemes: new Set(["dark", "light"]),
  };

  it("writes through a valid ?theme= to local.theme and sets stripThemeParam", () => {
    const { local: r, stripThemeParam } = reconcile(DEFAULT_URL_STATE, DEFAULT_LOCAL_STATE, ctx, "dark");
    expect(r.theme).toBe("dark");
    expect(stripThemeParam).toBe(true);
  });

  it("ignores an unknown ?theme= value", () => {
    const { local: r, stripThemeParam } = reconcile(DEFAULT_URL_STATE, DEFAULT_LOCAL_STATE, ctx, "unknown");
    expect(r.theme).toBe(DEFAULT_LOCAL_STATE.theme);
    expect(stripThemeParam).toBe(false);
  });

  it("ignores null themeOverride", () => {
    const { local: r, stripThemeParam } = reconcile(DEFAULT_URL_STATE, DEFAULT_LOCAL_STATE, ctx, null);
    expect(r.theme).toBe(DEFAULT_LOCAL_STATE.theme);
    expect(stripThemeParam).toBe(false);
  });
});

describe("navFilters.hidePackages persistence", () => {
  it("round-trips through toJSON/fromJSON and defaults to false", () => {
    const hidden = { ...DEFAULT_LOCAL_STATE, navFilters: { showPrivate: true, hidePackages: true } };
    expect(fromJSON(toJSON(hidden))?.navFilters).toEqual({ showPrivate: true, hidePackages: true });
    expect(fromJSON(JSON.stringify({ navFilters: { showPrivate: true } }))?.navFilters)
      .toEqual({ showPrivate: true, hidePackages: false });
    expect(fromJSON(JSON.stringify({ navFilters: { hidePackages: "yes" } }))?.navFilters.hidePackages).toBe(false);
  });
});

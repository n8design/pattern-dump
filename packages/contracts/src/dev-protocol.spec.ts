// The first tests this package has had.
//
// contracts is the seam every other package builds against, and it shipped with zero tests — its
// script is `vitest run --passWithNoTests`, so the gate reported green on an empty suite. Types erase
// at build time, so the only things a runtime test CAN pin are the six executable exports; the type
// surface is guarded at the bottom by compile-time assertions instead.
//
// Colocated in src/ rather than a test/ dir on purpose: the package tsconfig includes only
// `src/**/*`, so a test/ directory would not be typechecked. The `production` named input excludes
// *.spec.ts, so this does not churn the build cache, and index.ts never imports it so it is not
// bundled.

import { describe, it, expect } from "vitest";
import {
  previewUrl, renderedSourceUrl, dataSourceUrl, overviewUrl,
  componentUrl, componentCssUrl, themeCssUrl, scriptUrl, PD_ROUTES, PD_ROUTE_PREFIX, PD_HOSTS,
  staticPathFor, normalizeBasePath,
  buildAuditRollup, AUDIT_SCOPE, PD_PROTOCOL_VERSION,
  type DiagnosticsGraph, type HmrMessage,
  type DiagnosticComponentNode, type DiagnosticOccurrence,
  type DiagnosticEngine, type RenderOutcome,
} from "./dev-protocol.js";

// ─── URL builders ────────────────────────────────────────────────────────────
// The invariant under test is builder/parser SYMMETRY. The server parses these with
// `pathname.slice(prefix.length)` and NO decode, so the id must arrive raw. A well-meaning
// encodeURIComponent(id) here would turn "/" into %2F and break every nested component.

describe("URL builders — the id must stay raw", () => {
  it("preserves the '/' in a nested component id", () => {
    expect(previewUrl("atoms/button")).toBe("/preview/atoms/button");
    expect(renderedSourceUrl("molecules/field")).toBe("/source/molecules/field/rendered");
    expect(dataSourceUrl("molecules/field")).toBe("/source/molecules/field/data");
    expect(overviewUrl("atoms/widgets")).toBe("/api/overview/atoms/widgets");
  });

  it("preserves the '~' in a variant id", () => {
    // "~" is unreserved in a URL and the server does not decode, so raw-in/raw-out is correct.
    expect(previewUrl("atoms/badge~info")).toBe("/preview/atoms/badge~info");
    expect(renderedSourceUrl("atoms/badge~info")).toBe("/source/atoms/badge~info/rendered");
  });

  it("never percent-encodes the id segment", () => {
    for (const url of [previewUrl("a/b~c"), renderedSourceUrl("a/b~c"), dataSourceUrl("a/b~c"), overviewUrl("a/b")]) {
      expect(url).not.toContain("%2F");
      expect(url).not.toContain("%7E");
    }
  });
});

describe("URL builders — query parameters", () => {
  it("omits the query entirely when no params are given", () => {
    expect(previewUrl("atoms/button")).not.toContain("?");
    expect(renderedSourceUrl("atoms/button")).not.toContain("?");
    expect(dataSourceUrl("atoms/button")).not.toContain("?");
  });

  it("treats an empty-string variant as absent", () => {
    // Documented: "An empty string or absent value uses the config default."
    expect(previewUrl("atoms/button", "")).toBe("/preview/atoms/button");
    expect(renderedSourceUrl("atoms/button", "")).toBe("/source/atoms/button/rendered");
    expect(dataSourceUrl("atoms/button", "")).toBe("/source/atoms/button/data");
  });

  it("ENCODES the variant and theme values, unlike the id", () => {
    // Values are parsed with url.searchParams, which decodes — so they must be encoded here.
    // This asymmetry with the id is the thing most likely to be 'tidied' into a bug.
    expect(previewUrl("a", "with space")).toBe("/preview/a?variant=with+space");
    expect(renderedSourceUrl("a", "with space")).toBe("/source/a/rendered?variant=with%20space");
    expect(dataSourceUrl("a", "a&b")).toBe("/source/a/data?variant=a%26b");
  });

  it("carries variant and theme together, variant first", () => {
    expect(previewUrl("a", "v", "dark")).toBe("/preview/a?variant=v&theme=dark");
  });

  it("carries theme alone", () => {
    expect(previewUrl("a", undefined, "dark")).toBe("/preview/a?theme=dark");
  });
});

// ─── Route table ─────────────────────────────────────────────────────────────
// Round-trip each builder through the SAME parse routes.ts performs (prefix slice; a decode only for
// the single-segment theme/script routes), so builder and server cannot drift apart.

const parse = {
  component: (u: string) => new URL(u, "http://x").pathname.slice(PD_ROUTE_PREFIX.component.length),
  componentCss: (u: string) => new URL(u, "http://x").pathname.slice(PD_ROUTE_PREFIX.componentCss.length, -".css".length),
  themeCss: (u: string) => decodeURIComponent(new URL(u, "http://x").pathname.slice(PD_ROUTE_PREFIX.themeCss.length, -".css".length)),
  script: (u: string) => decodeURIComponent(new URL(u, "http://x").pathname.slice(PD_ROUTE_PREFIX.script.length, -".js".length)),
};

describe("route table — builders round-trip through the server's parse", () => {
  const ids = ["atoms/button", "molecules/field/input", "atoms/badge~info", "atoms/100%"];

  it("component detail: raw id, encoded variant", () => {
    for (const id of ids) expect(parse.component(componentUrl(id))).toBe(id);
    expect(componentUrl("atoms/button", "a b")).toBe("/api/component/atoms/button?variant=a%20b");
    expect(componentUrl("atoms/button", "")).toBe("/api/component/atoms/button");
  });

  it("component CSS: raw id, cache-buster ignored by the parse", () => {
    for (const id of ids) {
      expect(parse.componentCss(componentCssUrl(id))).toBe(id);
      expect(parse.componentCss(componentCssUrl(id, 1717))).toBe(id);
    }
    expect(componentCssUrl("atoms/button", 7)).toBe("/_pd/components/atoms/button.css?v=7");
  });

  it("theme CSS and scripts: single segments, encoded and decoded", () => {
    for (const name of ["dark", "brand blue", "a/b", "50%"]) {
      expect(parse.themeCss(themeCssUrl(name))).toBe(name);
      expect(parse.script(scriptUrl(name))).toBe(name);
    }
    expect(scriptUrl("toggle", 3)).toBe("/_pd/scripts/toggle.js?v=3");
  });

  it("every fixed route and prefix is root-relative and unique", () => {
    const all = [...Object.values(PD_ROUTES), ...Object.values(PD_ROUTE_PREFIX)];
    for (const r of all) expect(r.startsWith("/")).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it("names two distinct front-end hosts, both bare host names", () => {
    expect(PD_HOSTS.storefront).not.toBe(PD_HOSTS.workbench);
    for (const h of Object.values(PD_HOSTS)) expect(h).toMatch(/^[a-z0-9.-]+$/);
  });
});

// ─── buildAuditRollup ────────────────────────────────────────────────────────
// The one export with real logic, and the one shared by the CLI report and the workbench facet —
// so a change here moves both at once. Pinned as data, not as rendered strings.

const graph = (over: Partial<DiagnosticsGraph> = {}): DiagnosticsGraph => ({
  rules: [], components: [], occurrences: [], ...over,
});
// Fixtures are annotated with the real contract types on purpose. An untyped object literal would
// compile against anything, which is how the first draft of this file shipped occurrences with no
// `severity` and still ran green — vitest does not typecheck. The annotation is the guard.
const comp = (id: string, render: RenderOutcome = "ok"): DiagnosticComponentNode => ({ id, render });
const occ = (
  component: string,
  ruleId: string,
  engine: DiagnosticEngine = "axe",
  over: Partial<DiagnosticOccurrence> = {},
): DiagnosticOccurrence =>
  ({ component, ruleId, engine, severity: "error", tag: "SUBJECT-DEBT", message: `${ruleId} failed`, ...over });

describe("buildAuditRollup — totals", () => {
  it("reports 100% clean for an empty corpus, not NaN", () => {
    const r = buildAuditRollup(graph());
    expect(r.totals).toEqual({ components: 0, affected: 0, cleanPct: 100, defects: 0 });
  });

  it("counts affected components DISTINCTLY, not per occurrence", () => {
    const r = buildAuditRollup(graph({
      components: [comp("a"), comp("b")],
      occurrences: [occ("a", "r1"), occ("a", "r2"), occ("a", "r3")],
    }));
    expect(r.totals.defects).toBe(3);
    expect(r.totals.affected).toBe(1);
    expect(r.totals.cleanPct).toBe(50);
  });

  it("rounds cleanPct", () => {
    const r = buildAuditRollup(graph({
      components: [comp("a"), comp("b"), comp("c")],
      occurrences: [occ("a", "r1")],
    }));
    expect(r.totals.cleanPct).toBe(67); // 2/3
  });

  it("counts render outcomes, defaulting absent buckets to 0", () => {
    const r = buildAuditRollup(graph({ components: [comp("a"), comp("b", "error")] }));
    expect(r.renderOutcomes).toEqual({ ok: 1, blank: 0, error: 1 });
  });
});

describe("buildAuditRollup — rulesByBlast ordering", () => {
  it("ranks by blast radius (distinct components) FIRST, not occurrence count", () => {
    // The discriminator: `wide` has fewer occurrences but hits more components, so it must win.
    // Ranking by occurrences would be the natural 'simplification' and is wrong — blast radius is
    // the honest corpus metric.
    const r = buildAuditRollup(graph({
      components: [comp("a"), comp("b"), comp("c")],
      occurrences: [
        occ("a", "wide"), occ("b", "wide"), occ("c", "wide"),
        occ("a", "deep"), occ("a", "deep"), occ("a", "deep"), occ("a", "deep"),
      ],
    }));
    expect(r.rulesByBlast.map(x => x.ruleId)).toEqual(["wide", "deep"]);
    expect(r.rulesByBlast[0]).toMatchObject({ components: 3, occurrences: 3 });
    expect(r.rulesByBlast[1]).toMatchObject({ components: 1, occurrences: 4 });
  });

  it("breaks a blast-radius tie by occurrences, then by engine:ruleId", () => {
    const r = buildAuditRollup(graph({
      components: [comp("a")],
      occurrences: [occ("a", "zebra"), occ("a", "alpha")],
    }));
    expect(r.rulesByBlast.map(x => x.ruleId)).toEqual(["alpha", "zebra"]);
  });

  it("keys rules by engine AND ruleId, so the same id from two engines stays separate", () => {
    const r = buildAuditRollup(graph({
      components: [comp("a")],
      occurrences: [occ("a", "dup", "axe"), occ("a", "dup", "html-validate")],
    }));
    expect(r.rulesByBlast).toHaveLength(2);
  });

  it("deduplicates and sorts tags", () => {
    const r = buildAuditRollup(graph({
      components: [comp("a"), comp("b")],
      occurrences: [
        occ("a", "r", "axe", { tag: "PD-GAP" }),
        occ("b", "r", "axe", { tag: "SUBJECT-DEBT" }),
        occ("a", "r", "axe", { tag: "PD-GAP" }),
      ],
    }));
    expect(r.rulesByBlast[0]!.tags).toEqual(["PD-GAP", "SUBJECT-DEBT"]);
  });
});

describe("buildAuditRollup — perComponent", () => {
  it("omits components that are clean AND render ok", () => {
    const r = buildAuditRollup(graph({ components: [comp("clean")], occurrences: [] }));
    expect(r.perComponent).toEqual([]);
  });

  it("INCLUDES a clean component whose render is not ok", () => {
    // Otherwise a blank/error render would vanish from the report for having no rule findings.
    const r = buildAuditRollup(graph({ components: [comp("blank", "blank")], occurrences: [] }));
    expect(r.perComponent).toHaveLength(1);
    expect(r.perComponent[0]).toMatchObject({ id: "blank", render: "blank" });
  });

  it("omits domPath when absent rather than emitting undefined", () => {
    const r = buildAuditRollup(graph({
      components: [comp("a")], occurrences: [occ("a", "r")],
    }));
    expect(Object.hasOwn(r.perComponent[0]!.occurrences[0]!, "domPath")).toBe(false);
  });

  it("keeps domPath when present", () => {
    const r = buildAuditRollup(graph({
      components: [comp("a")], occurrences: [occ("a", "r", "axe", { domPath: "main > button" })],
    }));
    expect(r.perComponent[0]!.occurrences[0]!.domPath).toBe("main > button");
  });
});

describe("buildAuditRollup — contract guarantees", () => {
  it("is PURE: the same graph yields a deeply equal rollup", () => {
    const g = graph({ components: [comp("a")], occurrences: [occ("a", "r")] });
    expect(buildAuditRollup(g)).toEqual(buildAuditRollup(g));
  });

  it("does not mutate the input graph", () => {
    const g = graph({ components: [comp("a")], occurrences: [occ("a", "r2"), occ("a", "r1")] });
    const before = structuredClone(g);
    buildAuditRollup(g);
    expect(g).toEqual(before);
  });

  it("always carries the scope boundary — a number without its caveat is not shippable", () => {
    expect(buildAuditRollup(graph()).scope).toBe(AUDIT_SCOPE);
  });

  it("the scope is plain data: named areas with details, and no Markdown in any field", () => {
    expect(AUDIT_SCOPE.covered.length).toBeGreaterThan(0);
    expect(AUDIT_SCOPE.notCovered.length).toBeGreaterThan(0);
    const texts = [...AUDIT_SCOPE.covered, ...AUDIT_SCOPE.notCovered].flatMap(i => [i.name, i.detail]).concat(AUDIT_SCOPE.note);
    for (const t of texts) {
      expect(t.trim(), t).not.toBe("");
      expect(t, t).not.toMatch(/\*\*|^#|\n/);
    }
  });

  it("omits subjectSha unless one is supplied", () => {
    expect(Object.hasOwn(buildAuditRollup(graph()), "subjectSha")).toBe(false);
    expect(buildAuditRollup(graph(), { subjectSha: "abc123" }).subjectSha).toBe("abc123");
  });

  it("headline never claims bare 'clean' — it names what the number covers", () => {
    const h = buildAuditRollup(graph({ components: [comp("a")] })).headline;
    expect(h).toContain("clean of static machine-detectable defects");
  });
});

// ─── Wire-shape guards (compile-time) ────────────────────────────────────────
// Types erase, so these assert at typecheck rather than at runtime: each literal must satisfy its
// arm, and the union must be exhaustively narrowable by `type`. If an arm gains, loses or renames a
// field, or a new arm is added, this file stops compiling — which is the point.

describe("HmrMessage wire shapes", () => {
  it("every declared arm is constructible and discriminated", () => {
    const messages: HmrMessage[] = [
      { type: "hello", protocol: PD_PROTOCOL_VERSION },
      { type: "content-swap", componentId: "atoms/button" },
      { type: "error", scope: "build", message: "SCSS error" },
      { type: "error", scope: "render", componentId: "atoms/button", message: "missing partial" },
      { type: "css-link-swap", componentId: "atoms/button", href: "/_pd/components/atoms/button.css?v=1" },
      { type: "css-link-swap", componentId: "a", href: "/x.css", orderedHrefs: ["/x.css"] },
      { type: "tree-changed" },
      { type: "collision", handle: "atoms-b", incumbentPath: "/a.hbs", quarantinedPath: "/b.hbs" },
      { type: "page-changed", route: "/guides/setup/" },
      { type: "page-changed", route: null },
    ];

    // Exhaustiveness: the default arm is unreachable only while every `type` is handled. Adding an
    // arm to HmrMessage without extending this switch is a compile error.
    const seen = messages.map((m): string => {
      switch (m.type) {
        case "hello":         return String(m.protocol);
        case "content-swap":  return m.componentId;
        case "error":         return `${m.scope}:${m.message}`;
        case "css-link-swap": return m.href;
        case "tree-changed":  return "tree";
        case "collision":     return m.handle;
        case "page-changed":  return m.route ?? "*";
        default: {
          const never: never = m;
          return never;
        }
      }
    });
    expect(seen).toHaveLength(10);
  });
});

// ─── Static build paths ──────────────────────────────────────────────────────
// The writer (pd build) and the reader (the shell in static mode) both go through staticPathFor, so
// every URL a builder emits must land on one stable, distinct file.

describe("staticPathFor — every builder's URL maps to one file", () => {
  it("maps the fixed API routes to .json files", () => {
    for (const r of ["tree", "themes", "config", "version", "audit", "pages"] as const) {
      expect(staticPathFor(PD_ROUTES[r])).toBe(`api/${r}.json`);
    }
  });

  // The storefront writes through the same mapping, unchanged: a page route is a folder index, and an
  // embedded preview is addressed by its variant id, so the query a static host cannot serve never
  // appears in a storefront page.
  it("maps storefront page routes and variant-id previews without a change to the mapping", () => {
    expect(staticPathFor("/guides/setup/")).toBe("guides/setup/index.html");
    expect(staticPathFor("/about/")).toBe("about/index.html");
    expect(staticPathFor("/preview/atoms/button~secondary")).toBe("preview/atoms/button~secondary/index.html");
  });

  it("maps component detail by id and variant, keeping / and ~ in the id", () => {
    expect(staticPathFor(componentUrl("atoms/button"))).toBe("api/component/atoms/button/index.json");
    expect(staticPathFor(componentUrl("atoms/button", "secondary"))).toBe("api/component/atoms/button/~secondary.json");
    expect(staticPathFor(componentUrl("atoms/baseless-2/baseless-3"))).toBe("api/component/atoms/baseless-2/baseless-3/index.json");
  });

  it("drops the theme from previews; the default theme is baked at build time", () => {
    expect(staticPathFor(previewUrl("atoms/button", undefined, "dark"))).toBe("preview/atoms/button/index.html");
    expect(staticPathFor(previewUrl("atoms/button", "secondary", "dark"))).toBe("preview/atoms/button/~secondary.html");
  });

  it("maps source facets and overviews", () => {
    expect(staticPathFor(renderedSourceUrl("molecules/field"))).toBe("source/molecules/field/rendered.html");
    expect(staticPathFor(dataSourceUrl("molecules/field", "big"))).toBe("source/molecules/field/data~big.html");
    expect(staticPathFor(overviewUrl("atoms/input"))).toBe("api/overview/atoms/input/index.json");
  });

  it("keeps asset and _pd paths, without cache-busters", () => {
    expect(staticPathFor(componentCssUrl("atoms/button", 123))).toBe("_pd/components/atoms/button.css");
    expect(staticPathFor(themeCssUrl("brand blue"))).toBe("_pd/themes/brand%20blue.css");
    expect(staticPathFor(scriptUrl("toggle", 9))).toBe("_pd/scripts/toggle.js");
    expect(staticPathFor("/assets/images/logo.svg")).toBe("assets/images/logo.svg");
    expect(staticPathFor(PD_ROUTES.mainJs)).toBe("_pd/main.js");
  });

  it("maps shell routes to one index.html each", () => {
    expect(staticPathFor("/")).toBe("index.html");
    expect(staticPathFor("/atoms/button")).toBe("atoms/button/index.html");
    expect(staticPathFor("/atoms/")).toBe("atoms/index.html");
  });

  it("never maps two different requests to the same file", () => {
    const urls = [
      componentUrl("atoms/button"), componentUrl("atoms/button", "a"), previewUrl("atoms/button"),
      previewUrl("atoms/button", "a"), renderedSourceUrl("atoms/button"), renderedSourceUrl("atoms/button", "a"),
      dataSourceUrl("atoms/button"), overviewUrl("atoms"), "/atoms/button", PD_ROUTES.tree,
      PD_ROUTES.pages, "/preview/atoms/button~a",
    ];
    const files = urls.map(staticPathFor);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("normalizeBasePath", () => {
  it("always yields a slash-wrapped path", () => {
    expect(normalizeBasePath(undefined)).toBe("/");
    expect(normalizeBasePath("/")).toBe("/");
    expect(normalizeBasePath("pd")).toBe("/pd/");
    expect(normalizeBasePath("/docs/htwoo")).toBe("/docs/htwoo/");
  });
});

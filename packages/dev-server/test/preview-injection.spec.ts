import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startDevServer } from "@pattern-dump/dev-server";
import { defineConfig } from "@pattern-dump/config";

const here      = dirname(fileURLToPath(import.meta.url));
const testBench = join(here, "../../../test-bench");

const config = defineConfig({
  sourceDir:   "./src",
  patternsDir: "./src/patterns",
  outDir:      "./dist",
  styles:      { strategy: "parallel", dir: "./src/styles" },
  themes:      { dir: "./themes", default: "light", switch: "attribute" },
  assets:      { strategy: "central", dir: "./assets" },
  scriptsDir:  "./src/scripts",
});

describe("/preview injection hardening", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  it("?theme= injection payload is blocked: allowlist rejects unknown theme, default is used", async () => {
    // Two-layer defence:
    //   1. Allowlist: the payload is not in knownThemes → effectiveTheme = defaultTheme ("light")
    //   2. escapeAttr: even if the allowlist were absent, special chars would be escaped before
    //      reaching the HTML attribute.
    // This test verifies layer 1 (observable outcome) and layer 2 (no raw payload in output).
    const payload = '"><script>alert(1)</script>';
    const res = await fetch(
      `http://127.0.0.1:${server.port}/preview/atoms/button?theme=${encodeURIComponent(payload)}`
    );
    expect(res.status).toBe(200);
    const body = await res.text();

    // Allowlist blocked the payload — default theme is used instead.
    expect(body).toContain('data-theme="light"');
    // The raw payload string must not appear anywhere in the document.
    expect(body).not.toContain(payload);
    // No injected script tag anywhere in the response.
    expect(body).not.toMatch(/<script>alert/);
    // <body> must appear exactly once (attribute not broken).
    expect(body.match(/<body/g)?.length).toBe(1);
  });

  it("unknown ?theme= falls back to the config default theme", async () => {
    const res = await fetch(
      `http://127.0.0.1:${server.port}/preview/atoms/button?theme=nonexistent-theme`
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    // Falls back to the config default ("light") — unknown theme not reflected.
    expect(body).toContain('data-theme="light"');
    expect(body).not.toContain('nonexistent-theme');
  });

  it("componentId with percent-encoded quote hits discovery miss and returns 404", async () => {
    // A " in the path segment must be percent-encoded by any conforming client.
    // The server decodes the pathname, gets an id with " in it, which has no discoveryMap entry.
    // First defence is the map miss (render error → 404); escapeAttr is defence-in-depth.
    const res = await fetch(
      `http://127.0.0.1:${server.port}/preview/atoms%2Fbutton%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E`
    );
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("Render error");
    expect(body).not.toMatch(/<script>alert/);
  });
});

// The document-base layer (config.documentBase). Guards the shared-partial fixture:
//   00-base/shared-family.scss → .tb-shared-only (no owner) + .tb-dual (shared rule)
//   01-atoms/dual.scss         → .tb-dual (component-specific rule, owner atoms/dual)
// This is the ".hoo-buttonaction" shape distilled into test-bench: a class co-authored by a shared
// (family) partial AND its own component partial, both legitimate origins of different rules.
//
// documentBase is opt-in, so it is exercised here with an augmented config rather than by flipping
// test-bench's default (which existing e2e correctly asserts is base-not-linked). Two invariants:
//   (1) NO unattributed dumping ground — a rule with a genuine owner (dual's border) attributes to
//       that owner, never to base. Kept strict.
//   (2) base IS injected beneath the closure so the shared layer reaches every preview (M5 §2.2).
describe("/preview documentBase — shared base layer injection", () => {
  const onConfig = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    themes: { dir: "./themes", default: "light", switch: "attribute" },
    assets: { strategy: "central", dir: "./assets" }, scriptsDir: "./src/scripts",
    documentBase: ["00-base"],
  });
  let on: { port: number; close: () => Promise<void> };
  let off: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    on  = await startDevServer(onConfig, testBench, { port: 0, wsPort: 0 });
    off = await startDevServer(config,   testBench, { port: 0, wsPort: 0 }); // no documentBase
  }, 30_000);
  afterAll(async () => { await on?.close(); await off?.close(); });

  it("links /_pd/base.css BENEATH the component closure when documentBase is set", async () => {
    const head = await (await fetch(`http://127.0.0.1:${on.port}/preview/atoms/dual`)).text();
    expect(head).toContain("/_pd/base.css");
    // base must come before the component closure so the component's own rules override it.
    expect(head.indexOf("/_pd/base.css"))
      .toBeLessThan(head.indexOf("/_pd/components/atoms/dual.css"));
  });

  it("does NOT link /_pd/base.css when documentBase is absent (opt-in preserved)", async () => {
    const head = await (await fetch(`http://127.0.0.1:${off.port}/preview/atoms/dual`)).text();
    expect(head).not.toContain("/_pd/base.css");
  });

  it("the shared layer carries the unowned class and the shared rule for the dual class", async () => {
    const base = await (await fetch(`http://127.0.0.1:${on.port}/_pd/base.css`)).text();
    expect(base).toContain(".tb-shared-only");          // owned by no component → in base
    expect(base).toContain("outline-color");            // .tb-dual's SHARED rule → in base
  });

  it("(1) no dumping ground — dual's OWN rule attributes to its component, not base", async () => {
    const base = await (await fetch(`http://127.0.0.1:${on.port}/_pd/base.css`)).text();
    const comp = await (await fetch(`http://127.0.0.1:${on.port}/_pd/components/atoms/dual.css`)).text();
    // The component-specific rule (border) lives in the component bucket…
    expect(comp).toContain("rgb(70, 80, 90)");
    // …and must NOT leak into base — a genuine owner is never misattributed to the shared layer.
    expect(base).not.toContain("rgb(70, 80, 90)");
  });
});

// The project helper loader (config.helpers). Guards two fixtures against src/helpers/hbs.cjs:
//   atoms/helper-demo      → {{tbShout "loaded"}}                (a plain custom helper)
//   atoms/dynpartial-demo  → {{{tbDynamicPartial "atoms-dual"}}} (a dynamic partial: reads
//                            Handlebars.partials at call time — the DIFFERENTIATION-admitted
//                            dynamic-composition edge)
// An unregistered helper throws and blanks the pattern, so "helper-demo renders" is the loader
// working. The dynamic partial MUST render, yet contribute NO static composition edge — a runtime
// string lookup is invisible to the `{{> … }}` composition registry, and that is correct.
describe("/preview project helper loader", () => {
  const helpersConfig = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    themes: { dir: "./themes", default: "light", switch: "attribute" },
    assets: { strategy: "central", dir: "./assets" }, scriptsDir: "./src/scripts",
    helpers: "./src/helpers",
  });
  let srv: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    srv = await startDevServer(helpersConfig, testBench, { port: 0, wsPort: 0 });
  }, 30_000);
  afterAll(async () => { await srv?.close(); });

  it("a custom helper is registered — the component renders (would throw unregistered)", async () => {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/preview/atoms/helper-demo`)).text();
    expect(body).toContain(">LOADED<");            // tbShout uppercased its argument
  });

  it("a dynamic partial renders via the real env (resolves Handlebars.partials at call time)", async () => {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/preview/atoms/dynpartial-demo`)).text();
    // tbDynamicPartial looked up the atoms-dual partial in the env and rendered its markup.
    expect(body).toContain("tb-dual");
    expect(body).not.toContain("[no partial:"); // the not-found branch did NOT fire
  });

  it("the dynamic partial contributes NO static composition edge", async () => {
    const detail = await (await fetch(`http://127.0.0.1:${srv.port}/api/component/atoms/dynpartial-demo`)).json();
    // It renders atoms-dual at runtime, but a string lookup is invisible to the {{> }} registry —
    // the dynamic-composition limit DIFFERENTIATION admits, asserted rather than papered over.
    expect(detail.relationships?.uses ?? []).not.toContain("atoms/dual");
  });
});

// The project data layer (config.dataDir). Guards precedence in BOTH directions against
// src/_data/tb.json ({ tbGlobalOnly: "from-global", tbShared: "GLOBAL" }):
//   atoms/data-global   → {{tbGlobalOnly}}  reads a key that exists ONLY in global data
//   atoms/data-override → {{tbShared}} + its own JSON { tbShared: "COMPONENT" } overrides the global
// Cascade: global → component defaults → variant → live; component always wins.
describe("/preview project data layer", () => {
  const dataConfig = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    themes: { dir: "./themes", default: "light", switch: "attribute" },
    assets: { strategy: "central", dir: "./assets" }, scriptsDir: "./src/scripts",
    helpers: "./src/helpers", dataDir: "./src/_data",
  });
  let srv: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    srv = await startDevServer(dataConfig, testBench, { port: 0, wsPort: 0 });
  }, 30_000);
  afterAll(async () => { await srv?.close(); });

  it("a global-only key resolves — global data reaches the render", async () => {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/preview/atoms/data-global`)).text();
    expect(body).toContain(">from-global<");
  });

  it("component data OVERRIDES the global key (component wins)", async () => {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/preview/atoms/data-override`)).text();
    expect(body).toContain(">COMPONENT<");   // its own JSON
    expect(body).not.toContain(">GLOBAL<");  // not the global value
  });

  it("without dataDir there is no global tier (global-only key is blank)", async () => {
    const off = await startDevServer(config, testBench, { port: 0, wsPort: 0 }); // no dataDir
    try {
      const body = await (await fetch(`http://127.0.0.1:${off.port}/preview/atoms/data-global`)).text();
      expect(body).not.toContain("from-global");
    } finally { await off.close(); }
  });
});

// Handlebars block partials (`{{#> name}}block{{/name}}` + `{{> @partial-block}}`). Fixtures:
//   atoms/tb-block         → <div class="tb-block">wrap[{{> @partial-block}}]</div>
//   atoms/tb-block-caller  → {{#> atoms-tb-block}}<span class="tb-body">BODY</span>{{/atoms-tb-block}}
// PD registers partials as functions and runs them itself, so the block body (opts.fn) must be
// threaded through as `@partial-block`. Unlike dynamicPartial, a `{{#> x}}` is a STATIC include —
// it must produce a composition edge in the graph.
describe("/preview block partials (@partial-block)", () => {
  let srv: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    srv = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
  }, 30_000);
  afterAll(async () => { await srv?.close(); });

  it("the caller renders — the block body yields back through @partial-block", async () => {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/preview/atoms/tb-block-caller`)).text();
    expect(body).toContain("tb-block");   // the wrapper partial
    expect(body).toContain("BODY");        // the block body, via {{> @partial-block}}
  });

  it("a {{#> }} block partial DOES produce a composition edge (unlike dynamicPartial)", async () => {
    const detail = await (await fetch(`http://127.0.0.1:${srv.port}/api/component/atoms/tb-block-caller`)).json();
    expect(detail.relationships?.uses ?? []).toContain("atoms/tb-block");
  });

  it("the block partial rendered STANDALONE renders empty, never throws", async () => {
    const detail = await (await fetch(`http://127.0.0.1:${srv.port}/api/component/atoms/tb-block`)).json();
    const hasErr = (detail.diagnostics ?? []).some((x: { kind?: string }) => /error/i.test(x.kind ?? ""));
    expect(hasErr).toBe(false);
    expect(detail.document).toContain("tb-block"); // wrapper renders; the empty block is just absent
  });
});

// Asset reference normalization (config.assets.dir as multiple roots). Fixture:
//   media/tb-sprite.svg (a second asset ROOT, basename "media")
//   atoms/asset-demo → <use href="../../media/tb-sprite.svg#dot"> — a relative ref from a pattern
// The relative ref is rewritten to /assets/media/… by matching the root basename (depth-independent),
// and /assets/media/ serves the second root. Guards the two-root config shape + the rewrite.
describe("/preview asset reference normalization", () => {
  const assetsConfig = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    themes: { dir: "./themes", default: "light", switch: "attribute" },
    assets: { strategy: "central", dir: ["./assets", "./media"] }, // two roots
    scriptsDir: "./src/scripts",
  });
  let srv: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    srv = await startDevServer(assetsConfig, testBench, { port: 0, wsPort: 0 });
  }, 30_000);
  afterAll(async () => { await srv?.close(); });

  it("a relative asset ref is normalized to /assets/<root>/… (not left relative)", async () => {
    const body = await (await fetch(`http://127.0.0.1:${srv.port}/preview/atoms/asset-demo`)).text();
    expect(body).toContain("/assets/media/tb-sprite.svg#dot");
    expect(body).not.toContain("../../media/tb-sprite.svg");
  });

  it("the second asset root is served by basename", async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/assets/media/tb-sprite.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/svg/);
    expect(await res.text()).toContain('id="dot"');
  });

  it("the first root still mirrors 1:1 (single-root behaviour preserved)", async () => {
    // /assets/<not-a-root-basename>/… falls back to the first root's mirror.
    const res = await fetch(`http://127.0.0.1:${srv.port}/assets/tb-sprite-missing.svg`);
    expect(res.status).toBe(404); // resolves against ./assets (mirror), file absent → 404 not a crash
  });
});

// Project-level scripts (config.globalScripts) — loaded into EVERY preview. src/scripts/tb-global.ts
// marks the body and wires a dialog trigger; atoms/global-script-demo is a button + <dialog>.
// requireScript is per-component and cannot express "load these for every preview"; globalScripts can.
describe("/preview global scripts", () => {
  const gsConfig = defineConfig({
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel", dir: "./src/styles" },
    themes: { dir: "./themes", default: "light", switch: "attribute" },
    assets: { strategy: "central", dir: "./assets" }, scriptsDir: "./src/scripts",
    globalScripts: ["tb-global"],
  });
  let on: { port: number; close: () => Promise<void> };
  let off: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    on  = await startDevServer(gsConfig, testBench, { port: 0, wsPort: 0 });
    off = await startDevServer(config,   testBench, { port: 0, wsPort: 0 }); // no globalScripts
  }, 30_000);
  afterAll(async () => { await on?.close(); await off?.close(); });

  it("the global script is injected into EVERY preview, not just one component", async () => {
    for (const id of ["atoms/button", "atoms/global-script-demo"]) {
      const body = await (await fetch(`http://127.0.0.1:${on.port}/preview/${id}`)).text();
      expect(body, id).toContain("/_pd/scripts/tb-global.js");
    }
  });

  it("absent when globalScripts is unset (opt-in preserved)", async () => {
    const body = await (await fetch(`http://127.0.0.1:${off.port}/preview/atoms/button`)).text();
    expect(body).not.toContain("/_pd/scripts/tb-global.js");
  });
});

// Theme link-swap (themes.switch: 'stylesheet'). Fixture: themes-bare/ holds two BARE `:root` theme
// sets (tb-red, tb-blue) — the shape that collides when all are linked. Under 'stylesheet' only the
// active one is linked; under 'attribute' all are linked (current behaviour).
describe("/preview theme link-swap", () => {
  const base = {
    sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
    styles: { strategy: "parallel" as const, dir: "./src/styles" },
    assets: { strategy: "central" as const, dir: "./assets" }, scriptsDir: "./src/scripts",
  };
  const stylesheetCfg = defineConfig({ ...base, themes: { dir: "./themes-bare", default: "tb-red", switch: "stylesheet" } });
  const attributeCfg  = defineConfig({ ...base, themes: { dir: "./themes-bare", default: "tb-red", switch: "attribute" } });
  let ss: { port: number; close: () => Promise<void> };
  let at: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    ss = await startDevServer(stylesheetCfg, testBench, { port: 0, wsPort: 0 });
    at = await startDevServer(attributeCfg,  testBench, { port: 0, wsPort: 0 });
  }, 30_000);
  afterAll(async () => { await ss?.close(); await at?.close(); });

  it("'stylesheet': links ONLY the active theme, anchored for swapping", async () => {
    const body = await (await fetch(`http://127.0.0.1:${ss.port}/preview/atoms/theme-demo`)).text();
    expect(body).toContain('/_pd/themes/tb-red.css" data-pd-theme');
    expect(body).not.toContain("/_pd/themes/tb-blue.css"); // the inactive theme is NOT linked
    const cfg = await (await fetch(`http://127.0.0.1:${ss.port}/api/config`)).json();
    expect(cfg.themeSwitch).toBe("stylesheet");
  });

  it("'attribute' (default): links ALL themes (current behaviour)", async () => {
    const body = await (await fetch(`http://127.0.0.1:${at.port}/preview/atoms/theme-demo`)).text();
    expect(body).toContain("/_pd/themes/tb-red.css");
    expect(body).toContain("/_pd/themes/tb-blue.css");
  });
});

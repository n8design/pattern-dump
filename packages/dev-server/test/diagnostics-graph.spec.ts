import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { startDevServer, formatAuditReport, formatAudit, buildAuditRollup, AUDIT_SCOPE } from "@pattern-dump/dev-server";
import type { DiagnosticsGraph } from "@pattern-dump/contracts";
import { defineConfig } from "@pattern-dump/config";
import { save } from "../../../test-support/save.js";

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

interface Graph {
  rules: { engine: string; ruleId: string }[];
  components: { id: string; render: string }[];
  occurrences: { engine: string; ruleId: string; component: string; tag: string; message: string }[];
  _liveReaudits?: number;
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server = await startDevServer(config, testBench, { port: 0, wsPort: 0 });
  try { await fn(server.port); } finally { await server.close(); }
}

async function fetchAudit(port: number): Promise<Graph> {
  const res = await fetch(`http://127.0.0.1:${port}/api/audit`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Graph>;
}

describe("diagnostics graph — corpus sweep + guards", () => {
  it("known HTML defect: <div> under <summary> fires element-permitted-content, tagged [SUBJECT-DEBT]", async () => {
    await withServer(async (port) => {
      const g = await fetchAudit(port);
      const occ = g.occurrences.filter(o => o.component === "atoms/summary-invalid");
      const rule = occ.find(o => o.engine === "html-validate" && o.ruleId === "element-permitted-content");
      expect(rule, "element-permitted-content must fire on the <summary>/<div> fixture").toBeDefined();
      expect(rule!.tag).toBe("SUBJECT-DEBT");
    });
  }, 20000);

  it("known structural-axe violation: unlabeled control fires axe:label", async () => {
    await withServer(async (port) => {
      const g = await fetchAudit(port);
      const occ = g.occurrences.filter(o => o.component === "atoms/a11y-invalid");
      expect(occ.some(o => o.engine === "axe" && o.ruleId === "label")).toBe(true);
    });
  }, 20000);

  it("clean fixture → zero findings + render ok; report says 'clean of static machine-detectable defects', never bare 'clean'", async () => {
    await withServer(async (port) => {
      const g = await fetchAudit(port);
      const node = g.components.find(c => c.id === "atoms/audit-clean");
      expect(node?.render).toBe("ok");
      expect(g.occurrences.filter(o => o.component === "atoms/audit-clean")).toHaveLength(0);
    });
    // The honest-claim phrasing is embedded verbatim in every report.
    const report = formatAuditReport({ rules: [], components: [{ id: "x", render: "ok" }], occurrences: [] });
    expect(report).toContain("clean of static machine-detectable defects");
    // Zero findings is stated for what it is, never as a bare "clean".
    expect(report).toContain("No findings means no static, machine-detectable defects, not that a component is fully accessible or correct.");
  }, 20000);

  it("shared identity: a diagnostics component node uses the SAME discovery id composition keys on", async () => {
    await withServer(async (port) => {
      const g = await fetchAudit(port);
      // molecules/field is a real composition node (uses atoms/input). Its diagnostics node id must be
      // the identical discovery id — the §2.1 convergence requirement (merge, not a second scheme).
      expect(g.components.some(c => c.id === "molecules/field")).toBe(true);
      const detail = await (await fetch(`http://127.0.0.1:${port}/api/component/molecules/field`)).json() as {
        relationships: { uses: string[] };
      };
      expect(detail.relationships.uses).toContain("atoms/input"); // composition keys on "molecules/field"
    });
  }, 20000);

  it("incremental: a template edit re-audits EXACTLY that component; an SCSS edit re-audits NONE (tripwire)", async () => {
    // Mutation-based: isolate on a TEMP COPY of the bench so the live file edits never race other specs
    // sharing the real test-bench (the HMR test-isolation gotcha — temp-copy is the fix, not the real tree).
    const tmp = await mkdtemp(join(tmpdir(), "pd-incr-"));
    const tmpBench = join(tmp, "bench");
    const poll = async (port: number, target: number, ms = 6000): Promise<number> => {
      const t0 = Date.now();
      let last = -1;
      while (Date.now() - t0 < ms) {
        last = (await fetchAudit(port))._liveReaudits ?? 0;
        if (last >= target) return last;
        await new Promise(r => setTimeout(r, 150));
      }
      return last;
    };
    try {
      await cp(testBench, tmpBench, { recursive: true });
      const canary = join(tmpBench, "src/patterns/atoms/audit-clean/audit-clean.hbs");
      const scss   = join(tmpBench, "src/styles/01-atoms/button.scss");
      const server = await startDevServer(config, tmpBench, { port: 0, wsPort: 0 });
      try {
        // seed: first audit builds the in-memory slices; live counter starts at 0.
        expect((await fetchAudit(server.port))._liveReaudits).toBe(0);

        // Template edit → the watcher re-audits exactly one component.
        await save(canary, await readFile(canary, "utf-8") + "\n<!-- incr-proof -->\n");
        expect(await poll(server.port, 1), "template edit must trigger exactly one live re-audit").toBe(1);

        // SCSS edit → the tripwire: zero re-audits (covered engines are CSS-invariant).
        await save(scss, await readFile(scss, "utf-8") + "\n/* incr-proof */\n");
        await new Promise(r => setTimeout(r, 1500)); // give the watcher time to (not) act
        expect((await fetchAudit(server.port))._liveReaudits, "SCSS edit must NOT re-audit").toBe(1);
      } finally {
        await server.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30000);
});

describe("pd audit — report formats (--format md|text|json)", () => {
  // A representative graph: two rules (tie in blast radius → engine:ruleId tiebreak), a component with
  // findings + a blank-render component with none, one occurrence carrying a domPath.
  const FIXTURE: DiagnosticsGraph = {
    rules: [],
    components: [
      { id: "atoms/button", render: "ok" },
      { id: "atoms/field", render: "blank" },
    ],
    occurrences: [
      { engine: "html-validate", ruleId: "element-permitted-content", component: "atoms/button", severity: "error", message: "bad nesting", domPath: "button > div", tag: "SUBJECT-DEBT" },
      { engine: "axe", ruleId: "label", component: "atoms/button", severity: "error", message: "no label", tag: "SUBJECT-DEBT" },
    ],
  };
  const SCOPE_MARKER = "## Scope";
  const SCOPE_NOTE = "No findings means no static, machine-detectable defects, not that a component is fully accessible or correct.";

  it("md: byte-identical no-drift — formatAudit('md') === formatAuditReport; algorithm head frozen", () => {
    // formatAuditReport was proven byte-identical to the pre-refactor (cc8df47) output out-of-band;
    // the refactor extracts buildAuditRollup without changing what a user sees. This freezes the
    // algorithm-generated head so it cannot silently drift, and requires both entrypoints to agree.
    const md = formatAudit(FIXTURE, "md");
    expect(md).toBe(formatAuditReport(FIXTURE));
    const head = md.split(SCOPE_MARKER)[0];
    expect(head).toMatchInlineSnapshot(`
      "# Diagnostics audit

      **2 machine-detectable static defects across 1 of 2 components — 50% clean of static machine-detectable defects.**

      Render outcomes: 1 ok, 1 blank, 0 error.

      ## Rules by blast radius (components affected; occurrences secondary)

      | rule | components | occurrences | tag |
      | --- | ---: | ---: | --- |
      | \`axe:label\` | 1 | 1 | SUBJECT-DEBT |
      | \`html-validate:element-permitted-content\` | 1 | 1 | SUBJECT-DEBT |

      ## Per component

      ### atoms/button  _(render: ok)_
      - \`axe:label\` **[SUBJECT-DEBT]** no label
      - \`html-validate:element-permitted-content\` **[SUBJECT-DEBT]** bad nesting — \`button > div\`

      ### atoms/field  _(render: blank)_
      - (no defects; render outcome noted above)

      "
    `);
    // The scope follows the report: a real Markdown heading and lists, ending with the note.
    expect(md.split(SCOPE_MARKER)[1]).toMatchInlineSnapshot(`
      "

      Covered: static checks on a single render, without browser layout.

      - **HTML content model:** invalid nesting and content that isn't permitted where it appears (html-validate).
      - **Structural accessibility:** labels, accessible names, ARIA attributes, roles and image alternatives (the axe-core rules that don't need layout).
      - **Schema:** missing required fields and values of the wrong type, checked against each component's \`<name>.schema.json\`.
      - **Render outcome:** whether each component rendered, rendered empty or failed. It is reported with the component, not counted as a defect.

      Not covered:

      - **Checks that need a rendered page:** colour contrast, focusable content hidden with aria-hidden, and duplicate ids referenced by ARIA. They need real browser layout; the Console's Diagnostics tab runs them for the component on screen.
      - **Interaction:** focus traps, keyboard flow and Escape handling. The audit looks at a single static render.
      - **Structure:** unused components, shared bases and near-duplicate copies. The Relationships tab and \`pd export\` cover those.
      - **Components that need data:** a component that renders empty without data can't show the problems it would have with data. Its findings carry the render outcome.

      No findings means no static, machine-detectable defects, not that a component is fully accessible or correct.
      "
    `);
    expect(md.trimEnd().endsWith(SCOPE_NOTE)).toBe(true);
  });

  it("text: same information, Markdown stripped; headline and scope included", () => {
    const txt = formatAudit(FIXTURE, "text");
    // headline verbatim (plain, no ** emphasis)
    expect(txt).toContain("2 machine-detectable static defects across 1 of 2 components — 50% clean of static machine-detectable defects.");
    // markdown stripped: no table pipes, no backticked rule ids
    expect(txt).not.toContain("| rule |");
    expect(txt).not.toMatch(/`[a-z-]+:[a-z-]+`/);
    // rule rollup + per-component content present in plain form (sort tiebreak: axe before html-validate)
    expect(txt).toContain("axe:label — components 1, occurrences 1 [SUBJECT-DEBT]");
    expect(txt).toContain("atoms/button (render: ok)");
    expect(txt).toContain("axe:label [SUBJECT-DEBT] no label");
    expect(txt).toContain("html-validate:element-permitted-content [SUBJECT-DEBT] bad nesting — button > div");
    expect(txt).toContain("atoms/field (render: blank)");
    // The scope in plain form, so a text reader gets the caveat too — without Markdown syntax.
    expect(txt).toContain("\nScope\n");
    expect(txt).toContain("  - Schema: missing required fields");
    expect(txt.split("\nScope\n")[1]).not.toMatch(/\*\*|^#/m);
    expect(txt.trimEnd().endsWith(SCOPE_NOTE)).toBe(true);
  });

  it("json: CI-consumable rollup — pure JSON, scope + headline travel WITH the count", () => {
    const json = formatAudit(FIXTURE, "json");
    const parsed = JSON.parse(json); // must parse — no human meta mixed into the report string
    // the caveat rides alongside the number: a CI consumer never reads a bare count
    expect(parsed.headline).toBe("2 machine-detectable static defects across 1 of 2 components — 50% clean of static machine-detectable defects.");
    expect(parsed.scope).toEqual(AUDIT_SCOPE);
    expect(parsed.scope.note).toBe(SCOPE_NOTE);
    // numbers as data, not strings — the smell the refactor fixed
    expect(parsed.totals).toEqual({ components: 2, affected: 1, cleanPct: 50, defects: 2 });
    expect(parsed.renderOutcomes).toEqual({ ok: 1, blank: 1, error: 0 });
    // rulesByBlast sorted; tie broken by engine:ruleId
    expect(parsed.rulesByBlast.map((r: { engine: string; ruleId: string }) => `${r.engine}:${r.ruleId}`))
      .toEqual(["axe:label", "html-validate:element-permitted-content"]);
    expect(parsed.rulesByBlast[0]).toMatchObject({ components: 1, occurrences: 1, tags: ["SUBJECT-DEBT"] });
    // per-component: only components with findings or non-ok render; occ sorted; domPath preserved
    const byId = Object.fromEntries(parsed.perComponent.map((c: { id: string }) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual(["atoms/button", "atoms/field"]);
    expect(byId["atoms/button"].occurrences.map((o: { engine: string; ruleId: string }) => `${o.engine}:${o.ruleId}`))
      .toEqual(["axe:label", "html-validate:element-permitted-content"]);
    expect(byId["atoms/button"].occurrences[1].domPath).toBe("button > div");
    expect(byId["atoms/field"]).toMatchObject({ render: "blank", occurrences: [] });
  });

  it("buildAuditRollup: the shared intermediate carries the numbers as data", () => {
    const r = buildAuditRollup(FIXTURE);
    expect(r.totals.defects).toBe(2);
    expect(r.rulesByBlast).toHaveLength(2);
    expect(r.perComponent).toHaveLength(2);
    // md/text/json all render from this one object
    expect(formatAudit(FIXTURE, "json")).toBe(JSON.stringify(r, null, 2));
  });
});

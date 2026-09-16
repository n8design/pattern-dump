// CHARACTERISATION TESTS for the file watcher / HMR path.
//
// Written to pin CURRENT behaviour before the watcher moves out of startDevServer's closure, so
// the extraction can be shown to change nothing. Before this spec the watcher had exactly ONE
// server-side assertion — the `_liveReaudits` incremental tripwire in diagnostics-graph.spec.
// Its css-link-swap path, tree-changed on add/unlink, theme recompile and script-cache
// invalidation had no server-side cover at all; their only guard was four dev-ui Playwright specs
// driving a browser in another package.
//
// TWO KINDS OF ASSERTION, deliberately:
//
//   1. HTTP effects  — the watcher's durable results (tree contents, recompiled theme CSS,
//      invalidated script cache). Extraction-agnostic: they do not care where the watcher lives.
//   2. HMR broadcasts — the messages themselves, observed over a real WebSocket client. These are
//      the actual contract with dev-ui, and the part that would break silently: the server would
//      still serve correct bytes while the workbench stopped updating.
//
// Mutations run against a TEMP COPY of test-bench, never the git-tracked tree. The dev-ui e2e
// specs do write into the real one, which is a known hazard recorded in
// apps/dev-ui/e2e/playwright.config.ts — no reason to add another.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile, mkdir, rm, cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import WebSocket from "ws";

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

/** HMR messages are only observable over the socket — DevServer does not expose wsPort, so the
 *  test fixes one rather than using an ephemeral port. */
const WS_PORT = 47_311;

interface HmrMessage {
  type: string;
  componentId?: string;
  href?: string;
  orderedHrefs?: string[];
  message?: string;
}

/** Collects every broadcast for the life of the server. Assertions poll it, because a watcher
 *  round-trip is compile + derive + push and has no completion signal to await. */
class HmrTap {
  readonly received: HmrMessage[] = [];
  private ws!: WebSocket;

  async connect(): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    this.ws.on("message", (raw) => {
      try { this.received.push(JSON.parse(String(raw)) as HmrMessage); } catch { /* not ours */ }
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  clear(): void { this.received.length = 0; }

  /** Wait for a message matching `pred`, or throw with what actually arrived.
   *
   *  The default budget is deliberately generous. Unloaded, this whole spec runs in under two
   *  seconds — but vitest runs spec files in parallel, so several dev servers compile SCSS
   *  concurrently, and a tree rebuild (buildDiscoveryMap + collisions + composition registry +
   *  flattening, a full corpus pass) can take an order of magnitude longer under that contention.
   *  A tight budget here produced a ~50% flake that had nothing to do with the behaviour. The
   *  assertion is unchanged: the message must still arrive, or this throws with what did. */
  async waitFor(pred: (m: HmrMessage) => boolean, label: string, timeout = 45_000): Promise<HmrMessage> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hit = this.received.find(pred);
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${label}; received: ${JSON.stringify(this.received)}`);
  }

  close(): void { this.ws?.close(); }
}

describe("file watcher / HMR — characterisation", () => {
  let dir = "";
  let server: { port: number; close: () => Promise<void> };
  let tap: HmrTap;

  const get = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
  /** The tree is rebuilt lazily by the route, so read it only after tree-changed has fired. */
  const treeContains = async (slug: string): Promise<boolean> =>
    JSON.stringify(await (await get("/api/tree")).json()).includes(slug);
  const touch = async (rel: string, append: string) => {
    const abs = join(dir, rel);
    await writeFile(abs, (await readFile(abs, "utf-8")) + append, "utf-8");
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pd-watcher-"));
    await cp(testBench, dir, { recursive: true });
    server = await startDevServer(config, dir, { port: 0, wsPort: WS_PORT });
    tap = new HmrTap();
    await tap.connect();
  }, 60_000);

  afterAll(async () => {
    tap?.close();
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // ---- Durable effects, observable over HTTP -------------------------------------------

  describe("tree changes", () => {
    it("adding a .hbs puts the component in /api/tree", async () => {
      const slug = `watcher-add-${Date.now()}`;
      tap.clear();
      await mkdir(join(dir, "src/patterns/atoms", slug), { recursive: true });
      await writeFile(join(dir, "src/patterns/atoms", slug, `${slug}.hbs`), `<div class="${slug}"></div>\n`, "utf-8");

      // Wait on the server's own completion signal before polling HTTP. Blind-polling /api/tree
      // was flaky: vitest runs spec files in parallel, so several dev servers compile at once and
      // the fs-event -> rebuild -> serve chain can exceed a fixed budget. tree-changed is emitted
      // after the rebuild, so this waits for the real event instead of guessing a duration.
      await tap.waitFor(m => m.type === "tree-changed", "tree-changed after add");
      expect(await treeContains(slug), "new component should appear in the tree").toBe(true);
    }, 60_000);

    it("removing the directory takes it back out of /api/tree", async () => {
      const slug = `watcher-rm-${Date.now()}`;
      const compDir = join(dir, "src/patterns/atoms", slug);
      // Clear FIRST: the tap accumulates for the life of the server, so a tree-changed left by an
      // earlier test would satisfy the wait below instantly and the precondition would read a tree
      // that has not been rebuilt yet.
      tap.clear();
      await mkdir(compDir, { recursive: true });
      await writeFile(join(compDir, `${slug}.hbs`), `<div class="${slug}"></div>\n`, "utf-8");

      await tap.waitFor(m => m.type === "tree-changed", "tree-changed after add");
      expect(await treeContains(slug), "precondition: component was added").toBe(true);

      tap.clear();
      await rm(compDir, { recursive: true, force: true });
      await tap.waitFor(m => m.type === "tree-changed", "tree-changed after unlinkDir");
      expect(await treeContains(slug), "component should be gone after unlinkDir").toBe(false);
    }, 60_000);
  });

  describe("theme recompile", () => {
    it("editing a theme .scss updates the served theme CSS", async () => {
      const marker = `--watcher-theme-${Date.now()}`;
      await touch("themes/brand-blue.theme.scss", `\n[data-theme="brand-blue"]{${marker}:1;}\n`);

      const deadline = Date.now() + 10_000;
      let css = "";
      while (Date.now() < deadline && !css.includes(marker)) {
        css = await (await get("/_pd/themes/brand-blue.css")).text();
        if (!css.includes(marker)) await new Promise(r => setTimeout(r, 100));
      }
      expect(css, "recompiled theme CSS should be served").toContain(marker);
    }, 60_000);
  });

  describe("script cache invalidation", () => {
    it("editing a .ts serves the recompiled script rather than the cached one", async () => {
      // Prime the cache first — the invalidation only matters if something was cached.
      const before = await (await get("/_pd/scripts/toggle.js")).text();
      expect(before.length).toBeGreaterThan(0);

      const marker = `watcher_script_${Date.now()}`;
      await touch("src/scripts/toggle.ts", `\nexport const ${marker} = 1;\n`);

      const deadline = Date.now() + 10_000;
      let js = "";
      while (Date.now() < deadline && !js.includes(marker)) {
        js = await (await get("/_pd/scripts/toggle.js")).text();
        if (!js.includes(marker)) await new Promise(r => setTimeout(r, 100));
      }
      expect(js, "script cache should have been invalidated").toContain(marker);
    }, 60_000);
  });

  // ---- The broadcast contract, observed over the socket --------------------------------

  describe("HMR broadcasts", () => {
    it("a component .scss edit broadcasts css-link-swap with a cache-busted href", async () => {
      tap.clear();
      await touch("src/styles/01-atoms/button.scss", `\n.df-button{--watcher-css:${Date.now()};}\n`);

      const msg = await tap.waitFor(m => m.type === "css-link-swap", "css-link-swap");
      expect(msg.componentId).toBe("atoms/button");
      // The ?v= stamp is what makes the browser refetch rather than reuse the cached stylesheet.
      expect(msg.href).toContain("/_pd/components/atoms/button.css?v=");
    }, 60_000);

    // PINS A SUSPECTED BUG — see the note below. This asserts what the code DOES, not what it
    // should do, which is the job of a characterisation test. If someone fixes the resolution,
    // this fails loudly and they update it deliberately rather than silently changing behaviour.
    it("a .hbs edit broadcasts content-swap for the id hbsPathToId holds (a VARIANT here)", async () => {
      tap.clear();
      await touch("src/patterns/atoms/button/button.hbs", `\n<!-- watcher ${Date.now()} -->\n`);

      const msg = await tap.waitFor(m => m.type === "content-swap", "content-swap");

      // atoms/button has ONE button.hbs shared by three ids — the base plus two data-overlay
      // variants (button~disabled.json, button~secondary.json). `hbsPathToId` is a Map keyed by
      // path, so it can only hold one id per path: last write wins, and the variant wins.
      //
      // Consequence, believed to be a real defect: editing button.hbs while viewing the BASE
      // atoms/button produces no live update, because dev-ui gates content-swap on
      // `componentId === current?.id` (apps/dev-ui/src/main.ts:2405) and the broadcast names the
      // variant. The .json path does not have this problem — resolveComponentForFile's json scan
      // explicitly maps a variant back to its base — which is why the dev-ui hmr.spec never
      // caught it: that spec edits button.json, not button.hbs.
      expect(msg.componentId).toBe("atoms/button~secondary");
    }, 60_000);

  });

  describe("Markdown", () => {
    it("editing a component .md broadcasts tree-changed and content-swap for its component; docs and title are fresh", async () => {
      tap.clear();
      const stamp = `watcher-docs-${Date.now()}`;
      const file = join(dir, "src/patterns/atoms/chip/chip.md");
      const md = await readFile(file, "utf-8");
      const withTitle = /^title:.*$/m.test(md)
        ? md.replace(/^title:.*$/m, `title: Chip ${stamp}`)
        : md.replace(/^---\n/, `---\ntitle: Chip ${stamp}\n`);
      await writeFile(file, `${withTitle}\n${stamp}\n`, "utf-8");

      await tap.waitFor(m => m.type === "tree-changed", "tree-changed");
      await tap.waitFor(m => m.type === "content-swap" && m.componentId === "atoms/chip", "content-swap atoms/chip");
      const detail = await (await get("/api/component/atoms/chip")).json() as { doc?: string };
      expect(detail.doc).toContain(stamp);
      expect(await treeContains(`Chip ${stamp}`)).toBe(true);
    }, 60_000);

    it("editing a folder index.md broadcasts tree-changed", async () => {
      tap.clear();
      await touch("src/patterns/atoms/index.md", `\nwatcher ${Date.now()}\n`);
      await tap.waitFor(m => m.type === "tree-changed", "tree-changed");
    }, 60_000);

    it("adding a .md to an undocumented component rebuilds discovery, so its docs appear", async () => {
      tap.clear();
      const stamp = `watcher-new-docs-${Date.now()}`;
      await writeFile(join(dir, "src/patterns/organisms/buttonbar/buttonbar.md"), `---\ntitle: Button bar\n---\n\n${stamp}\n`, "utf-8");

      await tap.waitFor(m => m.type === "content-swap" && m.componentId === "organisms/buttonbar", "content-swap organisms/buttonbar");
      const detail = await (await get("/api/component/organisms/buttonbar")).json() as { doc?: string };
      expect(detail.doc).toContain(stamp);
    }, 60_000);
  });

  describe("HMR broadcasts, continued", () => {
    it("adding a component broadcasts tree-changed", async () => {
      tap.clear();
      const slug = `watcher-bc-${Date.now()}`;
      await mkdir(join(dir, "src/patterns/atoms", slug), { recursive: true });
      await writeFile(join(dir, "src/patterns/atoms", slug, `${slug}.hbs`), "<div></div>\n", "utf-8");

      const msg = await tap.waitFor(m => m.type === "tree-changed", "tree-changed");
      expect(msg.type).toBe("tree-changed");
    }, 60_000);
  });
});

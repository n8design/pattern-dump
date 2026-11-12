// pd dev reloads global data, helpers and assets while it runs. Renderer and data are one object,
// replaced in one assignment, so nothing renders with new data and an old renderer or the reverse. A
// reload that fails keeps the last good renderer and data, says so in the terminal and on open pages,
// and the next good save recovers, with no restart. A helper's own imports ask for a restart.
// Live cases run through watch-harness.ts (no waiting for quiet), each on a fresh project.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import WebSocket from "ws";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { createRenderer } from "@pattern-dump/renderer";
import { createRenderingHandle } from "../src/rendering.js";
import { liveScript } from "../src/storefront/page.js";
import { freePort } from "./free-ports.js";
import { Bench, closeAll } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
let n = 0;
const cli = fileURLToPath(new URL("../../cli/dist/index.js", import.meta.url));

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await save(path, text);
}

const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  dataDir: "./src/_data", helpers: "./src/helpers", assets: { dir: "./assets" },
}), "site");

const FILES: Record<string, string> = {
  "src/patterns/atoms/loud/loud.hbs": `<p class="loud">{{shout "quiet"}} {{site.v}}</p>\n`,
  "src/styles/atoms/loud.scss": ".loud {\n  color: red;\n}\n",
  "src/_data/site.json": `{ "site": { "v": "data-1" } }\n`,
  "src/helpers/shout.js": `import { mark } from "./lib/mark.js";\nexport function shout(s) { return String(s).toUpperCase() + mark; }\n`,
  "src/helpers/lib/mark.js": `export const mark = "!";\n`,
  "assets/dot.svg": `<svg xmlns="http://www.w3.org/2000/svg"/>\n`,
};

/** A fresh project, served, the workbench open on atoms/loud. */
async function project(): Promise<Bench & { preview(): Promise<string> }> {
  const root = join(tmp, `site-${n++}`);
  for (const [rel, text] of Object.entries(FILES)) await write(join(root, rel), text);
  const b = new Bench(root, "atoms/loud");
  await b.start(config);
  return Object.assign(b, {
    preview: async () => {
      const html = await (await fetch(`${b.origin}/preview/atoms/loud`)).text();
      return /<p class="loud">([^<]*)<\/p>/.exec(html)?.[1] ?? `(no preview: ${html.slice(0, 200)})`;
    },
  });
}

const OPEN = [`{"type":"content-swap","componentId":"atoms/loud"}`];
/** The error message a failed reload sends, up to its problems. */
const failed = (file: string, what: string) => `{"type":"error","scope":"build","message":"${file}: ${what} not reloaded, the last good ones are still in use: `;

beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-reload-")); });
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the rendering holder", () => {
  it("never pairs data with a renderer built from other data, while reloads replace it", async () => {
    const patterns = join(tmp, "holder", "patterns");
    await write(join(patterns, "atoms", "v", "v.hbs"), "{{v}}");
    const handle = createRenderingHandle((_r, d) => createRenderer({ patternsDir: patterns, ...(d ? { globalData: d } : {}) }), [], { v: "0" });
    const mismatches: string[] = [];
    let reloading = true;
    const reader = (async () => {
      while (reloading) {
        const { render, globalData } = handle.current;
        const html = (await render({ component: "atoms/v" })).html.trim();
        if (html !== String(globalData?.["v"])) mismatches.push(`${html} with ${String(globalData?.["v"])}`);
      }
    })();
    for (let i = 1; i <= 200; i++) {
      handle.replace({ globalData: { v: String(i) } });
      await new Promise(r => setImmediate(r));
    }
    reloading = false;
    await reader;
    expect(mismatches).toEqual([]);
    expect(handle.current.globalData).toEqual({ v: "200" });
  });

  it("keeps what is not replaced: new data keeps the helpers, new helpers keep the data", () => {
    const build = vi.fn(() => (async () => ({ html: "" })) as never);
    const h1 = (): void => {};
    const handle = createRenderingHandle(build, [h1], { a: 1 });
    handle.replace({ globalData: { a: 2 } });
    const h2 = (): void => {};
    handle.replace({ registrars: [h2] });
    expect(build.mock.calls).toEqual([[[h1], { a: 1 }], [[h1], { a: 2 }], [[h2], { a: 2 }]]);
  });
});

describe("pd dev reloads data, helpers and assets", () => {
  it("global data: the next render uses the new values", async () => {
    const b = await project();
    expect(await b.preview()).toBe("QUIET! data-1");
    const r = await b.step(() => b.create("src/_data/site.json", `{ "site": { "v": "data-2" } }\n`));
    expect(r.messages).toEqual(OPEN);
    expect(await b.preview()).toBe("QUIET! data-2");
  }, 60_000);

  it("a helper module: the next render uses its new code, with no restart", async () => {
    const b = await project();
    const r = await b.step(() => b.create("src/helpers/shout.js", `import { mark } from "./lib/mark.js";\nexport function shout(s) { return "<" + String(s) + ">" + mark; }\n`), [["change", "src/helpers/shout.js"]]);
    expect(r.messages).toEqual(OPEN);
    expect(await b.preview()).toBe("&lt;quiet&gt;! data-1");
  }, 60_000);

  it("a CommonJS helper module reloads too, in a pd dev of its own", async () => {
    // In its own process, as users run it: Node caches CommonJS by file name, which a test's module loader
    // would hide. Waits for the reload message, then reads the preview.
    const root = join(tmp, `cjs-${n++}`);
    await write(join(root, "pattern-dump.config.json"), JSON.stringify({
      sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
      styles: { strategy: "parallel", dir: "./src/styles" }, helpers: "./src/helpers",
    }));
    await write(join(root, "src/patterns/atoms/loud/loud.hbs"), `<p class="loud">{{shout "quiet"}}</p>\n`);
    await write(join(root, "src/styles/atoms/loud.scss"), ".loud {\n  color: red;\n}\n");
    await write(join(root, "src/helpers/shout.cjs"), `module.exports = { shout: s => "cjs-1:" + s };\n`);
    // Started once it says it's ready. A port found free can be taken by another test file before pd dev
    // binds it: then it exits saying so, and starts again on fresh ones.
    let port = 0, wsPort = 0;
    let pd!: ChildProcess;
    for (let attempt = 1; ; attempt++) {
      [port, wsPort] = [await freePort(), await freePort()];
      pd = spawn(process.execPath, [cli, "dev", "--port", String(port), "--ws-port", String(wsPort)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const started = await new Promise<boolean>((resolve, reject) => {
        pd.stdout!.on("data", (d: Buffer) => { out += String(d); if (out.includes("[dev-server] Ready in")) resolve(true); });
        pd.stderr!.on("data", (d: Buffer) => { out += String(d); });
        pd.once("exit", code => {
          if (out.includes("is already in use") && attempt < 5) resolve(false);
          else reject(new Error(`pd dev exited (${code}): ${out}`));
        });
      });
      if (started) break;
    }
    try {
      const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).text();
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      await get("/api/component/atoms/loud");
      const loud = async () => /<p class="loud">([^<]*)</.exec(await get("/preview/atoms/loud"))?.[1];
      expect(await loud()).toBe("cjs-1:quiet");
      const reloaded = new Promise<void>(resolve => ws.on("message", (d: Buffer) => { if (String(d).includes(`"content-swap"`)) resolve(); }));
      await save(join(root, "src/helpers/shout.cjs"), `module.exports = { shout: s => "cjs-2:" + s };\n`);
      await reloaded;
      expect(await loud()).toBe("cjs-2:quiet");
      ws.close();
    } finally {
      pd.kill();
    }
  }, 60_000);

  it("a file a helper imports: asks for a restart, and nothing reloads", async () => {
    const b = await project();
    const r = await b.step(() => b.create("src/helpers/lib/mark.js", `export const mark = "?";\n`));
    expect(r.messages).toEqual([`{"type":"error","scope":"build","message":"src/helpers/lib/mark.js changed: restart pd dev to load it (a helper's own imports are not reloaded)"}`]);
    expect(await b.preview()).toBe("QUIET! data-1");
  }, 60_000);

  it("an asset: reloads what is open", async () => {
    const b = await project();
    const r = await b.step(() => b.create("assets/dot.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="1"/>\n`));
    expect(r.messages).toEqual(OPEN);
  }, 60_000);
});

describe("a reload that fails keeps the last good state, and the next good save recovers", () => {
  const CASES: Array<[name: string, file: string, what: string, broken: string, problem: string, fixed: string, after: string]> = [
    ["global data that is not valid JSON", "src/_data/site.json", "global data", `{ "site": { "v": "data-2", } }\n`,
      "src/_data/site.json: invalid JSON", `{ "site": { "v": "data-3" } }\n`, "QUIET! data-3"],
    ["a helper with a syntax error", "src/helpers/shout.js", "helpers", `export function shout(s) { return s.; }\n`,
      "src/helpers/shout.js: ", `export function shout(s) { return "fixed:" + s; }\n`, "fixed:quiet data-1"],
    ["a helper module that throws", "src/helpers/shout.js", "helpers", `throw new Error("helper broke");\n`,
      "src/helpers/shout.js: helper broke", `export function shout(s) { return "back:" + s; }\n`, "back:quiet data-1"],
    // It imports, but throws when it registers: found by registering it once on a fresh environment.
    ["a helper whose registration throws", "src/helpers/shout.js", "helpers",
      `export default function register(hb) { throw new Error("registration broke"); }\n`,
      "src/helpers/shout.js: registration broke", `export function shout(s) { return "again:" + s; }\n`, "again:quiet data-1"],
  ];
  for (const [name, file, what, broken, problem, fixed, after] of CASES) {
    it(name, async () => {
      const b = await project();
      const errors = vi.spyOn(console, "error");
      try {
        const r = await b.step(() => b.create(file, broken), [["change", file]]);
        // Listed: one error message to the open pages, the same line in the terminal.
        expect(r.messages).toHaveLength(1);
        expect(r.messages[0].startsWith(failed(file, what))).toBe(true);
        expect(r.messages[0]).toContain(problem);
        expect(errors.mock.calls.map(c => c.join(" ")).filter(l => l.includes(`${file}: ${what} not reloaded`))).toHaveLength(1);
        // Pages still render, with the last good renderer and data.
        expect(await b.preview()).toBe("QUIET! data-1");
      } finally {
        errors.mockRestore();
      }
      const ok = await b.step(() => b.create(file, fixed), [["change", file]]);
      expect(ok.messages).toEqual(OPEN);
      expect(await b.preview()).toBe(after);
    }, 60_000);
  }
});

describe("the storefront page's live client", () => {
  /** Run the served live client against a stand-in page; returns what it did. */
  function client() {
    const elements: Array<{ tag: string; attrs: Record<string, string>; children: unknown[]; textContent: string; style: { cssText: string } }> = [];
    const make = (tag: string) => {
      const el = { tag, attrs: {} as Record<string, string>, children: [] as unknown[], textContent: "", style: { cssText: "" },
        setAttribute(k: string, v: string) { el.attrs[k] = v; },
        appendChild(c: unknown) { el.children.push(c); return c; },
        get firstChild() { return el.children[0]; } };
      elements.push(el);
      return el;
    };
    const body = make("body");
    let onmessage: ((e: { data: string }) => void) | undefined;
    const reloads: string[] = [];
    const document = {
      body,
      createElement: make,
      querySelector: (sel: string) => elements.find(e => sel === "[data-pd-live-notice]" && "data-pd-live-notice" in e.attrs) ?? null,
      querySelectorAll: () => [], // no live examples on this stand-in page
    };
    class WebSocket { set onmessage(f: (e: { data: string }) => void) { onmessage = f; } }
    const src = /<script data-pd-live>([\s\S]*)<\/script>/.exec(liveScript(4321))![1];
    runInContext(src, createContext({ WebSocket, document, location: { hostname: "live.localhost", pathname: "/about/", reload: () => reloads.push("reload") } }));
    return { send: (m: unknown) => onmessage!({ data: JSON.stringify(m) }), elements, reloads };
  }

  it("lists each build problem in one notice on the page, and reloads on a change", () => {
    const c = client();
    c.send({ type: "error", scope: "build", message: "src/_data/site.json: global data not reloaded" });
    c.send({ type: "error", scope: "build", message: "src/helpers/lib/mark.js changed: restart pd dev" });
    const notices = c.elements.filter(e => "data-pd-live-notice" in e.attrs);
    expect(notices.map(n => n.attrs["role"])).toEqual(["alert"]);
    const items = c.elements.filter(e => e.tag === "li").map(e => e.textContent);
    expect(items).toEqual(["src/_data/site.json: global data not reloaded", "src/helpers/lib/mark.js changed: restart pd dev"]);
    expect(c.reloads).toEqual([]);
    c.send({ type: "content-swap", componentId: "atoms/loud" });
    expect(c.reloads).toEqual(["reload"]);
  });
});

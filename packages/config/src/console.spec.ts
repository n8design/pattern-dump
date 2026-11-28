import { describe, it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { WriteStream } from "node:tty";
import { flame, label, line, say, severity, terminal, type Source, type Terminal } from "./console.js";

const plain: Terminal = { colour: false, depth: 1, tty: false };
const term = (depth: Terminal["depth"]): Terminal => ({ colour: true, depth, tty: true });
const pipe = (depth: Terminal["depth"]): Terminal => ({ colour: true, depth, tty: false });
/** A terminal whose depth Node works out from `env`, as a real one does. */
const fakeTty = { isTTY: true, getColorDepth: (env?: NodeJS.ProcessEnv) => WriteStream.prototype.getColorDepth.call(undefined, env) };
const notTty = { isTTY: false };

describe("terminal", () => {
  it("decides colour as Node's util.styleText does, for a pipe", () => {
    const cases: NodeJS.ProcessEnv[] = [
      {}, { FORCE_COLOR: "0" }, { FORCE_COLOR: "1" }, { FORCE_COLOR: "true" }, { FORCE_COLOR: "2" }, { FORCE_COLOR: "3" },
      { NO_COLOR: "1" }, { TERM: "dumb" }, { COLORTERM: "truecolor" },
    ];
    for (const extra of cases) {
      const env = { PATH: process.env["PATH"], ...extra };
      const node = execFileSync(process.execPath, ["-e", 'process.stdout.write(String(require("node:util").styleText("bold", "x") !== "x"))'],
        { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      expect({ env: extra, colour: terminal(notTty, env).colour }).toEqual({ env: extra, colour: node === "true" });
    }
  });

  it("a pipe: FORCE_COLOR gives its depth, nothing else gives colour", () => {
    expect(terminal(notTty, {})).toEqual(plain);
    expect(terminal(notTty, { COLORTERM: "truecolor", TERM: "xterm-256color" })).toEqual(plain);
    expect(terminal(notTty, { FORCE_COLOR: "0" })).toEqual(plain);
    expect(terminal(notTty, { FORCE_COLOR: "1" })).toEqual(pipe(4));
    expect(terminal(notTty, { FORCE_COLOR: "true" })).toEqual(pipe(4));
    expect(terminal(notTty, { FORCE_COLOR: "2" })).toEqual(pipe(8));
    expect(terminal(notTty, { FORCE_COLOR: "3" })).toEqual(pipe(24));
  });

  it("a terminal: its depth, and no colour under NO_COLOR, NODE_DISABLE_COLORS, TERM=dumb or FORCE_COLOR=0", () => {
    expect(terminal(fakeTty, { TERM: "xterm-256color" })).toEqual(term(8));
    expect(terminal(fakeTty, { TERM: "xterm-256color", COLORTERM: "truecolor" })).toEqual(term(24));
    expect(terminal(fakeTty, { TERM: "xterm" })).toEqual(term(4));
    expect(terminal(fakeTty, { TERM_PROGRAM: "Apple_Terminal", COLORTERM: "truecolor" })).toEqual(term(8));
    for (const env of [{ TERM: "xterm-256color", NO_COLOR: "1" }, { TERM: "xterm-256color", NODE_DISABLE_COLORS: "1" }, { TERM: "dumb" },
      { TERM: "xterm-256color", FORCE_COLOR: "0" }, {}]) {
      expect(terminal(fakeTty, env)).toEqual({ colour: false, depth: 1, tty: true });
    }
  });
});

describe("label and line", () => {
  const sources: Source[] = ["ts", "sass", "reload", "components", "site", "images", "audit", "mcp", "pd"];

  it("plain where colour is off", () => {
    for (const s of sources) expect(line(s, "text", plain)).toBe(`[${s}] text`);
  });

  it("four labels bold and coloured; the others plain", () => {
    expect(label("ts", term(8))).toBe("\x1b[1m\x1b[34m[ts]\x1b[39m\x1b[22m");
    expect(label("sass", term(8))).toBe("\x1b[1m\x1b[35m[sass]\x1b[39m\x1b[22m");
    expect(label("components", term(8))).toBe("\x1b[1m\x1b[36m[components]\x1b[39m\x1b[22m");
    for (const s of ["site", "images", "audit", "mcp", "pd"] as const) expect(label(s, term(24))).toBe(`[${s}]`);
    expect(line("sass", "CSS updated: base.scss", term(4))).toBe("\x1b[1m\x1b[35m[sass]\x1b[39m\x1b[22m CSS updated: base.scss");
  });

  it("[reload] orange on a terminal with 256 colours, bright yellow below that and in a pipe", () => {
    expect(label("reload", term(8))).toBe("\x1b[1;38;5;208m[reload]\x1b[39;22m");
    expect(label("reload", term(24))).toBe("\x1b[1;38;5;208m[reload]\x1b[39;22m");
    expect(label("reload", term(4))).toBe("\x1b[1m\x1b[93m[reload]\x1b[39m\x1b[22m");
    expect(label("reload", pipe(8))).toBe("\x1b[1m\x1b[93m[reload]\x1b[39m\x1b[22m");
    expect(label("reload", pipe(24))).toBe("\x1b[1m\x1b[93m[reload]\x1b[39m\x1b[22m");
  });
});

describe("severity", () => {
  it("the words stay; colour only adds", () => {
    expect(severity("error:", plain)).toBe("error:");
    expect(severity("warning:", plain)).toBe("warning:");
    expect(severity("passed", plain)).toBe("passed");
    expect(severity("error:", term(4))).toBe("\x1b[1m\x1b[31merror:\x1b[39m\x1b[22m");
    expect(severity("warning:", term(4))).toBe("\x1b[33mwarning:\x1b[39m");
    expect(severity("passed", pipe(4))).toBe("\x1b[32mpassed\x1b[39m");
  });
});

describe("flame", () => {
  it("only on a terminal with colour", () => {
    expect(flame(term(4))).toBe(" \u{1F525}");
    expect(flame(pipe(24))).toBe("");
    expect(flame(plain)).toBe("");
    expect(flame({ colour: false, depth: 1, tty: true })).toBe("");
  });
});

describe("say", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("prints through console.log, console.warn and console.error", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    say("sass", "CSS updated");
    say("components", "dataDir not found: data", "warn");
    say("ts", "Unhandled request error", "error");
    expect(log.mock.calls).toEqual([["[sass] CSS updated"]]);
    expect(warn.mock.calls).toEqual([["[components] dataDir not found: data"]]);
    expect(error.mock.calls).toEqual([["[ts] Unhandled request error"]]);
  });
});

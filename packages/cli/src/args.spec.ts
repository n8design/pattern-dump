// Pins the CLI's flags and defaults. Written against the behaviour of the hand-rolled parser this
// replaced, so the move to util.parseArgs cannot quietly change what an existing invocation does.

import { describe, expect, it } from "vitest";
import { parseCommand, USAGE } from "./args.js";

const cwd = "/work/project";

describe("pd dev", () => {
  it("defaults the root to cwd and sets nothing else", () => {
    expect(parseCommand(["dev"], cwd)).toEqual({ kind: "dev", root: cwd });
  });

  it("resolves --root and --config against cwd, independently", () => {
    expect(parseCommand(["dev", "--root", "../ds", "--config", "bench/pd.config.ts"], cwd)).toEqual({
      kind: "dev", root: "/work/ds", configPath: "/work/project/bench/pd.config.ts",
    });
  });

  it("parses ports, in both --flag value and --flag=value form", () => {
    expect(parseCommand(["dev", "--port", "4100", "--ws-port=4101"], cwd))
      .toEqual({ kind: "dev", root: cwd, port: 4100, wsPort: 4101 });
  });

  it("takes the last value of a repeated flag, as before", () => {
    expect(parseCommand(["dev", "--port", "1", "--port", "2"], cwd)).toMatchObject({ port: 2 });
  });

  it("rejects a non-numeric port instead of starting on NaN", () => {
    expect(parseCommand(["dev", "--port", "abc"], cwd)).toMatchObject({ kind: "error" });
  });
});

describe("pd audit", () => {
  it("defaults the format to md", () => {
    expect(parseCommand(["audit"], cwd)).toEqual({ kind: "audit", root: cwd, format: "md" });
  });

  it("accepts md|text|json and rejects anything else", () => {
    expect(parseCommand(["audit", "--format", "json"], cwd)).toMatchObject({ format: "json" });
    expect(parseCommand(["audit", "--format", "html"], cwd)).toEqual({
      kind: "error", message: '--format must be one of md|text|json (got "html")',
    });
  });
});

describe("pd build", () => {
  it("passes --out and --base through as given; the root resolves against cwd", () => {
    expect(parseCommand(["build"], "/work/project")).toEqual({ kind: "build", root: "/work/project" });
    expect(parseCommand(["build", "--root", "ds", "--out", "site", "--base=/docs/"], "/work/project"))
      .toEqual({ kind: "build", root: "/work/project/ds", out: "site", base: "/docs/" });
  });

  it("--browser also checks the storefront's pages in Chromium; without it, nothing is set", () => {
    expect(parseCommand(["build", "--browser"], "/w")).toEqual({ kind: "build", root: "/w", browser: true });
    expect(parseCommand(["build"], "/w")).not.toHaveProperty("browser");
  });

  it("--no-audit and --audit override the config; both together are an error", () => {
    expect(parseCommand(["build", "--no-audit"], "/w")).toEqual({ kind: "build", root: "/w", audit: false });
    expect(parseCommand(["build", "--audit"], "/w")).toEqual({ kind: "build", root: "/w", audit: true });
    expect(parseCommand(["build", "--audit", "--no-audit"], "/w")).toMatchObject({ kind: "error" });
  });

  it("--skip-checks takes a comma-separated list, passed on as given; empty skips none", () => {
    expect(parseCommand(["build", "--skip-checks=a11y"], "/w")).toEqual({ kind: "build", root: "/w", skipChecks: ["a11y"] });
    expect(parseCommand(["build", "--skip-checks", "a11y, html"], "/w")).toEqual({ kind: "build", root: "/w", skipChecks: ["a11y", "html"] });
    expect(parseCommand(["build", "--skip-checks="], "/w")).toEqual({ kind: "build", root: "/w", skipChecks: [] });
    expect(parseCommand(["build"], "/w")).not.toHaveProperty("skipChecks");
  });

  it("--check-workers takes a whole number of 1 or more; left out, the build chooses", () => {
    expect(parseCommand(["build", "--check-workers", "3"], "/w")).toEqual({ kind: "build", root: "/w", checkWorkers: 3 });
    expect(parseCommand(["build", "--check-workers", "1"], "/w")).toEqual({ kind: "build", root: "/w", checkWorkers: 1 });
    expect(parseCommand(["build"], "/w")).not.toHaveProperty("checkWorkers");
    for (const bad of ["0", "-2", "1.5", "many", ""]) {
      expect(parseCommand(["build", `--check-workers=${bad}`], "/w")).toEqual({
        kind: "error", message: `--check-workers takes a whole number of 1 or more (got "${bad}")`,
      });
    }
  });
});

describe("pd export", () => {
  it("passes --out through unresolved (runExport validates it against the root)", () => {
    expect(parseCommand(["export", "--root", "ds", "--out", "../out"], cwd))
      .toEqual({ kind: "export", root: "/work/project/ds", out: "../out" });
  });
});

describe("pd init", () => {
  it("reads --with-site and --without-site, and leaves the answer open without either", () => {
    expect(parseCommand(["init", "--with-site"], cwd)).toEqual({ kind: "init", target: cwd, yes: false, storefront: true });
    expect(parseCommand(["init", "--without-site"], cwd)).toEqual({ kind: "init", target: cwd, yes: false, storefront: false });
    expect(parseCommand(["init"], cwd)).not.toHaveProperty("storefront");
  });

  it("takes --storefront and --no-storefront, their names before 0.8.0, with a warning each", () => {
    expect(parseCommand(["init", "--storefront"], cwd)).toMatchObject({ kind: "init", storefront: true, warnings: ["--storefront is now --with-site"] });
    expect(parseCommand(["init", "--no-storefront"], cwd)).toMatchObject({ kind: "init", storefront: false, warnings: ["--no-storefront is now --without-site"] });
    expect(parseCommand(["init", "--with-site", "--storefront"], cwd)).toMatchObject({ storefront: true, warnings: ["--storefront is now --with-site"] });
    expect(parseCommand(["init", "--with-site"], cwd)).not.toHaveProperty("warnings");
  });

  it("--with-site is not --site: --site <package> keeps its meaning", () => {
    expect(parseCommand(["init", "--site", "../styleguide"], cwd)).toEqual({ kind: "init", target: cwd, yes: false, site: "../styleguide" });
  });

  it("reads --search / --no-search and --system-theme / --no-system-theme, open without either", () => {
    expect(parseCommand(["init", "--no-search", "--system-theme"], cwd)).toMatchObject({ kind: "init", search: false, systemTheme: true });
    expect(parseCommand(["init", "--search", "--no-system-theme"], cwd)).toMatchObject({ kind: "init", search: true, systemTheme: false });
    const open = parseCommand(["init"], cwd);
    expect(open).not.toHaveProperty("search");
    expect(open).not.toHaveProperty("systemTheme");
    expect(parseCommand(["init", "--search", "--no-search"], cwd)).toEqual({ kind: "error", message: "--search and --no-search cannot both be given" });
  });

  it("defaults to the current folder and asks for everything else", () => {
    expect(parseCommand(["init"], cwd)).toEqual({ kind: "init", target: cwd, yes: false });
  });

  it("takes a folder, every answer as a flag, and --yes", () => {
    expect(parseCommand([
      "init", "../my-ds", "--name", "my-ds", "--brand=My DS", "--no-examples", "--no-install", "--git",
      "--pd-source", "./pattern-dump-0.1.0.tgz", "-y",
    ], cwd)).toEqual({
      kind: "init", target: "/work/my-ds", yes: true, name: "my-ds", brand: "My DS",
      examples: false, install: false, git: true, pdSource: "./pattern-dump-0.1.0.tgz",
    });
  });

  it("rejects contradictory toggles and more than one folder", () => {
    expect(parseCommand(["init", "--git", "--no-git"], cwd)).toEqual({ kind: "error", message: "--git and --no-git cannot both be given" });
    expect(parseCommand(["init", "--with-site", "--without-site"], cwd)).toEqual({ kind: "error", message: "--with-site and --without-site cannot both be given" });
    expect(parseCommand(["init", "--storefront", "--without-site"], cwd)).toEqual({ kind: "error", message: "--storefront and --without-site cannot both be given" });
    expect(parseCommand(["init", "--storefront", "--no-storefront"], cwd)).toEqual({ kind: "error", message: "--storefront and --no-storefront cannot both be given" });
    expect(parseCommand(["init", "a", "b"], cwd)).toMatchObject({ kind: "error" });
  });
});

describe("help and errors", () => {
  it("no command, help, --help and -h all mean help", () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) expect(parseCommand(argv, cwd).kind).toBe("help");
    expect(parseCommand(["help", "audit"], cwd)).toEqual({ kind: "help", topic: "audit" });
    expect(parseCommand(["dev", "--help"], cwd)).toEqual({ kind: "help", topic: "dev" });
  });

  it("--version and -v ask for the version; help lists it", () => {
    for (const argv of [["--version"], ["-v"]]) expect(parseCommand(argv, cwd)).toEqual({ kind: "version" });
    expect(USAGE).toMatch(/^ {2}--version, -v +Print the installed version$/m);
  });

  it("an unknown command or flag is an error, not silently ignored", () => {
    expect(parseCommand(["serve"], cwd)).toEqual({ kind: "error", message: 'unknown command "serve"' });
    expect(parseCommand(["dev", "--prot", "4000"], cwd)).toMatchObject({ kind: "error" });
    expect(parseCommand(["dev", "--port"], cwd)).toMatchObject({ kind: "error" });
  });
});

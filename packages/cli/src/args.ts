// Command-line parsing for `pd`, kept pure: argv + cwd in, a typed command out. No process access,
// so every flag and default is unit-testable. src/index.ts does the running.
//
// Built on node:util parseArgs (no dependency): `--flag value` and `--flag=value` both work, repeated
// flags take the last value, and an unknown flag or a missing value is an error rather than being
// silently ignored as the old hand-rolled scanner did.

import { resolve } from "node:path";
import { parseArgs } from "node:util";

export type AuditFormat = "md" | "text" | "json";

export type Command =
  | { kind: "dev"; root: string; configPath?: string; port?: number; wsPort?: number }
  | { kind: "audit"; root: string; configPath?: string; format: AuditFormat; strict?: boolean }
  | { kind: "export"; root: string; configPath?: string; out?: string }
  | { kind: "build"; root: string; configPath?: string; out?: string; base?: string; audit?: boolean; browser?: boolean; checkWorkers?: number; skipChecks?: string[] }
  | { kind: "init"; target: string; yes: boolean; name?: string; brand?: string; examples?: boolean;
      storefront?: boolean; search?: boolean; systemTheme?: boolean; install?: boolean; git?: boolean; pdSource?: string;
      site?: string; workbenchUrl?: string }
  | { kind: "help"; topic?: string }
  | { kind: "error"; message: string };

const COMMANDS = ["init", "dev", "audit", "build", "export"] as const;

/** `--root` and `--config` resolve against the invoking cwd, independently of each other: a config
 *  may live outside the root it opens (a read-only project you don't own). The config's own paths
 *  still resolve against the root — see PatternDumpConfig. */
const rootAndConfig = {
  root: { type: "string" },
  config: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

function port(value: string | undefined, flag: string): number | undefined | Error {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : new Error(`${flag} must be a port number (got "${value}")`);
}

export function parseCommand(argv: string[], cwd: string): Command {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h") {
    return { kind: "help", ...(rest[0] ? { topic: rest[0] } : {}) };
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) {
    return { kind: "error", message: `unknown command "${cmd}"` };
  }

  try {
    if (cmd === "init") return parseInit(rest, cwd);

    if (cmd === "dev") {
      const { values } = parseArgs({
        args: rest, strict: true, allowPositionals: false,
        options: { ...rootAndConfig, port: { type: "string" }, "ws-port": { type: "string" } },
      });
      if (values.help) return { kind: "help", topic: cmd };
      const p = port(values.port, "--port");
      const ws = port(values["ws-port"], "--ws-port");
      if (p instanceof Error) return { kind: "error", message: p.message };
      if (ws instanceof Error) return { kind: "error", message: ws.message };
      return {
        kind: "dev",
        ...base(values, cwd),
        ...(p !== undefined ? { port: p } : {}),
        ...(ws !== undefined ? { wsPort: ws } : {}),
      };
    }

    if (cmd === "audit") {
      const { values } = parseArgs({
        args: rest, strict: true, allowPositionals: false,
        options: { ...rootAndConfig, format: { type: "string" }, strict: { type: "boolean" } },
      });
      if (values.help) return { kind: "help", topic: cmd };
      const format = values.format ?? "md";
      if (format !== "md" && format !== "text" && format !== "json") {
        return { kind: "error", message: `--format must be one of md|text|json (got "${format}")` };
      }
      return { kind: "audit", ...base(values, cwd), format, ...(values.strict ? { strict: true } : {}) };
    }

    if (cmd === "build") {
      const { values } = parseArgs({
        args: rest, strict: true, allowPositionals: false,
        options: {
          ...rootAndConfig, out: { type: "string" }, base: { type: "string" },
          audit: { type: "boolean" }, "no-audit": { type: "boolean" }, browser: { type: "boolean" },
          "check-workers": { type: "string" }, "skip-checks": { type: "string" },
        },
      });
      if (values.help) return { kind: "help", topic: cmd };
      const audit = toggle(values, "audit");
      if (audit instanceof Error) return { kind: "error", message: audit.message };
      const workers = values["check-workers"];
      if (workers !== undefined && !/^[1-9]\d*$/.test(workers)) {
        return { kind: "error", message: `--check-workers takes a whole number of 1 or more (got "${workers}")` };
      }
      // --out resolves against the ROOT (like every config path), so it is passed through as given.
      return {
        kind: "build", ...base(values, cwd),
        ...(values.out !== undefined ? { out: values.out } : {}),
        ...(values.base !== undefined ? { base: values.base } : {}),
        ...(audit !== undefined ? { audit } : {}),
        ...(values.browser ? { browser: true } : {}),
        ...(workers !== undefined ? { checkWorkers: Number(workers) } : {}),
        // A comma-separated list; empty skips none (over build.skipChecks in the config).
        ...(values["skip-checks"] !== undefined ? { skipChecks: values["skip-checks"].split(",").map(c => c.trim()).filter(Boolean) } : {}),
      };
    }

    const { values } = parseArgs({
      args: rest, strict: true, allowPositionals: false,
      options: { ...rootAndConfig, out: { type: "string" } },
    });
    if (values.help) return { kind: "help", topic: cmd };
    // --out is passed through unresolved: runExport resolves and validates it against the root.
    return { kind: "export", ...base(values, cwd), ...(values.out !== undefined ? { out: values.out } : {}) };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** `--x` / `--no-x` pairs. Implemented as two options rather than parseArgs' allowNegative, with which
 *  the last one given would win: here giving both is an error. */
function toggle(values: Record<string, unknown>, name: string): boolean | undefined | Error {
  const on = values[name] === true;
  const off = values[`no-${name}`] === true;
  if (on && off) return new Error(`--${name} and --no-${name} cannot both be given`);
  return on ? true : off ? false : undefined;
}

function parseInit(rest: string[], cwd: string): Command {
  const { values, positionals } = parseArgs({
    args: rest, strict: true, allowPositionals: true,
    options: {
      name: { type: "string" },
      brand: { type: "string" },
      examples: { type: "boolean" }, "no-examples": { type: "boolean" },
      storefront: { type: "boolean" }, "no-storefront": { type: "boolean" },
      search: { type: "boolean" }, "no-search": { type: "boolean" },
      "system-theme": { type: "boolean" }, "no-system-theme": { type: "boolean" },
      install: { type: "boolean" }, "no-install": { type: "boolean" },
      git: { type: "boolean" }, "no-git": { type: "boolean" },
      "pd-source": { type: "string" },
      site: { type: "string" },
      "workbench-url": { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { kind: "help", topic: "init" };
  if (positionals.length > 1) return { kind: "error", message: `init takes one folder (got ${positionals.join(", ")})` };

  const names = ["examples", "storefront", "search", "system-theme", "install", "git"] as const;
  const toggles: Record<(typeof names)[number], boolean | undefined> =
    { examples: undefined, storefront: undefined, search: undefined, "system-theme": undefined, install: undefined, git: undefined };
  for (const name of names) {
    const t = toggle(values, name);
    if (t instanceof Error) return { kind: "error", message: t.message };
    toggles[name] = t;
  }
  return {
    kind: "init",
    target: resolve(cwd, positionals[0] ?? "."),
    yes: values.yes === true,
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.brand !== undefined ? { brand: values.brand } : {}),
    ...(toggles.examples !== undefined ? { examples: toggles.examples } : {}),
    ...(toggles.storefront !== undefined ? { storefront: toggles.storefront } : {}),
    ...(toggles.search !== undefined ? { search: toggles.search } : {}),
    ...(toggles["system-theme"] !== undefined ? { systemTheme: toggles["system-theme"] } : {}),
    ...(toggles.install !== undefined ? { install: toggles.install } : {}),
    ...(toggles.git !== undefined ? { git: toggles.git } : {}),
    ...(values["pd-source"] !== undefined ? { pdSource: values["pd-source"] } : {}),
    ...(values.site !== undefined ? { site: values.site } : {}),
    ...(values["workbench-url"] !== undefined ? { workbenchUrl: values["workbench-url"] } : {}),
  };
}

function base(values: { root?: string; config?: string }, cwd: string): { root: string; configPath?: string } {
  return {
    root: values.root ? resolve(cwd, values.root) : cwd,
    ...(values.config ? { configPath: resolve(cwd, values.config) } : {}),
  };
}

export const USAGE = `Usage: pd <command> [options]

  init [dir]   Set up a new Pattern Dump project (default: the current folder)
    --name <name>      Package name (default: the folder name; a generic one such as styleguide or
                       site is scoped by its parent folder: acme-web/site gives @acme-web/site)
    --brand <title>    Title shown in the Nav Rail; with --site, the site's title (default: the name,
                       or the parent folder's for a scoped one)
    --no-examples      Structure, config and themes only, no starter components
    --storefront       Also a website: pages, a skin, and a GitHub Pages workflow (default: no)
    --no-search        With a website: leave Pagefind out (default: a devDependency, so pd build
                       writes the site's search index)
    --no-system-theme  With a website: the light theme as the default, and pages in light colours
                       (default: a system theme that follows the viewer's light or dark setting)
    --site <package>   A website on an existing style guide instead: its npm name (@acme/styleguide,
                       or @acme/styleguide@1.2.0) or its folder (../styleguide). Writes pages, a config
                       and a package.json only; the components, styles and skin come from the package
    --workbench-url <url>  With --site: where the style guide's workbench is published, a full address
                       or a path on the site's host (default: /workbench/)
    --no-install       Skip npm install
    --git / --no-git   Run git init (default: yes, unless already inside a repository)
    --pd-source <src>  Where to install Pattern Dump from: a .tgz file or an npm spec
    -y, --yes          Accept every default without asking

  dev      Start the local dev server
    --root <path>      Open a specific project root (default: current directory)
    --config <path>    Use a config file outside the root (paths resolve against --root)
    --port <n>         HTTP port (default 4000, env: PD_PORT)
    --ws-port <n>      WebSocket port (default port+1, env: PD_WS_PORT)

  audit    Build the diagnostics graph and emit the report + serialized JSON
    --root <path>      Audit a specific project root
    --config <path>    Use a config file outside the root
    --format <fmt>     Report format: md (default) | text | json (json → stdout only)
    --strict           Fail on any finding: by default pd audit fails (exit code 1) on an error,
                       not on warnings alone

  build    Write a static snapshot of the workbench: plain files for any static host
    --root <path>      Build a specific project root
    --config <path>    Use a config file outside the root
    --out <dir>        Output folder, relative to the root (default: build.outDir, outDir, or dist)
    --base <path>      Where it will be hosted: / or a subpath such as /docs/ (default: build.basePath,
                       then /)
    --browser          Also check the storefront's pages in Chromium: contrast and the accessibility
                       rules that need a rendered page, and each image's variant against its size.
                       Uses the project's own Playwright (npm install --save-dev playwright)
    --no-audit         Leave the corpus audit out: it is not run, and the site has no Audit tab
                       (default: build.audit in the config; --audit forces it back in)
    --check-workers <n>  Threads that check the storefront's pages for accessibility; 1 checks them in
                       one (default: the cores less one, at most 8, within a quarter of the memory)
    --skip-checks=a11y,html  Leave checks out, for a quick local build: a11y, the storefront pages'
                       accessibility; html, the components' markup against HTML's content model.
                       The report says so. Default: every check runs (build.skipChecks)

  export   Write the subject's flattened families back out in corrected form
    --root <path>      Export a specific project root (read-only)
    --out <dir>        Durable output sink (must be outside --root)
    --config <path>    Use a config file outside the root

  help     Show this help`;

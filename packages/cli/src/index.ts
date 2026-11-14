#!/usr/bin/env node
// @pattern-dump/cli — the `pd` binary. Parsing is pure (./args.ts); this file only runs the result.
import { runDev, runAudit, runBuild, runExport } from "@pattern-dump/core";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseCommand, USAGE } from "./args.js";
import { runInit } from "./init/run.js";
import { detectLocalBuild } from "./init/local-build.js";
import { PD_PACKAGE_NAME, PD_VERSION } from "./distribution.js";

const command = parseCommand(process.argv.slice(2), process.cwd());

/** What to print for a failed command. A config problem is written for the person editing the
 *  config, so it gets its message alone; anything else keeps its stack trace. Matched by name, not
 *  class, so the CLI needs no import beyond core. */
function describeError(e: unknown): unknown {
  return e instanceof Error && e.name === "ConfigError" ? e.message : e;
}

switch (command.kind) {
  case "init": {
    const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
    runInit(command, {
      cwd: process.cwd(),
      // templates/ ships beside dist/ — the same relative position in this repo and in the package.
      templatesDir: fileURLToPath(new URL("../templates/", import.meta.url)),
      interactive: rl !== null,
      localBuild: detectLocalBuild(import.meta.url, PD_PACKAGE_NAME, PD_VERSION),
      async ask(question, fallback) {
        const answer = (await rl!.question(`${question} (${fallback}): `)).trim();
        return answer || fallback;
      },
      async confirm(question, fallback) {
        const answer = (await rl!.question(`${question} (${fallback ? "Y/n" : "y/N"}): `)).trim().toLowerCase();
        return answer === "" ? fallback : answer.startsWith("y");
      },
      log: message => console.log(message),
      run: (cmd, args, cwd) => new Promise(resolve => {
        const quiet = cmd === "git" && args[0] === "rev-parse";
        const child = spawn(cmd, args, { cwd, stdio: quiet ? "ignore" : "inherit", shell: process.platform === "win32" });
        child.on("error", () => resolve(null));
        child.on("close", code => resolve(code));
      }),
    })
      .then(code => { rl?.close(); process.exitCode = code; })
      .catch((e) => { rl?.close(); console.error("[pd] Error:", e); process.exitCode = 1; });
    break;
  }

  case "dev":
    runDev(command.root, {
      ...(command.port !== undefined ? { port: command.port } : {}),
      ...(command.wsPort !== undefined ? { wsPort: command.wsPort } : {}),
    }, command.configPath).catch((e: unknown) => {
      // A port conflict is an everyday situation with a known fix: say so, without a stack trace.
      if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "EADDRINUSE" && e instanceof Error) {
        console.error(`[pd] ${e.message}`);
      } else {
        console.error("[pd] Error:", describeError(e));
      }
      process.exit(1);
    });
    break;

  case "audit":
    // The audit leaves handles open (renderer, jsdom), so it must exit explicitly — but only once
    // stdout has flushed. On a pipe Node writes stdout asynchronously, and a bare process.exit(0)
    // cut `pd audit --format json | …` off at the first 512 bytes. An empty write's callback runs
    // after every write queued before it.
    runAudit(command.root, command.configPath, command.format)
      .then(() => process.stdout.write("", () => process.exit(0)))
      .catch((e) => { console.error("[pd] Error:", describeError(e)); process.exit(1); });
    break;

  case "build":
    // Explicit exit once written: the headless server's renderer may leave handles open.
    runBuild(command.root, command.configPath, {
      ...(command.out !== undefined ? { out: command.out } : {}),
      ...(command.base !== undefined ? { base: command.base } : {}),
      ...(command.audit !== undefined ? { audit: command.audit } : {}),
      ...(command.browser ? { browser: true } : {}),
      pdVersion: PD_VERSION,
    })
      .then(() => process.stdout.write("", () => process.exit(0)))
      .catch((e) => { console.error("[pd] Error:", e instanceof Error ? e.message : e); process.exit(1); });
    break;

  case "export":
    // Set exitCode rather than process.exit(0): export's stdout IS its report, and process.exit can
    // truncate buffered stdout on large output before it flushes. runExport leaves no open handles,
    // so Node exits cleanly once the report has drained.
    runExport(command.root, command.configPath, command.out)
      .then(() => { process.exitCode = 0; })
      .catch((e) => { console.error("[pd] Error:", describeError(e)); process.exitCode = 1; });
    break;

  case "help":
    console.log(USAGE);
    break;

  case "error":
    console.error(`[pd] Error: ${command.message}\n`);
    console.error(USAGE);
    process.exit(1);
    break;

  default: {
    const unhandled: never = command;
    void unhandled;
  }
}

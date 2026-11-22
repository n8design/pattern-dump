// The commit-msg hook's rules (commitlint.config.js): no tool attribution in a commit (a Co-authored-by or
// Claude-Session trailer, a "Generated with Claude" line) and a subject of at most 72 characters.
import { test } from "node:test";
import assert from "node:assert/strict";
import load from "@commitlint/load";
import lint from "@commitlint/lint";

const config = await load({}, { cwd: new URL("..", import.meta.url).pathname });
/** The rules a message breaks, by name; empty when it passes. */
async function broken(message) {
  const r = await lint(message, config.rules, { plugins: config.plugins, parserOpts: config.parserPreset?.parserOpts });
  return r.errors.map(e => e.name);
}

test("a clean message passes", async () => {
  assert.deepEqual(await broken("fix(dev-server): read a tag over several lines\n\nThe body says why.\n"), []);
});

test("a Co-authored-by trailer is refused", async () => {
  assert.deepEqual(await broken("fix: a change\n\nThe body.\n\nCo-authored-by: Someone <someone@example.test>\n"), ["no-tool-attribution"]);
});

test("a Claude-Session trailer is refused", async () => {
  assert.deepEqual(await broken("fix: a change\n\nThe body.\n\nClaude-Session: https://example.test/session/1\n"), ["no-tool-attribution"]);
});

test("a Generated with line is refused", async () => {
  assert.deepEqual(await broken("fix: a change\n\nThe body.\n\nGenerated with [Claude Code](https://example.test)\n"), ["no-tool-attribution"]);
});

test("a subject over 72 characters is refused", async () => {
  const subject = `fix: ${"x".repeat(68)}`;
  assert.equal(subject.length, 73);
  assert.deepEqual(await broken(`${subject}\n`), ["header-max-length"]);
  assert.deepEqual(await broken(`${subject.slice(0, 72)}\n`), []);
});

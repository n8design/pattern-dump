// The harness's step() with no declared events: it waits until the last write of each file the act touched
// is handled. "Handled" is a stamp comparison (the stamp the watcher last read of the file equals the file's
// stamp on disk), not a quiet period. The rule is a pure function, held by cases of its own; the rest runs
// a served project, with an act that writes one file twice, one that removes a file, and one that writes two.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@pattern-dump/config";
import { Bench, closeAll, diskStamp, handled, isSettled, LATCH_MS } from "./watch-harness.js";
import { save } from "../../../test-support/save.js";

describe("isSettled: the last handled stamp equals the stamp on disk", () => {
  it("is not settled before the file is handled at all", () => {
    expect(isSettled([], "a")).toBe(false);
  });
  it("is settled when the only handling read what is on disk", () => {
    expect(isSettled(["a"], "a")).toBe(true);
  });
  // The case a comparison with the FIRST handled stamp gets wrong: the file was written again after the
  // first handling, whose stamp is old, and the second handling's is what is on disk.
  it("is settled by the last handling, not the first", () => {
    expect(isSettled(["a", "b"], "b")).toBe(true);
  });
  it("is not settled while a later write has not been handled", () => {
    expect(isSettled(["a"], "b")).toBe(false);
    expect(isSettled(["a", "b"], "c")).toBe(false);
  });
  it("is settled for a removed file once its removal is handled", () => {
    expect(isSettled(["a", null], null)).toBe(true);
    expect(isSettled(["a"], null)).toBe(false);
  });
});

const config = defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
});
const FILE = "src/patterns/atoms/btn/btn.hbs";
const OTHER = "src/patterns/atoms/chip/chip.hbs";

let tmp = "";
let b: Bench;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pd-step-settle-"));
  const root = join(tmp, "site");
  for (const f of [FILE, OTHER]) {
    await mkdir(dirname(join(root, f)), { recursive: true });
    await save(join(root, f), `<p>${f}</p>\n`);
  }
  await mkdir(join(root, "src/styles"), { recursive: true });
  b = new Bench(root, "atoms/btn");
  await b.start(config);
}, 60_000);
afterAll(async () => {
  await closeAll();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

// A case's own limit, above the harness latch (LATCH_MS, 5 s): a step waits on up to four latches, so a
// case limit at or under one latch (vitest's default is 5 s) ends the case before a stalled latch can say
// what it waited for, and a slow run reads as a bare timeout.
const CASE_MS = 4 * LATCH_MS;

describe("step() with no declared events", () => {
  it("returns after the last of two writes to one file is handled, and the disk's stamp is the last one read", async () => {
    const from = handled.length;
    const r = await b.step(async () => { await b.edit(FILE, "one\n"); await b.edit(FILE, "two\n"); });
    const mine = handled.slice(from).filter(h => b.owns(h.path) && b.rel(h.path) === FILE);
    expect(mine.length).toBeGreaterThan(0);
    // The formula in the harness is the watcher's: the last stamp it read is the file's stamp now.
    expect(mine[mine.length - 1]!.stamp).toBe(await diskStamp(b.at(FILE)));
    expect(r.events.every(([event]) => event === "change")).toBe(true);
    expect(r.messages.length).toBeGreaterThan(0);
  }, CASE_MS);

  it("waits for each of two files the act wrote", async () => {
    const from = handled.length;
    await b.step(async () => { await b.edit(FILE, "a\n"); await b.edit(OTHER, "b\n"); });
    const rels = handled.slice(from).filter(h => b.owns(h.path)).map(h => b.rel(h.path));
    expect(rels).toContain(FILE);
    expect(rels).toContain(OTHER);
   }, CASE_MS);

  it("waits for the removal of a file the act removed", async () => {
    await b.step(() => b.create("src/patterns/atoms/gone/gone.hbs", "<i>x</i>\n"));
    const r = await b.step(() => b.remove("src/patterns/atoms/gone/gone.hbs"));
    expect(r.events).toContainEqual(["unlink", "src/patterns/atoms/gone/gone.hbs"]);
   }, CASE_MS);

  it("a declared list still behaves as it did: the events named, and the case asserts what it got", async () => {
    const r = await b.step(() => b.edit(FILE, "c\n"), [["change", FILE]]);
    expect(r.events).toContainEqual(["change", FILE]);
   }, CASE_MS);
});
